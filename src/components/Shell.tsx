import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { readSession, signOut } from '../lib/session';

export function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const libraryKind = new URLSearchParams(location.search).get('kind');
  const [query, setQuery] = useState('');
  const [name, setName] = useState(readSession()?.email || 'Profile');

  useEffect(() => {
    const email = readSession()?.email;
    api.profile().then((profile) => setName(email || profile.displayName || 'Profile')).catch(() => setName(email || 'Profile'));
  }, []);

  return (
    <div className="app">
      <aside className="nav">
        <div className="brand">
          <strong>RED SOUND</strong>
          <span>STUDIO</span>
        </div>
        <div className="nav-group">
          <div className="nav-label">STUDIO</div>
          <button className="nav-new" type="button" onClick={() => navigate('/create')}>+ New</button>
          <NavLink to="/studio">Sessions</NavLink>
        </div>
        <div className="nav-group">
          <div className="nav-label">LIBRARY</div>
          <Link to="/library?kind=beat" className={libraryKind === 'beat' ? 'active' : ''} aria-current={libraryKind === 'beat' ? 'page' : undefined}>Beats</Link>
          <Link to="/library?kind=sample" className={libraryKind === 'sample' ? 'active' : ''} aria-current={libraryKind === 'sample' ? 'page' : undefined}>Samples</Link>
          <Link to="/library?kind=vocal" className={libraryKind === 'vocal' ? 'active' : ''} aria-current={libraryKind === 'vocal' ? 'page' : undefined}>Voices</Link>
          <Link to="/library?kind=song" className={libraryKind === 'song' ? 'active' : ''} aria-current={libraryKind === 'song' ? 'page' : undefined}>Songs</Link>
        </div>
        <div className="nav-group">
          <div className="nav-label">STORE</div>
          <NavLink to="/market">Marketplace</NavLink>
          <NavLink to="/rights">Rights</NavLink>
          <NavLink to="/earnings">Earnings</NavLink>
          <NavLink to="/plans">Plans</NavLink>
        </div>
        <div className="nav-group nav-foot">
          <button className="nav-new" type="button" onClick={() => { signOut(); navigate('/'); }}>Sign out</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <form onSubmit={(event) => {
            event.preventDefault();
            navigate(query.trim() ? `/library?q=${encodeURIComponent(query.trim())}` : '/library');
          }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions, beats, voices" aria-label="Search" />
          </form>
          <span className="profile">{name}</span>
        </header>
        <div className="stage">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
