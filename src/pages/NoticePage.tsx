import { Link, useLocation } from 'react-router-dom';
import { Mark } from '../components/Mark';

const pages = {
  '/about': {
    kicker: 'About',
    title: 'A room for the sound.',
    body: [
      'Red Sound is a studio for people who need a song, a beat, a sample, or the sound under a picture.',
      'You record, upload your own vocal and beat, arrange on a timeline, and ask the studio to work with the audio you already have. The original take stays.',
    ],
  },
  '/contact': {
    kicker: 'Contact',
    title: 'Write from the account you use.',
    body: [
      'Sign in with the same account that opens the studio. That is the account the session, the library, and the files belong to.',
    ],
  },
  '/terms': {
    kicker: 'Terms',
    title: 'Use the studio with your own account.',
    body: [
      'An account is yours. A session you open is yours. Do not upload audio you do not have the right to use.',
      'Generation runs when you ask for it. A stem split is a separate request. It is not started for you.',
    ],
  },
  '/privacy': {
    kicker: 'Privacy',
    title: 'The session stays with the account.',
    body: [
      'Sign-in uses your account email and password. The studio stores the session, the arrangement, and the audio you upload or generate under that account.',
      'The browser does not hold a payment key. Audio you publish is stored so the session can play it back.',
    ],
  },
  '/copyright': {
    kicker: 'Copyright',
    title: 'Your recording stays yours.',
    body: [
      'A vocal or beat you upload is marked as yours. A generated part is marked as generated. The original take is not replaced when a new lane is added.',
      'Rights for a session can be opened from the studio after you sign in.',
    ],
  },
} as const;

export function NoticePage() {
  const { pathname } = useLocation();
  const page = pages[pathname as keyof typeof pages] || pages['/about'];
  return (
    <main className="gate">
      <header className="gate-bar">
        <Link to="/" className="brand">
          <Mark />
          <span className="brand-name">
            <strong>RED SOUND</strong>
            <span>STUDIO</span>
          </span>
        </Link>
        <Link to="/login">Sign in</Link>
      </header>
      <section className="gate-hero">
        <p className="kicker">{page.kicker}</p>
        <h1>{page.title}</h1>
        {page.body.map((line) => <p className="lede" key={line}>{line}</p>)}
      </section>
    </main>
  );
}
