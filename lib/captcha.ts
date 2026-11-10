import 'server-only';

// Google reCAPTCHA v2 ("I'm not a robot", free) on the order lookup. Keys from google.com/recaptcha/admin
// (type: reCAPTCHA v2, Checkbox); without RECAPTCHA_SECRET_KEY (local testing) every request passes.
const VERIFY = 'https://www.google.com/recaptcha/api/siteverify';

export async function captchaOk(token: unknown, request: Request): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  const body = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch(VERIFY, { method: 'POST', body, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    return Boolean((await res.json())?.success);
  } catch {
    return false; // Google unreachable: refuse rather than let bots through
  }
}

export const CAPTCHA_FAILED = { error: 'refused', message: 'Please tick "I\'m not a robot" and try again.' };
