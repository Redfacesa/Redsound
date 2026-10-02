import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppConfig, TrackView } from '@shared/types.ts';
import { api, fileToBase64, pollTask } from '../lib/api';
import { GENRES, INSTRUMENTS, KEYS, LENGTHS, clock, jobLabel, studioError } from '../lib/studio';

type Room = 'beat' | 'song' | 'voice' | 'instrument';

export function CreatePage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [room, setRoom] = useState<Room>('beat');
  const [title, setTitle] = useState('Midnight');
  const [bpm, setBpm] = useState(128);
  const [musicalKey, setMusicalKey] = useState('C Minor');
  const [genre, setGenre] = useState<(typeof GENRES)[number]>('Hip-Hop');
  const [length, setLength] = useState<number>(150);
  const [instruments, setInstruments] = useState<string[]>(['Drums', 'Bass', 'Keys']);
  const [voice, setVoice] = useState<'none' | 'm' | 'f' | string>('none');
  const [lyrics, setLyrics] = useState('');
  const [pattern, setPattern] = useState('Four on the floor');
  const [soundLoop, setSoundLoop] = useState(false);
  const [voices, setVoices] = useState<TrackView[]>([]);
  const [voiceUrl, setVoiceUrl] = useState('');
  const [vocalStart, setVocalStart] = useState(0);
  const [vocalEnd, setVocalEnd] = useState(30);
  const [voiceName, setVoiceName] = useState('');
  const [verifyUrl, setVerifyUrl] = useState('');
  const [voiceTask, setVoiceTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState('');
  const [error, setError] = useState('');

  const ready = Boolean(config?.sunoConfigured);

  useEffect(() => {
    api.config().then(setConfig).catch((reason: Error) => setError(studioError(reason.message)));
    api.library().then((assets) => {
      setVoices(assets.filter((asset) => asset.kind === 'vocal' || asset.provenance?.personaId || asset.provenance?.voiceId));
    }).catch(() => setVoices([]));
  }, []);

  function toggleInstrument(name: string) {
    setInstruments((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  function arrangementStyle() {
    const picked = instruments.length ? instruments.join(', ') : 'full band';
    return `${genre}, ${bpm} BPM, ${musicalKey}, ${picked}`;
  }

  async function follow(taskId: string, kind: string) {
    setJob(jobLabel(kind));
    const done = await pollTask(taskId, () => setJob(jobLabel(kind)));
    if (done.error) throw new Error(done.error);
    const assetId = done.assetIds[0] || done.assets.find(Boolean)?.id;
    if (assetId) navigate(`/library/${assetId}`);
    else setJob('Ready. Open the session from Studio.');
  }

  async function generate() {
    setBusy(true);
    setError('');
    const savedVoice = voices.find((item) => item.provenance?.personaId === voice || item.provenance?.voiceId === voice);
    const instrumental = room === 'beat' || voice === 'none';
    try {
      const task = await api.generate({
        title,
        style: arrangementStyle(),
        lyrics: room === 'song' ? lyrics : undefined,
        instrumental,
        customMode: true,
        model: config?.model || 'V6',
        duration: length,
        bpm,
        musicalKey,
        vocalGender: voice === 'm' || voice === 'f' ? voice : undefined,
        personaId: savedVoice ? voice : undefined,
        personaModel: savedVoice ? 'voice_persona' : undefined,
      });
      await follow(task.id, 'generate');
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'The session did not render.'));
      setJob('');
    } finally {
      setBusy(false);
    }
  }

  async function designSound() {
    setBusy(true);
    setError('');
    const instrument = instruments[0] || 'Synth';
    try {
      const task = await api.sounds({
        prompt: `${instrument}, ${pattern}, ${genre}, ${bpm} BPM, ${musicalKey}`,
        model: config?.model || 'V6',
        soundLoop,
        soundTempo: bpm,
      });
      await follow(task.id, 'sounds');
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'The sound did not render.'));
      setJob('');
    } finally {
      setBusy(false);
    }
  }

  async function draftLyrics() {
    setBusy(true);
    setError('');
    try {
      const task = await api.lyrics(`${title}. ${genre}. ${musicalKey}. ${bpm} BPM.`);
      setJob(jobLabel('lyrics'));
      const done = await pollTask(task.id, () => setJob(jobLabel('lyrics')));
      const text = done.assets.find((asset) => asset?.work?.lyrics)?.work?.lyrics;
      if (text) setLyrics(text);
      setJob(text ? '' : 'Lyrics are in the library.');
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'Lyrics were not drafted.'));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined, origin: 'imported' | 'human_created', kind: 'beat' | 'vocal') {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const asset = await api.upload({
        filename: file.name,
        contentType: file.type || 'audio/webm',
        dataBase64: await fileToBase64(file),
        title: title || file.name,
        kind,
        origin,
        bpm,
        musicalKey,
      });
      navigate(`/library/${asset.id}`);
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'Import failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="session-head">
        <div>
          <p className="kicker">Create</p>
          <h1>New session</h1>
        </div>
      </div>
      {job && (
        <div className="processing">
          <strong>{job}</strong>
          <div className="meta">{title}</div>
          <div className="meter"><span /></div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <div className="modes">
          {(['beat', 'song', 'voice', 'instrument'] as const).map((item) => (
            <button key={item} className={room === item ? 'on' : ''} type="button" onClick={() => setRoom(item)}>
              {item === 'instrument' ? 'Instrument' : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <div className="stack">
          <div className="controls">
            <label>Session<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Tempo<input type="number" min={40} max={240} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} /></label>
            <label>Key<select value={musicalKey} onChange={(event) => setMusicalKey(event.target.value)}>{KEYS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Genre<select value={genre} onChange={(event) => setGenre(event.target.value as (typeof GENRES)[number])}>{GENRES.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          {room !== 'voice' && room !== 'instrument' && (
            <label>
              Length
              <select value={length} onChange={(event) => setLength(Number(event.target.value))}>
                {LENGTHS.map((seconds) => <option key={seconds} value={seconds}>{clock(seconds)}</option>)}
              </select>
            </label>
          )}
          {room !== 'voice' && (
            <div>
              <div className="kicker">Instruments</div>
              <div className="chips">
                {INSTRUMENTS.map((name) => (
                  <button key={name} type="button" className={instruments.includes(name) ? 'chip on' : 'chip'} onClick={() => toggleInstrument(name)}>{name}</button>
                ))}
              </div>
            </div>
          )}
          {(room === 'beat' || room === 'song') && (
            <div>
              <div className="kicker">Voice</div>
              <div className="chips">
                <button type="button" className={voice === 'none' ? 'chip on' : 'chip'} onClick={() => setVoice('none')}>No voice</button>
                <button type="button" className={voice === 'm' ? 'chip on' : 'chip'} onClick={() => setVoice('m')}>Male</button>
                <button type="button" className={voice === 'f' ? 'chip on' : 'chip'} onClick={() => setVoice('f')}>Female</button>
                {voices.filter((item) => item.provenance?.personaId || item.provenance?.voiceId).map((item) => {
                  const id = item.provenance?.voiceId || item.provenance?.personaId || item.id;
                  return (
                    <button key={item.id} type="button" className={voice === id ? 'chip on' : 'chip'} onClick={() => setVoice(id)}>
                      {item.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {room === 'song' && (
            <label>
              Lyrics
              <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} placeholder="Write the lyric, or draft one from the session." />
            </label>
          )}
          {room === 'instrument' && (
            <div className="row">
              <label>Pattern<input value={pattern} onChange={(event) => setPattern(event.target.value)} /></label>
              <label className="check"><input type="checkbox" checked={soundLoop} onChange={(event) => setSoundLoop(event.target.checked)} /> Loop</label>
            </div>
          )}
          {room === 'voice' && (
            <div className="stack">
              <div className="row">
                <label>Recording link<input value={voiceUrl} onChange={(event) => setVoiceUrl(event.target.value)} placeholder="https://" /></label>
                <label>Start<input type="number" value={vocalStart} onChange={(event) => setVocalStart(Number(event.target.value))} /></label>
                <label>End<input type="number" value={vocalEnd} onChange={(event) => setVocalEnd(Number(event.target.value))} /></label>
              </div>
              <div className="row">
                <button className="btn secondary" type="button" disabled={busy || !ready} onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const task = await api.voiceValidate({ voiceUrl, vocalStartS: vocalStart, vocalEndS: vocalEnd, language: 'en' });
                    setJob('Checking recording');
                    const done = await pollTask(task.id, () => setJob('Checking recording'));
                    setVoiceTask(done.sunoTaskId || '');
                    setJob('Phrase ready');
                  } catch (reason) {
                    setError(studioError(reason instanceof Error ? reason.message : 'The recording could not be checked.'));
                    setJob('');
                  } finally {
                    setBusy(false);
                  }
                }}>Check recording</button>
                <button className="btn secondary" type="button" disabled={busy || !ready || !voiceTask} onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const task = await api.voiceRegenerate(voiceTask);
                    setJob('Preparing phrase');
                    const done = await pollTask(task.id, () => setJob('Preparing phrase'));
                    setVoiceTask(done.sunoTaskId || voiceTask);
                    setJob('New phrase ready');
                  } catch (reason) {
                    setError(studioError(reason instanceof Error ? reason.message : 'The phrase could not be refreshed.'));
                  } finally {
                    setBusy(false);
                  }
                }}>New phrase</button>
              </div>
              <div className="row">
                <label>Voice name<input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} /></label>
                <label>Spoken phrase link<input value={verifyUrl} onChange={(event) => setVerifyUrl(event.target.value)} placeholder="https://" /></label>
              </div>
              <button className="btn" type="button" disabled={busy || !ready || !voiceTask} onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const task = await api.voiceGenerate({ taskId: voiceTask, verifyUrl, voiceName, style: genre, description: `${voiceName} · ${genre}` });
                  setJob('Creating voice');
                  const done = await pollTask(task.id, () => setJob('Creating voice'));
                  const created = done.request.voiceId;
                  if (typeof created === 'string') setVoice(created);
                  setJob(typeof created === 'string' ? `${voiceName || 'Voice'} is ready` : 'Voice saved');
                } catch (reason) {
                  setError(studioError(reason instanceof Error ? reason.message : 'The voice was not created.'));
                } finally {
                  setBusy(false);
                }
              }}>Create voice</button>
            </div>
          )}
          <div className="row">
            {room === 'instrument' ? (
              <button className="btn arm" type="button" disabled={busy || !ready} onClick={designSound}>Design</button>
            ) : room === 'song' ? (
              <>
                <button className="btn arm" type="button" disabled={busy || !ready} onClick={generate}>Generate</button>
                <button className="btn secondary" type="button" disabled={busy || !ready} onClick={draftLyrics}>Draft lyrics</button>
              </>
            ) : room === 'beat' ? (
              <button className="btn arm" type="button" disabled={busy || !ready} onClick={generate}>Generate</button>
            ) : null}
            {!ready && <span className="meta">Studio engine offline</span>}
          </div>
        </div>
      </section>
      <section className="panel row">
        <label>
          Import audio
          <input type="file" accept="audio/*" disabled={busy} onChange={(event) => onFile(event.target.files?.[0], 'imported', 'beat')} />
        </label>
        <RecordButton disabled={busy} onBlob={(file) => onFile(file, 'human_created', 'vocal')} />
      </section>
    </div>
  );
}

function RecordButton({ disabled, onBlob }: { disabled: boolean; onBlob: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (recording) return;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        onBlob(new File([blob], 'vocal.webm', { type: blob.type }));
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
      window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 20000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Microphone unavailable');
    }
  }

  return (
    <label>
      Record
      <button className="btn secondary" type="button" disabled={disabled || recording} onClick={toggle}>
        {recording ? 'Recording' : 'Record'}
      </button>
      {error && <p className="error">{error}</p>}
    </label>
  );
}
