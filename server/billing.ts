import type express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { planAllows, planMeters, requiredPlanName, soundPlan, SOUND_PLANS, type Gate, type SoundPlanId } from '../shared/plans.ts';
import type { SubscriptionState } from '../shared/types.ts';
import { update, view } from './store.ts';

export class BillingError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const COMMERCE_BASE = String(
  process.env.REDFACE_COMMERCE_API_BASE || 'https://bpzzgilwlkghgfkvkkxx.supabase.co/functions/v1/commerce-api',
).replace(/\/$/, '');

const accounts = new AsyncLocalStorage<string>();

const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || 'info@redfacepay.co.za')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

const verifiedSessions = new Map<string, { email: string; until: number }>();

function bearer(req: express.Request): string {
  const header = String(req.get('authorization') || '');
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function emailFromToken(token: string): Promise<string> {
  if (!token) return '';
  const hit = verifiedSessions.get(token);
  if (hit && hit.until > Date.now()) return hit.email;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!base || !key) return '';
  const response = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return '';
  const body = await response.json().catch(() => ({})) as { email?: string };
  const email = String(body.email || '').trim().toLowerCase();
  if (email) verifiedSessions.set(token, { email, until: Date.now() + 5 * 60 * 1000 });
  return email;
}

export function bindAccount(req: express.Request, next: () => void) {
  emailFromToken(bearer(req)).then(
    (email) => accounts.run(email, next),
    () => accounts.run('', next),
  );
}

function actorEmail(): string {
  return accounts.getStore() || '';
}

export function isAdmin(): boolean {
  return ADMIN_EMAILS.has(actorEmail());
}

export function payConfigured(): boolean {
  return Boolean(String(process.env.REDFACE_API_KEY || '').trim());
}

