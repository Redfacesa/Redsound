import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addVocalTake, setTrack, type Arrangement } from '@shared/arrange.ts';
import { formatZar, originLabel } from '@shared/rights.ts';
import type { TrackView } from '@shared/types.ts';
import { Timeline } from '../components/Timeline';
import { api, fileToBase64, pollTask } from '../lib/api';
import { jobLabel, studioError } from '../lib/studio';

const SPLITS = [
  { id: 'separate_vocal', label: 'Voice and music' },
  { id: 'split_stem', label: 'Full split' },
  { id: 'split_stem_advanced', label: 'One instrument' },
] as const;

type Action = 'split' | 'arrange' | 'voice' | 'instruments' | 'section' | 'version' | 'artwork' | 'midi' | 'restore' | 'voice-save';

export function AssetPage() {
  const { id = '' } = useParams();
  const [asset, setAsset] = useState<TrackView | null>(null);
  const [library, setLibrary] = useState<TrackView[]>([]);
  const [error, setError] = useState('');
  const [job, setJob] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | ''>('');
  const [mode, setMode] = useState<(typeof SPLITS)[number]['id']>('separate_vocal');
  const [stemName, setStemName] = useState('Lead Vocal');
  const [continueAt, setContinueAt] = useState(30);
  const [style, setStyle] = useState('Hip-Hop');
  const [lyrics, setLyrics] = useState('');
  const [sectionStart, setSectionStart] = useState(0);
  const [sectionEnd, setSectionEnd] = useState(12);
  const [partnerId, setPartnerId] = useState('');
  const [voiceName, setVoiceName] = useState('');
  const [voiceNote, setVoiceNote] = useState('');
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [extraSources, setExtraSources] = useState<Record<string, string>>({});
  const [revealMaster, setRevealMaster] = useState(0);
  const [bounceSignal, setBounceSignal] = useState(0);

  function load() {
    return api.asset(id).then(setAsset).catch((reason: Error) => setError(studioError(reason.message)));
  }

  useEffect(() => {
    void load();
    api.library().then(setLibrary).catch(() => setLibrary([]));
    api.arrangement(id).then(setArrangement).catch(() => setArrangement(null));
  }, [id]);

  async function run(kind: string, task: Promise<{ id: string }>) {
    setBusy(true);
    setError('');
    setJob(jobLabel(kind));
    try {
      const opened = await task;
      const done = await pollTask(opened.id, () => setJob(jobLabel(kind)));
      if (done.error) throw new Error(done.error);
      await load();
      const next = await api.arrangement(id);
      if (next) setArrangement(next);
      setJob('Ready');
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'The session could not finish.'));
      setJob('');
    } finally {
      setBusy(false);
    }
  }

  async function listInStore(assetIds: string[]) {
    setBusy(true);
    setError('');
    try {
      const listing = await api.listForSale(assetIds);
      window.location.assign(`/market/${listing.id}`);
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'The listing was not prepared.'));
      setBusy(false);
    }
  }

  if (!asset) return <p className="meta">{error || 'Opening session…'}</p>;
  const openAsset = asset;

  async function shapeClip(action: 'extend' | 'version' | 'separate' | 'vocals' | 'instrumental', assetId: string, durationSec: number) {
    setBusy(true);
    setError('');
    const label = action === 'extend' ? 'Extending this recording' : action === 'version' ? 'Making a new version of this recording' : action === 'separate' ? 'Separating this recording' : action === 'vocals' ? 'Adding a vocal to this recording' : 'Adding instruments to this recording';
    setJob(label);
    try {
      const task = action === 'extend'
        ? await api.uploadExtend(assetId, {
          continueAt: Math.max(1, Math.round(durationSec - 0.5)),
          style: 'Continue this recording, same voice and tempo',
          title: openAsset.title,
          lyrics,
        })
        : action === 'version'
          ? await api.cover(assetId, {
            style: 'A new arrangement of this recording, keep the performance',
            title: openAsset.title,
            instrumental: false,
            lyrics,
          })
          : action === 'separate'
            ? await api.stems(assetId, { type: 'separate_vocal' })
            : action === 'vocals'
              ? await api.vocals(assetId, { style: style || 'Keep this recording and add a vocal', title: openAsset.title, lyrics })
              : await api.instrumental(assetId, { tags: style || 'Keep this recording and add instruments', title: openAsset.title, lyrics });
      const done = await pollTask(task.id);
      if (done.status !== 'SUCCESS') throw new Error(done.error || 'That pass did not finish.');
      const fresh = await api.asset(id);
      setAsset(fresh);
      const incoming = [...fresh.children, ...(done.assets || []).filter((item): item is TrackView => Boolean(item))];
      const urls: Record<string, string> = {};
      if (arrangement) {
        let next = arrangement;
        for (const item of incoming) {
          if (!item.audioUrl || item.id === id) continue;
          urls[item.id] = item.audioUrl;
          const present = next.tracks.some((track) => track.assetId === item.id || track.clips.some((clip) => clip.assetId === item.id));
          if (present) continue;
          next = addVocalTake(next, {
            assetId: item.id,
            title: item.title,
            durationSec: item.durationSec || durationSec || 30,
            startSec: 0,
          });
          const added = next.tracks[next.tracks.length - 1];
          if (added) next = setTrack(next, added.id, { name: item.title });
        }
        if (next !== arrangement) {
          setArrangement(next);
          void api.saveArrangement(id, next);
        }
      }
      if (Object.keys(urls).length) setExtraSources((current) => ({ ...current, ...urls }));
      setJob('Ready');
    } catch (reason) {
      setError(studioError(reason instanceof Error ? reason.message : 'That pass did not finish.'));
      setJob('');
    } finally {
      setBusy(false);
    }
  }

  const when = new Date(asset.createdAt).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  const sources = {
    ...Object.fromEntries(
      [asset, ...asset.children, ...library].filter((item) => item.audioUrl).map((item) => [item.id, item.audioUrl as string]),
    ),
    ...extraSources,
  };

  return (
    <div className="stack">
      <div className="session-head">
        <div>
          <p className="kicker">Session · {when}</p>
          <h1>{asset.title}</h1>
          <div className="session-meta">
            {asset.provenance?.style?.split(',')[0] || asset.kind}
            {asset.bpm ? ` · ${asset.bpm} BPM` : ''}
            {asset.musicalKey ? ` · ${asset.musicalKey}` : ''}
            {asset.provenance ? ` · ${originLabel(asset.provenance.origin)}` : ''}
          </div>
        </div>
        <div className="row">
          <button className="btn secondary" type="button" onClick={() => setRevealMaster((value) => value + 1)}>Master</button>
          <button className="btn" type="button" onClick={() => setBounceSignal((value) => value + 1)}>Export</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => listInStore([asset.id])}>Store</button>
        </div>
      </div>
      {job && (
        <div className="processing">
          <strong>{job}</strong>
          <div className="meta">{asset.title}</div>
          <div className="meter"><span /></div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {arrangement && (
        <Timeline
          arrangement={arrangement}
          sources={sources}
          onCommit={(next) => {
            setArrangement(next);
            void api.saveArrangement(asset.id, next);
          }}
          onProduce={(action, range) => {
            if (action === 'extend') {
              void run('extend', api.extend(asset.id, { continueAt: Math.round(range.end), title: asset.title }));
              return;
            }
            if (range.end - range.start < 10) {
              setError('A replaced section needs at least 10 seconds.');
              return;
            }
            void run('replace_section', api.replaceSection(asset.id, {
              infillStartS: Number(range.start.toFixed(2)),
              infillEndS: Number(range.end.toFixed(2)),
              fullLyrics: lyrics,
              tags: style,
              title: openAsset.title,
            }));
          }}
          onShape={(action, assetId, durationSec) => { void shapeClip(action, assetId, durationSec); }}
          onCapture={async (input) => {
            const file = new File([input.blob], `${input.title}.webm`, { type: input.blob.type || 'audio/webm' });
            const saved = await api.upload({
              filename: file.name,
              contentType: file.type,
              dataBase64: await fileToBase64(file),
              title: input.title,
              kind: 'vocal',
              origin: 'human_created',
              parentAssetId: asset.id,
              durationSec: input.durationSec,
              bpm: asset.bpm,
              musicalKey: asset.musicalKey,
            });
            if (saved.audioUrl) setExtraSources((current) => ({ ...current, [saved.id]: saved.audioUrl as string }));
            return { id: saved.id, title: saved.title };
          }}
          sessionName={asset.title}
          revealMaster={revealMaster}
          bounceSignal={bounceSignal}
        />
      )}
      {asset.imageUrl && <img src={asset.imageUrl} alt="" style={{ width: 120, borderRadius: 4 }} />}
      <div className="row">
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'split' ? '' : 'split')}>Stems</button>
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'arrange' ? '' : 'arrange')}>Arrange</button>
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'voice' ? '' : 'voice')}>Voice</button>
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'instruments' ? '' : 'instruments')}>Instruments</button>
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'section' ? '' : 'section')}>Section</button>
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'version' ? '' : 'version')}>Version</button>
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'artwork' ? '' : 'artwork')}>Artwork</button>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => run('midi', api.midi(asset.id))}>MIDI</button>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => run('recovery', api.recover(asset.id))}>Restore</button>
        <button className="btn secondary" type="button" onClick={() => setAction(action === 'voice-save' ? '' : 'voice-save')}>Save voice</button>
      </div>
      {action === 'split' && (
        <section className="panel stack">
          <h2>Split</h2>
          <div className="chips">
            {SPLITS.map((item) => (
              <button key={item.id} type="button" className={mode === item.id ? 'chip on' : 'chip'} onClick={() => setMode(item.id)}>{item.label}</button>
            ))}
          </div>
          {mode === 'split_stem_advanced' && (
            <label>Instrument<input value={stemName} onChange={(event) => setStemName(event.target.value)} /></label>
          )}
          <button className="btn" type="button" disabled={busy} onClick={() => run('vocal_removal', api.stems(asset.id, { type: mode, stemName }))}>Split tracks</button>
          {asset.children.length > 0 && (
            <button className="btn secondary" type="button" disabled={busy} onClick={() => listInStore(asset.children.map((child) => child.id))}>List stem pack</button>
          )}
        </section>
      )}
      {action === 'arrange' && (
        <section className="panel row">
          <label>From second<input type="number" value={continueAt} onChange={(event) => setContinueAt(Number(event.target.value))} /></label>
          <button className="btn" type="button" disabled={busy} onClick={() => run('extend', api.extend(asset.id, { continueAt, title: asset.title }))}>Extend</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => run('upload_extend', api.uploadExtend(asset.id, { style, lyrics, continueAt, title: asset.title }))}>Extend import</button>
        </section>
      )}
      {action === 'voice' && (
        <section className="panel stack">
          <label>Style<input value={style} onChange={(event) => setStyle(event.target.value)} /></label>
          <label>Lyrics<textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} /></label>
          <button className="btn" type="button" disabled={busy} onClick={() => run('add_vocals', api.vocals(asset.id, { style, lyrics, title: asset.title }))}>Add voice</button>
        </section>
      )}
      {action === 'instruments' && (
        <section className="panel stack">
          <label>Instruments<input value={style} onChange={(event) => setStyle(event.target.value)} /></label>
          <button className="btn" type="button" disabled={busy} onClick={() => run('add_instrumental', api.instrumental(asset.id, { tags: style, lyrics, title: asset.title }))}>Add instruments</button>
        </section>
      )}
      {action === 'section' && (
        <section className="panel stack">
          <div className="row">
            <label>Start<input type="number" value={sectionStart} onChange={(event) => setSectionStart(Number(event.target.value))} /></label>
            <label>End<input type="number" value={sectionEnd} onChange={(event) => setSectionEnd(Number(event.target.value))} /></label>
          </div>
          <label>Lyrics<textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} /></label>
          <button className="btn" type="button" disabled={busy} onClick={() => run('replace_section', api.replaceSection(asset.id, { infillStartS: sectionStart, infillEndS: sectionEnd, fullLyrics: lyrics, tags: style, title: asset.title }))}>Replace section</button>
        </section>
      )}
      {action === 'version' && (
        <section className="panel stack">
          <label>Style<input value={style} onChange={(event) => setStyle(event.target.value)} /></label>
          <label>
            Second session
            <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
              <option value="">None</option>
              {library.filter((item) => item.id !== asset.id && item.audioUrl).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <div className="row">
            <button className="btn" type="button" disabled={busy} onClick={() => run('upload_cover', api.cover(asset.id, { style, lyrics, title: asset.title }))}>New version</button>
            <button className="btn secondary" type="button" disabled={busy || !partnerId} onClick={() => run('mashup', api.mashup([asset.id, partnerId]))}>Combine</button>
          </div>
        </section>
      )}
      {action === 'artwork' && (
        <section className="panel row">
          <button className="btn" type="button" disabled={busy} onClick={() => run('cover_image', api.artwork(asset.id))}>Design artwork</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api.lyricsSync(asset.id);
              await load();
              setJob('Lyrics aligned');
            } catch (reason) {
              setError(studioError(reason instanceof Error ? reason.message : 'Lyrics were not aligned.'));
            } finally {
              setBusy(false);
            }
          }}>Align lyrics</button>
        </section>
      )}
      {action === 'voice-save' && (
        <section className="panel stack">
          <label>Voice name<input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} /></label>
          <label>Character<input value={voiceNote} onChange={(event) => setVoiceNote(event.target.value)} /></label>
          <button className="btn" type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api.persona(asset.id, { name: voiceName, description: voiceNote, style });
              await load();
              setJob('Voice saved');
            } catch (reason) {
              setError(studioError(reason instanceof Error ? reason.message : 'The voice was not saved.'));
            } finally {
              setBusy(false);
            }
          }}>Save voice</button>
        </section>
      )}
      <section className="panel stack">
        {(asset.provenance?.origin === 'ai_generated' || asset.provenance?.origin === 'ai_assisted') && (
          <button className="btn secondary" type="button" disabled={busy || Boolean(asset.provenance?.providerTermsAcknowledgedAt)} onClick={async () => {
            await api.acknowledge(asset.id);
            await load();
          }}>
            {asset.provenance?.providerTermsAcknowledgedAt ? 'Generation terms on file' : 'Confirm generation terms'}
          </button>
        )}
        <p className="notice">Rights records are a declaration for this session. They are not a copyright registration and they are not legal advice.</p>
        <div className="row">
          <Link to="/rights">Rights</Link>
          <span className="meta">Licences start at {formatZar(9900)}, {formatZar(29900)}, {formatZar(79900)}, and {formatZar(250000)}.</span>
        </div>
      </section>
    </div>
  );
}
