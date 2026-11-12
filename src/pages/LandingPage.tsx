import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mark } from '../components/Mark';
import { readSession } from '../lib/session';
import { SOUND_PLANS } from '@shared/plans.ts';

const trades = [
  { name: 'Film', copy: 'Score the scene. The arrival, the tension, the ending.' },
  { name: 'Video', copy: 'Background sound under a cut, finished in the same session.' },
  { name: 'Beats', copy: 'A melody and drums, started on the phone and kept on the timeline.' },
  { name: 'Samples', copy: 'Loops and one-shots for a song you are already writing.' },
];

const shots = [
  { id: 'scene', name: 'Film' },
  { id: 'record', name: 'Record' },
  { id: 'beats', name: 'Beats' },
  { id: 'samples', name: 'Samples' },
];

export function LandingPage() {
  const signedIn = Boolean(readSession());
  const enter = signedIn ? '/studio' : '/login';
  const [store, setStore] = useState<'apple' | 'play'>('apple');
  return (
    <main className="home">
      <header className="home-bar">
        <Link to="/" className="brand">
          <Mark size={36} />
          <span className="brand-name">
            <strong>RED SOUND</strong>
            <span>STUDIO</span>
          </span>
        </Link>
        <nav className="home-nav">
          <a href="#trades">Who it is for</a>
          <a href="#shots">The app</a>
          <Link to={enter}>{signedIn ? 'Open studio' : 'Sign in'}</Link>
          <Link className="btn" to={signedIn ? '/studio' : '/login?join=1'}>{signedIn ? 'Open studio' : 'Create account'}</Link>
        </nav>
      </header>

      <section className="home-hero">
        <p className="kicker">Film, video, beats, samples</p>
        <h1>Any sound the picture needs.</h1>
        <p className="lede">
          Red Sound is the studio a producer opens for a score, the sound under a video, a beat, or a sample.
          Record it yourself, drop in your own files, or let the studio write with the audio you already have.
        </p>
        <div className="home-meter" aria-hidden="true">
          {[28, 46, 70, 100, 62, 84, 40, 76, 54, 92, 34, 68, 48, 88, 30].map((height, index) => (
            <span key={index} style={{ ['--h' as string]: `${height}%`, animationDelay: `${index * 0.08}s` }} />
          ))}
        </div>
        <div className="row">
          <Link className="btn" to={signedIn ? '/studio' : '/login?join=1'}>{signedIn ? 'Open studio' : 'Create account'}</Link>
          {!signedIn && <Link className="btn secondary" to="/login">Sign in</Link>}
        </div>
      </section>

      <section id="trades" className="home-wall">
        {trades.map((trade) => (
          <article key={trade.name}>
            <h2>{trade.name}</h2>
            <p>{trade.copy}</p>
          </article>
        ))}
      </section>

      <section id="shots" className="home-shots-wrap">
        <div className="home-shots-head">
          <div>
            <p className="kicker">App Store and Play Store</p>
            <h2>The screens we submit with the app.</h2>
            <p className="lede">One studio. An iPhone build for the App Store, and an Android build for the Play Store. These are the screenshots of that studio.</p>
          </div>
          <div className="home-switch" role="group" aria-label="Store screenshots">
            <button type="button" className={store === 'apple' ? 'on' : ''} onClick={() => setStore('apple')}>App Store</button>
            <button type="button" className={store === 'play' ? 'on' : ''} onClick={() => setStore('play')}>Play Store</button>
          </div>
        </div>
        <div className={store === 'play' ? 'home-shots play' : 'home-shots'}>
          {shots.map((shot) => (
            <figure key={shot.id}>
              <img src={`/store/${store}/${shot.id}.png`} alt={`${shot.name} screen of the Red Sound studio`} />
              <figcaption>{shot.name}</figcaption>
            </figure>
          ))}
        </div>
        <p className="meta">App Store frames are 1290 × 2796. Play Store frames are 1080 × 1920.</p>
      </section>

      <section className="home-plans" id="plans">
        <p className="kicker">Account</p>
        <h2>Sign up, then open the studio.</h2>
        <div className="home-plan-grid">
          {SOUND_PLANS.map((plan) => (
            <article key={plan.id}>
              <p className="kicker">{plan.name}</p>
              <p className="price">R{plan.amountZar}</p>
              <p>{plan.summary}</p>
              <p className="meta">{plan.generations} generations a month</p>
            </article>
          ))}
        </div>
        <Link className="btn" to={signedIn ? '/plans' : '/login?join=1'}>{signedIn ? 'See plans' : 'Create account'}</Link>
      </section>
    </main>
  );
}
