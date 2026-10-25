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
  const openTasks = tasks.filter((task) => task.status !== 'SUCCESS' && !/FAIL|ERROR|SENSITIVE/.test(task.status));

  async function shapeTake(action: 'extend' | 'version' | 'separate' | 'vocals' | 'instrumental', assetId: string, durationSec: number) {
    if (!lead || !session) return;
    setError('');
    const label = action === 'extend' ? 'Extending this recording' : action === 'version' ? 'Making a new version of this recording' : action === 'separate' ? 'Separating this recording' : action === 'vocals' ? 'Adding a vocal to this recording' : 'Adding instruments to this recording';
    setJob(label);
    try {
      const task = action === 'extend'
        ? await api.uploadExtend(assetId, {
          continueAt: Math.max(1, Math.round(durationSec - 0.5)),
          style: 'Continue this recording, same voice and tempo',
          title: lead.title,
          lyrics: '',
        })
        : action === 'version'
          ? await api.cover(assetId, {
            style: 'A new arrangement of this recording, keep the performance',
            title: lead.title,
            instrumental: false,
            lyrics: '',
          })
          : action === 'separate'
            ? await api.stems(assetId, { type: 'separate_vocal' })
            : action === 'vocals'
              ? await api.vocals(assetId, { style: 'Keep this recording and add a vocal', title: lead.title, lyrics: '' })
              : await api.instrumental(assetId, { tags: 'Keep this recording and add instruments', title: lead.title, lyrics: '' });
      const done = await pollTask(task.id);
      if (done.status !== 'SUCCESS') throw new Error(done.error || 'That pass did not finish.');
      const nextSessions = await api.projects();
      setSessions(nextSessions);
      const fresh = nextSessions.find((item) => item.id === session.id);
      if (arrangement && fresh) {
        let next = arrangement;
        const added: Record<string, string> = {};
        for (const asset of fresh.assets) {
          if (!asset.audioUrl) continue;
          const present = next.tracks.some((track) => track.assetId === asset.id || track.clips.some((clip) => clip.assetId === asset.id));
          if (present) continue;
          next = addVocalTake(next, {
            assetId: asset.id,
            title: asset.title,
            durationSec: asset.durationSec || 30,
            startSec: 0,
          });
          const addedTrack = next.tracks[next.tracks.length - 1];
          if (addedTrack) next = setTrack(next, addedTrack.id, { name: asset.title });
          added[asset.id] = asset.audioUrl;
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
            <button key={item.id} type="button" className={item.id === session?.id ? 'session-item on' : 'session-item'} onClick={() => setSelected(item.id)}>
              <strong>{item.title}</strong>
              <small>{item.assets[0]?.bpm ? `${item.assets[0].bpm} BPM` : 'Session'}{item.assets[0]?.musicalKey ? ` · ${item.assets[0].musicalKey}` : ''}</small>
            </button>
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
                  const ext = type.includes('wav') ? 'wav' : 'webm';
                  const file = new File([input.blob], `take.${ext}`, { type });
                  const saved = await api.upload({
                    filename: file.name,
                    contentType: file.type,
                    dataBase64: await fileToBase64(file),
                    title: input.title,
                    kind: 'vocal',
                    origin: 'human_created',
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
