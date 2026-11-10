'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// The customer's ordering page: custom or bulk -> items -> you -> pickup or delivery -> review. Talks only to
// /api/order/*. No prices here: Harley's calls to confirm, then the order's page asks for the advance. The payload is the one the Harley's app sends.
// ?outlet=BLR-KRM (an outlet's own link, from Odoo) chooses that outlet for pickup.

type Option = { key: string; label: string; type: string; choices: string[]; allow_custom: boolean; unit: string; step: number;
  required: boolean; max_length: number; hint: string };
type Size = { id: number; sku: string; name: string; kg: number | null };
type Product = { id: number; name: string; image: boolean; description: string; sku: string; variants: Size[]; lead_hours?: number;
  min_qty?: number; qty_step?: number; options?: Option[] }; // options: the section's, with this item's shapes / flavours / colours
type Kind = 'custom' | 'bulk';
type Section = { id: number; name: string; order_type: Kind; lead_hours: number; options: Option[]; products: Product[];
  image?: boolean; color?: string };
type Values = Record<string, string | number | boolean>;
type Line = { product_id: number | null; variant_id: number | null; section_id: number | null; name: string; custom_name: string;
  qty: number; options: Values; notes: string; photos: string[]; image: boolean; summary: string; min?: number; step?: number };
type Outlet = { id: number; name: string; code: string; area: string; km: number | null };
type Calendar = { slots: { name: string; from: number; to: number }[]; occasions: string[]; closed: { name: string; from: string; to: string }[] };
type Place = { found: boolean; areas: string[]; city: string; district: string; state: string; outlet: Outlet | null };

const STEPS = ['Choose', 'You', 'When', 'Review'];
const KINDS: { kind: Kind; title: string; text: string; icon: string }[] = [
  { kind: 'custom', title: 'Celebration cake', text: 'A cake made for your day: pick the size, flavour, colours and message.', icon: '🎂' },
  { kind: 'bulk', title: 'Bulk & party order', text: 'Pastries, macarons, assortments and drinks for a party or the office.', icon: '🎉' },
];
// Odoo: Harley's Custom > Configuration > Calendar; these until it answers
const CALENDAR: Calendar = {
  slots: [{ name: '10 am – 12 pm', from: 10, to: 12 }, { name: '12 – 4 pm', from: 12, to: 16 }, { name: '4 – 8 pm', from: 16, to: 20 }],
  occasions: ['🎂 Birthday', '💍 Anniversary', '👰 Wedding', '🍼 Baby shower', '🏢 Office party', '🪔 Festival', '🎓 Graduation'],
  closed: [],
};
const CHIP_LIMIT = 8;
const SAVED = 'harleys-order-customer';
const swatch = (choice: string) => {
  const match = choice.match(/^(.*?)\s*(#[0-9a-f]{6})$/i);
  return match ? { name: match[1], color: match[2] } : { name: choice, color: '' };
};
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const outletName = (o: Outlet) => o.name.replace(/^[A-Z]{2}-[A-Z]{3}-/, ''); // "KA-BLR-Cloud FC HSR" -> "Cloud FC HSR"
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/order${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || ({ closed: 'Online ordering opens soon. Please call your Harley\'s outlet.',
      unreachable: 'We could not reach Harley\'s. Try again in a minute.' } as Record<string, string>)[data.error] || 'Something went wrong.');
  }
  return data as T;
}

/** A photo as base64 JPEG, at most 1600 px (Odoo refuses over 8 MB). */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width * scale, height: bitmap.height * scale });
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

function Picture({ id, image, size = 512 }: { id?: number | null; image?: boolean; size?: number }) {
  return image && id
    ? <img src={`/api/order/image/${id}/${size}`} alt="" loading="lazy" />
    : <div className="ph" aria-hidden>H</div>;
}

/** Harley's logo in a turning ring: the wait screen (over the page, or in place with ``inline``). */
function Loader({ text = 'Processing...', inline = false }: { text?: string; inline?: boolean }) {
  return (
    <div className={inline ? 'loader inline' : 'loader'} role="status" aria-live="polite">
      <div className="loader-ring"><img src="/assets/logo.png" alt="" /></div>
      <b>{text}</b>
    </div>
  );
}

