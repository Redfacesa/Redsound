import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mark } from '../components/Mark';
import { readSession } from '../lib/session';
import { SOUND_PLANS } from '@shared/plans.ts';

const uses = [
  { name: 'Video', copy: 'A soundtrack under a cut, finished in the same session as the picture.' },
  { name: 'Business', copy: 'A bigger sound for a brand film, a launch, or a room full of people.' },
  { name: 'Samples', copy: 'Loops and one-shots you can drop into a song you are already writing.' },
  { name: 'Beats', copy: 'A melody and a drum pattern, started from the phone and kept on the timeline.' },
  { name: 'Film', copy: 'Cues for a scene: the arrival, the tension, the ending.' },
  { name: 'Record', copy: 'Sing or speak in. The original take stays. A cleaned take sits on the next lane.' },
];

export function LandingPage() {
  const signedIn = Boolean(readSession());
  const enter = signedIn ? '/studio' : '/login';
  return (
    <main className="gate lp">
      <header className="gate-bar">
        <Link to="/" className="brand">
          <Mark size={36} />
          <span className="brand-name">
            <strong>RED SOUND</strong>
            <span>STUDIO</span>
          </span>
        </Link>
        <nav className="lp-nav">
          <a className="lp-jump" href="#uses">What it is for</a>
          <a className="lp-jump" href="#screens">The app</a>
          <a className="lp-jump" href="#plans">Plans</a>
          <Link to={enter}>{signedIn ? 'Open studio' : 'Sign in'}</Link>
        </nav>
      </header>

      <section className="lp-hero">
        <div>
          <p className="kicker">Video, business, songs, and film</p>
          <h1>The sound for the picture, the song, and the score.</h1>
          <p className="lede">
            Red Sound is the app for a quick soundtrack, a sample, a melody, a beat, or a vocal you record yourself.
            Create an account. Then record it, build it by hand, or let the studio write with the audio you already have.
          </p>
          <div className="row">
            <Link className="btn" to={signedIn ? '/studio' : '/login?join=1'}>{signedIn ? 'Open studio' : 'Create account'}</Link>
            {!signedIn && <Link className="btn secondary" to="/login">Sign in</Link>}
          </div>
          <p className="meta lp-note">The account opens the studio on this phone today. The App Store and Play Store builds are the same app, prepared after this page.</p>
        </div>
        <Phone caption="Arrange">
          <ScreenArrange />
        </Phone>
      </section>

      <section id="uses" className="lp-uses">
        <p className="kicker">Who it is for</p>
        <h2>One studio, six jobs.</h2>
        <div className="lp-use-grid">
          {uses.map((use) => (
            <article key={use.name}>
              <h3>{use.name}</h3>
              <p>{use.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="screens" className="lp-screens">
        <div className="lp-screens-copy">
          <p className="kicker">On the phone</p>
          <h2>The screens you open after you sign up.</h2>
          <p className="lede">Record a take, drop in your own beat, pull a sample, or score a scene. The original file stays on its lane.</p>
        </div>
        <div className="lp-row">
          <Phone caption="Record">
            <ScreenRecord />
          </Phone>
          <Phone caption="Samples">
            <ScreenSamples />
          </Phone>
          <Phone caption="Score">
            <ScreenScore />
          </Phone>
        </div>
      </section>

      <section id="plans" className="lp-plans">
        <p className="kicker">Account</p>
        <h2>Sign up, then choose how much you make.</h2>
        <div className="lp-plan-grid">
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

function Phone({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="lp-phone">
      <div className="lp-device" aria-hidden="true">
        <div className="lp-screen">
          <div className="lp-status">
            <Mark size={16} />
            <strong>RED SOUND</strong>
            <span>9:41</span>
          </div>
          {children}
        </div>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function ScreenArrange() {
  return (
    <div className="lp-app">
      <p className="lp-title">Midnight</p>
      <p className="lp-meta">128 BPM · C minor</p>
      <div className="lp-transport"><span className="lp-play" /> 0:14</div>
      <div className="lp-lanes">
        <div className="lp-lane">
          <b>Vocal</b>
          <i className="lp-clip gold" style={{ width: '72%' }} />
        </div>
        <div className="lp-lane">
          <b>Beat</b>
          <i className="lp-clip" style={{ width: '88%' }} />
        </div>
        <div className="lp-lane">
          <b>Score</b>
          <i className="lp-clip teal" style={{ width: '46%' }} />
        </div>
        <div className="lp-head" />
      </div>
    </div>
  );
}

function ScreenRecord() {
  return (
    <div className="lp-app">
      <p className="lp-title">Take 3</p>
      <p className="lp-meta">Original stays muted</p>
      <div className="lp-wave" aria-hidden="true">
        {[8, 14, 22, 30, 18, 36, 28, 16, 32, 20, 12, 26].map((height, index) => (
          <span key={index} style={{ height }} />
        ))}
      </div>
      <div className="lp-rec">Record</div>
    </div>
  );
}

function ScreenSamples() {
  return (
    <div className="lp-app">
      <p className="lp-title">Samples</p>
      <p className="lp-meta">128 BPM · C minor</p>
      <ul className="lp-list">
        <li><b>Room tone</b><span>Loop</span></li>
        <li><b>Hat pattern</b><span>Beat</span></li>
        <li><b>Soft keys</b><span>Melody</span></li>
      </ul>
    </div>
  );
}

function ScreenScore() {
  return (
    <div className="lp-app">
      <p className="lp-title">Scene 4</p>
      <p className="lp-meta">Arrival · 96 BPM</p>
      <ul className="lp-list">
        <li><b>Cue A</b><span>0:18</span></li>
        <li><b>Tension</b><span>0:42</span></li>
        <li><b>Out</b><span>1:05</span></li>
      </ul>
    </div>
  );
}
