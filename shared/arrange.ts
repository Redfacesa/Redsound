export type SnapMode = 'off' | 'beat' | 'bar';

export interface Clip {
  id: string;
  assetId: string;
  name: string;
  startSec: number;
  offsetSec: number;
  durationSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  gain?: number;
}

export type EffectType = 'eq' | 'compressor' | 'de-esser' | 'saturation' | 'reverb' | 'delay' | 'autotune' | 'pitch';
export type ChannelRole = 'lead' | 'backing' | 'adlib' | 'double' | 'beat' | 'bass' | 'drums' | 'music' | 'fx' | 'vocal-bus' | 'drum-bus' | 'master';

export interface ChannelEffect {
  id: string;
  type: EffectType;
  enabled: boolean;
  amount: number;
}

export interface MixerChannel {
  id: string;
  name: string;
  kind: 'channel' | 'bus' | 'master';
  role: ChannelRole;
  volume: number;
  pan: number;
  muted: boolean;
  solo?: boolean;
  effects: ChannelEffect[];
  busId?: string;
}

export interface ArrangeTrack {
  id: string;
  name: string;
  assetId: string;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  clips: Clip[];
  channelId?: string;
  take?: number;
}

export interface ArrangeSection {
  id: string;
  name: string;
  startSec: number;
  endSec: number;
}

export interface Arrangement {
  id: string;
  bpm: number;
  snap: SnapMode;
  tracks: ArrangeTrack[];
  sections: ArrangeSection[];
  channels?: MixerChannel[];
}

export interface ClipClipboard {
  span: number;
  items: Array<Clip & { trackId: string }>;
}

export function clipEnd(clip: Clip): number {
  return clip.startSec + clip.durationSec;
}

export function arrangementEnd(arrangement: Arrangement): number {
  const clipEdge = arrangement.tracks.reduce((max, track) => {
    return track.clips.reduce((edge, clip) => Math.max(edge, clipEnd(clip)), max);
  }, 0);
  const sectionEdge = arrangement.sections.reduce((max, section) => Math.max(max, section.endSec), 0);
  return Math.max(32, clipEdge + 4, sectionEdge);
}

export function snapTime(time: number, bpm: number, mode: SnapMode): number {
  const safe = Math.max(0, time);
  if (mode === 'off' || bpm <= 0) return safe;
  const beat = 60 / bpm;
  const grid = mode === 'bar' ? beat * 4 : beat;
  return Math.round(safe / grid) * grid;
}

function overlaps(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd - 0.0001 && end > rangeStart + 0.0001;
}

export function seedArrangement(
  id: string,
  bpm: number,
  assets: Array<{ id: string; title: string; stemName?: string; durationSec?: number; kind?: string }>,
  newId: () => string = () => crypto.randomUUID(),
): Arrangement {
  const tempo = bpm > 0 ? bpm : 120;
  const tracks: ArrangeTrack[] = assets.map((asset) => {
    const duration = asset.durationSec && asset.durationSec > 0.05 ? asset.durationSec : 4;
    return {
      id: newId(),
      name: (asset.stemName || asset.title || asset.kind || 'Track').toUpperCase(),
      assetId: asset.id,
      muted: false,
      solo: false,
      volume: 0.8,
      pan: 0,
      clips: [{
        id: newId(),
        assetId: asset.id,
        name: asset.stemName || asset.title,
        startSec: 0,
        offsetSec: 0,
        durationSec: duration,
        fadeInSec: 0,
        fadeOutSec: 0,
      }],
    };
  });
  const span = 8;
  const names = ['Intro', 'Verse', 'Chorus', 'Outro'];
  return ensureMixer({
    id,
    bpm: tempo,
    snap: 'beat',
    tracks,
    sections: names.map((name, index) => ({
      id: newId(),
      name,
      startSec: index * span,
      endSec: (index + 1) * span,
    })),
  }, newId);
}

export function blankArrangement(id: string, bpm: number, newId: () => string = () => crypto.randomUUID()): Arrangement {
  const tempo = bpm > 0 ? bpm : 120;
  const bar = (60 / tempo) * 4;
  const span = bar * 4;
  const names = ['Intro', 'Verse', 'Chorus', 'Outro'];
  const lane = (name: string): ArrangeTrack => ({
    id: newId(),
    name,
    assetId: id,
    muted: false,
    solo: false,
    volume: 0.85,
    pan: 0,
    clips: [],
  });
  return ensureMixer({
    id,
    bpm: tempo,
    snap: 'bar',
    tracks: [lane('VOCAL'), lane('BEAT')],
    sections: names.map((name, index) => ({
      id: newId(),
      name,
      startSec: index * span,
      endSec: (index + 1) * span,
    })),
  }, newId);
}

