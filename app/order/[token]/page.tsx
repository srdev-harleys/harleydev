import type { Metadata } from 'next';
import { callOdoo, OrderError } from '@/lib/custom-orders';
import PayBox, { type Payment } from './pay-box';

// /order/<token>: where the customer's order is, straight from Odoo (no personal data beyond what's shown).

type Status = {
  name: string; state: string; state_label: string; fulfilment?: string; expected_date: string | null;
  outlet: { name: string } | null; customer: { first_name: string };
  timeline: { state: string; label: string; at: string | null }[];
  lines: { name: string; qty: number; options: { label: string; value: string }[]; notes: string }[];
  contact_phone?: string; payment?: Payment;
};

const STOPPED: Record<string, string> = { draft: "We'll call you about a change", rejected: 'Not possible this time', cancelled: 'Cancelled' };
const STEP: Record<string, string> = { submitted: 'Received', approved: 'Confirmed', in_production: 'Being made', ready: 'Ready at the outlet',
  out_for_delivery: 'On its way to you', picked_up: 'Picked up', delivered: 'Delivered' };

export const dynamic = 'force-dynamic';
// One customer's order: never in search results.
export const metadata: Metadata = { title: "Your Harley's order", robots: { index: false, follow: false } };

export default async function OrderStatus({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let order: Status | null = null;
  try {
    if (/^[\w-]{32,}$/.test(token)) order = await (await callOdoo(`/order/${token}`)).json();
  } catch (err) {
    if (!(err instanceof OrderError && err.kind === 'not_found')) {
      return <main className="status done"><a className="brand" href="/" aria-label="Harley's home"><img src="/assets/logo.png" alt="Harley's" width={40} height={40} /></a><p className="error">We couldn&apos;t load your order just now. Try again in a minute.</p></main>;
    }
  }
  if (!order) return <main className="status done"><a className="brand" href="/" aria-label="Harley's home"><img src="/assets/logo.png" alt="Harley's" width={40} height={40} /></a><p className="lead">We can&apos;t find this order. Check the link.</p></main>;
  const delivery = order.fulfilment === 'delivery';
  return (
    <main className="status page">
      <a className="brand" style={{ display: 'inline-block', paddingTop: 16 }} href="/"><img src="/assets/logo.png" alt="Harley's" width={40} height={40} /></a>
      <h1>{order.name}</h1>
      <p className="lead">Hi {order.customer.first_name}. {STOPPED[order.state] ?? order.state_label}</p>
      {!STOPPED[order.state] && (
        <ol className="timeline">
          {order.timeline.map((t) => (
            <li key={t.state} className={t.at ? 'on' : ''}>
              {t.state === 'ready' && !delivery ? 'Ready for pickup' : STEP[t.state] ?? t.label}
              {t.at && <span className="hint" style={{ marginLeft: 'auto' }}>{new Date(t.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="box">
        <h3>{delivery ? 'Delivery' : 'Pickup'} {order.expected_date ?? ''}</h3>
        <div className="hint">{order.outlet ? `${delivery ? 'From' : 'At'} ${order.outlet.name}` : "We'll confirm the outlet when we call."}</div>
      </div>
      {order.payment && <PayBox token={token} payment={order.payment} open={!STOPPED[order.state]} />}
      <div className="box">
        <h3>Items</h3>
        {order.lines.map((line, i) => (
          <div className="line" key={i}><div><b>{line.qty} × {line.name}</b>
            <small>{line.options.map((o) => `${o.label}: ${o.value}`).join(' · ')}{line.notes && ` · ${line.notes}`}</small></div></div>
        ))}
      </div>
      <p className="hint">Questions? {order.contact_phone
        ? <>Call us on <a href={`tel:${order.contact_phone.replace(/\s/g, '')}`}>{order.contact_phone}</a>.</>
        : 'Call your Harley\'s outlet.'} <a href="https://harleys.com/">harleys.com</a></p>
    </main>
  );
}
