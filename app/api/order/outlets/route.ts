import { callOdoo, errorResponse } from '@/lib/custom-orders';

// GET /api/order/outlets?pincode=560034: every pickup outlet, nearest to the pincode first
export async function GET(request: Request) {
  const pin = new URL(request.url).searchParams.get('pincode') ?? '';
  const query = /^[1-9]\d{5}$/.test(pin) ? `?pincode=${pin}` : '';
  try {
    const res = await callOdoo(`/outlets${query}`, { timeout: 6_000 });
    return Response.json(await res.json(), { headers: { 'Cache-Control': 'public, s-maxage=3600' } });
  } catch (err) {
    return errorResponse('outlets', err);
  }
}