const EFFECT_TYPES: EffectType[] = ['eq', 'compressor', 'de-esser', 'saturation', 'reverb', 'delay', 'autotune', 'pitch'];

function effectChain(newId: () => string): ChannelEffect[] {
  return EFFECT_TYPES.map((type) => ({ id: newId(), type, enabled: false, amount: 0.45 }));
}

function guessRole(name: string): ChannelRole {
  const label = name.toLowerCase();
  if (label.includes('adlib')) return 'adlib';
  if (label.includes('back')) return 'backing';
  if (label.includes('double')) return 'double';
  if (label.includes('vocal') || label.includes('voice')) return 'lead';
  if (label.includes('drum') || label.includes('kick') || label.includes('snare')) return 'drums';
  if (label.includes('bass')) return 'bass';
  if (label.includes('fx')) return 'fx';
  return 'beat';
}

function busFor(role: ChannelRole, vocalBusId?: string, drumBusId?: string): string | undefined {
  if (role === 'lead' || role === 'backing' || role === 'adlib' || role === 'double') return vocalBusId;
  if (role === 'drums' || role === 'beat') return drumBusId;
  return undefined;
}

export function ensureMixer(arrangement: Arrangement, newId: () => string = () => crypto.randomUUID()): Arrangement {
  const channels: MixerChannel[] = [...(arrangement.channels || [])];
  function need(role: ChannelRole, name: string, kind: MixerChannel['kind']): MixerChannel {
    const found = channels.find((channel) => channel.role === role && channel.kind === kind);
    if (found) {
      const missing = EFFECT_TYPES.filter((type) => found.kind === 'channel' && !found.effects.some((effect) => effect.type === type));
      if (missing.length) found.effects = [...found.effects, ...missing.map((type) => ({ id: newId(), type, enabled: false, amount: 0.5 }))];
      return found;
    }
    const created: MixerChannel = {
      id: newId(),
      name,
      kind,
      role,
      volume: kind === 'master' ? 0.9 : 0.85,
      pan: 0,
      muted: false,
      effects: kind === 'channel' ? effectChain(newId) : kind === 'master'
        ? [{ id: newId(), type: 'compressor', enabled: false, amount: 0.55 }]
        : [],
    };
    channels.push(created);
    return created;
  }
  need('master', 'Master', 'master');
  const vocalBus = need('vocal-bus', 'Vocal bus', 'bus');
  const drumBus = need('drum-bus', 'Drum bus', 'bus');
  const tracks = arrangement.tracks.map((track) => {
    if (track.channelId && channels.some((channel) => channel.id === track.channelId)) return track;
    const role = guessRole(track.name);
    const channel: MixerChannel = {
      id: newId(),
      name: track.name,
      kind: 'channel',
      role,
      volume: track.volume,
      pan: track.pan,
      muted: false,
      effects: effectChain(newId),
      busId: busFor(role, vocalBus.id, drumBus.id),
    };
    channels.push(channel);
    return { ...track, channelId: channel.id };
  });
  const filled = channels.map((channel) => {
    if (channel.kind !== 'channel') return channel;
    const missing = EFFECT_TYPES.filter((type) => !channel.effects.some((effect) => effect.type === type));
    if (!missing.length) return channel;
    return {
      ...channel,
      effects: [...channel.effects, ...missing.map((type) => ({ id: newId(), type, enabled: false, amount: 0.5 }))],
    };
  });
  return { ...arrangement, tracks, channels: filled };
}

