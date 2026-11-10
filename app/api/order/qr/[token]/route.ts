import { callOdoo, errorResponse } from '@/lib/custom-orders';

// GET /api/order/qr/<token>: the order's payment QR (a UPI QR for what is due now, or the account's own)
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^[\w-]{32,}$/.test(token)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    const res = await callOdoo(`/order/${token}/qr`);
    return new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'image/png', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse('qr', err);
  }
}
