import { callOdoo, errorResponse } from '@/lib/custom-orders';

// POST /api/order: a customer's order, checked here, then to Odoo as Awaiting Approval.
// Resending the same client_uuid answers the first order, so the page can retry safely.

const placed = new Map<string, number[]>(); // ip -> times; TODO: Vercel KV / Upstash once it runs on several instances
const PER_HOUR = 5;

type Line = { product_id?: number; variant_id?: number; custom_name?: string; section_id?: number; qty?: number;
  options?: Record<string, unknown>; notes?: string; photos?: string[] };
type Order = { consent?: boolean; map_url?: string; client_uuid?: string; order_type?: string; fulfilment?: string; pickup_warehouse_id?: number; expected_date?: string; expected_time?: string;
  occasion?: string; notes?: string; customer?: Record<string, string>; lines?: Line[] };

const short = (value: unknown, size: number) => (typeof value === 'string' ? value.trim().slice(0, size) : '');

function problem(order: Order): string | null {
  const c = order.customer ?? {};
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST
  if (!/^[a-f0-9-]{16,64}$/i.test(order.client_uuid ?? '')) return 'Reload the page and try again.';
  if (!short(c.name, 120)) return 'Enter your name.';
  if (order.consent !== true) return 'Please give your consent to continue.';
  if (!/^[6-9]\d{9}$/.test((c.phone ?? '').replace(/[\s-]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, ''))) return 'Enter a 10-digit mobile number.';
  if (c.pincode && !/^[1-9]\d{5}$/.test(c.pincode)) return 'Check the pincode.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.expected_date ?? '') || order.expected_date! < today) return 'Pick a date from today.';
  if (order.fulfilment === 'delivery' && !short(c.address, 500)) return 'Enter the delivery address.';
  const lines = order.lines ?? [];
  if (!lines.length || lines.length > 50) return 'Add at least one item.';
  for (const line of lines) {
    if (!line.product_id && !short(line.custom_name, 120)) return 'Name each item.';
    if (!(Number(line.qty) >= 1 && Number(line.qty) <= 10000)) return 'Check the quantities.';
    if ((line.photos ?? []).length > 5) return 'Up to 5 photos per item.';
  }
  return null;
}

export async function POST(request: Request) {
  const order = (await request.json().catch(() => null)) as Order | null;
  const wrong = order ? problem(order) : 'Bad request.';
  if (wrong) return Response.json({ error: 'invalid', message: wrong }, { status: 400 });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const recent = (placed.get(ip) ?? []).filter((at) => at > Date.now() - 3600_000);
  if (recent.length >= PER_HOUR) return Response.json({ error: 'too_many', message: 'Too many orders from here. Please call us.' }, { status: 429 });

  const c = order!.customer ?? {};
  try {
    const res = await callOdoo('/order', {
      timeout: 60_000,
      body: {
        client_uuid: order!.client_uuid,
        order_type: order!.order_type === 'bulk' ? 'bulk' : 'custom',
        fulfilment: order!.fulfilment === 'delivery' ? 'delivery' : 'pickup',
        pickup_warehouse_id: Number(order!.pickup_warehouse_id) || null, // Odoo keeps it only if it takes pickups
        consent: true,
        map_url: /^https:\/\//.test(order!.map_url ?? '') ? short(order!.map_url, 500) : '',
        expected_date: order!.expected_date,
        expected_time: short(order!.expected_time, 40),
        occasion: short(order!.occasion, 120),
        notes: short(order!.notes, 2000),
        customer: Object.fromEntries(['name', 'phone', 'email', 'pincode', 'area', 'city', 'district', 'state', 'address', 'landmark']
          .map((key) => [key, short(c[key], key === 'address' ? 500 : 120)])),
        lines: order!.lines!.map((line) => ({
          product_id: line.product_id || null, variant_id: line.variant_id || null, section_id: line.section_id || null,
          custom_name: short(line.custom_name, 120), qty: Number(line.qty), options: line.options ?? {},
          notes: short(line.notes, 2000), photos: (line.photos ?? []).filter((p) => typeof p === 'string'),
        })),
      },
    });
    const placedOrder = await res.json();
    placed.set(ip, [...recent, Date.now()]);
    console.info('[api/order] placed', placedOrder.name);
    return Response.json(placedOrder);
  } catch (err) {
    return errorResponse('place', err);
  }
}
