/** Turn a phone or laptop vocal into a tighter studio take. The source buffer is left untouched. */
export async function studioVocal(buffer: AudioBuffer): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;

  const highpass = offline.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 90;
  highpass.Q.value = 0.707;

  const box = offline.createBiquadFilter();
  box.type = 'peaking';
  box.frequency.value = 250;
  box.Q.value = 1;
  box.gain.value = -4;

  const presence = offline.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3200;
  presence.Q.value = 0.8;
  presence.gain.value = 4.5;

  const deEss = offline.createBiquadFilter();
  deEss.type = 'peaking';
  deEss.frequency.value = 7000;
  deEss.Q.value = 2.4;
  deEss.gain.value = -6;

  const compressor = offline.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.18;

  const makeup = offline.createGain();
  makeup.gain.value = 1.6;

  const limiter = offline.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 2;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;

  source.connect(highpass);
  highpass.connect(box);
  box.connect(presence);
  presence.connect(deEss);
  deEss.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(limiter);
  limiter.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const frames = buffer.length;
  const block = channels * 2;
  const dataSize = frames * block;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * block, true);
  view.setUint16(32, block, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}