export function addVocalTake(
  arrangement: Arrangement,
  input: { assetId: string; title: string; durationSec: number; startSec: number },
  newId: () => string = () => crypto.randomUUID(),
): Arrangement {
  const base = ensureMixer(arrangement, newId);
  const take = base.tracks.filter((track) => track.take).reduce((max, track) => Math.max(max, track.take || 0), 0) + 1;
  const vocalBus = base.channels?.find((channel) => channel.role === 'vocal-bus');
  const channelId = newId();
  const role: ChannelRole = take === 1 ? 'lead' : 'backing';
  const channel: MixerChannel = {
    id: channelId,
    name: take === 1 ? 'Lead vocal' : `Vocal ${take}`,
    kind: 'channel',
    role,
    volume: 0.85,
    pan: 0,
    muted: false,
    effects: effectChain(newId),
    busId: vocalBus?.id,
  };
  const track: ArrangeTrack = {
    id: newId(),
    name: `VOCAL TAKE ${take}`,
    assetId: input.assetId,
    channelId,
    take,
    muted: false,
    solo: false,
    volume: 0.85,
    pan: 0,
    clips: [{
      id: newId(),
      assetId: input.assetId,
      name: input.title,
      startSec: Math.max(0, input.startSec),
      offsetSec: 0,
      durationSec: Math.max(0.05, input.durationSec),
      fadeInSec: 0,
      fadeOutSec: 0,
    }],
  };
  return { ...base, channels: [...(base.channels || []), channel], tracks: [...base.tracks, track] };
}

export function duplicateChannel(arrangement: Arrangement, channelId: string, newId: () => string = () => crypto.randomUUID()): Arrangement {
  const base = ensureMixer(arrangement, newId);
  const source = base.channels?.find((channel) => channel.id === channelId);
  if (!source || source.kind !== 'channel') return base;
  const copyId = newId();
  const copy: MixerChannel = {
    ...source,
    id: copyId,
    name: `${source.name} copy`,
    effects: source.effects.map((effect) => ({ ...effect, id: newId() })),
  };
  const tracks = base.tracks.flatMap((track) => {
    if (track.channelId !== channelId) return [track];
    return [track, {
      ...track,
      id: newId(),
      name: `${track.name} COPY`,
      channelId: copyId,
      clips: track.clips.map((clip) => ({ ...clip, id: newId() })),
    }];
  });
  return { ...base, channels: [...(base.channels || []), copy], tracks };
}

export function setClip(arrangement: Arrangement, clipId: string, patch: Partial<Pick<Clip, 'name' | 'gain' | 'startSec' | 'offsetSec' | 'durationSec'>>): Arrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
    })),
  };
}

export function setChannel(arrangement: Arrangement, channelId: string, patch: Partial<Pick<MixerChannel, 'name' | 'role' | 'volume' | 'pan' | 'muted' | 'solo' | 'busId'>>): Arrangement {
  const base = ensureMixer(arrangement);
  return {
    ...base,
    channels: (base.channels || []).map((channel) => channel.id === channelId ? { ...channel, ...patch } : channel),
  };
}

export function setEffect(arrangement: Arrangement, channelId: string, type: EffectType, patch: Partial<Pick<ChannelEffect, 'enabled' | 'amount'>>): Arrangement {
  const base = ensureMixer(arrangement);
  return {
    ...base,
    channels: (base.channels || []).map((channel) => channel.id === channelId ? {
      ...channel,
      effects: channel.effects.map((effect) => effect.type === type ? { ...effect, ...patch } : effect),
    } : channel),
  };
}

export function compSelection(arrangement: Arrangement, rangeStart: number, rangeEnd: number, newId: () => string = () => crypto.randomUUID()): Arrangement {
  const base = ensureMixer(arrangement, newId);
  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);
  const clipboard = copyRange(base, start, end);
  const takes = clipboard.items.filter((item) => base.tracks.some((track) => track.id === item.trackId && track.take));
  if (takes.length === 0) return base;
  let comp = base.tracks.find((track) => track.name === 'COMP VOCAL');
  let next = base;
  if (!comp) {
    const vocalBus = base.channels?.find((channel) => channel.role === 'vocal-bus');
    const channelId = newId();
    const channel: MixerChannel = {
      id: channelId,
      name: 'Comp vocal',
      kind: 'channel',
      role: 'lead',
      volume: 0.85,
      pan: 0,
      muted: false,
      effects: effectChain(newId),
      busId: vocalBus?.id,
    };
    comp = {
      id: newId(),
      name: 'COMP VOCAL',
      assetId: takes[0].assetId,
      channelId,
      muted: false,
      solo: false,
      volume: 0.85,
      pan: 0,
      clips: [],
    };
    next = { ...base, channels: [...(base.channels || []), channel], tracks: [...base.tracks, comp] };
  }
  const compId = comp.id;
  const clips = takes.map((item) => {
    const { trackId: _track, ...clip } = item;
    void _track;
    return { ...clip, id: newId(), startSec: start + clip.startSec };
  });
  return {
    ...next,
    tracks: next.tracks.map((track) => track.id === compId ? { ...track, clips: [...track.clips, ...clips] } : track),
  };
}

