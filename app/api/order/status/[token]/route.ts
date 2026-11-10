import { callOdoo, errorResponse } from '@/lib/custom-orders';

// GET /api/order/status/<token>: the order's timeline, for its status page
export async function GET(_request: Request, ctx: RouteContext<'/api/order/status/[token]'>) {
  const { token } = await ctx.params;
  if (!/^[\w-]{32,}$/.test(token)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    return Response.json(await (await callOdoo(`/order/${token}`)).json(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse('status', err);
  }
}
