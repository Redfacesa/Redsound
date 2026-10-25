import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signIn, signUp } from '../lib/session';

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [joining, setJoining] = useState(params.get('join') === '1');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (joining) await signUp(email, password);
      else await signIn(email, password);
      navigate('/studio');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.');
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <header className="gate-bar">
        <Link to="/" className="brand">
          <strong>RED SOUND</strong>
          <span>STUDIO</span>
        </Link>
      </header>
      <form className="gate-card" onSubmit={submit}>
        <p className="kicker">{joining ? 'Create account' : 'Sign in'}</p>
        <h1>{joining ? 'Open a studio account' : 'Enter the studio'}</h1>
        <p className="lede">Use your Redface Pay email and password. This is the login, not the API key.</p>
        {error && <p className="error">{error}</p>}
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={joining ? 'new-password' : 'current-password'}
            required
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Checking' : joining ? 'Create account' : 'Sign in'}</button>
        <button className="btn secondary" type="button" onClick={() => { setJoining((current) => !current); setError(''); }}>
          {joining ? 'I already have an account' : 'Create an account'}
        </button>
        <p className="meta">
          The Redface Pay API key is a server secret that starts with rf_live_. It only opens checkout for subscribers.
          An existing key cannot be read back, and generating music does not use it.
        </p>
      </form>
    </main>
  );
}
