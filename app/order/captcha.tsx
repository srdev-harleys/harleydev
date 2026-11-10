'use client';

import { useEffect, useRef } from 'react';

// Google reCAPTCHA v2 checkbox: hands its token to the form. Nothing shows without NEXT_PUBLIC_RECAPTCHA_SITE_KEY.
// Change `round` after each send: a token works once.

declare global {
  interface Window {
    grecaptcha?: { ready: (cb: () => void) => void; render: (el: HTMLElement, opts: Record<string, unknown>) => number };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '';
let script: Promise<void> | null = null;

function load(): Promise<void> {
  script ??= new Promise((resolve, reject) => {
    const tag = Object.assign(document.createElement('script'), {
      src: 'https://www.google.com/recaptcha/api.js?render=explicit', async: true, defer: true,
    });
    tag.onload = () => window.grecaptcha!.ready(resolve);
    tag.onerror = () => { script = null; reject(new Error('captcha')); };
    document.head.appendChild(tag);
  });
  return script;
}

export const captchaOn = Boolean(SITE_KEY);

export default function Captcha({ onToken, round = 0 }: { onToken: (token: string) => void; round?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = box.current;
    if (!SITE_KEY || !host) return;
    let gone = false;
    onToken('');
    const el = document.createElement('div'); // a fresh element each round: reCAPTCHA renders once per element
    host.replaceChildren(el);
    load().then(() => {
      if (gone || !window.grecaptcha) return;
      window.grecaptcha.render(el, {
        sitekey: SITE_KEY, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken(''),
      });
    }).catch(() => undefined);
    return () => {
      gone = true;
      host.replaceChildren();
    };
  }, [onToken, round]);
  return SITE_KEY ? <div ref={box} className="captcha" /> : null;
}
