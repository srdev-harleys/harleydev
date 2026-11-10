import { callOdoo, errorResponse } from '@/lib/custom-orders';

// GET /api/order/catalog: sections, their options and products (with SKUs and sizes)
export async function GET() {
  try {
    const res = await callOdoo('/catalog');
    return Response.json(await res.json(), { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } });
  } catch (err) {
    return errorResponse('catalog', err);
  }
}
