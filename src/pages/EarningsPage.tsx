import { useEffect, useState } from 'react';
import { formatZar } from '@shared/rights.ts';
import { api } from '../lib/api';

type Earnings = Awaited<ReturnType<typeof api.earnings>>;

export function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.earnings().then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <div className="stack">
      <p className="kicker">Earnings</p>
      <h1>Payouts</h1>
      <p className="lede">
        Each licence is recorded here: price, creator share, and the studio fee. Payment runs through Red Face once the store is open.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="cards">
        <article className="card">
          <p className="meta">Creator share</p>
          <div className="price">{formatZar(data?.creatorCents || 0)}</div>
        </article>
        <article className="card">
          <p className="meta">Red Sound fee · {((data?.feeBps || 1000) / 100).toFixed(0)}%</p>
          <div className="price">{formatZar(data?.platformCents || 0)}</div>
        </article>
      </div>
      <section className="panel">
        <h2>Licence records</h2>
        {(data?.grants.length || 0) === 0 && <p className="meta">No licences issued. A sale writes a record like RS-000184 instead of emailing an MP3.</p>}
        <div className="lanes">
          {data?.grants.map((grant) => (
            <div className="lane" key={grant.id}>
              <strong>{grant.number}</strong>
              <span>{grant.buyerName} · {grant.licenseTier} · {formatZar(grant.priceCents)} · {grant.status}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Ledger</h2>
        {(data?.ledger.length || 0) === 0 && <p className="meta">The ledger stays empty until a real licence is issued.</p>}
        {data?.ledger.map((entry) => (
          <p key={entry.id} className="meta">{entry.party} · {entry.kind} · {formatZar(entry.amountCents)} · {entry.note}</p>
        ))}
      </section>
    </div>
  );
}
