import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { originLabel } from '@shared/rights.ts';
import type { TrackView } from '@shared/types.ts';
import { api } from '../lib/api';

const FILTERS: Record<string, string[]> = {
  beat: ['beat'],
  sample: ['sample', 'stem'],
  vocal: ['vocal'],
  song: ['song', 'full_mix', 'lyrics'],
};

export function LibraryPage() {
  const [params] = useSearchParams();
  const [assets, setAssets] = useState<TrackView[]>([]);
  const [error, setError] = useState('');
  const kind = params.get('kind') || '';
  const query = (params.get('q') || '').trim().toLowerCase();

  useEffect(() => {
    api.library().then(setAssets).catch((reason: Error) => setError(reason.message));
  }, []);

  const visible = assets.filter((asset) => {
    const allowed = FILTERS[kind];
    if (allowed && !allowed.includes(asset.kind)) return false;
    if (!query) return true;
    return `${asset.title} ${asset.kind} ${asset.stemName || ''} ${asset.musicalKey || ''}`.toLowerCase().includes(query);
  });

  const title = kind === 'beat' ? 'Beats' : kind === 'sample' ? 'Samples' : kind === 'vocal' ? 'Voices' : kind === 'song' ? 'Songs' : 'Library';

  return (
    <div className="stack">
      <div>
        <p className="kicker">Library</p>
        <h1>{title}</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {visible.length === 0 ? (
        <section className="panel">
          <h3>Nothing in this rack</h3>
          <p className="meta">Create a session or import audio.</p>
        </section>
      ) : (
        <div className="cards">
          {visible.map((asset) => (
            <Link className="card" key={asset.id} to={`/library/${asset.id}`}>
              <span className={`badge ${asset.provenance?.origin === 'human_created' ? 'human' : ''}`}>
                {asset.provenance ? originLabel(asset.provenance.origin) : 'Session'}
              </span>
              <h3 style={{ marginTop: 10 }}>{asset.title}</h3>
              <p className="meta">{asset.kind}{asset.bpm ? ` · ${asset.bpm} BPM` : ''}{asset.musicalKey ? ` · ${asset.musicalKey}` : ''}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
