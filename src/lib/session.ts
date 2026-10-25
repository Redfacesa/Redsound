export type Session = {
  accessToken: string;
  refreshToken: string;
  email: string;
  expiresAt: number;
};

const SESSION_KEY = 'redsound-session';

type AuthBody = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { email?: string };
  error_description?: string;
  msg?: string;
  error?: string;
  confirmation_sent_at?: string;
};

function authBase(): { url: string; key: string } {
  const url = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) throw new Error('Sign-in is not configured on this studio.');
  return { url, key };
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

function sessionFrom(body: AuthBody, fallbackEmail: string): Session {
  if (!body.access_token || !body.refresh_token) {
    if (body.confirmation_sent_at) throw new Error('Confirm that email, then sign in.');
    throw new Error(body.error_description || body.msg || 'Sign-in failed.');
  }
  const session: Session = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    email: String(body.user?.email || fallbackEmail).trim().toLowerCase(),
    expiresAt: Date.now() + (body.expires_in || 3600) * 1000,
  };
  writeSession(session);
  return session;
}

async function authPost(path: string, body: Record<string, string>): Promise<AuthBody> {
  const { url, key } = authBase();
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as AuthBody;
  if (!response.ok && !payload.access_token) {
    throw new Error(payload.error_description || payload.msg || payload.error || 'Sign-in failed.');
  }
  return payload;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const account = email.trim().toLowerCase();
  const payload = await authPost('/auth/v1/token?grant_type=password', { email: account, password });
  return sessionFrom(payload, account);
}

export async function signUp(email: string, password: string): Promise<Session> {
  const account = email.trim().toLowerCase();
  if (password.length < 6) throw new Error('Use at least 6 characters.');
  const payload = await authPost('/auth/v1/signup', { email: account, password });
  return sessionFrom(payload, account);
}

export async function ensureSession(): Promise<Session | null> {
  const current = readSession();
  if (!current) return null;
  if (current.expiresAt > Date.now() + 60_000) return current;
  try {
    const payload = await authPost('/auth/v1/token?grant_type=refresh_token', { refresh_token: current.refreshToken });
    return sessionFrom(payload, current.email);
  } catch {
    signOut();
    return null;
  }
}
