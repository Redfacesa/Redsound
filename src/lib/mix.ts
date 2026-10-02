import type { Arrangement, MixerChannel } from '@shared/arrange.ts';

const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();

function reverbImpulse(ctx: BaseAudioContext): AudioBuffer {
  const cached = impulses.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 1.6);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2.4;
    }
  }
  impulses.set(ctx, buffer);
  return buffer;
}

function effectAmount(channel: MixerChannel, type: MixerChannel['effects'][number]['type']): number {
  const effect = channel.effects.find((item) => item.type === type);
  return effect?.enabled ? effect.amount : 0;
}

export function buildDesk(ctx: BaseAudioContext, channels: MixerChannel[], destination?: AudioNode) {
  const masterChannel = channels.find((channel) => channel.kind === 'master');
  const master = ctx.createGain();
  master.gain.value = masterChannel?.muted ? 0 : masterChannel?.volume ?? 0.9;
  const limiter = ctx.createDynamicsCompressor();
  const limit = masterChannel ? effectAmount(masterChannel, 'compressor') : 0;
  limiter.threshold.value = limit > 0 ? -18 : 0;
  limiter.knee.value = 8;
  limiter.ratio.value = limit > 0 ? 8 : 1;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  master.connect(limiter);
  limiter.connect(destination || ctx.destination);

  const buses = new Map<string, GainNode>();
  for (const channel of channels.filter((item) => item.kind === 'bus')) {
    const gain = ctx.createGain();
    gain.gain.value = channel.muted ? 0 : channel.volume;
    gain.connect(master);
    buses.set(channel.id, gain);
  }

  const inputs = new Map<string, GainNode>();
  const soloed = channels.some((channel) => channel.kind === 'channel' && channel.solo);
  for (const channel of channels.filter((item) => item.kind === 'channel')) {
    const input = ctx.createGain();
    input.gain.value = channel.muted || (soloed && !channel.solo) ? 0 : 1;
    let node: AudioNode = input;
    const eqAmount = effectAmount(channel, 'eq');
    if (eqAmount > 0) {
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 180;
      low.gain.value = (eqAmount - 0.5) * 8;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 3200;
      high.gain.value = (eqAmount - 0.35) * 8;
      node.connect(low);
      low.connect(high);
      node = high;
    }
    const deEss = effectAmount(channel, 'de-esser');
    if (deEss > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = 6500;
      filter.Q.value = 2.2;
      filter.gain.value = -14 * deEss;
      node.connect(filter);
      node = filter;
    }
    const compression = effectAmount(channel, 'compressor');
    if (compression > 0) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -36 * compression;
      compressor.knee.value = 12;
      compressor.ratio.value = 1 + 6 * compression;
      compressor.attack.value = 0.012;
      compressor.release.value = 0.18;
      node.connect(compressor);
      node = compressor;
    }
    const drive = effectAmount(channel, 'saturation');
    if (drive > 0) {
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      const k = 1 + drive * 18;
      for (let index = 0; index < curve.length; index += 1) {
        const x = index / 128 - 1;
        curve[index] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      shaper.curve = curve;
      node.connect(shaper);
      node = shaper;
    }
    const fader = ctx.createGain();
    fader.gain.value = channel.volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, channel.pan));
    node.connect(fader);
    fader.connect(panner);
    const wetIn = panner;
    const delayAmount = effectAmount(channel, 'delay');
    if (delayAmount > 0) {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.28;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.15 + delayAmount * 0.4;
      const wet = ctx.createGain();
      wet.gain.value = delayAmount * 0.45;
      wetIn.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect((channel.busId && buses.get(channel.busId)) || master);
    }
    const room = effectAmount(channel, 'reverb');
    if (room > 0) {
      const convolver = ctx.createConvolver();
      convolver.buffer = reverbImpulse(ctx);
      const wet = ctx.createGain();
      wet.gain.value = room * 0.4;
      wetIn.connect(convolver);
      convolver.connect(wet);
      wet.connect((channel.busId && buses.get(channel.busId)) || master);
    }
    panner.connect((channel.busId && buses.get(channel.busId)) || master);
    inputs.set(channel.id, input);
  }
  return { inputs, master };
}

export function scheduleArrangement(
  ctx: BaseAudioContext,
  arrangement: Arrangement,
  buffers: Map<string, AudioBuffer>,
  desk: { inputs: Map<string, GainNode>; master: GainNode },
  from: number,
  when: number,
): AudioBufferSourceNode[] {
  const solo = arrangement.tracks.some((track) => track.solo);
  const nodes: AudioBufferSourceNode[] = [];
  for (const track of arrangement.tracks) {
    if (track.muted || (solo && !track.solo)) continue;
    const buffer = buffers.get(track.assetId);
    if (!buffer) continue;
    const destination = (track.channelId && desk.inputs.get(track.channelId)) || desk.master;
    for (const clip of track.clips) {
      const end = clip.startSec + clip.durationSec;
      if (end <= from + 0.01) continue;
      const delay = Math.max(0, clip.startSec - from);
      const offset = clip.offsetSec + Math.max(0, from - clip.startSec);
      let duration = clip.durationSec - Math.max(0, from - clip.startSec);
      if (offset >= buffer.duration - 0.01) continue;
      duration = Math.min(duration, buffer.duration - offset);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const level = Math.max(track.volume * (clip.gain ?? 1), 0.0001);
      const startAt = when + delay;
      const fadeIn = Math.max(0, clip.fadeInSec - Math.max(0, from - clip.startSec));
      gain.gain.setValueAtTime(fadeIn > 0.01 ? 0.0001 : level, startAt);
      if (fadeIn > 0.01) gain.gain.exponentialRampToValueAtTime(level, startAt + Math.max(0.01, fadeIn));
      if (clip.fadeOutSec > 0.01 && duration > clip.fadeOutSec) {
        gain.gain.setValueAtTime(level, startAt + Math.max(fadeIn, duration - clip.fadeOutSec));
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      }
      source.connect(gain);
      gain.connect(destination);
      source.start(startAt, Math.max(0, offset), Math.max(0.01, duration));
      nodes.push(source);
    }
  }
  return nodes;
}
