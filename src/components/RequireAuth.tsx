import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { ensureSession } from '../lib/session';

export function RequireAuth() {
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');

  useEffect(() => {
    let live = true;
    ensureSession().then((session) => {
      if (live) setState(session ? 'in' : 'out');
    });
    return () => { live = false; };
  }, []);

  if (state === 'checking') return <p className="gate-wait">Opening the studio…</p>;
  if (state === 'out') return <Navigate to="/login" replace />;
  return <Outlet />;
}