export function mergeNewTracks(stored: Arrangement, seeded: Arrangement): Arrangement {
  const known = new Set(stored.tracks.map((track) => track.assetId));
  const extra = seeded.tracks.filter((track) => !known.has(track.assetId));
  if (extra.length === 0) return stored;
  return { ...stored, tracks: [...stored.tracks, ...extra] };
}

function replaceClip(arrangement: Arrangement, clipId: string, next: Clip | Clip[] | null): Arrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => ({
      ...track,
      clips: track.clips.flatMap((clip) => {
        if (clip.id !== clipId) return [clip];
        if (next == null) return [];
        return Array.isArray(next) ? next : [next];
      }),
    })),
  };
}

export function splitAt(
  arrangement: Arrangement,
  time: number,
  newId: () => string = () => crypto.randomUUID(),
  trackId?: string,
): Arrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => {
      if (trackId && track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.flatMap((clip) => {
          if (time <= clip.startSec + 0.02 || time >= clipEnd(clip) - 0.02) return [clip];
          const leftDuration = time - clip.startSec;
          const left: Clip = { ...clip, durationSec: leftDuration, fadeOutSec: 0 };
          const right: Clip = {
            ...clip,
            id: newId(),
            startSec: time,
            offsetSec: clip.offsetSec + leftDuration,
            durationSec: clip.durationSec - leftDuration,
            fadeInSec: 0,
          };
          return [left, right];
        }),
      };
    }),
  };
}

export function deleteRange(
  arrangement: Arrangement,
  rangeStart: number,
  rangeEnd: number,
  newId: () => string = () => crypto.randomUUID(),
  trackId?: string,
): Arrangement {
  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => {
      if (trackId && track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.flatMap((clip) => {
          const clipStart = clip.startSec;
          const endSec = clipEnd(clip);
          if (!overlaps(clipStart, endSec, start, end)) return [clip];
          if (clipStart >= start && endSec <= end) return [];
          if (clipStart < start && endSec > end) {
            const leftDuration = start - clipStart;
            const rightStart = end;
            return [
              { ...clip, durationSec: leftDuration, fadeOutSec: 0 },
              {
                ...clip,
                id: newId(),
                startSec: rightStart,
                offsetSec: clip.offsetSec + (rightStart - clipStart),
                durationSec: endSec - rightStart,
                fadeInSec: 0,
              },
            ];
          }
          if (clipStart < start) {
            return [{ ...clip, durationSec: start - clipStart, fadeOutSec: 0 }];
          }
          const trim = end - clipStart;
          return [{
            ...clip,
            startSec: end,
            offsetSec: clip.offsetSec + trim,
            durationSec: clip.durationSec - trim,
            fadeInSec: 0,
          }];
        }),
      };
    }),
  };
}

export function removeClip(arrangement: Arrangement, clipId: string): Arrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== clipId),
    })),
  };
}

export function removeTrack(arrangement: Arrangement, trackId: string): Arrangement {
  const track = arrangement.tracks.find((item) => item.id === trackId);
  const channelId = track?.channelId;
  const stillUsed = arrangement.tracks.some((item) => item.id !== trackId && item.channelId === channelId);
  return {
    ...arrangement,
    tracks: arrangement.tracks.filter((item) => item.id !== trackId),
    channels: channelId && !stillUsed
      ? arrangement.channels?.filter((channel) => channel.id !== channelId || channel.kind !== 'channel')
      : arrangement.channels,
  };
}

export function copyRange(arrangement: Arrangement, rangeStart: number, rangeEnd: number, trackId?: string): ClipClipboard {
  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);
  const items: ClipClipboard['items'] = [];
  for (const track of arrangement.tracks) {
    if (trackId && track.id !== trackId) continue;
    for (const clip of track.clips) {
      const clipStart = clip.startSec;
      const endSec = clipEnd(clip);
      if (!overlaps(clipStart, endSec, start, end)) continue;
      const sliceStart = Math.max(clipStart, start);
      const sliceEnd = Math.min(endSec, end);
      const lead = sliceStart - clipStart;
      items.push({
        ...clip,
        trackId: track.id,
        startSec: sliceStart - start,
        offsetSec: clip.offsetSec + lead,
        durationSec: sliceEnd - sliceStart,
        fadeInSec: sliceStart <= clipStart + 0.001 ? clip.fadeInSec : 0,
        fadeOutSec: sliceEnd >= endSec - 0.001 ? clip.fadeOutSec : 0,
      });
    }
  }
  return { span: Math.max(0, end - start), items };
}