export function publicOrigin(req: express.Request): string {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

export function currentSubscription(): SubscriptionState | null {
  const subscription = view().profile.subscription;
  if (!subscription || subscription.status !== 'active') return null;
  if (subscription.currentPeriodEnd && Date.parse(subscription.currentPeriodEnd) < Date.now()) return null;
  return subscription;
}

export function billingSnapshot() {
  const subscription = currentSubscription();
  const stored = view().profile.subscription;
  const plan = soundPlan(subscription?.planId);
  const admin = isAdmin();
  return {
    payConfigured: payConfigured(),
    payOrigin: 'https://www.redfacepay.co.za',
    admin,
    accountEmail: actorEmail(),
    plans: SOUND_PLANS.map((item) => ({
      id: item.id,
      name: item.name,
      amountZar: item.amountZar,
      planCode: item.planCode,
      interval: item.interval,
      generations: item.generations,
      summary: item.summary,
      includes: [...item.includes],
    })),
    pendingPaymentId: stored?.status === 'pending' ? stored.paymentId : undefined,
    subscription: admin
      ? {
          planId: 'studio' as const,
          planName: 'Admin',
          status: 'active',
          email: actorEmail(),
          generationsUsed: generationsUsed(),
          generations: 0,
        }
      : subscription
      ? {
          planId: subscription.planId,
          planName: plan?.name || subscription.planId,
          status: subscription.status,
          email: subscription.email,
          currentPeriodEnd: subscription.currentPeriodEnd,
          generationsUsed: generationsUsed(),
          generations: plan?.generations || 0,
        }
      : null,
  };
}

export function requireAccess(gate: Gate) {
  if (!actorEmail()) throw new BillingError(401, 'Sign in to use the studio.');
  if (isAdmin()) return;
  const subscription = currentSubscription();
  const plan = soundPlan(subscription?.planId);
  if (!plan || !planAllows(plan.id, gate)) {
    throw new BillingError(402, `${requiredPlanName(gate)} is required for this. Subscribe through Redface Pay.`);
  }
  if (planMeters(gate) && generationsUsed() >= plan.generations) {
    throw new BillingError(402, `${plan.name} has used its ${plan.generations} generations for this month.`);
  }
}

export async function startCheckout(planId: string, email: string, origin: string) {
  const plan = soundPlan(planId);
  if (!plan) throw new BillingError(400, 'Choose Basic, Premium, or Studio.');
  const customer = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer)) throw new BillingError(400, 'Enter a valid email for the receipt.');
  const key = String(process.env.REDFACE_API_KEY || '').trim();
  if (!key) throw new BillingError(503, 'Redface Pay is not configured. Set REDFACE_API_KEY on the server.');

  const month = new Date().toISOString().slice(0, 7);
  const response = await fetch(`${COMMERCE_BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `redsound:${plan.id}:${customer}:${month}`,
    },
    body: JSON.stringify({
      ...(process.env.REDFACE_BUSINESS_ID ? { business_id: process.env.REDFACE_BUSINESS_ID } : {}),
      amount: plan.amountZar,
      currency: 'ZAR',
      label: `Red Sound ${plan.name}`,
      metadata: {
        origin: 'redsound',
        plan_id: plan.id,
        plan_code: plan.planCode,
        plan_name: plan.name,
        interval: plan.interval,
        amount_zar: plan.amountZar,
        customer_email: customer,
      },
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    data?: { payment_id?: string; checkout_url?: string };
  };
  const paymentId = body.data?.payment_id;
  const checkoutUrl = body.data?.checkout_url;
  if (!response.ok || !body.ok || !paymentId || !checkoutUrl) {
    throw new BillingError(502, body.error || 'Redface Pay did not start checkout.');
  }

  const pending: SubscriptionState = {
    planId: plan.id,
    planCode: plan.planCode,
    status: 'pending',
    email: customer,
    paymentId,
  };
  await update((db) => {
    db.profile.subscription = pending;
    return pending;
  });
  return { checkoutUrl: withReturn(checkoutUrl, origin, paymentId), paymentId, planId: plan.id as SoundPlanId };
}

export async function confirmCheckout(paymentId: string) {
  const key = String(process.env.REDFACE_API_KEY || '').trim();
  if (!key) throw new BillingError(503, 'Redface Pay is not configured. Set REDFACE_API_KEY on the server.');
  const id = paymentId.trim();
  if (!id) throw new BillingError(400, 'Missing payment.');

  const response = await fetch(`${COMMERCE_BASE}/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    data?: {
      status?: string;
      session?: { status?: string; label?: string; paid_at?: string | null };
      transaction?: { status?: string };
    };
  };
  if (!response.ok || !body.ok) throw new BillingError(502, body.error || 'Redface Pay could not confirm this payment.');
  const session = body.data?.session;
  const status = String(session?.status || body.data?.transaction?.status || body.data?.status || '').toLowerCase();
  const paid = Boolean(session?.paid_at) || ['paid', 'success', 'completed', 'settled'].includes(status);
  if (!paid) return { active: false, status: status || 'pending' };

  const saved = view().profile.subscription;
  if (saved?.paymentId && saved.paymentId !== id) {
    throw new BillingError(400, 'This payment does not match the plan waiting for checkout.');
  }
  const plan = soundPlan(saved?.planId) || SOUND_PLANS.find((item) => session?.label?.includes(item.name));
  if (!plan) throw new BillingError(400, 'This payment is not a Red Sound plan.');
  const periodEnd = new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString();
  const subscription: SubscriptionState = {
    planId: plan.id,
    planCode: plan.planCode,
    status: 'active',
    email: saved?.email || '',
    paymentId: id,
    currentPeriodEnd: periodEnd,
  };
  await update((db) => {
    db.profile.subscription = subscription;
    return subscription;
  });
  return { active: true, status: 'active', planId: plan.id, currentPeriodEnd: periodEnd };
}

function generationsUsed(): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const from = start.getTime();
  return view().tasks.filter((task) => planMeters(task.kind) && Date.parse(task.createdAt) >= from).length;
}

function withReturn(checkoutUrl: string, origin: string, paymentId: string): string {
  try {
    const url = new URL(checkoutUrl);
    if (!url.searchParams.get('return_url') && !url.searchParams.get('callback_url')) {
      url.searchParams.set('return_url', `${origin}/plans?payment=${encodeURIComponent(paymentId)}`);
    }
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}
