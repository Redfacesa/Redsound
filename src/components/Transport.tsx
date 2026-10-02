import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { clock, waveHeights } from '../lib/studio';

export function Transport({ src, title }: { src?: string; title: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = waveHeights(title);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDuration(0);
  }, [src]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) {
      void audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(event: MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }

  const progress = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <section className="transport">
      <button className="transport-play" type="button" disabled={!src} onClick={toggle} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? 'Stop' : 'Play'}
      </button>
      <div className="transport-body">
        <div className="transport-title">{title}</div>
        <button className="wave-hit" type="button" onClick={seek} disabled={!src} aria-label="Seek">
          <span className="wave">
            {bars.map((height, index) => (
              <i key={index} style={{ height: `${height}%`, opacity: (index / bars.length) * 100 < progress ? 1 : 0.35 }} />
            ))}
          </span>
        </button>
        <div className="transport-time">
          <span>{clock(time)}</span>
          <span>{clock(duration)}</span>
        </div>
      </div>
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </section>
  );
}