/** An all-day calendar event for the pickup / delivery day. */
function calendarFile(title: string, date: string, link: string) {
  const day = date.replaceAll('-', '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Harleys//Order//EN', 'BEGIN:VEVENT', `UID:${day}-${Date.now()}@harleys`,
    `DTSTART;VALUE=DATE:${day}`, `SUMMARY:${title}`, `DESCRIPTION:Track your order: ${link}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
}

export default function OrderApp() {
  const [catalog, setCatalog] = useState<Section[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [sheet, setSheet] = useState<{ index: number | null; product: Product | null; section: Section | null } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [filter, setFilter] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [c, setC] = useState({ name: '', phone: '', email: '', pincode: '', area: '', city: '', district: '', state: '', address: '', landmark: '' });
  const [mapUrl, setMapUrl] = useState('');
  useEffect(() => {
    try { // the details of this browser's last order
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
      if (saved?.c) setC((old) => ({ ...old, ...saved.c }));
      if (saved?.mapUrl) setMapUrl(saved.mapUrl);
    } catch { /* private window */ }
  }, []);
  const [place, setPlace] = useState<Place | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState<number | null>(null);
  const [chosenOutlet, setChosenOutlet] = useState(false); // the customer (or the outlet's link) picked it
  const [outletSearch, setOutletSearch] = useState('');
  const [allOutlets, setAllOutlets] = useState(false);
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [occasion, setOccasion] = useState('');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ name: string; access_token: string } | null>(null);
  const [phone, setPhone] = useState(''); // Settings > Harley's Custom > Customer Help Number
  const [word, setWord] = useState(0); // the first screen's turning occasion
  const [calendar, setCalendar] = useState(CALENDAR);

  useEffect(() => {
    api<{ sections: Section[]; contact_phone?: string; calendar?: Calendar }>('/catalog').then((data) => {
      setCatalog(data.sections); setPhone(data.contact_phone ?? ''); if (data.calendar) setCalendar(data.calendar);
    },
      (err) => setLoadError(err.message));
    if (new URLSearchParams(location.search).has('step')) { // a reload starts over: the order isn't kept
      const params = new URLSearchParams(location.search);
      params.delete('step');
      history.replaceState(null, '', `?${params}`.replace(/\?$/, ''));
    }
    const code = new URLSearchParams(location.search).get('outlet');
    api<Outlet[]>('/outlets').then((list) => {
      setOutlets(list);
      const linked = code && list.find((o) => o.code.toLowerCase() === code.toLowerCase());
      if (linked) { setOutletId(linked.id); setChosenOutlet(true); }
    }, () => {});
    const back = () => setStep(Number(new URLSearchParams(location.search).get('step')) || 0);
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, []);

  useEffect(() => {
    if (kind) return;
    const timer = setInterval(() => setWord((w) => (w + 1) % Math.max(1, calendar.occasions.length)), 2000);
    return () => clearInterval(timer);
  }, [kind, calendar]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const showcase = useMemo(() => (catalog ?? []).flatMap((s) => s.products.filter((p) => p.image).slice(0, 6).map((p) => ({ p, s }))).slice(0, 18), [catalog]);
  const section = useCallback((id: number | null) => catalog?.find((s) => s.id === id) ?? null, [catalog]);
  const leadHours = Math.max(0, ...lines.map((l) => {
    const s = section(l.section_id);
    return s?.products.find((p) => p.id === l.product_id)?.lead_hours || s?.lead_hours || 0; // the product's, else its section's
  }));
  const closedOn = (day: string) => calendar.closed.find((c) => c.from <= day && day <= c.to)?.name ?? '';
  const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
  const slots = calendar.slots.filter((s) => date !== iso(new Date()) || !s.to || s.to > nowHour).map((s) => s.name); // none that are over today
  const earliest = useMemo(() => iso(new Date(Date.now() + leadHours * 3600_000)), [leadHours]);
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);
  const outlet = outlets.find((o) => o.id === outletId) ?? null;
  const days = useMemo(() => Array.from({ length: 10 }, (_, i) => new Date(Date.now() + i * 86400_000)), []);

  /** What a step still needs, by field: each is highlighted with its own message once the customer tries to go on. */
  const problems = (at: number): Record<string, string> => {
    const out: Record<string, string> = {};
    if (at === 0 && !lines.length) out.lines = 'Add at least one item.';
    if (at === 1) {
      if (!/^[6-9]\d{9}$/.test(c.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))) out.phone = 'Enter a valid 10-digit mobile number.';
      if (!c.name.trim()) out.name = 'Enter your name.';
      if (c.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) out.email = 'Check the email address, or leave it empty.';
      if (!consent) out.consent = 'Your consent is needed to process this order.';
    }
    if (at === 2) {
      if (!date) out.date = `Choose the ${fulfilment} day.`;
      else if (closedOn(date)) out.date = `We're closed that day (${closedOn(date)}). Choose another day.`;
      if (fulfilment === 'delivery' && !c.address.trim()) out.address = 'Enter the delivery address.';
      if (fulfilment === 'delivery' && mapUrl.trim() && !/^https:\/\//.test(mapUrl.trim())) out.map = 'Paste the Google Maps link as shared (https://...).';
    }
    return out;
  };
  const [tried, setTried] = useState<number | null>(null); // the step whose fields are being checked live
  const bad = tried === step ? problems(step) : {};
  const flag = (key: string) => ({ className: `field${bad[key] ? ' bad' : ''}`, 'data-bad': bad[key] ? true : undefined });
  const note = (key: string) => bad[key] && <span className="field-error" role="alert">{bad[key]}</span>;
  const stopAt = (at: number) => {
    const wrong = problems(at);
    if (!Object.keys(wrong).length) return false;
    setTried(at);
    if (wrong.lines) setError(wrong.lines); // no field to mark: the empty cart
    setTimeout(() => {
      const first = document.querySelector<HTMLElement>('[data-bad]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    }, 60);
    return true;
  };

  const go = (to: number) => {
    for (let at = step; at < to; at++) {
      if (stopAt(at)) return;
    }
    setTried(null);
    setError('');
    setCartOpen(false);
    setStep(to);
    history.pushState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), step: String(to) })}`);
    scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setField = (key: keyof typeof c, value: string) => setC((old) => ({ ...old, [key]: value }));

  const lookupPincode = async (pin: string) => {
    setField('pincode', pin);
    if (!/^[1-9]\d{5}$/.test(pin)) { // a cleared or changed pincode empties what the old one filled
      if (place) setC((old) => ({ ...old, area: '', city: '', district: '', state: '' }));
      return setPlace(null);
    }
    const wait = <T,>(p: Promise<T>) => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    const [found, nearest] = await Promise.all([wait(api<Place>(`/pincode/${pin}`)), wait(api<Outlet[]>(`/outlets?pincode=${pin}`))]);
    if (nearest?.length) setOutlets(nearest);
    if (!found) return;
    setPlace(found);
    if (found.outlet && !chosenOutlet) setOutletId(found.outlet.id); // suggest the nearest, never override a choice
    setC((old) => ({ ...old, city: found.city, district: found.district, state: found.state,
      area: found.areas.length === 1 ? found.areas[0] : found.areas.includes(old.area) ? old.area : '' }));
  };

  const pickKind = (next: Kind) => {
    setKind(next);
    setFilter(null);
    setTimeout(() => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const submit = async () => {
    for (let at = 0; at < 3; at++) {
      if (Object.keys(problems(at)).length) { setStep(at); stopAt(at); return; }
    }
    let uuid = sessionStorage.getItem('order-uuid');
    if (!uuid) sessionStorage.setItem('order-uuid', (uuid = crypto.randomUUID().replace(/-/g, '')));
    setBusy(true);
    setError('');
    try {
      const done = await api<{ name: string; access_token: string }>('', {
        client_uuid: uuid, order_type: kind ?? 'custom', fulfilment, pickup_warehouse_id: outletId, consent,
        map_url: fulfilment === 'delivery' ? mapUrl.trim() : '',
        expected_date: date, expected_time: time, occasion: occasion.replace(/^\p{Extended_Pictographic}\s*/u, ''), notes,
        customer: { ...c, phone: c.phone.replace(/\D/g, '').slice(-10), email: c.email.trim() },
        lines: lines.map(({ name: _name, image: _image, summary: _summary, ...line }) => line),
      });
      sessionStorage.removeItem('order-uuid');
      try { // the next order starts with these filled in (this browser only)
        localStorage.setItem(SAVED, JSON.stringify({ c, mapUrl }));
      } catch { /* private window */ }
      setPlaced(done);
      scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (placed) {
    const link = `${location.origin}/order/${placed.access_token}`;
    const what = fulfilment === 'delivery' ? 'delivery' : 'pickup';
    return (
      <main className="done page">
        <div className="confetti" aria-hidden>{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div>
        <a className="brand" href="/" aria-label="Harley's home"><img src="/assets/logo.png" alt="Harley's" width={40} height={40} /></a>
        <div className="done-card">
          <div className="tick" aria-hidden>✓</div>
          <p className="lead">Thank you, {c.name.split(' ')[0]}! Your order is in.</p>
          <div className="big">{placed.name}</div>
          <ol className="mini-steps">
            <li className="on">Received</li><li>We call to confirm</li><li>Being made</li><li>Ready for {what}</li>
          </ol>
          <p className="note">Our team will call you on {c.phone} to confirm the details and the price.
</p>
          <div className="done-actions">
            <a className="btn" href={link}>Track this order</a>
            <a className="btn ghost" href={calendarFile(`Harley's ${what}: ${placed.name}`, date, link)} download="harleys-order.ics">Add to calendar</a>
            <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(`My Harley's order ${placed.name}: ${link}`)}`} target="_blank" rel="noopener noreferrer">Save on WhatsApp</a>
          </div>
        </div>
      </main>
    );
  }

  const ofKind = (catalog ?? []).filter((s) => s.order_type === kind);
  const shown = ofKind
    .filter((s) => filter === null || s.id === filter)
    .map((s) => ({ s, products: s.products.filter((p) => !search ||
      [p.name, p.sku, ...p.variants.map((v) => v.sku)].some((t) => t?.toLowerCase().includes(search.toLowerCase()))) }))
    .filter(({ products }) => products.length);
  const pickupList = outlets.filter((o) => !outletSearch || `${o.name} ${o.area} ${o.code}`.toLowerCase().includes(outletSearch.toLowerCase()));
  const nav = step < 3
    ? <button className="btn" onClick={() => go(step + 1)}>{['Your details', 'Pickup or delivery', 'Review order'][step]} →</button>
    : <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Placing…' : 'Place order'}</button>;

  return (
    <>
      {busy && <Loader />}
      <header className="top">
        <div className="top-in">
          <a className="brand" href="/" aria-label="Harley's home"><img src="/assets/logo.png" alt="Harley's" width={40} height={40} /></a>
          <nav className="steps" aria-label="Steps">
            {STEPS.map((label, i) => (
              <button key={label} className={i <= step ? 'on' : ''} disabled={i >= step} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
                <i />{label}
              </button>
            ))}
          </nav>
          <a className="top-track" href="/order/track" aria-label="Track your orders">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
            <span>Track<span className="top-track__more"> orders</span></span>
          </a>
          {phone && <a className="top-call" href={`tel:${phone.replace(/\s/g, '')}`} aria-label={`Call ${phone}`}>📞 <span>{phone}</span></a>}
          <button className="top-cart" onClick={() => setCartOpen(true)} disabled={!lines.length} aria-label={`Your order, ${plural(itemCount, 'item')}`}>
            🛍 <b key={itemCount} className="pop">{itemCount}</b>
          </button>
        </div>
      </header>

      <div className={`layout ${kind || lines.length ? '' : 'solo'}`}>
        <main className="content">
          {error && <div className="error" role="alert">{error}</div>}

          {step === 0 && (
            <section className="page" key="items">
              <div className="hero">
                <p className="eyebrow">Made to order · Confirmed by phone</p>
                <h1>What are we celebrating?</h1>
                {!kind && calendar.occasions.length > 0 && <p className="turning" aria-hidden><span key={word}>{calendar.occasions[word % calendar.occasions.length]}</span></p>}
                <p className="lead">Choose the kind of order. You&apos;ll see the cakes and finished goods for it, then tell us your day.</p>
                <div className="kinds" role="radiogroup" aria-label="Kind of order">
                  {KINDS.map((k) => (
                    <button key={k.kind} role="radio" aria-checked={kind === k.kind} className={`kind ${kind === k.kind ? 'on' : ''}`} onClick={() => pickKind(k.kind)}>
                      <span className="kind-icon" aria-hidden>{k.icon}</span>
                      <b>{k.title}</b>
                      <small>{k.text}</small>
                      <span className="kind-count">{catalog ? plural((catalog.filter((s) => s.order_type === k.kind).flatMap((s) => s.products)).length, 'item') : '…'}</span>
                      <span className="kind-peek" aria-hidden>
                        {(catalog ?? []).filter((s) => s.order_type === k.kind).flatMap((s) => s.products).filter((p) => p.image).slice(0, 4)
                          .map((p) => <img key={p.id} src={`/api/order/image/${p.id}/256`} alt="" />)}
                      </span>
                    </button>
                  ))}
                </div>
                {!kind && !!showcase.length && (
                  <div className="showcase" aria-label="Some of our cakes and party items">
                    <div className="showcase-track">
                      {[...showcase, ...showcase].map(({ p, s }, i) => (
                        <button key={i} className="show-item" tabIndex={i < showcase.length ? 0 : -1} aria-hidden={i >= showcase.length}
                          onClick={() => { setKind(s.order_type); setSheet({ index: null, product: p, section: s }); }}>
                          <img src={`/api/order/image/${p.id}/256`} alt="" loading="lazy" />
                          <span>{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!kind && (
                  <ol className="how">
                    {[['🍰', 'Choose', 'Pick a cake or party items, size and design'], ['📅', 'Your day', 'Pickup at an outlet or delivery, date and time'],
                      ['📞', 'We call you', 'To confirm the details and the price'], ['🎁', 'Enjoy', 'Freshly made, ready when you need it']]
                      .map(([icon, title, text]) => <li key={title}><span aria-hidden>{icon}</span><b>{title}</b><small>{text}</small></li>)}
                  </ol>
                )}
              </div>

              {loadError && <div className="error">{loadError}</div>}
              {kind && !catalog && !loadError && <Loader inline />}
              {kind && catalog && (
                <div id="menu" className="menu">
                  <div className="menu-bar">
                    <div className="chips" role="group" aria-label="Sections">
                      <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>All</button>
                      {ofKind.map((s) => <button key={s.id} className="chip" aria-pressed={filter === s.id} onClick={() => setFilter(s.id)}>{s.name} <span className="chip-n">{s.products.length}</span></button>)}
                    </div>
                    <input className="search" type="search" placeholder="Search by name or SKU" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <button className="something" onClick={() => setSheet({ index: null, product: null, section: null })}>
                    <span aria-hidden>✏️</span>
                    <div><b>Have your own idea?</b><small>Describe it or upload a photo: a theme cake, a logo, anything not listed.</small></div>
                    <span className="arrow" aria-hidden>→</span>
                  </button>
                  {shown.map(({ s, products }) => (
                    <div key={s.id}>
                      {s.image && <img className="section-banner" src={`/api/order/banner/${s.id}`} alt="" loading="lazy" />}
                      <h2 className="section-title" style={s.color ? { color: s.color } : undefined}>{s.name}<span>{plural(products.length, 'item')}{s.lead_hours > 0 && ` · order ${plural(Math.ceil(s.lead_hours / 24), 'day')} ahead`}</span></h2>
                      <div className="grid">
                        {products.map((p) => {
                          const count = lines.filter((l) => l.product_id === p.id).reduce((n, l) => n + l.qty, 0);
                          return (
                            <button key={p.id} className="card" onClick={() => setSheet({ index: null, product: p, section: s })}>
                              <div className="card-img"><Picture id={p.id} image={p.image} /></div>
                              {count > 0 && <span className="added">✓ {count}</span>}
                              <b>{p.name}</b>
                              <small>{p.variants.length ? p.variants.map((v) => v.name).join(' · ') : 'Customise'}</small>
                              <span className="card-add" aria-hidden>+</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {!shown.length && <p className="lead">Nothing matches. Tell us under &ldquo;Have your own idea?&rdquo;.</p>}
                </div>
              )}
            </section>
          )}

          {step === 1 && (
            <section className="page narrow" key="you">
              <h1>Your details</h1>
              <p className="lead">So we can call you to confirm. We never share them.</p>
              <div className="row">
                <label {...flag('phone')}>Mobile number *
                  <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="98450 12345" aria-invalid={!!bad.phone} value={c.phone} onChange={(e) => setField('phone', e.target.value)} />
                  {note('phone')}
                </label>
                <label {...flag('name')}>Your name *
                  <input className="input" autoComplete="name" aria-invalid={!!bad.name} value={c.name} onChange={(e) => setField('name', e.target.value)} />
                  {note('name')}
                </label>
              </div>
              <label {...flag('email')}>Email (optional)
                <input className="input" type="email" autoComplete="email" aria-invalid={!!bad.email} value={c.email} onChange={(e) => setField('email', e.target.value)} />
                {note('email')}
              </label>
              <div {...flag('consent')}>
                <label className="consent">
                  <input type="checkbox" checked={consent} aria-invalid={!!bad.consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>I consent to my name and mobile number being collected and used for the purpose of fulfilling my order and
                    tracking order details. *</span>
                </label>
                {note('consent')}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="page narrow" key="when">
              <h1>When and where?</h1>
              <p className="lead">Collect it from a Harley&apos;s outlet, or we deliver it to you.</p>
              <div className="toggle" role="radiogroup" aria-label="Pickup or delivery">
                {(['pickup', 'delivery'] as const).map((f) => (
                  <button key={f} role="radio" aria-checked={fulfilment === f} className={fulfilment === f ? 'on' : ''} onClick={() => setFulfilment(f)}>
                    {f === 'pickup' ? '🏬 Pickup at outlet' : '🚚 Deliver to me'}
                  </button>
                ))}
              </div>

              <div {...flag('date')}>{fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} day *
                {note('date')}
                <div className="days" role="radiogroup" aria-label="Day">
                  {days.map((d) => {
                    const value = iso(d), closed = closedOn(value);
                    return (
                      <button key={value} role="radio" aria-checked={date === value} disabled={!!closed} className={`day ${date === value ? 'on' : ''} ${value < earliest ? 'soon' : ''}`}
                        onClick={() => setDate(value)} title={closed ? `Closed: ${closed}` : value < earliest ? 'Short notice: we\'ll confirm when we call' : undefined}>
                        <small>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
                        <b>{d.getDate()}</b>
                        <small>{d.toLocaleDateString('en-IN', { month: 'short' })}</small>
                      </button>
                    );
                  })}
                  <label className="day other">
                    <small>Other</small>
                    <input type="date" min={iso(new Date())} value={days.some((d) => iso(d) === date) ? '' : date} onChange={(e) => closedOn(e.target.value) ? setToast(`Closed that day: ${closedOn(e.target.value)}`) : setDate(e.target.value)} aria-label="Another date" />
                  </label>
                </div>
                {leadHours > 0 && <span className="hint">These items are best ordered {Math.ceil(leadHours / 24)} day{leadHours > 24 ? 's' : ''} ahead{date && date < earliest ? '. Short notice: we\'ll confirm when we call.' : '.'}</span>}
              </div>

              <div className="field">Time (optional)
                <div className="chips" style={{ marginTop: 6 }}>
                  {slots.map((s) => <button key={s} className="chip" aria-pressed={time === s} onClick={() => setTime(time === s ? '' : s)}>{s}</button>)}
                  <input className="input slim" placeholder="Or a time, e.g. 6:30 pm" value={slots.includes(time) ? '' : time} onChange={(e) => setTime(e.target.value.slice(0, 40))} />
                </div>
              </div>

              {fulfilment === 'delivery' && (
                <>
                  <label {...flag('address')}>Address *
                    <textarea className="input" autoComplete="street-address" placeholder="House / flat, street" aria-invalid={!!bad.address} value={c.address} onChange={(e) => setField('address', e.target.value)} />
                    {note('address')}
                  </label>
                  <div className="row">
                    <label className="field">Landmark
                      <input className="input" value={c.landmark} onChange={(e) => setField('landmark', e.target.value)} />
                    </label>
                    <label {...flag('map')}>Google Maps link
                      <input className="input" type="url" inputMode="url" placeholder="Share your location from Google Maps" aria-invalid={!!bad.map} value={mapUrl} onChange={(e) => setMapUrl(e.target.value.slice(0, 500))} />
                      {note('map')}
                    </label>
                    <label className="field">Area
                      <input className="input" list="areas" value={c.area} onChange={(e) => setField('area', e.target.value)} />
                      <datalist id="areas">{place?.areas.map((a) => <option key={a} value={a} />)}</datalist>
                      {(place?.areas.length ?? 0) > 1 && <span className="hint">{place!.areas.length} areas share this pincode: pick yours below</span>}
                    </label>
                  </div>
                </>
              )}
              {fulfilment === 'delivery' && (place?.areas.length ?? 0) > 1 && (
                <div className="chips">
                  {place!.areas.slice(0, 12).map((a) => <button key={a} className="chip" aria-pressed={c.area === a} onClick={() => setField('area', a)}>{a}</button>)}
                </div>
              )}
              <div className="row">
                <label className="field">{fulfilment === 'delivery' ? 'Pincode' : 'Your pincode (optional)'}
                  <input className="input" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={c.pincode} onChange={(e) => lookupPincode(e.target.value.replace(/\D/g, ''))} />
                  {fulfilment === 'pickup' && <span className="hint">Puts the outlets nearest to you first</span>}
                </label>
                {fulfilment === 'delivery' && (
                  <label className="field">City
                    <input className="input" autoComplete="address-level2" value={c.city} onChange={(e) => setField('city', e.target.value)} />
                  </label>
                )}
              </div>

              {fulfilment === 'pickup' && outlets.length > 0 && (
                <div className="field">Pickup outlet
                  <span className="hint">{outlet ? 'You can change it any time before we confirm.' : 'Pick one, or we\'ll suggest the nearest when we call.'}</span>
                  <input className="input" type="search" placeholder={`Search ${outlets.length} outlets`} value={outletSearch} onChange={(e) => { setOutletSearch(e.target.value); setAllOutlets(true); }} />
                  <div className="outlets" role="radiogroup" aria-label="Pickup outlet">
                    {(allOutlets ? pickupList : [...(outlet ? [outlet] : []), ...pickupList.filter((o) => o.id !== outletId)].slice(0, 6)).map((o) => (
                      <button key={o.id} role="radio" aria-checked={o.id === outletId} className={`outlet ${o.id === outletId ? 'on' : ''}`}
                        onClick={() => { setOutletId(o.id); setChosenOutlet(true); }}>
                        <b>{outletName(o)}</b>
                        <small>{[o.area, o.km !== null ? `${o.km} km` : ''].filter(Boolean).join(' · ')}</small>
                        {place?.outlet?.id === o.id && <span className="tag">Nearest</span>}
                      </button>
                    ))}
                  </div>
                  {!allOutlets && pickupList.length > 6 && <button className="link" onClick={() => setAllOutlets(true)}>Show all {pickupList.length} outlets</button>}
                </div>
              )}
              {fulfilment === 'delivery' && place?.outlet && (
                <p className="note">Sent from <b>{outletName(place.outlet)}</b>{place.outlet.area && `, ${place.outlet.area}`}. We&apos;ll confirm it when we call.</p>
              )}

              <div className="field">Occasion (optional)
                <div className="chips" style={{ marginTop: 6 }}>
                  {calendar.occasions.map((o) => <button key={o} className="chip" aria-pressed={occasion === o} onClick={() => setOccasion(occasion === o ? '' : o)}>{o}</button>)}
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="page narrow" key="review">
              <h1>Check and place</h1>
              <p className="lead">Harley&apos;s will call you to confirm the details and price. Then pay the advance by UPI or bank transfer on your order&apos;s page.</p>
              <div className="box">
                <h3>{kind === 'bulk' ? 'Bulk order' : 'Custom order'} · {plural(itemCount, 'item')} <button onClick={() => go(0)}>Change</button></h3>
                {lines.map((line, i) => <CartLine key={i} line={line} onOpen={() => setSheet({ index: i, product: findProduct(catalog, line.product_id), section: section(line.section_id) })} />)}
              </div>
              <div className="box">
                <h3>{c.name} <button onClick={() => go(1)}>Change</button></h3>
                <div className="hint">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="box">
                <h3>{fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · {date && new Date(`${date}T12:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} {time} <button onClick={() => go(2)}>Change</button></h3>
                <div className="hint">{fulfilment === 'delivery'
                  ? [c.address, c.landmark, c.area, c.city, c.pincode].filter(Boolean).join(', ')
                  : outlet ? `${outletName(outlet)}${outlet.area ? `, ${outlet.area}` : ''}` : 'We\'ll confirm the outlet when we call'}
                {occasion && ` · ${occasion}`}</div>
              </div>
              <label className="field">Anything else we should know?
                <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </section>
          )}
        </main>

        {(kind || lines.length > 0) && <aside className="summary" aria-label="Your order">
          <h2>Your order</h2>
          {!lines.length && <p className="hint">{kind ? 'Tap an item to add it.' : 'Start by choosing the kind of order.'}</p>}
          {lines.map((line, i) => (
            <div className="s-line" key={i}>
              <div className="s-img"><Picture id={line.product_id} image={line.image} size={256} /></div>
              <button className="s-name" onClick={() => setSheet({ index: i, product: findProduct(catalog, line.product_id), section: section(line.section_id) })}>
                <b>{line.name}</b><small>{details(line) || 'Tap to customise'}</small>
              </button>
              <Qty line={line} set={(qty) => setLines((all) => qty < (line.min ?? 1) ? all.filter((_, j) => j !== i) : all.map((l, j) => j === i ? { ...l, qty } : l))} />
            </div>
          ))}
          {step > 0 && (
            <dl className="s-facts">
              {c.name && <><dt>For</dt><dd>{c.name}</dd></>}
              {date && <><dt>{fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</dt><dd>{new Date(`${date}T12:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} {time}</dd></>}
              {fulfilment === 'pickup' && outlet && <><dt>At</dt><dd>{outletName(outlet)}</dd></>}
            </dl>
          )}
          <div className="s-nav">
            {step > 0 && <button className="btn ghost" onClick={() => history.back()}>Back</button>}
            {nav}
          </div>
          <p className="hint">Nothing to pay now. We confirm the price when we call, then your order&apos;s page shows how to pay.</p>
        </aside>}
      </div>

      <footer className="site-foot">
        <div className="foot-in">
          <a className="brand" href="/" aria-label="Harley's home"><img src="/assets/logo.png" alt="Harley's" width={40} height={40} /></a>
          <span className="hint">Custom cakes and party orders, made to order.</span>
          <nav>
            {phone && <a href={`tel:${phone.replace(/\s/g, '')}`}>📞 {phone}</a>}
            <a href="/order/track">Track your orders</a>
            <a href="https://harleys.com/">harleys.com</a>
          </nav>
        </div>
      </footer>

      <div className="bar" hidden={!kind && !lines.length}>
        <div className="bar-in">
          {step === 0
            ? <button className="btn cart" disabled={!lines.length} onClick={() => setCartOpen(true)}>🛍 {plural(itemCount, 'item')}</button>
            : <button className="btn ghost" onClick={() => history.back()}>Back</button>}
          {nav}
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      {cartOpen && (
        <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && setCartOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Your order">
            <div className="body">
              <h2>Your order</h2>
              {lines.map((line, i) => (
                <div className="line" key={i}>
                  <div><b>{line.name}</b><small>{details(line)}</small></div>
                  <Qty line={line} set={(qty) => setLines((all) => qty < (line.min ?? 1) ? all.filter((_, j) => j !== i) : all.map((l, j) => j === i ? { ...l, qty } : l))} />
                </div>
              ))}
            </div>
            <div className="foot">
              <button className="btn ghost" onClick={() => setCartOpen(false)}>Add more</button>
              <button className="btn" style={{ flex: 1 }} disabled={!lines.length} onClick={() => go(1)}>Your details →</button>
            </div>
          </div>
        </div>
      )}

      {sheet && catalog && (
        <ItemSheet
          key={`${sheet.index}-${sheet.product?.id}`}
          sections={catalog}
          product={sheet.product}
          section={sheet.section}
          line={sheet.index === null ? null : lines[sheet.index]}
          onClose={() => setSheet(null)}
          onDone={(line) => {
            setLines((all) => sheet.index === null ? (line ? [...all, line] : all)
              : line ? all.map((l, i) => i === sheet.index ? line : l) : all.filter((_, i) => i !== sheet.index));
            if (line && sheet.index === null) setToast(`Added ${line.name}`);
            setSheet(null);
            setError('');
          }}
        />
      )}
    </>
  );
}

const findProduct = (catalog: Section[] | null, id: number | null) =>
  catalog?.flatMap((s) => s.products).find((p) => p.id === id) ?? null;

const details = (line: Line) => [
  line.summary,
  line.photos.length ? plural(line.photos.length, 'photo') : '',
].filter(Boolean).join(' · ');

function Qty({ line, set }: { line: Line; set: (qty: number) => void }) {
  return (
    <span className="qty">
      <button aria-label={line.qty <= (line.min ?? 1) ? 'Remove' : 'Less'} onClick={() => set(Number(fmt(line.qty - (line.step ?? 1))))}>{line.qty <= (line.min ?? 1) ? '×' : '−'}</button>
      {fmt(line.qty)}
      <button aria-label="More" onClick={() => set(Number(fmt(line.qty + (line.step ?? 1))))}>+</button>
    </span>
  );
}

function CartLine({ line, onOpen }: { line: Line; onOpen: () => void }) {
  return (
    <button className="line" onClick={onOpen}>
      <div><b>{line.qty} × {line.name}</b><small>{details(line)}</small></div>
    </button>
  );
}

/** One item: quantity, the section's customisation (starting from the basics), notes and photos. */
function ItemSheet({ sections, product, section: given, line, onClose, onDone }: {
  sections: Section[]; product: Product | null; section: Section | null; line: Line | null;
  onClose: () => void; onDone: (line: Line | null) => void;
}) {
  const [section, setSection] = useState(given);
  const [name, setName] = useState(line?.custom_name ?? '');
  const min = product?.min_qty || 1;
  const step = product?.qty_step || 1;
  const [qty, setQty] = useState(line?.qty ?? min);
  const [notes, setNotes] = useState(line?.notes ?? '');
  const [photos, setPhotos] = useState<string[]>(line?.photos ?? []);
  const [missing, setMissing] = useState('');
  const sizes = useMemo(() => (product?.variants ?? []).filter((v) => v.kg !== null), [product]);
  const weighs = (o: Option) => o.type === 'number' && o.unit.toLowerCase() === 'kg';
  const start = (options: Option[]): Values => Object.fromEntries(options.flatMap((o) => {
    if (o.type !== 'number') return [];
    const first = (weighs(o) ? sizes[0]?.kg : null) ?? o.choices.map(Number).find((n) => n > 0) ?? (o.step || 1);
    return [[o.key, first]];
  }));
  const [values, setValues] = useState<Values>(() => line?.options ?? start(product?.options ?? given?.options ?? []));
  const set = (key: string, value: string | number | boolean) => setValues((old) => ({ ...old, [key]: value }));
  const options = (product && section?.id === given?.id ? product.options : null) ?? section?.options ?? [];
  const message = Object.entries(values).find(([key, v]) => /message|topper/.test(key) && typeof v === 'string' && v)?.[1] as string | undefined;

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, [onClose]);

  const done = () => {
    if (!product && !name.trim() && !section) return setMissing('Tell us what it is, or pick the closest type.');
    const title = product?.name ?? (name.trim() || `Custom ${section!.name}`);
    const need = options.filter((o) => o.required && (values[o.key] === undefined || values[o.key] === '')).map((o) => o.label);
    if (need.length) return setMissing(`Choose ${need.join(', ')}.`);
    const kg = options.filter(weighs).map((o) => Number(values[o.key]))[0];
    const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== false && v !== undefined));
    const summary = options.filter((o) => o.key in kept).map((o) => {
      const v = kept[o.key];
      if (v === true) return o.label;
      if (weighs(o)) return sizes.find((s) => s.kg === Number(v))?.name ?? `${fmt(Number(v))} kg`;
      return o.type === 'number' ? `${o.label}: ${fmt(Number(v))}${o.unit && ` ${o.unit}`}` : String(v);
    }).join(' · ');
    onDone({
      product_id: product?.id ?? null, section_id: section?.id ?? null, custom_name: product ? '' : title, name: title, variant_id: sizes.find((v) => v.kg === kg)?.id ?? null, image: !!product?.image,
      qty, notes: notes.trim(), photos, options: kept, summary, min, step,
    });
  };

  const addPhotos = async (files: FileList | null) => {
    const added = await Promise.all([...(files ?? [])].slice(0, 5 - photos.length).map(shrink));
    setPhotos((old) => [...old, ...added]);
  };

  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet wide" role="dialog" aria-label={product?.name ?? 'Your own idea'}>
        <div className="hero-img">
          {photos[0] && !product ? <img src={`data:image/jpeg;base64,${photos[0]}`} alt="" /> : <Picture id={product?.id} image={product?.image} size={1024} />}
          {message && <div className="topper">{message}</div>}
          <button className="close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-main">
          <div className="body">
            {product ? (
              <>
                {section && <div className="eyebrow">{section.name}</div>}
                <h2 style={{ margin: '4px 0' }}>{product.name}</h2>
                {product.description && <p className="hint">{product.description}</p>}
              </>
            ) : (
              <>
                <h2>Your own idea</h2>
                <label className="field">What is it?
                  <input className="input" placeholder="e.g. 3-tier wedding cake, logo cookies" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field">Type<span className="hint">Pick the closest one, or name it above (either is enough).</span>
                  <select className="input" value={section?.id ?? ''} onChange={(e) => {
                    const next = sections.find((s) => s.id === Number(e.target.value)) ?? null;
                    setSection(next);
                    setValues((old) => ({ ...start(next?.options ?? []), ...old }));
                  }}>
                    <option value="">None</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              </>
            )}

            <div className="field">Quantity
              <div className="stepper">
                <button aria-label="Less" disabled={qty <= min} onClick={() => setQty(Math.max(min, Number(fmt(qty - step))))}>−</button>
                <output>{fmt(qty)}</output>
                <button aria-label="More" onClick={() => setQty(Number(fmt(qty + step)))}>+</button>
              </div>
            </div>

            {options.map((o) => <OptionField key={o.key} option={o} value={values[o.key]} set={(v) => set(o.key, v)} sizes={weighs(o) ? sizes : []} />)}

            <label className="field">Notes
              <textarea className="input" placeholder="Anything else about this item" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="field">Reference photos (up to 5)
              <div className="photos">
                {photos.map((p, i) => <img key={i} src={`data:image/jpeg;base64,${p}`} alt={`Photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))} title="Tap to remove" />)}
                {photos.length < 5 && (
                  <label className="photo-add">+<input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} hidden /></label>
                )}
              </div>
            </div>
            {missing && <div className="error" role="alert">{missing}</div>}
          </div>
          <div className="foot">
            {line && <button className="btn ghost" onClick={() => onDone(null)}>Remove</button>}
            <button className="btn" style={{ flex: 1 }} onClick={done}>{line ? 'Update item' : `Add ${qty > 1 ? `${qty} ` : ''}to order`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionField({ option: o, value, set, sizes }: { option: Option; value: Values[string] | undefined; set: (v: string | number | boolean) => void; sizes: Size[] }) {
  const label = `${o.label}${o.required ? ' *' : ''}`;
  const hint = o.hint && <span className="hint">{o.hint}</span>;
  const [typedColours, setTypedColours] = useState(() => o.type === 'colours'
    ? String(value ?? '').split(', ').filter((p) => p && !o.choices.some((c) => swatch(c).name === p)).join(', ') : '');

  switch (o.type) {
    case 'number': {
      const n = Number(value) || 0;
      const step = o.step || 1;
      const size = sizes.find((v) => v.kg === n);
      return (
        <div className="field">{label}{hint}
          <div className="chips" style={{ marginTop: 8 }}>
            {(sizes.length ? sizes.map((v) => ({ label: v.name, n: v.kg! })) : o.choices.map((ch) => ({ label: `${ch}${o.unit && ` ${o.unit}`}`, n: Number(ch) })))
              .map((pick) => <button key={pick.label} className="chip" aria-pressed={pick.n === n} onClick={() => set(pick.n)}>{pick.label}</button>)}
          </div>
          <div className="stepper">
            <button aria-label="Less" disabled={n <= step} onClick={() => set(Math.max(step, n - step))}>−</button>
            <output>{fmt(n)}{o.unit && ` ${o.unit}`}</output>
            <button aria-label="More" onClick={() => set(n + step)}>+</button>
          </div>
          {sizes.length > 0 && <span className="hint">{size ? `${size.name} · SKU ${size.sku}` : 'Custom size: made to order'}</span>}
        </div>
      );
    }
    case 'colours': {
      const picked = String(value ?? '').split(', ').filter((p) => o.choices.some((c) => swatch(c).name === p));
      const save = (names: string[], typed: string) => set([...names, typed.trim()].filter(Boolean).join(', '));
      return (
        <div className="field">{label}{hint}
          <div className="swatches" role="group" aria-label={o.label}>
            {o.choices.map(swatch).map(({ name, color }) => (
              <button key={name} className="swatch" style={{ background: color }} title={name} aria-label={name} aria-pressed={picked.includes(name)}
                onClick={() => save(picked.includes(name) ? picked.filter((p) => p !== name) : [...picked, name], typedColours)} />
            ))}
          </div>
          {picked.length > 0 && <span className="hint">{picked.join(', ')}</span>}
          <input className="input" placeholder="Type the theme or another colour" value={typedColours}
            onChange={(e) => { setTypedColours(e.target.value); save(picked, e.target.value); }} />
        </div>
      );
    }
    case 'choice':
      if (o.choices.length > CHIP_LIMIT) {
        return (
          <label className="field">{label}{hint}
            <input className="input" list={`list-${o.key}`} placeholder={o.allow_custom ? 'Pick or type one' : 'Pick one'} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
            <datalist id={`list-${o.key}`}>{o.choices.map((ch) => <option key={ch} value={ch} />)}</datalist>
          </label>
        );
      }
      return (
        <div className="field">{label}{hint}
          <div className="chips" style={{ marginTop: 6 }}>
            {o.choices.map((ch) => <button key={ch} className="chip" aria-pressed={value === ch} onClick={() => set(value === ch ? '' : ch)}>{ch}</button>)}
          </div>
          {o.allow_custom && <input className="input" placeholder="Or type one" value={o.choices.includes(String(value ?? '')) ? '' : String(value ?? '')} onChange={(e) => set(e.target.value)} />}
        </div>
      );
    case 'multi': {
      const chosen = String(value ?? '').split(', ').filter(Boolean);
      return (
        <div className="field">{label}{hint}
          <div className="chips" style={{ marginTop: 6 }}>
            {o.choices.map((ch) => <button key={ch} className="chip" aria-pressed={chosen.includes(ch)}
              onClick={() => set((chosen.includes(ch) ? chosen.filter((x) => x !== ch) : [...chosen, ch]).join(', '))}>{ch}</button>)}
          </div>
        </div>
      );
    }
    case 'yes_no':
      return (
        <label className="field check">
          <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} />{label}
        </label>
      );
    default:
      return (
        <label className="field">{label}{hint}
          <input className="input" maxLength={o.max_length || undefined} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
          {o.max_length > 0 && <span className="hint">{String(value ?? '').length} / {o.max_length}</span>}
        </label>
      );
  }
}
