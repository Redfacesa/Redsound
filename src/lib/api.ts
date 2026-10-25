import type { Arrangement } from '@shared/arrange.ts';
import type { AppConfig, LicenseGrant, Listing, Profile, Project, TaskRecord, TrackView } from '@shared/types.ts';
import { ensureSession } from './session';

async function authHeaders(): Promise<Record<string, string>> {
  const current = await ensureSession();
  return current ? { Authorization: `Bearer ${current.accessToken}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init?.headers || {}) },
  });
  const text = await response.text();
  let body: { error?: string } = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(response.ok ? 'The studio API returned a page instead of data.' : `Request failed (${response.status})`);
    }
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  billing: () => request<{
    payConfigured: boolean;
    payOrigin: string;
    admin: boolean;
    accountEmail: string;
    pendingPaymentId?: string;
    plans: Array<{
      id: 'basic' | 'premium' | 'studio';
      name: string;
      amountZar: number;
      planCode: string;
      interval: 'monthly';
      generations: number;
      summary: string;
      includes: string[];
    }>;
    subscription: null | {
      planId: 'basic' | 'premium' | 'studio';
      planName: string;
      status: string;
      email: string;
      currentPeriodEnd?: string;
      generationsUsed: number;
      generations: number;
    };
  }>('/api/billing'),
  checkoutPlan: (planId: string, email: string) =>
    request<{ checkoutUrl: string; paymentId: string; planId: string }>('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ planId, email }) }),
  confirmPlan: (paymentId: string) =>
    request<{ active: boolean; status: string; planId?: string; currentPeriodEnd?: string }>('/api/billing/confirm', { method: 'POST', body: JSON.stringify({ paymentId }) }),
  profile: () => request<Profile>('/api/profile'),
  saveProfile: (profile: Partial<Pick<Profile, 'displayName' | 'handle' | 'email'>>) =>
    request<Profile>('/api/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  library: () => request<TrackView[]>('/api/library'),
  asset: (id: string) => request<TrackView>(`/api/assets/${id}`),
  arrangement: (id: string) => request<Arrangement>(`/api/assets/${id}/arrangement`),
  saveArrangement: (id: string, arrangement: Arrangement) =>
    request<Arrangement>(`/api/assets/${id}/arrangement`, { method: 'PUT', body: JSON.stringify(arrangement) }),
  credits: () => request<{ credits: number }>('/api/credits'),
  tasks: () => request<TaskRecord[]>('/api/tasks'),
  task: (id: string) => request<TaskRecord & { assets: Array<TrackView | null> }>(`/api/tasks/${id}`),
  generate: (body: Record<string, unknown>) => request<TaskRecord>('/api/generate', { method: 'POST', body: JSON.stringify(body) }),
  lyrics: (prompt: string) => request<TaskRecord>('/api/lyrics', { method: 'POST', body: JSON.stringify({ prompt }) }),
  upload: (body: Record<string, unknown>) => request<TrackView>('/api/assets/upload', { method: 'POST', body: JSON.stringify(body) }),
  stems: (id: string, body: Record<string, unknown>) =>
    request<TaskRecord>(`/api/assets/${id}/stems`, { method: 'POST', body: JSON.stringify(body) }),
  extend: (id: string, body: Record<string, unknown>) =>
    request<TaskRecord>(`/api/assets/${id}/extend`, { method: 'POST', body: JSON.stringify(body) }),
  cover: (id: string, body: Record<string, unknown>) => request<TaskRecord>(`/api/assets/${id}/cover`, { method: 'POST', body: JSON.stringify(body) }),
  uploadExtend: (id: string, body: Record<string, unknown>) => request<TaskRecord>(`/api/assets/${id}/upload-extend`, { method: 'POST', body: JSON.stringify(body) }),
  vocals: (id: string, body: Record<string, unknown>) => request<TaskRecord>(`/api/assets/${id}/vocals`, { method: 'POST', body: JSON.stringify(body) }),
  instrumental: (id: string, body: Record<string, unknown>) => request<TaskRecord>(`/api/assets/${id}/instrumental`, { method: 'POST', body: JSON.stringify(body) }),
  replaceSection: (id: string, body: Record<string, unknown>) => request<TaskRecord>(`/api/assets/${id}/replace`, { method: 'POST', body: JSON.stringify(body) }),
  mashup: (assetIds: string[]) => request<TaskRecord>('/api/mashup', { method: 'POST', body: JSON.stringify({ assetIds }) }),
  wav: (id: string) => request<TaskRecord>(`/api/assets/${id}/wav`, { method: 'POST', body: '{}' }),
  midi: (id: string) => request<TaskRecord>(`/api/assets/${id}/midi`, { method: 'POST', body: '{}' }),
  persona: (id: string, body: Record<string, unknown>) => request<{ personaId: string }>(`/api/assets/${id}/persona`, { method: 'POST', body: JSON.stringify(body) }),
  lyricsSync: (id: string) => request<{ asset: TrackView }>(`/api/assets/${id}/lyrics-sync`, { method: 'POST', body: '{}' }),
  artwork: (id: string) => request<TaskRecord>(`/api/assets/${id}/artwork`, { method: 'POST', body: '{}' }),
  recover: (id: string) => request<TaskRecord>(`/api/assets/${id}/recover`, { method: 'POST', body: '{}' }),
  sounds: (body: Record<string, unknown>) => request<TaskRecord>('/api/sounds', { method: 'POST', body: JSON.stringify(body) }),
  boostStyle: (content: string) => request<{ result: string }>('/api/style', { method: 'POST', body: JSON.stringify({ content }) }),
  voiceValidate: (body: Record<string, unknown>) => request<TaskRecord>('/api/voice/validate', { method: 'POST', body: JSON.stringify(body) }),
  voiceGenerate: (body: Record<string, unknown>) => request<TaskRecord>('/api/voice/generate', { method: 'POST', body: JSON.stringify(body) }),
  voiceRegenerate: (taskId: string) => request<TaskRecord>('/api/voice/regenerate', { method: 'POST', body: JSON.stringify({ taskId }) }),
  voiceCheck: (taskId: string) => request<{ isAvailable: boolean }>('/api/voice/check', { method: 'POST', body: JSON.stringify({ taskId }) }),
  saveOffers: (id: string, offers: Array<{ id: string; priceCents: number }>) =>
    request<Listing>(`/api/listings/${id}/offers`, { method: 'PATCH', body: JSON.stringify({ offers }) }),
  declare: (id: string, body: Record<string, unknown>) =>
    request(`/api/assets/${id}/declaration`, { method: 'POST', body: JSON.stringify(body) }),
  clearance: (id: string, source: string, proofNote: string) =>
    request(`/api/assets/${id}/clearances`, { method: 'POST', body: JSON.stringify({ source, proofNote }) }),
  splits: (subjectType: 'work' | 'recording', subjectId: string, splits: Array<{ name: string; role: string; shareBps: number }>) =>
    request(`/api/splits`, { method: 'PUT', body: JSON.stringify({ subjectType, subjectId, splits }) }),
  acknowledge: (id: string) => request(`/api/assets/${id}/provider-terms`, { method: 'POST', body: '{}' }),
  listForSale: (assetIds: string[]) => request<Listing>('/api/listings', { method: 'POST', body: JSON.stringify({ assetIds }) }),
  listings: () => request<Listing[]>('/api/listings'),
  listing: (id: string) => request<Listing & { assets: TrackView[] }>(`/api/listings/${id}`),
  purchase: (id: string, offerId: string, buyerName: string) =>
    request<LicenseGrant>(`/api/listings/${id}/purchase`, { method: 'POST', body: JSON.stringify({ offerId, buyerName }) }),
  projects: () => request<Array<Project & { assets: TrackView[] }>>('/api/projects'),
  openSession: (body: { title: string; bpm: number; musicalKey: string }) =>
    request<Project & { assets: TrackView[] }>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  rights: () => request<{
    profile: Profile;
    works: Array<{ id: string; title: string; lyrics?: string; splits: TrackView['splits']; assets: TrackView[] }>;
    recordings: Array<{ id: string; title: string; workId?: string; assetId: string; splits: TrackView['splits'] }>;
    feeBps: number;
  }>('/api/rights'),
  earnings: () => request<{
    grants: LicenseGrant[];
    ledger: Array<{ id: string; kind: string; amountCents: number; note: string; createdAt: string; party: string }>;
    creatorCents: number;
    platformCents: number;
    feeBps: number;
  }>('/api/earnings'),
};

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function pollTask(taskId: string, onTick?: (status: string) => void) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const task = await api.task(taskId);
    onTick?.(task.status);
    if (task.status === 'SUCCESS' || /FAIL|ERROR|SENSITIVE/.test(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  throw new Error('Still working. Check the library again in a minute.');
}
