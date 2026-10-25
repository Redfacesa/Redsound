import { Link } from 'react-router-dom';
import { readSession } from '../lib/session';

const rooms = [
  { name: 'Create', copy: 'Make a beat, a song, or a voice from the desk.' },
  { name: 'Arrange', copy: 'Extend, cover, mashup, replace a section, and pull stems.' },
  { name: 'Deliver', copy: 'Leave with WAV, MIDI, artwork, and the rights on the file.' },
];

export function LandingPage() {
  const signedIn = Boolean(readSession());
  return (
    <main className="gate">
      <header className="gate-bar">
        <div className="brand">
          <strong>RED SOUND</strong>
          <span>STUDIO</span>
        </div>
        <Link to={signedIn ? '/studio' : '/login'}>{signedIn ? 'Enter studio' : 'Sign in'}</Link>
      </header>
      <section className="gate-hero">
        <p className="kicker">Red Sound</p>
        <h1>A studio for the whole record.</h1>
        <p className="lede">
          Write a beat, put a voice on it, split the stems, and keep the session in the room.
          Red Sound is the production desk. Redface Pay is how a subscription opens it.
        </p>
        <div className="row">
          <Link className="btn" to={signedIn ? '/studio' : '/login'}>{signedIn ? 'Enter studio' : 'Sign in'}</Link>
          <Link className="btn secondary" to="/login?join=1">Create account</Link>
        </div>
      </section>
      <section className="cards">
        {rooms.map((room) => (
          <article className="card" key={room.name}>
            <p className="kicker">{room.name}</p>
            <p>{room.copy}</p>
          </article>
        ))}
      </section>
      <section className="panel">
        <p className="kicker">Access</p>
        <p>
          Basic is R299, Premium is R399, and Studio is R799 a month. Checkout runs on Redface Pay.
          Sign in with the same email and password you use there. The studio admin is not billed. Every other account subscribes.
        </p>
        <p className="meta">
          Your login is not the Redface Pay API key. That key starts with rf_live_, stays on the server, and only opens checkout.
          Generating music uses the studio engine, which turns on after you are signed in.
        </p>
      </section>
    </main>
  );
}
