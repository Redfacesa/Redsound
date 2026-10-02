import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Arrangement } from '@shared/arrange.ts';
import type { TaskRecord, TrackView } from '@shared/types.ts';
import { Timeline } from '../components/Timeline';
import { api, fileToBase64 } from '../lib/api';
import { jobLabel, studioError } from '../lib/studio';

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

  return (
    <div className="session-layout">
      <aside className="panel">
        <h2>Sessions</h2>
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
                  {lead.provenance?.style?.split(',')[0] || lead.kind}
                  {lead.bpm ? ` · ${lead.bpm} BPM` : ''}
                  {lead.musicalKey ? ` · ${lead.musicalKey}` : ''}
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
                onCapture={async (input) => {
                  const file = new File([input.blob], `${input.title}.webm`, { type: input.blob.type || 'audio/webm' });
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
            <p className="meta">Create a beat, import a recording, or pick a session on the left.</p>
          </section>
        )}
      </div>
    </div>
  );
}
