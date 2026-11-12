import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { seedArrangement, setTrack, type Arrangement } from '@shared/arrange.ts';
import { Timeline } from '../components/Timeline';
import { Mark } from '../components/Mark';

const frames = {
  scene: {
    title: 'Scene 12',
    meta: '96 BPM · D minor',
    bpm: 96,
    tracks: [
      { id: 'vocal', title: 'Vocal', durationSec: 14, tone: 196 },
      { id: 'beat', title: 'Beat', durationSec: 18, tone: 82 },
      { id: 'score', title: 'Score', durationSec: 12, tone: 146 },
    ],
  },
  record: {
    title: 'Take 3',
    meta: '128 BPM · C minor',
    bpm: 128,
    tracks: [
      { id: 'studio', title: 'Studio vocal', durationSec: 11, tone: 220 },
      { id: 'original', title: 'Original', durationSec: 11, tone: 174 },
    ],
  },
  beats: {
    title: 'Night loop',
    meta: '140 BPM · F minor',
    bpm: 140,
    tracks: [
      { id: 'melody', title: 'Melody', durationSec: 8, tone: 349 },
      { id: 'drums', title: 'Drums', durationSec: 16, tone: 70 },
      { id: 'bass', title: 'Bass', durationSec: 16, tone: 55 },
    ],
  },
  samples: {
    title: 'Kit',
    meta: '128 BPM · C minor',
    bpm: 128,
    tracks: [
      { id: 'room', title: 'Room tone', durationSec: 6, tone: 90 },
      { id: 'hat', title: 'Hat', durationSec: 4, tone: 2400 },
      { id: 'keys', title: 'Soft keys', durationSec: 8, tone: 262 },
    ],
  },
} as const;

type FrameId = keyof typeof frames;

export function ShotPage() {
  const params = useParams();
  const frame = frames[(params.frame || '') as FrameId] || frames.scene;
  const sources = useMemo(() => {
    const next: Record<string, string> = {};
    for (const track of frame.tracks) next[track.id] = wavUrl(track.tone, track.durationSec, track.id === 'drums' || track.id === 'beat' || track.id === 'hat');
    return next;
  }, [frame]);
  const arrangement = useMemo(() => {
    let next: Arrangement = seedArrangement('shot', frame.bpm, frame.tracks.map((track) => ({
      id: track.id,
      title: track.title,
      stemName: track.title,
      durationSec: track.durationSec,
    })), sequence());
    if (params.frame === 'record') {
      const original = next.tracks.find((track) => track.name.includes('ORIGINAL'));
      if (original) next = setTrack(next, original.id, { muted: true });
    }
    return next;
  }, [frame, params.frame]);

  useEffect(() => {
    const timer = window.setTimeout(() => { document.documentElement.dataset.ready = '1'; }, 1600);
    return () => {
      window.clearTimeout(timer);
      delete document.documentElement.dataset.ready;
    };
  }, [frame]);

  return (
    <main className="shot-root">
      <header className="shot-bar">
        <Mark size={22} />
        <strong>RED SOUND</strong>
        <span>{frame.meta}</span>
      </header>
      <div className="shot-title">
        <h1>{frame.title}</h1>
      </div>
      <Timeline
        arrangement={arrangement}
        sources={sources}
        onCommit={() => {}}
        onCapture={async (input) => ({ id: input.title, title: input.title })}
        sessionName={frame.title}
      />
    </main>
  );
}

function sequence() {
  let n = 0;
  return () => `shot-${n += 1}`;
}

function wavUrl(freq: number, seconds: number, pulse: boolean) {
  const rate = 22050;
  const length = Math.floor(rate * seconds);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  write(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  write(view, 8, 'WAVE');
  write(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(view, 36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const beat = (t * 2) % 1;
    const pulseShape = beat < 0.09 ? 1 - beat / 0.09 : ((t * 8) % 1) < 0.03 ? 0.45 : 0.08;
    const voice = Math.pow(Math.sin(Math.PI * ((t * 1.6) % 1)), 2);
    const tone = Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 1.5 * t);
    const sample = tone * (pulse ? pulseShape : voice) * 0.28;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function write(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}
