import { callOdoo, errorResponse } from '@/lib/custom-orders';

// GET /api/order/pincode/560034: area, city, state and the nearest pickup outlet (a help only)
export async function GET(_request: Request, ctx: RouteContext<'/api/order/pincode/[pin]'>) {
  const { pin } = await ctx.params;
  if (!/^[1-9]\d{5}$/.test(pin)) return Response.json({ error: 'bad_pincode' }, { status: 400 });
  try {
    const res = await callOdoo(`/pincode/${pin}`, { timeout: 4_000 });
    return Response.json(await res.json(), { headers: { 'Cache-Control': 'public, s-maxage=86400' } });
  } catch (err) {
    return errorResponse('pincode', err);
  }
}
