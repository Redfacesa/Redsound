import { Link } from 'react-router-dom';
import { Mark } from '../components/Mark';
import { readSession } from '../lib/session';

const rooms = [
  { name: 'Songs', copy: 'Lyric, melody, vocal.', room: 'song', tone: '#e23b2f', ink: '#fff', bpm: '96', wave: [4, 8, 14, 10, 18, 12, 20, 9, 16, 7, 13, 5] },
  { name: 'Beats', copy: 'Drums, bass, pocket.', room: 'beat', tone: '#c4a15a', ink: '#1a140c', bpm: '128', wave: [6, 16, 4, 18, 5, 14, 4, 17, 6, 15, 4, 12] },
  { name: 'Samples', copy: 'Loops you can drop in.', room: 'instrument', tone: '#3f8f86', ink: '#041614', bpm: '120', wave: [8, 8, 14, 14, 6, 6, 16, 16, 7, 7, 12, 12] },
  { name: 'Score', copy: 'The bed under a scene.', room: 'beat', tone: '#4d6ea8', ink: '#f4f7fb', bpm: '72', wave: [6, 9, 12, 16, 18, 16, 12, 9, 7, 10, 14, 11] },
  { name: 'Effects', copy: 'A hit, a room, a texture.', room: 'instrument', tone: '#c46b4a', ink: '#1c0d08', bpm: '—', wave: [3, 18, 4, 8, 20, 3, 6, 14, 4, 9, 3, 7] },
  { name: 'Picture', copy: 'Sound for the cut.', room: 'beat', tone: '#8a6aad', ink: '#f7f3fb', bpm: '100', wave: [10, 12, 8, 15, 11, 18, 9, 14, 8, 16, 10, 7] },
  { name: 'Briefs', copy: 'A jingle from a line.', room: 'song', tone: '#8d3a32', ink: '#fff6f4', bpm: '110', wave: [7, 11, 15, 9, 13, 17, 8, 12, 16, 6, 10, 14] },
  { name: 'Strange', copy: 'Keep it if it works.', room: 'instrument', tone: '#d7c48a', ink: '#1c180e', bpm: '90', wave: [5, 14, 7, 18, 4, 11, 16, 6, 13, 8, 17, 5] },
];

const sides = [
  ['Vocal', '72%', '#c4a15a'],
  ['Beat', '88%', '#8d3a32'],
  ['Score', '54%', '#3f8f86'],
  ['Sample', '36%', '#4d6ea8'],
] as const;

const floor = [
  ['01', 'Artists', 'A lyric and a melody, kept as a song.'],
  ['02', 'Producers', 'A beat, a sample, and your own files on the timeline.'],
  ['03', 'Film', 'Describe the scene. The score stays in the session.'],
  ['04', 'Picture', 'Background for a video, a reel, or a cut.'],
  ['05', 'Business', 'A short piece from a brief.'],
];

