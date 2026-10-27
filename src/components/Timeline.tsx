import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addSection,
  addVocalTake,
  arrangementEnd,
  blendOverlaps,
  clampToSource,
  compSelection,
  copyRange,
  deleteRange,
  duplicateChannel,
  duplicateRange,
  duplicateSection,
  moveClip,
  moveSection,
  pasteClipboard,
  placeUpload,
  applyVocalPreset,
  removeClip,
  removeSection,
  removeTrack,
  setChannel,
  setClip,
  setEffect,
  setFade,
  setTrack,
  snapTime,
  splitAt,
  trimClip,
  type Arrangement,
  type ChannelRole,
  type Clip,
  type ClipClipboard,
  type SnapMode,
  type VocalPreset,
} from '@shared/arrange.ts';
import { bounceArrangement, downloadBlob } from '../lib/bounce';
import { buildDesk, scheduleArrangement } from '../lib/mix';
import { encodeWav, studioVocal } from '../lib/restore';
import { clock } from '../lib/studio';

const HEAD = 188;
const LANE_COLORS = ['#8d3a32', '#c4a15a', '#c9b84a', '#3f8f86', '#4d6ea8', '#8a6aad', '#c46b4a'];

function initialZoom(arrangement: Arrangement): number {
  const longest = arrangement.tracks.reduce((max, track) => (
    track.clips.reduce((edge, clip) => Math.max(edge, clip.durationSec), max)
  ), 0);
  if (longest > 0 && longest < 1) return 240;
  if (longest < 8) return 80;
  return 48;
}

