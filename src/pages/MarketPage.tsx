import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatZar } from '@shared/rights.ts';
import type { AppConfig, Listing, TrackView } from '@shared/types.ts';
import { api } from '../lib/api';

export function MarketPage() {
  const { id } = useParams();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [selected, setSelected] = useState<(Listing & { assets?: TrackView[] }) | null>(null);
  const [error, setError] = useState('');
  const [buyer, setBuyer] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    api.config().then(setConfig).catch((reason: Error) => setError(reason.message));
    api.listings().then(setListings).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!id) {
      setSelected(null);
      return;
    }
    api.listing(id).then((listing) => {
      setSelected(listing);
      setPrices(Object.fromEntries(listing.offers.map((offer) => [offer.id, String(offer.priceCents / 100)])));
    }).catch((reason: Error) => setError(reason.message));
  }, [id]);

  async function savePrices() {
    if (!selected) return;
    setError('');
    try {
      const listing = await api.saveOffers(selected.id, selected.offers.map((offer) => ({
        id: offer.id,
        priceCents: Math.round(Number(prices[offer.id] || 0) * 100),
      })));
      setSelected({ ...selected, ...listing });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save prices');
    }
  }

  async function buy(offerId: string) {
    if (!selected) return;
    setError('');
    try {
      await api.purchase(selected.id, offerId, buyer);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Checkout is closed');
    }
  }

  return (
    <div className="stack">
      <p className="kicker">Store</p>
      <h1>Marketplace</h1>
      <p className="lede">
        Beats, songs, and stem packs are offered as licences. Red Sound keeps the licence. Payment opens through Red Face after the creator terms are reviewed.
      </p>
      <p className="notice">{config?.marketplaceNote}</p>
      {error && <p className="error">{error}</p>}

      {selected ? (
        <section className="panel stack">
          <header>
            <div>
              <h2>{selected.title}</h2>
              <p className="meta">{selected.status.replaceAll('_', ' ')} · {selected.bpm ? `${selected.bpm} BPM` : 'Tempo unset'}{selected.musicalKey ? ` · ${selected.musicalKey}` : ''}</p>
            </div>
            <Link to="/market">All listings</Link>
          </header>
          {selected.holdReasons.length > 0 && (
            <ul>{selected.holdReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          )}
          <div className="cards">
            {selected.offers.map((offer) => (
              <article className="card" key={offer.id}>
                <h3>{offer.name}</h3>
                <div className="price">{formatZar(Math.round(Number(prices[offer.id] || 0) * 100))}</div>
                <label>
                  Price in rand
                  <input type="number" min="0" value={prices[offer.id] || ''} onChange={(event) => setPrices((current) => ({ ...current, [offer.id]: event.target.value }))} />
                </label>
                <p className="meta">{offer.summary}</p>
                <p className="meta">{offer.deliverables.join(' · ')}{offer.exclusive ? ' · exclusive' : ''}</p>
                <button className="btn secondary" disabled={!config?.marketplaceLive} onClick={() => buy(offer.id)}>
                  {config?.marketplaceLive ? `Buy ${offer.name}` : 'Checkout closed'}
                </button>
              </article>
            ))}
          </div>
          <label>
            Buyer name, for the licence record
            <input value={buyer} onChange={(event) => setBuyer(event.target.value)} placeholder="Customer" />
          </label>
          <button className="btn secondary" onClick={savePrices}>Save prices</button>
        </section>
      ) : (
        <div className="cards">
          {listings.length === 0 && (
            <div className="panel">
              <h3>No listings yet</h3>
              <p className="meta">Open a track and choose Sell this. The listing is held until the rights record is complete and the creator terms are reviewed.</p>
            </div>
          )}
          {listings.map((listing) => (
            <Link className="card" key={listing.id} to={`/market/${listing.id}`}>
              <span className="badge hold">{listing.status.replaceAll('_', ' ')}</span>
              <h3 style={{ marginTop: 12 }}>{listing.title}</h3>
              <p className="meta">{listing.offers.length} licences · from {formatZar(Math.min(...listing.offers.map((offer) => offer.priceCents)))}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
