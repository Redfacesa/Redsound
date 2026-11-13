import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mark } from '../components/Mark';
import { convertAudio } from '../lib/convert';
import { outputName, rejectReason, sizeLabel, type ConvertTarget } from '../lib/convertName';

const ACCEPT = 'audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.webm,.flac,.aiff,.aif,.caf,.3gp,.amr,.wma,.mp4,.m4b';

export function ConvertPage() {
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<ConvertTarget>('wav');
  const [stage, setStage] = useState<'idle' | 'prepare' | 'convert' | 'done'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const busy = stage === 'prepare' || stage === 'convert';

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  function take(next: File | undefined) {
    if (!next) return;
    setError(rejectReason(next));
    setFile(next);
    setStage('idle');
    setResult((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function run() {
    if (!file || busy) return;
    const refused = rejectReason(file);
    if (refused) {
      setError(refused);
      return;
    }
    setError('');
    setStage('prepare');
    try {
      const blob = await convertAudio(file, target, setStage);
      const url = URL.createObjectURL(blob);
      setResult((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { url, name: outputName(file.name, target) };
      });
      setStage('done');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The file did not convert.');
      setStage('idle');
    }
  }

  return (
    <main className="gate">
      <header className="gate-bar">
        <Link to="/" className="brand">
          <Mark />
          <span className="brand-name">
            <strong>RED SOUND</strong>
            <span>STUDIO</span>
          </span>
        </Link>
        <Link to="/login">Sign in</Link>
      </header>
      <section className="gate-hero">
        <p className="kicker">Convert</p>
        <h1>Turn the voice note into a WAV or an MP3.</h1>
        <p className="lede">A note can arrive as M4A, AAC, OGG, WEBM, AMR, or something else. Pick WAV or MP3. The file stays on this device, and the conversion is free.</p>
      </section>
      <section
        className="gate-card"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          take(event.dataTransfer.files?.[0]);
        }}
      >
        <label>
          Sound
          <input
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={(event) => {
              take(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <p className="meta">{file ? `${file.name} · ${sizeLabel(file.size)}` : 'Drop a voice note here, or choose the file. A video keeps only the sound.'}</p>
        <div>
          <div className="kicker">Save as</div>
          <div className="chips">
            {(['wav', 'mp3'] as const).map((item) => (
              <button key={item} type="button" className={target === item ? 'chip on' : 'chip'} disabled={busy} onClick={() => setTarget(item)}>
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" type="button" disabled={busy || !file || Boolean(rejectReason(file))} onClick={() => { void run(); }}>
          {stage === 'prepare' ? 'Preparing' : stage === 'convert' ? 'Converting' : 'Convert'}
        </button>
        {stage === 'prepare' && <p className="meta">Preparing the converter. The first time takes a moment.</p>}
        {error && <p className="error">{error}</p>}
        {result && (
          <div className="stack">
            <audio src={result.url} controls />
            <a className="btn" href={result.url} download={result.name}>Download {result.name}</a>
          </div>
        )}
      </section>
    </main>
  );
}