type Range = { start: number; end: number };
type Drag =
  | { kind: 'move'; clipId: string; origin: number; x: number }
  | { kind: 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out'; clipId: string; origin: number; x: number }
  | { kind: 'select'; origin: number }
  | { kind: 'playhead'; origin: number; x: number }
  | { kind: 'section'; sectionId: string; origin: number; x: number };

function Mark({ name }: { name: 'play' | 'pause' | 'stop' | 'record' | 'undo' | 'redo' | 'plus' | 'minus' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {name === 'play' && <path d="M5 3.5v9l8-4.5-8-4.5z" fill="currentColor" />}
      {name === 'pause' && <path d="M4.5 3h2.2v10H4.5V3zm4.8 0h2.2v10H9.3V3z" fill="currentColor" />}
      {name === 'stop' && <rect x="4" y="4" width="8" height="8" fill="currentColor" />}
      {name === 'record' && <circle cx="8" cy="8" r="4.2" fill="currentColor" />}
      {name === 'plus' && <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" />}
      {name === 'minus' && <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" />}
      {name === 'undo' && <path d="M6 5H3.5V2.5M3.8 5.2A5 5 0 1 1 4.2 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
      {name === 'redo' && <path d="M10 5h2.5V2.5M12.2 5.2A5 5 0 1 0 11.8 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

export function Timeline({
  arrangement,
  sources,
  onCommit,
  onProduce,
  onCapture,
  onShape,
  sessionName,
  revealMaster = 0,
  bounceSignal = 0,
}: {
  arrangement: Arrangement;
  sources: Record<string, string>;
  onCommit: (next: Arrangement) => void;
  onProduce?: (action: 'replace' | 'extend', range: Range) => void;
  onCapture?: (input: { blob: Blob; durationSec: number; startSec: number; title: string; kind?: 'vocal' | 'beat'; filename?: string }) => Promise<{ id: string; title: string }>;
  onShape?: (action: 'extend' | 'version' | 'separate' | 'vocals' | 'instrumental', assetId: string, durationSec: number) => void;
  sessionName?: string;
  revealMaster?: number;
  bounceSignal?: number;
}) {
  const [draft, setDraft] = useState(arrangement);
  const [pxPerSec, setPxPerSec] = useState(() => initialZoom(arrangement));
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playNote, setPlayNote] = useState('');
  const [selection, setSelection] = useState<Range | null>(null);
  const [selectionTrack, setSelectionTrack] = useState('');
  const [selectedClip, setSelectedClip] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; trackId: string; clipId: string; sectionId?: string } | null>(null);
  const [loop, setLoop] = useState(false);
  const [clipboard, setClipboard] = useState<ClipClipboard | null>(null);
  const [recState, setRecState] = useState<'idle' | 'count' | 'rec'>('idle');
  const [loopRec, setLoopRec] = useState(false);
  const [countBeat, setCountBeat] = useState(4);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [openChannel, setOpenChannel] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importKind = useRef<'vocal' | 'beat'>('vocal');
  const importTrack = useRef('');
  const streamRef = useRef<MediaStream | null>(null);
  const playingRef = useRef(false);
  const playGen = useRef(0);
  const zoomRef = useRef(pxPerSec);
  zoomRef.current = pxPerSec;
  const loopRecRef = useRef(false);
  const keepTaking = useRef(false);
  const punchTimer = useRef(0);
  loopRecRef.current = loopRec;
  const past = useRef<Arrangement[]>([]);
  const future = useRef<Arrangement[]>([]);
  const savedRef = useRef(arrangement);
  const draftRef = useRef(draft);
  const selectionRef = useRef(selection);
  const clipPick = useRef('');
  const menuRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef(clipboard);
  const loopRef = useRef(loop);
  const playRef = useRef(playhead);
  const dragRef = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomTo = useRef<(value: number) => void>(() => {});
  zoomTo.current = (next: number) => {
    const scroller = scrollRef.current;
    const old = zoomRef.current;
    const clamped = Math.max(16, Math.min(220, next));
    if (scroller && old > 0) {
      const screenX = HEAD + playRef.current * old - scroller.scrollLeft;
      scroller.scrollLeft = Math.max(0, HEAD + playRef.current * clamped - screenX);
    }
    setPxPerSec(clamped);
  };
  const audioRef = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const durations = useRef<Record<string, number>>({});
  const missing = useRef(new Set<string>());
  const nodes = useRef<AudioBufferSourceNode[]>([]);
  const startedAt = useRef(0);
  const offsetAt = useRef(0);
  const raf = useRef(0);
  const [waveVersion, setWaveVersion] = useState(0);
  draftRef.current = draft;
  selectionRef.current = selection;
  clipPick.current = selectedClip;
  clipboardRef.current = clipboard;
  loopRef.current = loop;
  playRef.current = playhead;

  useEffect(() => {
    setDraft(arrangement);
    draftRef.current = arrangement;
    savedRef.current = arrangement;
    past.current = [];
    future.current = [];
  }, [arrangement.id]);

  useEffect(() => {
    const known = new Set(draftRef.current.tracks.map((track) => track.assetId));
    const extra = arrangement.tracks.filter((track) => !known.has(track.assetId));
    if (extra.length === 0) return;
    const channelIds = new Set((draftRef.current.channels || []).map((channel) => channel.id));
    const channels = [
      ...(draftRef.current.channels || []),
      ...(arrangement.channels || []).filter((channel) => extra.some((track) => track.channelId === channel.id) && !channelIds.has(channel.id)),
    ];
    commit({ ...draftRef.current, tracks: [...draftRef.current.tracks, ...extra], channels }, false);
  }, [arrangement]);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    stopSources();
    const ctx = audioRef.current;
    audioRef.current = null;
    void ctx?.close();
  }, []);

  useEffect(() => {
    const key = Object.entries(sources).sort().map(([id, url]) => `${id}:${url}`).join('|');
    if (!key) return;
    let cancel = false;
    const ctx = context();
    void (async () => {
      const found: Record<string, number> = {};
      for (const [assetId, url] of Object.entries(sources)) {
        if (!url || buffers.current.has(assetId) || missing.current.has(assetId)) continue;
        try {
          const response = await fetch(url);
          if (!response.ok) {
            missing.current.add(assetId);
            found[assetId] = 0;
            continue;
          }
          const copy = (await response.arrayBuffer()).slice(0);
          const audio = await ctx.decodeAudioData(copy);
          if (cancel) return;
          buffers.current.set(assetId, audio);
          found[assetId] = audio.duration;
        } catch {
          missing.current.add(assetId);
          found[assetId] = durations.current[assetId] || 0;
        }
      }
      if (cancel) return;
      durations.current = { ...durations.current, ...found };
      setWaveVersion((version) => version + 1);
      const usable = Object.fromEntries(Object.entries(durations.current).filter(([, value]) => value > 0));
      const clamped = clampToSource(draftRef.current, usable);
      if (clamped !== draftRef.current) commit(clamped, false);
    })();
    return () => { cancel = true; };
  }, [Object.entries(sources).sort().map(([id, url]) => `${id}:${url}`).join('|')]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON')) return;
      const meta = event.metaKey || event.ctrlKey;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      } else if (meta && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if (meta && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copy();
      } else if (meta && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        cut();
      } else if (meta && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        paste();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove();
      } else if (event.key.toLowerCase() === 's' && !meta) {
        event.preventDefault();
        split();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!menu) return;
    function outside(event: PointerEvent) {
      const node = menuRef.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      setMenu(null);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null);
    }
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [menu]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    let pinch: { dist: number; zoom: number } | null = null;
    function start(event: TouchEvent) {
      if (event.touches.length !== 2) { pinch = null; return; }
      pinch = {
        dist: Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY),
        zoom: zoomRef.current,
      };
    }
    function move(event: TouchEvent) {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const dist = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
      zoomTo.current(pinch.zoom * (dist / Math.max(pinch.dist, 1)));
    }
    function end() { pinch = null; }
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', end);
    return () => {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
    };
  }, []);

  useEffect(() => {
    if (!revealMaster) return;
    const master = draftRef.current.channels?.find((channel) => channel.kind === 'master');
    if (master) setOpenChannel(master.id);
  }, [revealMaster]);

  useEffect(() => {
    if (!bounceSignal) return;
    void exportMix();
  }, [bounceSignal]);

  function context() {
    if (!audioRef.current || audioRef.current.state === 'closed') audioRef.current = new AudioContext();
    return audioRef.current;
  }

  function commit(next: Arrangement, remember = true) {
    if (next === savedRef.current) return;
    if (remember) {
      past.current = [...past.current, savedRef.current].slice(-80);
      future.current = [];
    }
    savedRef.current = next;
    draftRef.current = next;
    setDraft(next);
    onCommit(next);
  }

  function apply(next: Arrangement) {
    draftRef.current = next;
    setDraft(next);
  }

  function undo() {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(savedRef.current);
    savedRef.current = previous;
    draftRef.current = previous;
    setDraft(previous);
    onCommit(previous);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(savedRef.current);
    savedRef.current = next;
    draftRef.current = next;
    setDraft(next);
    onCommit(next);
  }

  function timeAt(clientX: number) {
    const scroller = scrollRef.current;
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + scroller.scrollLeft - HEAD) / pxPerSec);
  }

  function snapped(time: number, mode: SnapMode = draftRef.current.snap) {
    return snapTime(time, draftRef.current.bpm, mode);
  }

  function stopSources() {
    for (const node of nodes.current) {
      try { node.stop(); } catch { /* already ended */ }
    }
    nodes.current = [];
  }

  function stopPlayback() {
    playGen.current += 1;
    cancelAnimationFrame(raf.current);
    stopSources();
    playingRef.current = false;
    setPlaying(false);
  }

  async function ensureBuffer(assetId: string) {
    const existing = buffers.current.get(assetId);
    if (existing) return existing;
    const url = sources[assetId];
    if (!url || missing.current.has(assetId)) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        missing.current.add(assetId);
        return null;
      }
      const audio = await context().decodeAudioData((await response.arrayBuffer()).slice(0));
      buffers.current.set(assetId, audio);
      durations.current[assetId] = audio.duration;
      return audio;
    } catch {
      missing.current.add(assetId);
      return null;
    }
  }

  async function startPlayback(from: number) {
    const gen = ++playGen.current;
    const ctx = context();
    try {
      await ctx.resume();
    } catch {
      setPlayNote('The browser blocked playback. Click Play again.');
      return;
    }
    if (gen !== playGen.current) return;
    cancelAnimationFrame(raf.current);
    stopSources();
    const current = draftRef.current;
    await Promise.all(current.tracks.map((track) => ensureBuffer(track.assetId)));
    if (gen !== playGen.current) return;
    const desk = buildDesk(ctx, current.channels || [], undefined, current.bpm);
    const now = ctx.currentTime + 0.05;
    startedAt.current = now;
    offsetAt.current = from;
    nodes.current = scheduleArrangement(ctx, current, buffers.current, desk, from, now);
    const wantedSound = current.tracks.some((track) => !track.muted && track.clips.length > 0);
    setPlayNote(wantedSound && nodes.current.length === 0 ? 'This take did not load, so there is nothing to play.' : '');
    playingRef.current = true;
    setPlaying(true);
    const tick = () => {
      const head = offsetAt.current + (context().currentTime - startedAt.current);
      const region = loopRef.current ? normalized(selectionRef.current) : null;
      if (region && head >= region.end) {
        startPlayback(region.start);
        return;
      }
      if (head >= arrangementEnd(draftRef.current)) {
        stopPlayback();
        setPlayhead(0);
        return;
      }
      setPlayhead(head);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function pausePlayback() {
    if (!playingRef.current) return;
    const head = offsetAt.current + (context().currentTime - startedAt.current);
    stopPlayback();
    playRef.current = head;
    setPlayhead(head);
  }

  function stopToStart() {
    keepTaking.current = false;
    window.clearTimeout(punchTimer.current);
    recorderRef.current?.stop();
    stopPlayback();
    playRef.current = 0;
    setPlayhead(0);
    setRecState('idle');
  }

  function togglePlay() {
    if (playingRef.current) pausePlayback();
    else void startPlayback(playRef.current);
  }

  async function exportMix() {
    await Promise.all(draftRef.current.tracks.map((track) => ensureBuffer(track.assetId)));
    const blob = await bounceArrangement(draftRef.current, buffers.current);
    downloadBlob(blob, `${sessionName || 'session'}.wav`);
  }

  function click(at: number) {
    const ctx = context();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.09);
  }

  async function capturePass(startSec: number, limitSec: number) {
    const stream = streamRef.current;
    if (!stream || !onCapture) return;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      window.clearTimeout(punchTimer.current);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      void (async () => {
        try {
          const decoded = await context().decodeAudioData((await blob.arrayBuffer()).slice(0));
          const take = draftRef.current.tracks.filter((track) => track.take).length + 1;
          let heard = decoded;
          let heardBlob: Blob = blob;
          try {
            heard = await studioVocal(decoded);
            heardBlob = encodeWav(heard);
          } catch {
            heard = decoded;
            heardBlob = blob;
          }
          const [source, cleaned] = await Promise.all([
            onCapture({ blob, durationSec: decoded.duration, startSec, title: `Original ${take}` }),
            onCapture({ blob: heardBlob, durationSec: heard.duration, startSec, title: `Studio vocal ${take}` }),
          ]);
          buffers.current.set(source.id, decoded);
          buffers.current.set(cleaned.id, heard);
          durations.current[source.id] = decoded.duration;
          durations.current[cleaned.id] = heard.duration;
          setWaveVersion((version) => version + 1);
          let next = addVocalTake(draftRef.current, {
            assetId: source.id,
            title: source.title || `Original ${take}`,
            durationSec: decoded.duration,
            startSec,
          });
          next = addVocalTake(next, {
            assetId: cleaned.id,
            title: cleaned.title || `Studio vocal ${take}`,
            durationSec: heard.duration,
            startSec,
          });
          const originalTrack = next.tracks.find((track) => track.assetId === source.id);
          const cleanedTrack = next.tracks.find((track) => track.assetId === cleaned.id);
          if (originalTrack) next = setTrack(next, originalTrack.id, { muted: true, name: source.title || `Original ${take}` });
          if (cleanedTrack) next = setTrack(next, cleanedTrack.id, { name: cleaned.title || `Studio vocal ${take}` });
          commit(next);
          if (keepTaking.current && loopRecRef.current) {
            playRef.current = startSec;
            setPlayhead(startSec);
            await capturePass(startSec, limitSec);
            return;
          }
        } catch {
          /* a failed take does not replace earlier ones */
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecState('idle');
      })();
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecState('rec');
    void startPlayback(startSec);
    if (limitSec > 0.05) punchTimer.current = window.setTimeout(() => recorder.stop(), limitSec * 1000);
  }

  async function importAudio(file: File | undefined, kind: 'vocal' | 'beat', trackId = '') {
    if (!file || !onCapture) return;
    setPlayNote(kind === 'beat' ? 'Adding the beat' : 'Adding the vocal');
    try {
      const decoded = await context().decodeAudioData((await file.arrayBuffer()).slice(0));
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || (kind === 'beat' ? 'Beat' : 'Vocal');
      const saved = await onCapture({
        blob: file,
        durationSec: decoded.duration,
        startSec: playRef.current,
        title,
        kind,
        filename: file.name,
      });
      buffers.current.set(saved.id, decoded);
      durations.current[saved.id] = decoded.duration;
      setWaveVersion((version) => version + 1);
      commit(placeUpload(draftRef.current, {
        assetId: saved.id,
        title: saved.title || title,
        durationSec: decoded.duration,
        startSec: playRef.current,
        kind,
        trackId,
      }));
      setPlayNote('');
    } catch (reason) {
      setPlayNote(reason instanceof Error ? reason.message : 'That file did not load.');
    }
  }

  async function toggleRecord() {
    if (!onCapture) return;
    if (recState === 'rec' || recState === 'count') {
      keepTaking.current = false;
      window.clearTimeout(punchTimer.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state === 'recording') recorder.stop();
      else {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      stopPlayback();
      setRecState('idle');
      return;
    }
    try {
      const ctx = context();
      await ctx.resume();
      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (deviceId) audio.deviceId = { exact: deviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
      setDevices(inputs);
      const range = normalized(selectionRef.current);
      const punched = Boolean(range && range.end - range.start > 0.2);
      const startSec = punched && range ? range.start : playRef.current;
      const limitSec = punched && range ? range.end - range.start : 0;
      playRef.current = startSec;
      setPlayhead(startSec);
      setRecState('count');
      const beat = 60 / Math.max(draftRef.current.bpm, 1);
      for (let step = 0; step < 4; step += 1) {
        if (!streamRef.current) return;
        setCountBeat(4 - step);
        click(ctx.currentTime + 0.02);
        await new Promise((resolve) => window.setTimeout(resolve, beat * 1000));
      }
      keepTaking.current = true;
      await capturePass(startSec, limitSec);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRecState('idle');
    }
  }

  function finish() {
    dragRef.current = null;
    if (draftRef.current !== savedRef.current) commit(draftRef.current);
  }

  useEffect(() => {
    function move(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const current = draftRef.current;
      const time = timeAt(event.clientX);
      if (drag.kind === 'select') {
        setSelection({ start: drag.origin, end: time });
        return;
      }
      if (drag.kind === 'playhead') {
        const next = Math.max(0, snapped(time, 'off'));
        playRef.current = next;
        setPlayhead(next);
        return;
      }
      if (drag.kind === 'section') {
        const delta = (event.clientX - drag.x) / pxPerSec;
        apply(moveSection(current, drag.sectionId, snapped(drag.origin + delta)));
        return;
      }
      const delta = (event.clientX - drag.x) / pxPerSec;
      if (drag.kind === 'move') apply(moveClip(current, drag.clipId, snapped(drag.origin + delta)));
      if (drag.kind === 'trim-start' || drag.kind === 'trim-end') {
        const clip = current.tracks.flatMap((track) => track.clips).find((item) => item.id === drag.clipId);
        const source = clip ? durations.current[clip.assetId] : undefined;
        apply(trimClip(current, drag.clipId, drag.kind === 'trim-start' ? 'start' : 'end', snapped(drag.origin + delta), source));
      }
      if (drag.kind === 'fade-in' || drag.kind === 'fade-out') {
        apply(setFade(current, drag.clipId, drag.kind === 'fade-in' ? 'in' : 'out', Math.max(0, drag.origin + delta)));
      }
    }
    function up() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.kind === 'select' || drag.kind === 'playhead') return;
      if (draftRef.current !== savedRef.current) commit(draftRef.current);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  function normalized(range: Range | null): Range | null {
    if (!range) return null;
    const start = Math.min(range.start, range.end);
    const end = Math.max(range.start, range.end);
    return end - start < 0.05 ? null : { start, end };
  }

  const activeSelection = normalized(selection);

  function takenClipboard() {
    const picked = clipPick.current;
    if (picked) {
      for (const track of draftRef.current.tracks) {
        const clip = track.clips.find((item) => item.id === picked);
        if (!clip) continue;
        return { span: clip.durationSec, items: [{ ...clip, trackId: track.id, startSec: 0 }] };
      }
    }
    const range = normalized(selectionRef.current);
    if (!range) return null;
    const next = copyRange(draftRef.current, range.start, range.end, selectionTrack || undefined);
    return next.items.length ? next : null;
  }

  function copy() {
    const next = takenClipboard();
    if (next) setClipboard(next);
  }

  function remove() {
    const picked = clipPick.current;
    if (picked) {
      commit(removeClip(draftRef.current, picked));
      setSelectedClip('');
      setSelection(null);
      return;
    }
    const range = normalized(selectionRef.current);
    const section = !selectionTrack && range
      ? draftRef.current.sections.find((item) => Math.abs(item.startSec - range.start) < 0.05 && Math.abs(item.endSec - range.end) < 0.05)
      : undefined;
    if (section) {
      commit(removeSection(draftRef.current, section.id));
      setSelection(null);
      return;
    }
    if (range && selectionTrack) {
      commit(deleteRange(draftRef.current, range.start, range.end, () => crypto.randomUUID(), selectionTrack));
      setSelection(null);
      return;
    }
    if (selectionTrack) {
      commit(removeTrack(draftRef.current, selectionTrack));
      setSelectionTrack('');
    }
  }

  function cut() {
    const next = takenClipboard();
    if (next) setClipboard(next);
    remove();
  }

  function paste() {
    const board = clipboardRef.current;
    if (!board) return;
    commit(pasteClipboard(draftRef.current, board, snapped(playRef.current)));
  }

  function split() {
    const pickedTrack = draftRef.current.tracks.find((track) => track.clips.some((clip) => clip.id === clipPick.current));
    const trackId = selectionTrack || pickedTrack?.id || '';
    if (!trackId) return;
    commit(splitAt(draftRef.current, playRef.current, () => crypto.randomUUID(), trackId));
    setSelectedClip('');
    setSelection(null);
  }

  function duplicate() {
    const picked = clipPick.current;
    if (picked) {
      for (const track of draftRef.current.tracks) {
        const clip = track.clips.find((item) => item.id === picked);
        if (!clip) continue;
        commit(duplicateRange(draftRef.current, clip.startSec, clip.startSec + clip.durationSec, () => crypto.randomUUID(), track.id));
        return;
      }
    }
    const range = normalized(selectionRef.current);
    if (!range) return;
    const section = !selectionTrack && draftRef.current.sections.find((item) => Math.abs(item.startSec - range.start) < 0.05 && Math.abs(item.endSec - range.end) < 0.05);
    commit(section ? duplicateSection(draftRef.current, section.id) : duplicateRange(draftRef.current, range.start, range.end, () => crypto.randomUUID(), selectionTrack || undefined));
  }

  function openMenu(event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }, trackId: string, clipId = '') {
    event.preventDefault();
    event.stopPropagation();
    const track = draftRef.current.tracks.find((item) => item.id === trackId);
    const clip = clipId ? track?.clips.find((item) => item.id === clipId) : undefined;
    setSelectionTrack(trackId);
    if (clip) {
      setSelectedClip(clip.id);
      setSelection({ start: clip.startSec, end: clip.startSec + clip.durationSec });
    } else {
      setSelectedClip('');
      setSelection(null);
    }
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 320)),
      trackId,
      clipId: clip?.id || '',
    });
  }

  function tighten() {
    const clip = draft.tracks.flatMap((track) => track.clips).find((item) => {
      if (!activeSelection) return false;
      return Math.abs(item.startSec - activeSelection.start) < 0.05 && Math.abs(item.startSec + item.durationSec - activeSelection.end) < 0.05;
    });
    const buffer = clip ? buffers.current.get(clip.assetId) : undefined;
    if (!clip || !buffer) return;
    const data = buffer.getChannelData(0);
    const from = Math.max(0, Math.floor(clip.offsetSec * buffer.sampleRate));
    const to = Math.min(data.length, Math.floor((clip.offsetSec + clip.durationSec) * buffer.sampleRate));
    let first = from;
    let last = to - 1;
    while (first < to && Math.abs(data[first]) < 0.015) first += 1;
    while (last > first && Math.abs(data[last]) < 0.015) last -= 1;
    if (last <= first) return;
    const offsetSec = first / buffer.sampleRate;
    const durationSec = Math.max(0.05, (last - first + 1) / buffer.sampleRate);
    commit(setClip(draft, clip.id, {
      offsetSec,
      durationSec,
      startSec: clip.startSec + (offsetSec - clip.offsetSec),
    }));
  }

  const length = arrangementEnd(draft);
  const beatPx = (60 / Math.max(draft.bpm, 1)) * pxPerSec;
  const marks = [];
  for (let time = 0; time <= length; time += Math.max(beatPx > 28 ? 60 / draft.bpm : (60 / draft.bpm) * 4, 0.01)) {
    marks.push(time);
    if (marks.length > 400) break;
  }
  const shaped = draft.tracks.find((track) => track.id === selectionTrack);
  const shapedClip = shaped?.clips.find((clip) => clip.id === selectedClip) || shaped?.clips[0];
  const menuTrack = menu ? draft.tracks.find((track) => track.id === menu.trackId) : undefined;
  const menuClip = menuTrack?.clips.find((clip) => clip.id === menu?.clipId);
  const clipInRange = activeSelection
    ? draft.tracks.flatMap((track) => track.clips).find((clip) => clip.startSec < activeSelection.end && clip.startSec + clip.durationSec > activeSelection.start)
    : undefined;

  return (
    <section className="tl" tabIndex={0}>
      <div className="tl-bar">
        <button className={playing ? 'tl-tool tl-play on' : 'tl-tool tl-play'} type="button" onClick={togglePlay}><Mark name={playing ? 'pause' : 'play'} />{playing ? 'Pause' : 'Play'}</button>
        <button className="tl-btn" type="button" aria-label="Stop" onClick={stopToStart}><Mark name="stop" /></button>
        <button className="tl-btn" type="button" aria-label="Undo" onClick={undo}><Mark name="undo" /></button>
        <button className="tl-btn" type="button" aria-label="Redo" onClick={redo}><Mark name="redo" /></button>
        <button className="tl-btn" type="button" aria-label="Zoom out" onClick={() => zoomTo.current(zoomRef.current / 1.25)}><Mark name="minus" /></button>
        <button className="tl-btn" type="button" aria-label="Zoom in" onClick={() => zoomTo.current(zoomRef.current * 1.25)}><Mark name="plus" /></button>
        <span className="tl-clock">{clock(playhead)}</span>
        {playNote && <span className="tl-note">{playNote}</span>}
        {onCapture && (
          <>
            <select className="tl-mic" aria-label="Microphone" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">Microphone</option>
              {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}
            </select>
            <button className={recState === 'rec' ? 'tl-btn on' : 'tl-btn'} type="button" aria-label="Record" onClick={() => void toggleRecord()}>
              {recState === 'count' ? countBeat : <Mark name="record" />}
            </button>
            <button className={loopRec ? 'tl-tool on' : 'tl-tool'} type="button" onClick={() => setLoopRec((value) => !value)}>Loop rec</button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void importAudio(file, importKind.current, importTrack.current);
              }}
            />
            <button className="tl-tool" type="button" onClick={() => { importKind.current = 'vocal'; importTrack.current = ''; fileRef.current?.click(); }}>Upload vocal</button>
            <button className="tl-tool" type="button" onClick={() => { importKind.current = 'beat'; importTrack.current = ''; fileRef.current?.click(); }}>Upload beat</button>
          </>
        )}
        <button className={loop ? 'tl-tool on' : 'tl-tool'} type="button" onClick={() => setLoop((value) => !value)}>Loop</button>
        <label className="tl-inline">Snap
          <select value={draft.snap} onChange={(event) => commit({ ...draft, snap: event.target.value as SnapMode })}>
            <option value="beat">Beat</option>
            <option value="bar">Bar</option>
            <option value="off">Off</option>
          </select>
        </label>
        <button className="tl-tool" type="button" onClick={() => void exportMix()}>Bounce</button>
      </div>
      <div className="tl-tools">
        <button type="button" className="tl-tool" onClick={cut} disabled={!activeSelection}>Cut</button>
        <button type="button" className="tl-tool" onClick={copy} disabled={!activeSelection}>Copy</button>
        <button type="button" className="tl-tool" onClick={paste} disabled={!clipboard}>Paste</button>
        <button type="button" className="tl-tool" onClick={split} disabled={!selectionTrack && !selectedClip} title="Split the selected track at the marker">Split</button>
        <button type="button" className="tl-tool" onClick={duplicate} disabled={!activeSelection}>Duplicate</button>
        <button type="button" className="tl-tool" onClick={remove} disabled={!activeSelection && !selectionTrack && !selectedClip}>Delete</button>
        <button type="button" className="tl-tool" onClick={() => commit(blendOverlaps(draft))} disabled={!activeSelection}>Blend</button>
        <button type="button" className="tl-tool" onClick={tighten} disabled={!activeSelection}>Tighten</button>
        <button type="button" className="tl-tool" disabled={!activeSelection} onClick={() => activeSelection && commit(compSelection(draft, activeSelection.start, activeSelection.end))}>Comp</button>
        <button type="button" className="tl-tool" disabled={!activeSelection} onClick={() => {
          if (!activeSelection) return;
          const names = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'];
          const used = new Set(draft.sections.map((section) => section.name));
          const name = names.find((item) => !used.has(item)) || 'Section';
          commit(addSection(draft, name, activeSelection.start, activeSelection.end));
          setSelection(activeSelection);
        }}>Section</button>
        <label className="tl-inline">Gain
          <input className="tl-gain" type="range" min="0" max="2" step="0.01" value={clipInRange?.gain ?? 1} aria-label="Clip gain" disabled={!activeSelection} onChange={(event) => {
            if (!activeSelection) return;
            const gain = Number(event.target.value);
            const clips = draftRef.current.tracks.flatMap((track) => track.clips).filter((clip) => {
              const end = clip.startSec + clip.durationSec;
              return clip.startSec < activeSelection.end && end > activeSelection.start;
            });
            let next = draftRef.current;
            for (const clip of clips) next = setClip(next, clip.id, { gain });
            apply(next);
          }} onPointerUp={finish} />
        </label>
        {onShape && (
          <>
            <button type="button" className="tl-tool" disabled={!shapedClip} onClick={() => shapedClip && onShape('extend', shapedClip.assetId, shapedClip.durationSec)}>Extend</button>
            <button type="button" className="tl-tool" disabled={!shapedClip} onClick={() => shapedClip && onShape('version', shapedClip.assetId, shapedClip.durationSec)}>Make the song</button>
            <button type="button" className="tl-tool" disabled={!shapedClip} onClick={() => shapedClip && onShape('separate', shapedClip.assetId, shapedClip.durationSec)}>Separate</button>
          </>
        )}
        {onProduce && (
          <>
            <button type="button" className="tl-tool" disabled={!activeSelection} onClick={() => activeSelection && onProduce('extend', activeSelection)}>Continue</button>
            <button type="button" className="tl-tool" disabled={!activeSelection} onClick={() => activeSelection && onProduce('replace', activeSelection)}>Replace</button>
          </>
        )}
      </div>
      <div
        className="tl-scroll"
        ref={scrollRef}
        onWheel={(event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          zoomTo.current(zoomRef.current * (event.deltaY > 0 ? 0.9 : 1.1));
        }}
      >
        <div className="tl-sheet" style={{ width: HEAD + length * pxPerSec }}>
          <div className="tl-ruler-row">
            <div className="tl-head">Sections</div>
            <div className="tl-ruler" onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest('.tl-section')) return;
              stopPlayback();
              const next = snapped(timeAt(event.clientX), 'off');
              playRef.current = next;
              setPlayhead(next);
              dragRef.current = { kind: 'playhead', origin: next, x: event.clientX };
            }}>
              {draft.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className="tl-section"
                  style={{ left: section.startSec * pxPerSec, width: Math.max(8, (section.endSec - section.startSec) * pxPerSec) }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectionTrack('');
                    setSelectedClip('');
                    clipPick.current = '';
                    setSelection({ start: section.startSec, end: section.endSec });
                    dragRef.current = { kind: 'section', sectionId: section.id, origin: section.startSec, x: event.clientX };
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectionTrack('');
                    setSelectedClip('');
                    clipPick.current = '';
                    setSelection({ start: section.startSec, end: section.endSec });
                    setMenu({ x: event.clientX, y: event.clientY, trackId: '', clipId: '', sectionId: section.id });
                  }}
                >{section.name}</button>
              ))}
              {marks.map((time) => (
                <span key={time} className="tl-mark" style={{ left: time * pxPerSec }}>{clock(time)}</span>
              ))}
            </div>
          </div>
          {draft.tracks.map((track) => (
            <div className={`${track.take ? 'tl-row take' : 'tl-row'}${selectionTrack === track.id ? ' on' : ''}`} key={track.id}>
              <div className="tl-head" onPointerDown={() => { setSelectionTrack(track.id); setSelectedClip(''); setSelection(null); }} onContextMenu={(event) => openMenu(event, track.id)}>
                <strong>{track.name}</strong>
                <div className="tl-flags">
                  <button type="button" className={track.muted ? 'tl-flag on' : 'tl-flag'} aria-label="Mute" onPointerDown={(event) => event.stopPropagation()} onClick={() => commit(setTrack(draft, track.id, { muted: !track.muted }))}>M</button>
                  <button type="button" className={track.solo ? 'tl-flag on' : 'tl-flag'} aria-label="Solo" onPointerDown={(event) => event.stopPropagation()} onClick={() => commit(setTrack(draft, track.id, { solo: !track.solo }))}>S</button>
                </div>
                <input className="fader" type="range" min="0" max="1" step="0.01" value={track.volume} aria-label={`${track.name} level`} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => apply(setTrack(draftRef.current, track.id, { volume: Number(event.target.value) }))} onPointerUp={finish} />
                <input className="fader" type="range" min="-1" max="1" step="0.01" value={track.pan} aria-label={`${track.name} pan`} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => apply(setTrack(draftRef.current, track.id, { pan: Number(event.target.value) }))} onPointerUp={finish} />
              </div>
              <div
                className="tl-lane"
                style={{ backgroundSize: `${beatPx}px 100%, ${beatPx * 4}px 100%` }}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest('.clip')) return;
                  setSelectionTrack(track.id);
                  setSelectedClip('');
                  const origin = timeAt(event.clientX);
                  dragRef.current = { kind: 'select', origin };
                  setSelection({ start: origin, end: origin });
                }}
                onContextMenu={(event) => openMenu(event, track.id)}
                onDragOver={(event) => {
                  if (!onCapture || !event.dataTransfer.types.includes('Files')) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  const file = event.dataTransfer.files?.[0];
                  if (!onCapture || !file) return;
                  event.preventDefault();
                  const label = track.name.toLowerCase();
                  const kind = label.includes('beat') || label.includes('drum') ? 'beat' : 'vocal';
                  void importAudio(file, kind, track.clips.length ? '' : track.id);
                }}
              >
                {activeSelection && !selectedClip && activeSelection.end - activeSelection.start > 0.05 && (selectionTrack === '' || selectionTrack === track.id) && (
                  <div className="tl-select" style={{ left: activeSelection.start * pxPerSec, width: (activeSelection.end - activeSelection.start) * pxPerSec }} />
                )}
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    px={pxPerSec}
                    color={LANE_COLORS[draft.tracks.indexOf(track) % LANE_COLORS.length]}
                    selected={clip.id === selectedClip}
                    buffer={buffers.current.get(clip.assetId)}
                    version={waveVersion}
                    onContextMenu={(event) => openMenu(event, track.id, clip.id)}
                    onPointerDown={(event, mode) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      setSelectionTrack(track.id);
                      setSelectedClip(clip.id);
                      if (mode === 'move') {
                        setSelection(null);
                        const startDrag = () => { dragRef.current = { kind: 'move', clipId: clip.id, origin: clip.startSec, x: event.clientX }; };
                        if (event.pointerType === 'touch') {
                          const timer = window.setTimeout(startDrag, 380);
                          const cancel = () => window.clearTimeout(timer);
                          event.currentTarget.addEventListener('pointerup', cancel, { once: true });
                          event.currentTarget.addEventListener('pointercancel', cancel, { once: true });
                        } else startDrag();
                      } else if (mode === 'start' || mode === 'end') {
                        dragRef.current = { kind: mode === 'start' ? 'trim-start' : 'trim-end', clipId: clip.id, origin: mode === 'start' ? clip.startSec : clip.startSec + clip.durationSec, x: event.clientX };
                      } else {
                        dragRef.current = { kind: mode === 'fade-in' ? 'fade-in' : 'fade-out', clipId: clip.id, origin: mode === 'fade-in' ? clip.fadeInSec : clip.fadeOutSec, x: event.clientX };
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="tl-playhead" style={{ left: HEAD + playhead * pxPerSec }}>
            <button
              type="button"
              className="tl-marker"
              aria-label="Marker"
              onPointerDown={(event) => {
                event.stopPropagation();
                stopPlayback();
                dragRef.current = { kind: 'playhead', origin: playRef.current, x: event.clientX };
              }}
            />
          </div>
        </div>
      </div>
      <div className="mixer" aria-label="Mixer">
        {(draft.channels || []).map((channel) => (
          <article key={channel.id} className={openChannel === channel.id ? 'strip open' : 'strip'}>
            <button type="button" className="strip-name" onClick={() => setOpenChannel((current) => current === channel.id ? '' : channel.id)}>{channel.name}</button>
            <div className="tl-flags">
              <button type="button" className={channel.muted ? 'tl-flag on' : 'tl-flag'} aria-label="Mute" onClick={() => commit(setChannel(draft, channel.id, { muted: !channel.muted }))}>M</button>
              {channel.kind === 'channel' && <button type="button" className={channel.solo ? 'tl-flag on' : 'tl-flag'} aria-label="Solo" onClick={() => commit(setChannel(draft, channel.id, { solo: !channel.solo }))}>S</button>}
            </div>
            {channel.kind === 'channel' && (
              <select aria-label={`${channel.name} role`} value={channel.role} onChange={(event) => {
                const role = event.target.value as ChannelRole;
                const vocal = draft.channels?.find((item) => item.role === 'vocal-bus');
                const drum = draft.channels?.find((item) => item.role === 'drum-bus');
                const vocalRole = role === 'lead' || role === 'backing' || role === 'adlib' || role === 'double';
                const drumRole = role === 'drums' || role === 'beat';
                commit(setChannel(draft, channel.id, { role, busId: vocalRole ? vocal?.id : drumRole ? drum?.id : undefined }));
              }}>
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            )}
            {channel.kind === 'channel' && (
              <select aria-label={`${channel.name} bus`} value={channel.busId || ''} onChange={(event) => commit(setChannel(draft, channel.id, { busId: event.target.value || undefined }))}>
                <option value="">Master</option>
                {(draft.channels || []).filter((item) => item.kind === 'bus').map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
              </select>
            )}
            <input className="fader" type="range" min="-1" max="1" step="0.01" value={channel.pan} aria-label={`${channel.name} pan`} onChange={(event) => apply(setChannel(draftRef.current, channel.id, { pan: Number(event.target.value) }))} onPointerUp={finish} />
            {openChannel === channel.id && (
              <div className="strip-fx">
                {channel.kind === 'channel' && (
                  <select aria-label={`${channel.name} preset`} defaultValue="" onChange={(event) => {
                    const preset = event.target.value as VocalPreset;
                    if (!preset) return;
                    commit(applyVocalPreset(draftRef.current, channel.id, preset));
                    event.target.value = '';
                  }}>
                    <option value="">Preset</option>
                    <option value="natural">Natural vocal</option>
                    <option value="hard-tune">Hard tune</option>
                    <option value="booth">Vocal booth</option>
                    <option value="studio">Studio</option>
                    <option value="hall">Concert hall</option>
                    <option value="stage">Live stage</option>
                    <option value="slap">Slap delay</option>
                  </select>
                )}
                {channel.effects.map((effect) => (
                  <label key={effect.id}>
                    <input type="checkbox" checked={effect.enabled} onChange={(event) => commit(setEffect(draft, channel.id, effect.type, { enabled: event.target.checked }))} />
                    {effect.type === 'autotune' ? 'Tune' : effect.type === 'de-esser' ? 'De-ess' : effect.type === 'eq' ? 'EQ' : effect.type}
                    <input type="range" min="0" max="1" step="0.01" value={effect.amount} aria-label={`${channel.name} ${effect.type}`} onChange={(event) => apply(setEffect(draftRef.current, channel.id, effect.type, { amount: Number(event.target.value) }))} onPointerUp={finish} />
                  </label>
                ))}
                {channel.kind === 'channel' && <button type="button" className="chip" onClick={() => commit(duplicateChannel(draft, channel.id))}>Duplicate</button>}
              </div>
            )}
            <input className="fader tall" type="range" min="0" max="1" step="0.01" value={channel.volume} aria-label={`${channel.name} fader`} onChange={(event) => apply(setChannel(draftRef.current, channel.id, { volume: Number(event.target.value) }))} onPointerUp={finish} />
          </article>
        ))}
      </div>
      {menu?.sectionId && (
        <div className="tl-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { const sectionId = menu.sectionId || ''; setMenu(null); commit(removeSection(draft, sectionId)); setSelection(null); }}>Delete section</button>
        </div>
      )}
      {menu && menuTrack && (
        <div className="tl-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { setMenu(null); remove(); }}>{menuClip ? 'Delete clip' : 'Delete track'}</button>
          {menuClip && <button type="button" onClick={() => { setMenu(null); commit(removeTrack(draft, menuTrack.id)); setSelectionTrack(''); setSelectedClip(''); setSelection(null); }}>Delete track</button>}
          <button type="button" onClick={() => { setMenu(null); duplicate(); }}>Duplicate</button>
          <button type="button" onClick={() => { setMenu(null); split(); }}>Split</button>
          {onShape && (menuClip || menuTrack.clips[0]) && (
            <>
              <hr />
              <button type="button" onClick={() => { const clip = menuClip || menuTrack.clips[0]; setMenu(null); onShape('extend', clip.assetId, clip.durationSec); }}>Extend</button>
              <button type="button" onClick={() => { const clip = menuClip || menuTrack.clips[0]; setMenu(null); onShape('version', clip.assetId, clip.durationSec); }}>Make the song</button>
              <button type="button" onClick={() => { const clip = menuClip || menuTrack.clips[0]; setMenu(null); onShape('separate', clip.assetId, clip.durationSec); }}>Separate vocals</button>
              <button type="button" onClick={() => { const clip = menuClip || menuTrack.clips[0]; setMenu(null); onShape('vocals', clip.assetId, clip.durationSec); }}>Add a vocal</button>
              <button type="button" onClick={() => { const clip = menuClip || menuTrack.clips[0]; setMenu(null); onShape('instrumental', clip.assetId, clip.durationSec); }}>Add instruments</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const ROLES: ChannelRole[] = ['lead', 'backing', 'adlib', 'double', 'beat', 'bass', 'drums', 'music', 'fx'];

function ClipView({
  clip,
  px,
  color,
  buffer,
  version,
  selected,
  onPointerDown,
  onContextMenu,
}: {
  clip: Clip;
  px: number;
  color: string;
  buffer?: AudioBuffer;
  version: number;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'start' | 'end' | 'fade-in' | 'fade-out') => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = Math.max(8, clip.durationSec * px);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.floor(46 * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    const data = buffer?.getChannelData(0);
    if (!data || !buffer) {
      ctx.fillRect(0, canvas.height * 0.35, canvas.width, canvas.height * 0.3);
      return;
    }
    const start = Math.floor((clip.offsetSec / buffer.duration) * data.length);
    const end = Math.floor(((clip.offsetSec + clip.durationSec) / buffer.duration) * data.length);
    const slice = data.subarray(Math.max(0, start), Math.max(start + 1, end));
    const step = Math.max(1, Math.floor(slice.length / canvas.width));
    for (let x = 0; x < canvas.width; x += 1) {
      let peak = 0;
      const from = x * step;
      for (let index = 0; index < step && from + index < slice.length; index += 1) peak = Math.max(peak, Math.abs(slice[from + index]));
      const bar = Math.max(1, peak * canvas.height);
      ctx.fillRect(x, (canvas.height - bar) / 2, 1, bar);
    }
  }, [buffer, clip.offsetSec, clip.durationSec, width, version]);

  return (
    <div
      className={selected ? 'clip on' : 'clip'}
      role="button"
      aria-label={clip.name}
      style={{ left: clip.startSec * px, width, background: color, borderColor: color }}
      onContextMenu={onContextMenu}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        if (x < 8) onPointerDown(event, 'start');
        else if (bounds.width - x < 8) onPointerDown(event, 'end');
        else onPointerDown(event, 'move');
      }}
    >
      <canvas ref={canvasRef} />
      {clip.fadeInSec > 0 && <span className="clip-fade in" style={{ width: clip.fadeInSec * px }} />}
      {clip.fadeOutSec > 0 && <span className="clip-fade out" style={{ width: clip.fadeOutSec * px }} />}
      <button type="button" className="fade-handle in" aria-label="Fade in" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, 'fade-in'); }} />
      <button type="button" className="fade-handle out" aria-label="Fade out" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, 'fade-out'); }} />
      <em>{clip.name}</em>
    </div>
  );
}
