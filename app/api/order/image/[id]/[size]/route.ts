import { callOdoo, errorResponse } from '@/lib/custom-orders';

// GET /api/order/image/12/512: a product photo, already sized by Odoo
export async function GET(_request: Request, ctx: RouteContext<'/api/order/image/[id]/[size]'>) {
  const { id, size } = await ctx.params;
  if (!/^\d+$/.test(id) || !['256', '512', '1024'].includes(size)) return Response.json({ error: 'bad_request' }, { status: 400 });
  try {
    const res = await callOdoo(`/image/${id}/${size}`);
    return new Response(res.body, {
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    });
  } catch (err) {
    return errorResponse('image', err);
  }
}