export function LandingPage() {
  const signedIn = Boolean(readSession());
  function open(room: string) {
    const next = `/create?room=${room}`;
    return signedIn ? next : `/login?join=1&next=${encodeURIComponent(next)}`;
  }
  return (
    <main className="home">
      <header className="home-bar">
        <Link to="/" className="brand">
          <Mark size={32} />
          <span className="brand-name">
            <strong>RED SOUND</strong>
            <span>STUDIO</span>
          </span>
        </Link>
        <nav className="home-nav">
          <a href="#floor">The floor</a>
          <a href="#rooms">Rooms</a>
          <Link to={signedIn ? '/studio' : '/login'}>{signedIn ? 'Open studio' : 'Sign in'}</Link>
          <Link className="btn" to={open('song')}>Start creating</Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-copy">
          <p className="kicker">Find your sound. Create your sound.</p>
          <h1>Every sound has a place.</h1>
          <p className="lede">Songs, beats, samples, and the score under a picture. Open a room. The session is the same studio.</p>
          <div className="row">
            <Link className="btn" to={open('song')}>Start creating</Link>
            <a className="btn secondary" href="#rooms">See the rooms</a>
          </div>
        </div>
        <div className="home-studio">
          <div className="home-studio-top">
            <strong>Night drive</strong>
            <span>C min</span>
          </div>
          <div className="home-studio-readout">
            <i />
            <em>00:00.000</em>
            <em>001.1.1</em>
            <span>128 BPM</span>
            <span>4/4</span>
          </div>
          <div className="home-studio-ruler" aria-hidden="true">
            {[1, 3, 5, 7, 9, 11, 13, 15, 17].map((bar) => <span key={bar}>{bar}</span>)}
          </div>
          <div className="home-studio-sheet">
            {sides.map(([name, width, color]) => (
              <div className="home-studio-row" key={name}>
                <b style={{ borderLeftColor: color }}>{name}</b>
                <span>
                  <i style={{ width, background: color }} />
                </span>
              </div>
            ))}
            <div className="home-playhead" />
          </div>
          <Link className="home-studio-ask" to={open('beat')}>
            <span>Beat</span>
            <em>Build a gritty pocket and put it on this track</em>
            <strong>V6</strong>
          </Link>
        </div>
      </section>

      <div className="home-ticker" aria-hidden="true">
        {['Songs', 'Beats', 'Samples', 'Score', 'Vocal', 'Picture', 'Briefs'].map((word) => (
          <span key={word}>{word}</span>
        ))}
      </div>

      <section className="home-frames" aria-label="The studio">
        <figure>
          <img src="/brand/studio.jpg" alt="A producer at a desk with headphones, a keyboard, drum pads, and a timeline on the monitor." />
          <figcaption><span>01</span><strong>The desk</strong></figcaption>
        </figure>
        <figure>
          <img src="/brand/session.jpg" alt="A producer at the keys beside a creator recording on a phone." />
          <figcaption><span>02</span><strong>The session</strong></figcaption>
        </figure>
        <figure>
          <img src="/brand/picture.jpg" alt="A laptop session beside a creator holding a phone on a gimbal." />
          <figcaption><span>03</span><strong>The picture</strong></figcaption>
        </figure>
      </section>

      <section id="rooms" className="home-block">
        <div className="home-intro">
          <p className="kicker">Rooms</p>
          <h2>Pick the sound. Walk in.</h2>
        </div>
        <div className="home-sleeves">
          {rooms.map((item, index) => (
            <Link key={item.name} to={open(item.room)} className="home-sleeve">
              <span className="home-sleeve-face" style={{ background: item.tone, color: item.ink }}>
                <small>{String(index + 1).padStart(2, '0')}</small>
                <svg viewBox="0 0 120 36" aria-hidden="true">
                  {item.wave.map((height, bar) => (
                    <rect key={bar} x={bar * 10} y={18 - height / 2} width="6" height={height} rx="1" fill="currentColor" />
                  ))}
                </svg>
                <em>{item.bpm === '—' ? 'Free' : `${item.bpm} BPM`}</em>
              </span>
              <strong>{item.name}</strong>
              <p>{item.copy}</p>
            </Link>
          ))}
        </div>
      </section>

      <section id="floor" className="home-floor">
        {floor.map(([index, name, copy]) => (
          <article key={name}>
            <span>{index}</span>
            <h2>{name}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="home-close">
        <p className="kicker">The session</p>
        <h2>Your next sound starts here.</h2>
        <Link className="btn" to={open('song')}>Start creating</Link>
      </section>

      <footer className="home-foot">
        <div>
          <strong>RED SOUND</strong>
          <p>Find your sound. Create your sound.</p>
        </div>
        <nav>
          <Link to="/about">About</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/copyright">Copyright</Link>
          <Link to={signedIn ? '/studio' : '/login'}>{signedIn ? 'Open studio' : 'Sign in'}</Link>
          <Link to={signedIn ? '/studio' : '/login?join=1'}>Create account</Link>
        </nav>
      </footer>
    </main>
  );
}
