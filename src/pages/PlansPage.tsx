import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatZar } from '@shared/rights.ts';
import { api } from '../lib/api';
import { readSession } from '../lib/session';

type Billing = Awaited<ReturnType<typeof api.billing>>;

export function PlansPage() {
  const [params] = useSearchParams();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  function load() {
    return api.billing().then((next) => {
      setBilling(next);
      const known = next.accountEmail || next.subscription?.email || readSession()?.email || '';
      if (known) setEmail((current) => current || known);
    });
  }

  useEffect(() => {
    const paymentId = params.get('payment') || '';
    const run = paymentId
      ? api.confirmPlan(paymentId).then((result) => {
          setNote(result.active ? 'Redface Pay confirmed this month.' : 'Payment is still open in Redface Pay.');
        })
      : api.billing().then((next) => next.pendingPaymentId ? api.confirmPlan(next.pendingPaymentId) : null).then((result) => {
          if (result?.active) setNote('Redface Pay confirmed this month.');
        });
    run
      .catch((reason: Error) => setError(reason.message))
      .finally(() => { load().catch((reason: Error) => setError(reason.message)); });
  }, [params]);

  async function subscribe(planId: string) {
    setBusy(planId);
    setError('');
    try {
      const result = await api.checkoutPlan(planId, email);
      window.location.assign(result.checkoutUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Checkout did not start.');
      setBusy('');
    }
  }

  const active = billing?.admin ? null : billing?.subscription;

  return (
    <div className="stack">
      <div>
        <p className="kicker">Redface Pay</p>
        <h1>Plans</h1>
        <p className="lede">You are signed in. Checkout opens on Redface Pay. The Paystack plan code and amount stay the same.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <p className="meta">{note}</p>}
      {billing?.admin && <p className="meta">Admin access is on for {billing.accountEmail}. This account is not billed.</p>}
      {active && (
        <p className="meta">
          {active.planName} is active until {active.currentPeriodEnd ? new Date(active.currentPeriodEnd).toLocaleDateString('en-ZA') : 'this period'}
          {' · '}{active.generationsUsed} of {active.generations} generations used
        </p>
      )}
      <label>
        Receipt email
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@studio.co.za" autoComplete="email" />
      </label>
      <div className="cards">
        {billing?.plans.map((plan) => (
          <article className="card" key={plan.id}>
            <p className="kicker">{plan.name}</p>
            <div className="price">{formatZar(plan.amountZar * 100)}</div>
            <p className="meta">per month · {plan.generations} generations</p>
            <p>{plan.summary}</p>
            <ul>
              {plan.includes.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="meta">{plan.planCode}</p>
            <button className="btn" type="button" disabled={Boolean(busy) || active?.planId === plan.id} onClick={() => subscribe(plan.id)}>
              {active?.planId === plan.id ? 'Current plan' : busy === plan.id ? 'Opening Redface Pay' : `Subscribe`}
            </button>
          </article>
        ))}
      </div>
      {billing && !billing.payConfigured && (
        <p className="meta">
          Checkout needs a Redface Pay API key on the server. That key starts with rf_live_, is shown once when it is created, and only opens payment. It is not this login, and it is not what generates the music.
        </p>
      )}
    </div>
  );
}