export function pasteClipboard(
  arrangement: Arrangement,
  clipboard: ClipClipboard,
  atSec: number,
  newId: () => string = () => crypto.randomUUID(),
): Arrangement {
  const at = Math.max(0, atSec);
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => {
      const additions = clipboard.items
        .filter((item) => item.trackId === track.id)
        .map((item) => {
          const { trackId, ...clip } = item;
          void trackId;
          return { ...clip, id: newId(), startSec: at + clip.startSec };
        });
      return additions.length ? { ...track, clips: [...track.clips, ...additions] } : track;
    }),
  };
}

export function moveClip(arrangement: Arrangement, clipId: string, startSec: number): Arrangement {
  const clip = arrangement.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
  if (!clip) return arrangement;
  return replaceClip(arrangement, clipId, { ...clip, startSec: Math.max(0, startSec) });
}

export function trimClip(
  arrangement: Arrangement,
  clipId: string,
  edge: 'start' | 'end',
  time: number,
  sourceDuration?: number,
): Arrangement {
  const clip = arrangement.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
  if (!clip) return arrangement;
  if (edge === 'start') {
    const minStart = clip.startSec - clip.offsetSec;
    const maxStart = clipEnd(clip) - 0.05;
    const nextStart = Math.min(maxStart, Math.max(minStart, time));
    const delta = nextStart - clip.startSec;
    const duration = clip.durationSec - delta;
    return replaceClip(arrangement, clipId, {
      ...clip,
      startSec: nextStart,
      offsetSec: clip.offsetSec + delta,
      durationSec: duration,
      fadeInSec: Math.min(clip.fadeInSec, duration / 2),
    });
  }
  let duration = Math.max(0.05, time - clip.startSec);
  if (sourceDuration != null) duration = Math.min(duration, Math.max(0.05, sourceDuration - clip.offsetSec));
  return replaceClip(arrangement, clipId, {
    ...clip,
    durationSec: duration,
    fadeOutSec: Math.min(clip.fadeOutSec, duration / 2),
  });
}

export function setFade(arrangement: Arrangement, clipId: string, edge: 'in' | 'out', seconds: number): Arrangement {
  const clip = arrangement.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
  if (!clip) return arrangement;
  const amount = Math.max(0, Math.min(seconds, clip.durationSec / 2));
  return replaceClip(arrangement, clipId, edge === 'in' ? { ...clip, fadeInSec: amount } : { ...clip, fadeOutSec: amount });
}

export function blendOverlaps(arrangement: Arrangement): Arrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => {
      const clips = [...track.clips].sort((a, b) => a.startSec - b.startSec).map((clip) => ({ ...clip }));
      for (let index = 0; index < clips.length - 1; index += 1) {
        const left = clips[index];
        const right = clips[index + 1];
        const overlap = clipEnd(left) - right.startSec;
        if (overlap > 0.02) {
          left.fadeOutSec = Math.min(overlap, left.durationSec / 2);
          right.fadeInSec = Math.min(overlap, right.durationSec / 2);
        }
      }
      return { ...track, clips };
    }),
  };
}

function shiftFrom(arrangement: Arrangement, time: number, delta: number): Arrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clip.startSec >= time - 0.0001 ? { ...clip, startSec: clip.startSec + delta } : clip),
    })),
    sections: arrangement.sections.map((section) => (
      section.startSec >= time - 0.0001
        ? { ...section, startSec: section.startSec + delta, endSec: section.endSec + delta }
        : section
    )),
  };
}

export function duplicateRange(
  arrangement: Arrangement,
  rangeStart: number,
  rangeEnd: number,
  newId: () => string = () => crypto.randomUUID(),
  trackId?: string,
): Arrangement {
  const clipboard = copyRange(arrangement, rangeStart, rangeEnd, trackId);
  const at = Math.max(rangeStart, rangeEnd);
  return pasteClipboard(arrangement, clipboard, at, newId);
}

