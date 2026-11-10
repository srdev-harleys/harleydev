import { callOdoo, errorResponse } from '@/lib/custom-orders';

// POST /api/order/payment/<token> {amount, reference, photos}: the customer says they paid; Harley's checks it
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^[\w-]{32,}$/.test(token)) return Response.json({ error: 'not_found' }, { status: 404 });
  const { amount, reference, photos } = await request.json().catch(() => ({}));
  const shots = Array.isArray(photos) ? photos.filter((p) => typeof p === 'string').slice(0, 3) : [];
  if (!(Number(amount) > 0) || (typeof reference === 'string' && reference.length > 60)) {
    return Response.json({ error: 'refused', message: 'Enter the amount you paid.' }, { status: 409 });
  }
  try {
    const body = { amount: Number(amount), reference: typeof reference === 'string' ? reference : '', photos: shots };
    return Response.json(await (await callOdoo(`/order/${token}/payment`, { body, timeout: 30_000 })).json());
  } catch (err) {
    return errorResponse('payment', err);
  }
}
