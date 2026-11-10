'use client';

import { useState } from 'react';
import Captcha, { captchaOn } from '../captcha';

// /order/track: a customer's orders by mobile number or email, like a courier's tracking page (no sign-in yet).

type Found = { name: string; state: string; state_label: string; fulfilment: string; expected_date: string | null; items: string[]; access_token: string;
  payment_state?: string; amount_due?: number };

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// back to where the customer came from on this site; the main page when they landed here directly
const goBack = () => {
  const internal = document.referrer && new URL(document.referrer).origin === location.origin;
  if (internal && history.length > 1) history.back();
  else location.href = '/';
};

export default function TrackOrders() {
  const [lookup, setLookup] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<Found[] | null>(null);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaOn && !captcha) return setError('Please complete the security check.');
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/order/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lookup, captcha }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'We could not reach Harley\'s. Try again in a minute.');
      setOrders(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setRound((n) => n + 1); // a token works once
    }
  };

  return (
    <main className="status page">
      <div className="track-top">
        <button type="button" className="back" onClick={goBack} aria-label="Go back">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          <span>Back</span>
        </button>
        <a className="brand" href="/"><img src="/assets/logo.png" alt="Harley's" width={40} height={40} /></a>
      </div>
      <h1>Track your orders</h1>
      <p className="lead">Enter the mobile number or email you ordered with.</p>
      <form className="box" onSubmit={find}>
        <label className="field">Mobile number or email
          <input className="input" autoComplete="tel" placeholder="98450 12345 or you@example.com" required maxLength={120} value={lookup} onChange={(e) => setLookup(e.target.value)} />
        </label>
        <Captcha onToken={setCaptcha} round={round} />
        <button className="btn" disabled={busy}>{busy ? 'Processing...' : 'Find my orders'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {orders && !orders.length && <p className="lead">No orders found for these details. Check them, or call us.</p>}
      {orders?.map((o) => (
        <a key={o.access_token} className="box found" href={`/order/${o.access_token}`}>
          <h3>{o.name}<span className={`state ${o.state}`}>{o.state_label}</span></h3>
          <small>{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}{o.expected_date && ` · ${day(o.expected_date)}`}</small>
          <p>{o.items.join(', ')}</p>
          {!!o.amount_due && o.payment_state !== 'paid' && <small className="due">₹{o.amount_due.toLocaleString('en-IN')} to pay</small>}
          <span className="link">See the details →</span>
        </a>
      ))}
      <p><a className="link" href="/order">← Place a new order</a></p>
    </main>
  );
}