export function duplicateSection(arrangement: Arrangement, sectionId: string, newId: () => string = () => crypto.randomUUID()): Arrangement {
  const section = arrangement.sections.find((item) => item.id === sectionId);
  if (!section) return arrangement;
  const span = section.endSec - section.startSec;
  const clipboard = copyRange(arrangement, section.startSec, section.endSec);
  const shifted = shiftFrom(arrangement, section.endSec, span);
  const pasted = pasteClipboard(shifted, clipboard, section.endSec, newId);
  const copy: ArrangeSection = { id: newId(), name: section.name, startSec: section.endSec, endSec: section.endSec + span };
  return {
    ...pasted,
    sections: [...pasted.sections, copy].sort((a, b) => a.startSec - b.startSec),
  };
}

export function moveSection(arrangement: Arrangement, sectionId: string, nextStart: number): Arrangement {
  const section = arrangement.sections.find((item) => item.id === sectionId);
  if (!section) return arrangement;
  const start = Math.max(0, nextStart);
  const delta = start - section.startSec;
  if (Math.abs(delta) < 0.0001) return arrangement;
  const end = section.endSec;
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => (
        clip.startSec >= section.startSec - 0.0001 && clip.startSec < end
          ? { ...clip, startSec: Math.max(0, clip.startSec + delta) }
          : clip
      )),
    })),
    sections: arrangement.sections.map((item) => (
      item.id === sectionId ? { ...item, startSec: start, endSec: item.endSec + delta } : item
    )),
  };
}

export function addSection(arrangement: Arrangement, name: string, startSec: number, endSec: number, newId: () => string = () => crypto.randomUUID()): Arrangement {
  const start = Math.max(0, Math.min(startSec, endSec));
  const end = Math.max(start + 0.1, Math.max(startSec, endSec));
  return {
    ...arrangement,
    sections: [...arrangement.sections, { id: newId(), name, startSec: start, endSec: end }].sort((a, b) => a.startSec - b.startSec),
  };
}

export function removeSection(arrangement: Arrangement, sectionId: string): Arrangement {
  return { ...arrangement, sections: arrangement.sections.filter((section) => section.id !== sectionId) };
}

export type VocalPreset = 'natural' | 'hard-tune' | 'booth' | 'studio' | 'hall' | 'stage' | 'slap';

export function applyVocalPreset(arrangement: Arrangement, channelId: string, preset: VocalPreset): Arrangement {
  const settings: Record<VocalPreset, Partial<Record<EffectType, number>>> = {
    natural: { eq: 0.45, compressor: 0.35, 'de-esser': 0.3, autotune: 0.15 },
    'hard-tune': { autotune: 1, eq: 0.7, compressor: 0.75, 'de-esser': 0.45, delay: 0.12 },
    booth: { eq: 0.4, compressor: 0.4, 'de-esser': 0.35, reverb: 0.08 },
    studio: { eq: 0.55, compressor: 0.5, 'de-esser': 0.4, reverb: 0.28, delay: 0.15 },
    hall: { eq: 0.4, compressor: 0.35, reverb: 0.72 },
    stage: { eq: 0.5, compressor: 0.45, reverb: 0.48, delay: 0.55 },
    slap: { eq: 0.4, compressor: 0.3, delay: 0.2, reverb: 0.12 },
  };
  const chosen = settings[preset];
  return {
    ...arrangement,
    channels: arrangement.channels?.map((channel) => {
      if (channel.id !== channelId) return channel;
      return {
        ...channel,
        effects: channel.effects.map((effect) => (
          chosen[effect.type] == null
            ? { ...effect, enabled: false }
            : { ...effect, enabled: true, amount: chosen[effect.type] as number }
        )),
      };
    }),
  };
}

export function setTrack(arrangement: Arrangement, trackId: string, patch: Partial<Pick<ArrangeTrack, 'name' | 'muted' | 'solo' | 'volume' | 'pan'>>): Arrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
  };
}

export function clampToSource(arrangement: Arrangement, durations: Record<string, number>): Arrangement {
  let changed = false;
  const tracks = arrangement.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const source = durations[clip.assetId];
      if (source == null) return clip;
      const max = Math.max(0.05, source - clip.offsetSec);
      if (clip.durationSec <= max + 0.02) return clip;
      changed = true;
      return { ...clip, durationSec: max, fadeInSec: Math.min(clip.fadeInSec, max / 2), fadeOutSec: Math.min(clip.fadeOutSec, max / 2) };
    }),
  }));
  return changed ? { ...arrangement, tracks } : arrangement;
}
