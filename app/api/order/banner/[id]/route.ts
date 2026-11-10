import { callOdoo, errorResponse } from '@/lib/custom-orders';

// GET /api/order/banner/3: a section's banner (Odoo: Harley's Custom > Configuration > Sections)
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: 'bad_request' }, { status: 400 });
  try {
    const res = await callOdoo(`/banner/${id}`);
    return new Response(res.body, {
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
    });
  } catch (err) {
    return errorResponse('banner', err);
  }
}
