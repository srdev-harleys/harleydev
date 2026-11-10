'use client';

import { useState } from 'react';

// The tracking page's payment box. Until Harley's confirms the price on the call it only says so; then the
// order value, QR, UPI ID and bank details (each copyable), and "Paid already?" with screenshots or a reference.

export type Payment = {
  state: string; state_label: string; confirmed: boolean; total: number; advance_asked: number; received: number; due: number;
  due_now: number; to_check: number;
  account: { holder: string; bank: string; account_number: string; ifsc: string; upi_id: string; gstin: string; qr: boolean } | null;
  payments: { id: number; kind_label: string; state: string; state_label: string; date: string; amount: number; reference: string }[];
};

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const MAX_SHOTS = 3;

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width * scale, height: bitmap.height * scale });
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function Copy({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // old browser / no permission: the value is on screen to select
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <div className="copy-row">
      <div><small>{label}</small><b>{value}</b></div>
      <button type="button" className="copy" onClick={copy} aria-label={`Copy ${label}`}>{done ? '✓ Copied' : 'Copy'}</button>
    </div>
  );
}

export default function PayBox({ token, payment: first, open }: { token: string; payment: Payment; open: boolean }) {
  const [payment, setPayment] = useState(first);
  const [amount, setAmount] = useState(first.due_now ? String(first.due_now) : '');
  const [reference, setReference] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const a = payment.account;
  if (!open && !payment.payments.length) return null;

  if (!payment.confirmed) {
    return (
      <div className="box pay">
        <h3>Payment</h3>
        <p className="hint">We&apos;ll confirm your order value when we call you. How to pay (UPI or bank transfer) shows here after that.</p>
      </div>
    );
  }

  const addShots = async (files: FileList | null) => {
    const added = await Promise.all([...(files ?? [])].slice(0, MAX_SHOTS - photos.length).map(shrink));
    setPhotos((old) => [...old, ...added]);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reference.trim() && !photos.length) return setMessage('Add the payment screenshot or its reference number.');
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/order/payment/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), reference: reference.trim(), photos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'We could not reach Harley\'s. Try again in a minute.');
      setPayment(data);
      setReference('');
      setPhotos([]);
      setMessage('Thank you! We will check it and update your order.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="box pay">
      <h3>Payment<span className={`state ${payment.state}`}>{payment.state_label}</span></h3>
      <div className="pay-sums">
        <div><small>Order value</small><b>{rupees(payment.total)}</b></div>
        <div><small>Paid</small><b>{rupees(payment.received)}</b></div>
        <div><small>{payment.received < payment.advance_asked ? 'Advance to pay' : 'To pay'}</small><b>{rupees(payment.due_now)}</b></div>
      </div>
      {open && payment.due_now > 0 && a && (
        <div className="pay-ways">
          {a.qr && (
            <figure className="pay-qr">
              <img src={`/api/order/qr/${token}`} width={180} height={180} alt="Scan to pay with any UPI app" />
              <figcaption>Scan with any UPI app</figcaption>
            </figure>
          )}
          <div className="pay-details">
            {a.upi_id && (
              <>
                <Copy label="UPI ID" value={a.upi_id} />
                <a className="btn slim" href={`upi://pay?pa=${encodeURIComponent(a.upi_id)}&pn=${encodeURIComponent(a.holder)}&am=${payment.due_now.toFixed(2)}&cu=INR`}>
                  Pay {rupees(payment.due_now)} with a UPI app</a>
              </>
            )}
            {a.account_number && (
              <>
                <Copy label="Account name" value={a.holder} />
                <Copy label="Account number" value={a.account_number} />
                {a.ifsc && <Copy label={`IFSC${a.bank ? ` · ${a.bank}` : ''}`} value={a.ifsc} />}
              </>
            )}
            {a.gstin && <p className="hint">GSTIN {a.gstin}</p>}
          </div>
        </div>
      )}
      {payment.payments.length > 0 && (
        <ul className="pay-list">
          {payment.payments.map((p) => (
            <li key={p.id}><span>{p.kind_label} · {new Date(`${p.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{p.reference && ` · ${p.reference}`}</span>
              <b>{rupees(p.amount)}</b><span className={`state ${p.state}`}>{p.state === 'to_check' ? 'Checking' : p.state_label}</span></li>
          ))}
        </ul>
      )}
      {open && payment.due > 0 && (
        <form onSubmit={send} className="pay-form">
          <b>Paid already? Send us the proof</b>
          <div className="row">
            <label className="field">Amount paid (₹)
              <input className="input" type="number" min={1} step="any" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field">UPI / bank reference (UTR)
              <input className="input" maxLength={60} placeholder="12-digit UTR from your app" value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
          <div className="shots">
            {photos.map((photo, i) => (
              <div key={i} className="shot">
                <img src={`data:image/jpeg;base64,${photo}`} alt={`Screenshot ${i + 1}`} />
                <button type="button" aria-label="Remove" onClick={() => setPhotos((old) => old.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {photos.length < MAX_SHOTS && (
              <label className="drop">
                <input type="file" accept="image/*" multiple onChange={(e) => { addShots(e.target.files); e.target.value = ''; }} />
                <span aria-hidden>📎</span>
                <b>{photos.length ? 'Add another' : 'Add payment screenshot'}</b>
                <small>JPG or PNG, up to {MAX_SHOTS}</small>
              </label>
            )}
          </div>
          <button className="btn" disabled={busy}>{busy ? 'Sending...' : 'Send payment proof'}</button>
        </form>
      )}
      {message && <p className="hint" role="status">{message}</p>}
    </div>
  );
}
