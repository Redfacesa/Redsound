import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
} from '@shared/arrange.ts';
import { bounceArrangement, downloadBlob } from '../lib/bounce';
import { buildDesk, scheduleArrangement } from '../lib/mix';
import { clock } from '../lib/studio';

const HEAD = 188;

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
  | { kind: 'section'; sectionId: string; origin: number; x: number };

export function Timeline({
  arrangement,
  sources,
  onCommit,
  onProduce,
  onCapture,
  sessionName,
  revealMaster = 0,
  bounceSignal = 0,
}: {
  arrangement: Arrangement;
  sources: Record<string, string>;
  onCommit: (next: Arrangement) => void;
  onProduce?: (action: 'replace' | 'extend', range: Range) => void;
  onCapture?: (input: { blob: Blob; durationSec: number; startSec: number; title: string }) => Promise<{ id: string; title: string }>;
  sessionName?: string;
  revealMaster?: number;
  bounceSignal?: number;
}) {
  const [draft, setDraft] = useState(arrangement);
  const [pxPerSec, setPxPerSec] = useState(() => initialZoom(arrangement));
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Range | null>(null);
  const [loop, setLoop] = useState(false);
  const [clipboard, setClipboard] = useState<ClipClipboard | null>(null);
  const [recState, setRecState] = useState<'idle' | 'count' | 'rec'>('idle');
  const [loopRec, setLoopRec] = useState(false);
  const [countBeat, setCountBeat] = useState(4);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [openChannel, setOpenChannel] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
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
  const clipboardRef = useRef(clipboard);
  const loopRef = useRef(loop);
  const playRef = useRef(playhead);
  const dragRef = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const durations = useRef<Record<string, number>>({});
  const nodes = useRef<AudioBufferSourceNode[]>([]);
  const startedAt = useRef(0);
  const offsetAt = useRef(0);
  const raf = useRef(0);
  const [waveVersion, setWaveVersion] = useState(0);
  draftRef.current = draft;
  selectionRef.current = selection;
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
        if (!url || buffers.current.has(assetId)) continue;
        try {
          const response = await fetch(url);
          const copy = (await response.arrayBuffer()).slice(0);
          const audio = await ctx.decodeAudioData(copy);
          if (cancel) return;
          buffers.current.set(assetId, audio);
          found[assetId] = audio.duration;
        } catch {
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
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
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
      setPxPerSec(Math.max(16, Math.min(220, pinch.zoom * (dist / Math.max(pinch.dist, 1)))));
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
    if (!url) return null;
    const response = await fetch(url);
    const audio = await context().decodeAudioData((await response.arrayBuffer()).slice(0));
    buffers.current.set(assetId, audio);
    durations.current[assetId] = audio.duration;
    return audio;
  }

  async function startPlayback(from: number) {
    const gen = ++playGen.current;
    const ctx = context();
    await ctx.resume();
    if (gen !== playGen.current) return;
    cancelAnimationFrame(raf.current);
    stopSources();
    const current = draftRef.current;
    await Promise.all(current.tracks.map((track) => ensureBuffer(track.assetId)));
    if (gen !== playGen.current) return;
    const desk = buildDesk(ctx, current.channels || []);
    const now = ctx.currentTime + 0.05;
    startedAt.current = now;
    offsetAt.current = from;
    nodes.current = scheduleArrangement(ctx, current, buffers.current, desk, from, now);
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
      const scroller = scrollRef.current;
      if (scroller) {
        const x = HEAD + head * pxPerSec;
        if (x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = x - 80;
      }
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
          const title = `Vocal Take ${take}`;
          const saved = await onCapture({ blob, durationSec: decoded.duration, startSec, title });
          buffers.current.set(saved.id, decoded);
          durations.current[saved.id] = decoded.duration;
          setWaveVersion((version) => version + 1);
          commit(addVocalTake(draftRef.current, {
            assetId: saved.id,
            title: saved.title || title,
            durationSec: decoded.duration,
            startSec,
          }));
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
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
      if (!drag || drag.kind === 'select') return;
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

  function copy() {
    const range = normalized(selectionRef.current);
    if (!range) return;
    const next = copyRange(draftRef.current, range.start, range.end);
    if (next.items.length) setClipboard(next);
  }

  function remove() {
    const range = normalized(selectionRef.current);
    if (!range) return;
    commit(deleteRange(draftRef.current, range.start, range.end));
  }

  function cut() {
    const range = normalized(selectionRef.current);
    if (!range) return;
    const next = copyRange(draftRef.current, range.start, range.end);
    if (next.items.length) setClipboard(next);
    commit(deleteRange(draftRef.current, range.start, range.end));
  }

  function paste() {
    const board = clipboardRef.current;
    if (!board) return;
    commit(pasteClipboard(draftRef.current, board, snapped(playRef.current)));
  }

  function split() {
    const count = (value: Arrangement) => value.tracks.reduce((total, track) => total + track.clips.length, 0);
    let next = splitAt(draftRef.current, playRef.current);
    if (count(next) === count(draftRef.current)) {
      const range = normalized(selectionRef.current);
      if (range) next = splitAt(next, (range.start + range.end) / 2);
    }
    commit(next);
  }

  function duplicate() {
    const range = normalized(selectionRef.current);
    if (!range) return;
    const section = draftRef.current.sections.find((item) => Math.abs(item.startSec - range.start) < 0.05 && Math.abs(item.endSec - range.end) < 0.05);
    commit(section ? duplicateSection(draftRef.current, section.id) : duplicateRange(draftRef.current, range.start, range.end));
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

  return (
    <section className="tl" tabIndex={0}>
      <div className="tl-bar">
        <button className="transport-play" type="button" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
        <button className="chip" type="button" onClick={stopToStart}>Stop</button>
        <button className="chip" type="button" onClick={() => void exportMix()}>Bounce</button>
        {onCapture && (
          <>
            <select className="tl-mic" aria-label="Microphone" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">Microphone</option>
              {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}
            </select>
            <button className={recState === 'rec' ? 'transport-rec on' : 'transport-rec'} type="button" onClick={() => void toggleRecord()}>
              {recState === 'count' ? countBeat : recState === 'rec' ? 'Stop rec' : 'Record'}
            </button>
            <button className={loopRec ? 'chip on' : 'chip'} type="button" onClick={() => setLoopRec((value) => !value)}>Loop rec</button>
          </>
        )}
        <span className="tl-clock">{clock(playhead)}</span>
        <label className="tl-inline">Snap
          <select value={draft.snap} onChange={(event) => commit({ ...draft, snap: event.target.value as SnapMode })}>
            <option value="beat">Beat</option>
            <option value="bar">Bar</option>
            <option value="off">Off</option>
          </select>
        </label>
        <button className={loop ? 'chip on' : 'chip'} type="button" onClick={() => setLoop((value) => !value)}>Loop</button>
        <button className="chip" type="button" onClick={() => setPxPerSec((value) => Math.max(16, value / 1.25))}>−</button>
        <button className="chip" type="button" onClick={() => setPxPerSec((value) => Math.min(220, value * 1.25))}>+</button>
        <button className="chip" type="button" onClick={undo}>Undo</button>
        <button className="chip" type="button" onClick={redo}>Redo</button>
        {activeSelection && (
          <div className="tl-edit">
            <button type="button" className="chip" onClick={cut}>Cut</button>
            <button type="button" className="chip" onClick={copy}>Copy</button>
            <button type="button" className="chip" onClick={paste} disabled={!clipboard}>Paste</button>
            <button type="button" className="chip" onClick={split}>Split</button>
            <button type="button" className="chip" onClick={remove}>Delete</button>
            <button type="button" className="chip" onClick={duplicate}>Duplicate</button>
            <button type="button" className="chip" onClick={() => commit(blendOverlaps(draft))}>Blend</button>
            <button type="button" className="chip" onClick={tighten}>Tighten</button>
            <label className="tl-inline">Gain
              <input type="range" min="0" max="2" step="0.01" value={draft.tracks.flatMap((track) => track.clips).find((clip) => clip.startSec < activeSelection.end && clip.startSec + clip.durationSec > activeSelection.start)?.gain ?? 1} aria-label="Clip gain" onChange={(event) => {
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
            <button type="button" className="chip" onClick={() => commit(compSelection(draft, activeSelection.start, activeSelection.end))}>Comp</button>
            <button type="button" className="chip" onClick={() => {
              const names = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'];
              const used = new Set(draft.sections.map((section) => section.name));
              const name = names.find((item) => !used.has(item)) || 'Section';
              commit(addSection(draft, name, activeSelection.start, activeSelection.end));
              setSelection(activeSelection);
            }}>Section</button>
            {onProduce && (
              <>
                <button type="button" className="chip" onClick={() => onProduce('replace', activeSelection)}>Replace</button>
                <button type="button" className="chip" onClick={() => onProduce('extend', activeSelection)}>Extend</button>
              </>
            )}
          </div>
        )}
      </div>
      <div
        className="tl-scroll"
        ref={scrollRef}
        onWheel={(event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          setPxPerSec((value) => Math.max(16, Math.min(220, value * (event.deltaY > 0 ? 0.9 : 1.1))));
        }}
      >
        <div className="tl-sheet" style={{ width: HEAD + length * pxPerSec }}>
          <div className="tl-ruler-row">
            <div className="tl-head">Sections</div>
            <div className="tl-ruler" onPointerDown={(event) => { stopPlayback(); setPlayhead(snapped(timeAt(event.clientX), 'off')); }}>
              {draft.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className="tl-section"
                  style={{ left: section.startSec * pxPerSec, width: Math.max(8, (section.endSec - section.startSec) * pxPerSec) }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelection({ start: section.startSec, end: section.endSec });
                    dragRef.current = { kind: 'section', sectionId: section.id, origin: section.startSec, x: event.clientX };
                  }}
                >{section.name}</button>
              ))}
              {marks.map((time) => (
                <span key={time} className="tl-mark" style={{ left: time * pxPerSec }}>{clock(time)}</span>
              ))}
            </div>
          </div>
          {draft.tracks.map((track) => (
            <div className={track.take ? 'tl-row take' : 'tl-row'} key={track.id}>
              <div className="tl-head">
                <strong>{track.name}</strong>
                <div className="tl-flags">
                  <button type="button" className={track.muted ? 'chip on' : 'chip'} onClick={() => commit(setTrack(draft, track.id, { muted: !track.muted }))}>M</button>
                  <button type="button" className={track.solo ? 'chip on' : 'chip'} onClick={() => commit(setTrack(draft, track.id, { solo: !track.solo }))}>S</button>
                </div>
                <input className="fader" type="range" min="0" max="1" step="0.01" value={track.volume} aria-label={`${track.name} level`} onChange={(event) => apply(setTrack(draftRef.current, track.id, { volume: Number(event.target.value) }))} onPointerUp={finish} />
                <input className="fader" type="range" min="-1" max="1" step="0.01" value={track.pan} aria-label={`${track.name} pan`} onChange={(event) => apply(setTrack(draftRef.current, track.id, { pan: Number(event.target.value) }))} onPointerUp={finish} />
              </div>
              <div
                className="tl-lane"
                style={{ backgroundSize: `${beatPx}px 100%, ${beatPx * 4}px 100%` }}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest('.clip')) return;
                  const origin = timeAt(event.clientX);
                  dragRef.current = { kind: 'select', origin };
                  setSelection({ start: origin, end: origin });
                }}
              >
                {activeSelection && (
                  <div className="tl-select" style={{ left: activeSelection.start * pxPerSec, width: (activeSelection.end - activeSelection.start) * pxPerSec }} />
                )}
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    px={pxPerSec}
                    buffer={buffers.current.get(clip.assetId)}
                    version={waveVersion}
                    onPointerDown={(event, mode) => {
                      event.stopPropagation();
                      if (mode === 'move') {
                        setSelection({ start: clip.startSec, end: clip.startSec + clip.durationSec });
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
          <div className="tl-playhead" style={{ left: HEAD + playhead * pxPerSec }} />
        </div>
      </div>
      <div className="mixer" aria-label="Mixer">
        {(draft.channels || []).map((channel) => (
          <article key={channel.id} className={openChannel === channel.id ? 'strip open' : 'strip'}>
            <button type="button" className="strip-name" onClick={() => setOpenChannel((current) => current === channel.id ? '' : channel.id)}>{channel.name}</button>
            <div className="tl-flags">
              <button type="button" className={channel.muted ? 'chip on' : 'chip'} onClick={() => commit(setChannel(draft, channel.id, { muted: !channel.muted }))}>M</button>
              {channel.kind === 'channel' && <button type="button" className={channel.solo ? 'chip on' : 'chip'} onClick={() => commit(setChannel(draft, channel.id, { solo: !channel.solo }))}>S</button>}
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
                {channel.effects.map((effect) => (
                  <label key={effect.id}>
                    <input type="checkbox" checked={effect.enabled} onChange={(event) => commit(setEffect(draft, channel.id, effect.type, { enabled: event.target.checked }))} />
                    {effect.type}
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
    </section>
  );
}

const ROLES: ChannelRole[] = ['lead', 'backing', 'adlib', 'double', 'beat', 'bass', 'drums', 'music', 'fx'];

function ClipView({
  clip,
  px,
  buffer,
  version,
  onPointerDown,
}: {
  clip: Clip;
  px: number;
  buffer?: AudioBuffer;
  version: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'start' | 'end' | 'fade-in' | 'fade-out') => void;
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
    ctx.fillStyle = '#e7b2a4';
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
      className="clip"
      role="button"
      aria-label={clip.name}
      style={{ left: clip.startSec * px, width }}
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
