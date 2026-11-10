'use client';

import { useEffect, useState } from 'react';

const LINKS = [{ href: '#locations', label: 'Our cities' }];

export const Parcel = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="parcel">
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </svg>
);

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={`nav${scrolled ? ' nav--solid' : ''}${open ? ' nav--open' : ''}`}>
      <div className="nav__inner">
        <a href="#top" className="nav__brand" aria-label="Harley's Fine Baking — home">
          <img src="/assets/site/logo.png" alt="" width={44} height={44} />
          <span>
            <strong>HARLEY&apos;S</strong>
            <em>Fine Baking</em>
          </span>
        </a>

        <nav className="nav__links" aria-label="Main" id="site-menu">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a href="https://harleys.com" target="_blank" rel="noopener noreferrer">
            harleys.com
          </a>
          <a href="/order/track" className="nav__track">
            <Parcel /> Track order
          </a>
          <a href="/order" className="btn btn--rose nav__cta">
            Order custom / bulk
          </a>
        </nav>

        <a href="/order/track" className="nav__track nav__track--bar" aria-label="Track your order">
          <Parcel /> <span>Track</span>
        </a>

        <button
          type="button"
          className="nav__toggle"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
