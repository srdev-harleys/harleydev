import { CAPTCHA_FAILED, captchaOk } from '@/lib/captcha';
import { callOdoo, errorResponse } from '@/lib/custom-orders';

// POST /api/order/track {lookup, captcha}: the customer's orders by mobile number or email (no sign-in yet),
// behind the captcha and a per-address limit so numbers can't be tried one after another.

const asked = new Map<string, number[]>(); // ip -> times; TODO: Vercel KV / Upstash once it runs on several instances
const PER_HOUR = 20;

export async function POST(request: Request) {
  const { lookup, captcha } = await request.json().catch(() => ({}));
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const recent = (asked.get(ip) ?? []).filter((at) => at > Date.now() - 3600_000);
  if (recent.length >= PER_HOUR) return Response.json({ error: 'too_many', message: 'Too many searches from here. Try again later.' }, { status: 429 });
  asked.set(ip, [...recent, Date.now()]);
  if (!(await captchaOk(captcha, request))) return Response.json(CAPTCHA_FAILED, { status: 400 });
  const text = typeof lookup === 'string' ? lookup.trim() : '';
  const phone = text.replace(/\D/g, '').slice(-10);
  const body = text.includes('@') ? { email: text } : phone.length === 10 ? { phone } : null;
  if (!body || text.length > 120) {
    return Response.json({ error: 'refused', message: 'Enter your 10-digit mobile number or your email.' }, { status: 409 });
  }
  try {
    return Response.json(await (await callOdoo('/track', { body })).json());
  } catch (err) {
    return errorResponse('track', err);
  }
}
