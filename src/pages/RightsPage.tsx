import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Split, SplitRole } from '@shared/types.ts';
import { api } from '../lib/api';

type WorkRow = {
  id: string;
  title: string;
  lyrics?: string;
  splits: Split[];
  assets: Array<{ id: string; title: string }>;
};

type RecordingRow = { id: string; title: string; assetId: string; splits: Split[] };

export function RightsPage() {
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [name, setName] = useState('Creator');
  const [handle, setHandle] = useState('creator');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  function load() {
    return api.rights().then((rights) => {
      setWorks(rights.works);
      setRecordings(rights.recordings);
      setName(rights.profile.displayName);
      setHandle(rights.profile.handle);
    });
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <div className="stack">
      <p className="kicker">Rights</p>
      <h1>Session rights</h1>
      <p className="lede">
        A musical work and a sound recording are different rights. Composition covers the melody, lyrics, and arrangement. The master is the actual audio. Splits here are your declaration. They are not a SAMRO registration and not a copyright filing.
      </p>
      <section className="panel row">
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Handle<input value={handle} onChange={(event) => setHandle(event.target.value)} /></label>
        <button className="btn secondary" onClick={() => api.saveProfile({ displayName: name, handle }).then(() => setSaved('Profile saved'))}>Save</button>
      </section>
      {saved && <p className="ok">{saved}</p>}
      {error && <p className="error">{error}</p>}

      {works.length === 0 && <div className="panel"><p className="meta">Create or upload something and its work and master will show up here.</p></div>}

      {works.map((work) => {
        const recording = recordings.find((item) => work.assets.some((asset) => asset.id === item.assetId));
        const asset = work.assets[0];
        return (
          <section className="panel stack" key={work.id}>
            <header>
              <div>
                <h2>{work.title}</h2>
                <p className="meta">{work.assets.length} linked asset{work.assets.length === 1 ? '' : 's'}</p>
              </div>
              {asset && <Link to={`/library/${asset.id}`}>Open asset</Link>}
            </header>
            <SplitEditor
              label="Composition"
              subjectType="work"
              subjectId={work.id}
              roles={['writer', 'publisher']}
              initial={work.splits}
              onSaved={load}
            />
            {recording && (
              <SplitEditor
                label="Master"
                subjectType="recording"
                subjectId={recording.id}
                roles={['master_owner', 'producer', 'performer']}
                initial={recording.splits}
                onSaved={load}
              />
            )}
            {asset && <Declaration assetId={asset.id} onSaved={load} />}
          </section>
        );
      })}
    </div>
  );
}

function SplitEditor({
  label,
  subjectType,
  subjectId,
  roles,
  initial,
  onSaved,
}: {
  label: string;
  subjectType: 'work' | 'recording';
  subjectId: string;
  roles: SplitRole[];
  initial: Split[];
  onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState(initial.length ? initial : [{ id: 'new', subjectType, subjectId, name: '', role: roles[0], shareBps: 10000 }]);
  const [message, setMessage] = useState('');
  const total = rows.reduce((sum, row) => sum + Number(row.shareBps || 0), 0);

  async function save() {
    setMessage('');
    try {
      await api.splits(subjectType, subjectId, rows.map((row) => ({ name: row.name, role: row.role, shareBps: Number(row.shareBps) })));
      setMessage(`${label} shares saved`);
      await onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not save shares');
    }
  }

  return (
    <div className="stack">
      <h3>{label} · {(total / 100).toFixed(2)}%</h3>
      {rows.map((row, index) => (
        <div className="split" key={`${row.id}-${index}`}>
          <input value={row.name} placeholder="Name" onChange={(event) => update(index, { name: event.target.value })} />
          <select value={row.role} onChange={(event) => update(index, { role: event.target.value as SplitRole })}>
            {roles.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}
          </select>
          <input type="number" value={row.shareBps / 100} onChange={(event) => update(index, { shareBps: Math.round(Number(event.target.value) * 100) })} />
          <button className="btn secondary" onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <button className="btn secondary" onClick={() => setRows([...rows, { id: crypto.randomUUID(), subjectType, subjectId, name: '', role: roles[0], shareBps: 0 }])}>Add share</button>
        <button className="btn" onClick={save}>Save {label.toLowerCase()}</button>
        {message && <span className="meta">{message}</span>}
      </div>
    </div>
  );

  function update(index: number, patch: Partial<Split>) {
    setRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }
}

function Declaration({ assetId, onSaved }: { assetId: string; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    createdThisWork: false,
    controlsRecording: false,
    usesSamples: false,
    samplesCleared: false,
    contributorsPermitted: false,
    acceptsResponsibility: false,
  });
  const [source, setSource] = useState('');
  const [proof, setProof] = useState('');
  const [message, setMessage] = useState('');

  async function sign() {
    setMessage('');
    try {
      if (form.usesSamples && source.trim()) await api.clearance(assetId, source, proof);
      await api.declare(assetId, form);
      setMessage('Declaration signed');
      await onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Declaration failed');
    }
  }

  return (
    <div className="stack">
      <h3>Do you control the rights you need to offer this?</h3>
      <label className="check"><input type="checkbox" checked={form.createdThisWork} onChange={(event) => setForm({ ...form, createdThisWork: event.target.checked })} /> I created this work, or I control the right to offer it.</label>
      <label className="check"><input type="checkbox" checked={form.controlsRecording} onChange={(event) => setForm({ ...form, controlsRecording: event.target.checked })} /> I own or control the recording.</label>
      <label className="check"><input type="checkbox" checked={form.contributorsPermitted} onChange={(event) => setForm({ ...form, contributorsPermitted: event.target.checked })} /> I have permission from every contributor.</label>
      <label className="check"><input type="checkbox" checked={form.acceptsResponsibility} onChange={(event) => setForm({ ...form, acceptsResponsibility: event.target.checked })} /> I am responsible for the rights in this upload.</label>
      <label className="check"><input type="checkbox" checked={form.usesSamples} onChange={(event) => setForm({ ...form, usesSamples: event.target.checked })} /> This uses a sample.</label>
      {form.usesSamples && (
        <div className="row">
          <label>Sample source<input value={source} onChange={(event) => setSource(event.target.value)} /></label>
          <label>Licence or permission<input value={proof} onChange={(event) => setProof(event.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={form.samplesCleared} onChange={(event) => setForm({ ...form, samplesCleared: event.target.checked })} /> That sample is cleared.</label>
        </div>
      )}
      <button className="btn" onClick={sign}>Sign declaration</button>
      {message && <p className="meta">{message}</p>}
    </div>
  );
}
