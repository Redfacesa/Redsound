import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addVocalTake, setTrack, type Arrangement } from '@shared/arrange.ts';
import type { TaskRecord, TrackView } from '@shared/types.ts';
import { Timeline } from '../components/Timeline';
import { api, fileToBase64, pollTask } from '../lib/api';
import { KEYS, jobLabel, studioError } from '../lib/studio';

type Session = { id: string; title: string; createdAt?: string; assets: TrackView[] };

export function StudioPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [error, setError] = useState('');
  const [job, setJob] = useState('');
  const [extraSources, setExtraSources] = useState<Record<string, string>>({});
  const [revealMaster, setRevealMaster] = useState(0);
  const [bounceSignal, setBounceSignal] = useState(0);
  const [title, setTitle] = useState('First song');
  const [bpm, setBpm] = useState(120);
  const [musicalKey, setMusicalKey] = useState<(typeof KEYS)[number]>('C Minor');
  const [genre, setGenre] = useState('Hip-Hop');
  const [opening, setOpening] = useState(false);

  async function startSession() {
    setOpening(true);
    setError('');
    try {
      const session = await api.openSession({ title, bpm, musicalKey });
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setSelected(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The session did not open.');
    } finally {
      setOpening(false);
    }
  }

  useEffect(() => {
    api.projects().then((next) => {
      setSessions(next);
      setSelected((current) => current || next[0]?.id || '');
    }).catch((reason: Error) => setError(reason.message));
    api.tasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  const session = sessions.find((item) => item.id === selected) || sessions[0];
  const lead = session?.assets.find((asset) => asset.audioUrl) || session?.assets[0];

  useEffect(() => {
    if (!lead) return;
    api.arrangement(lead.id).then(setArrangement).catch((reason: Error) => setError(reason.message));
  }, [lead?.id]);
  const openTasks = tasks.filter((task) => {
    if (task.status === 'SUCCESS' || task.status === 'FIRST_SUCCESS' || /FAIL|ERROR|SENSITIVE/.test(task.status)) return false;
    const age = Date.now() - new Date(task.updatedAt || task.createdAt).getTime();
    return age < 12 * 60 * 1000;
  });

  async function shapeTake(action: 'extend' | 'version' | 'separate' | 'vocals' | 'instrumental', assetId: string, durationSec: number) {
    if (!lead || !session) return;
    setError('');
    const tempo = arrangement?.bpm || lead.bpm || bpm;
    const key = lead.musicalKey || musicalKey;
    const label = action === 'extend' ? 'Extending this recording' : action === 'version' ? 'Making the song from this vocal' : action === 'separate' ? 'Separating this recording' : action === 'vocals' ? 'Adding a vocal to this recording' : 'Adding a beat under this vocal';
    setJob(label);
    try {
      const task = action === 'extend'
        ? await api.uploadExtend(assetId, {
          continueAt: Math.max(1, Math.round(durationSec - 0.5)),
          style: genre,
          title: lead.title,
          lyrics: '',
        })
        : action === 'version'
          ? await api.instrumental(assetId, {
            tags: genre,
            title: lead.title,
            lyrics: '',
            bpm: tempo,
            musicalKey: key,
            single: true,
          })
          : action === 'separate'
            ? await api.stems(assetId, { type: 'separate_vocal' })
            : action === 'vocals'
              ? await api.vocals(assetId, { style: 'Keep this recording and add a vocal', title: lead.title, lyrics: '' })
              : await api.instrumental(assetId, {
                tags: genre,
                title: lead.title,
                lyrics: '',
                bpm: tempo,
                musicalKey: key,
                single: true,
              });
      const done = await pollTask(task.id);
      if (done.status !== 'SUCCESS' && done.status !== 'FIRST_SUCCESS') throw new Error(done.error || 'That pass did not finish.');
      const nextSessions = await api.projects();
      setSessions(nextSessions);
      const fresh = nextSessions.find((item) => item.id === session.id);
      if (arrangement && fresh) {
        let next = arrangement;
        const added: Record<string, string> = {};
        const newcomers = fresh.assets.filter((asset) => {
          if (!asset.audioUrl) return false;
          return !next.tracks.some((track) => track.assetId === asset.id || track.clips.some((clip) => clip.assetId === asset.id));
        });
        const chosen = action === 'version' || action === 'instrumental' ? newcomers.slice(0, 1) : newcomers;
        for (const asset of chosen) {
          next = addVocalTake(next, {
            assetId: asset.id,
            title: asset.title,
            durationSec: asset.durationSec || 30,
            startSec: 0,
          });
          const addedTrack = next.tracks[next.tracks.length - 1];
          if (addedTrack) next = setTrack(next, addedTrack.id, { name: asset.title });
          if (asset.audioUrl) added[asset.id] = asset.audioUrl;
        }
        if (next !== arrangement) {
          setArrangement(next);
          void api.saveArrangement(lead.id, next);
        }
        if (Object.keys(added).length) setExtraSources((sources) => ({ ...sources, ...added }));
      }
      setJob('');
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'That pass failed.'));
      setJob('');
    }
  }

  async function dropSession(id: string, name: string) {
    if (!window.confirm(`Delete “${name}” and its recordings? This cannot be undone.`)) return;
    setError('');
    try {
      await api.deleteSession(id);
      const next = sessions.filter((item) => item.id !== id);
      setSessions(next);
      if (selected === id) {
        setSelected(next[0]?.id || '');
        setArrangement(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The session did not delete.');
    }
  }

  return (
    <div className="session-layout">
      <aside className="panel">
        <h2>Sessions</h2>
        <form className="session-new" onSubmit={(event) => { event.preventDefault(); void startSession(); }}>
          <label>
            Song
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <div className="session-tempo">
            <label>
              BPM
              <input type="number" min={40} max={220} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
            </label>
            <label>
              Key
              <select value={musicalKey} onChange={(event) => setMusicalKey(event.target.value as (typeof KEYS)[number])}>
                {KEYS.map((key) => <option key={key}>{key}</option>)}
              </select>
            </label>
          </div>
          <button className="btn" type="submit" disabled={opening}>{opening ? 'Opening' : 'New session'}</button>
        </form>
        <div className="session-list" style={{ marginTop: 10 }}>
          {sessions.length === 0 && <p className="meta">No sessions yet. Start one from New.</p>}
          {sessions.map((item) => (
            <div key={item.id} className="session-row">
              <button type="button" className={item.id === session?.id ? 'session-item on' : 'session-item'} onClick={() => setSelected(item.id)}>
                <strong>{item.title}</strong>
                <small>{item.assets[0]?.bpm ? `${item.assets[0].bpm} BPM` : 'Session'}{item.assets[0]?.musicalKey ? ` · ${item.assets[0].musicalKey}` : ''}</small>
              </button>
              <button type="button" className="tl-btn" aria-label={`Delete ${item.title}`} onClick={() => { void dropSession(item.id, item.title); }}>×</button>
            </div>
          ))}
        </div>
      </aside>
      <div className="stack">
        {error && <p className="error">{error}</p>}
        {openTasks.map((task) => (
          <div className="processing" key={task.id}>
            <strong>{jobLabel(task.kind)}</strong>
            <div className="meter"><span /></div>
          </div>
        ))}
        {session && lead ? (
          <>
            <div className="session-head">
              <div>
                <h1>{session.title}</h1>
                <div className="session-meta">
                  {lead.bpm || arrangement?.bpm || 120} BPM · 4/4 · {lead.musicalKey || 'C Minor'}
                  {session.createdAt ? ` · ${new Date(session.createdAt).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                </div>
              </div>
              <div className="row">
                <select aria-label="Genre" value={genre} onChange={(event) => setGenre(event.target.value)}>
                  {['Amapiano', 'Hip-Hop', 'R&B', 'Afrobeat', 'Gospel', 'Trap', 'Pop'].map((item) => <option key={item}>{item}</option>)}
                </select>
                <button className="btn secondary" type="button" onClick={() => setRevealMaster((value) => value + 1)}>Master</button>
                <button className="btn" type="button" onClick={() => setBounceSignal((value) => value + 1)}>Export</button>
                <Link className="btn secondary" to={`/library/${lead.id}`}>Session</Link>
              </div>
            </div>
            {job && <div className="processing"><strong>{job}</strong><div className="meter"><span /></div></div>}
            {arrangement && arrangement.id === lead.id && (
              <Timeline
                arrangement={arrangement}
                sources={{
                  ...Object.fromEntries(session.assets.filter((asset) => asset.audioUrl).map((asset) => [asset.id, asset.audioUrl as string])),
                  ...extraSources,
                }}
                onCommit={(next) => {
                  setArrangement(next);
                  void api.saveArrangement(lead.id, next);
                }}
                onProduce={(action, range) => {
                  if (action === 'extend') {
                    setJob(jobLabel('extend'));
                    void api.extend(lead.id, { continueAt: Math.round(range.end), title: lead.title })
                      .then(() => setJob('Extending arrangement'))
                      .catch((reason: Error) => { setError(studioError(reason.message)); setJob(''); });
                    return;
                  }
                  if (range.end - range.start < 10) {
                    setError('A replaced section needs at least 10 seconds.');
                    return;
                  }
                  setJob(jobLabel('replace_section'));
                  void api.replaceSection(lead.id, {
                    infillStartS: Number(range.start.toFixed(2)),
                    infillEndS: Number(range.end.toFixed(2)),
                    tags: lead.provenance?.style || 'Hip-Hop',
                    title: lead.title,
                    fullLyrics: '',
                  }).then(() => setJob('Replacing section')).catch((reason: Error) => { setError(studioError(reason.message)); setJob(''); });
                }}
                onShape={(action, assetId, durationSec) => { void shapeTake(action, assetId, durationSec); }}
                onCapture={async (input) => {
                  const type = input.blob.type || 'audio/webm';
                  const filename = input.filename || `take.${type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : 'webm'}`;
                  const saved = await api.upload({
                    filename,
                    contentType: type,
                    dataBase64: await fileToBase64(input.filename ? input.blob : new File([input.blob], filename, { type })),
                    title: input.title,
                    kind: input.kind || 'vocal',
                    origin: input.filename ? 'imported' : 'human_created',
                    parentAssetId: lead.id,
                    durationSec: input.durationSec,
                    bpm: lead.bpm,
                  });
                  if (saved.audioUrl) setExtraSources((current) => ({ ...current, [saved.id]: saved.audioUrl as string }));
                  return { id: saved.id, title: saved.title };
                }}
                sessionName={session.title}
                revealMaster={revealMaster}
                bounceSignal={bounceSignal}
              />
            )}
          </>
        ) : (
          <section className="panel">
            <h3>Open a session</h3>
            <p className="meta">Name the song, set the tempo and key, then record into the vocal lane. A generated beat can come in later. It does not have to start the session.</p>
          </section>
        )}
      </div>
    </div>
  );
}
