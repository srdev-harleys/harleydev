import 'server-only';

// Server-side client for Odoo's Harley's Custom website API (module harleys_custom, /harleys/custom/v1/web).
// The portal token never leaves the server: the /order page only talks to /api/order/*.
// Without CUSTOM_ODOO_URL it answers from built-in sample data in development only; a deployed site
// without it says ordering isn't open (never fake order numbers for real customers).

export type OrderErrorKind = 'closed' | 'unreachable' | 'forbidden' | 'refused' | 'not_found';

export class OrderError extends Error {
  constructor(public kind: OrderErrorKind, message: string, public status = 502) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;

/** Calls Odoo and returns its Response (JSON or an image); Odoo's 403/404/409 become OrderErrors. */
export async function callOdoo(path: string, init: { body?: unknown; timeout?: number } = {}): Promise<Response> {
  const base = process.env.CUSTOM_ODOO_URL;
  if (!base) {
    if (process.env.NODE_ENV === 'production') throw new OrderError('closed', 'CUSTOM_ODOO_URL not set', 503);
    return mock(path, init.body);
  }
  const db = process.env.CUSTOM_ODOO_DB;
  let res: Response;
  try {
    res = await fetch(new URL(`/harleys/custom/v1/web${path}`, base), {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Portal-Token': process.env.CUSTOM_PORTAL_TOKEN ?? '',
        'ngrok-skip-browser-warning': '1',
        ...(db ? { 'X-Odoo-Database': db } : {}),
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeout ?? TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    throw new OrderError('unreachable', `Odoo did not answer: ${(err as Error).message}`);
  }
  if (res.ok) return res;
  const message = await res.json().then((data) => String(data?.error ?? ''), () => '');
  if (res.status === 403) throw new OrderError('forbidden', 'Odoo refused the portal token');
  if (res.status === 404) throw new OrderError('not_found', message || 'Not found', 404);
  if (res.status === 409) throw new OrderError('refused', message || 'Odoo refused the order', 409);
  throw new OrderError('unreachable', `Odoo answered HTTP ${res.status}`);
}

/** The route's answer for a failed call: Odoo's own message for refused data, a kind otherwise. */
export function errorResponse(where: string, err: unknown): Response {
  const error = err instanceof OrderError ? err : new OrderError('unreachable', String(err));
  console.error(`[api/order/${where}]`, error.kind); // never the customer's details
  return Response.json({ error: error.kind, message: error.kind === 'refused' ? error.message : undefined }, { status: error.status });
}

// -- sample data (no CUSTOM_ODOO_URL) ------------------------------------------

const SAMPLE = {
  contact_phone: '+91 80830 98888',
  sections: [
    {
      id: 1, name: 'Cakes', order_type: 'custom', lead_hours: 48,
      options: [
        { key: 'weight', label: 'Weight', type: 'number', unit: 'kg', step: 0.5, choices: ['0.5', '1', '1.5', '2'], required: true, allow_custom: false, max_length: 0, hint: '' },
        { key: 'tiers', label: 'Tiers', type: 'number', unit: '', step: 1, choices: [], required: false, allow_custom: false, max_length: 0, hint: '' },
        { key: 'flavour', label: 'Flavour', type: 'choice', choices: ['Honey', 'Lotus Biscoff', 'Belgium Chocolate'], allow_custom: true, required: false, unit: '', step: 1, max_length: 0, hint: '' },
        { key: 'theme', label: 'Theme / colours', type: 'colours', choices: ['White #FFFFFF', 'Pink #EC6F9B', 'Gold #D4AF37', 'Blue #2A62C9'], allow_custom: true, required: false, unit: '', step: 1, max_length: 0, hint: 'Tap the colours, and type the theme' },
        { key: 'message', label: 'Message on cake', type: 'text', max_length: 40, choices: [], required: false, allow_custom: false, unit: '', step: 1, hint: '' },
      ],
      products: [
        { id: 101, name: 'Lotus Biscoff Medovik Cake', image: false, description: '', sku: '',
          variants: [{ id: 1001, sku: '3201', name: '600 GM', kg: 0.6 }, { id: 1002, sku: '1714', name: '1 KG', kg: 1 }] },
        { id: 102, name: 'Honey Bento Cake', image: false, description: '', sku: '3006', variants: [] },
      ],
    },
    {
      id: 3, name: 'Macarons', order_type: 'bulk', lead_hours: 24,
      options: [{ key: 'box', label: 'Box', type: 'choice', choices: ['Box of 6', 'Box of 12'], required: false, allow_custom: false, unit: '', step: 1, max_length: 0, hint: '' }],
      products: [{ id: 201, name: 'French Macarons Assorted', image: false, description: '', sku: '5101', variants: [] }],
    },
  ],
};

function mock(path: string, body: unknown): Response {
  if (path === '/catalog') return Response.json(SAMPLE);
  if (path.startsWith('/pincode/')) {
    return Response.json({ pincode: path.slice(9), found: false, areas: [], city: '', district: '', state: '', outlet: null });
  }
  if (path.startsWith('/outlets')) {
    return Response.json([
      { id: 1, name: 'KA-BLR-Cloud FC Koramangala', code: 'BLR-KRM', area: 'Koramangala, Bengaluru', km: null },
      { id: 2, name: 'KA-BLR-Cloud FC Indira Nagar', code: 'BLR-IDN', area: 'Indiranagar, Bengaluru', km: null },
    ]);
  }
  if (path === '/order') {
    const uuid = String((body as { client_uuid?: string })?.client_uuid ?? 'sample');
    return Response.json({ name: 'CO/SAMPLE/00001', access_token: `sample-${uuid}`.padEnd(40, '0') });
  }
  if (path.startsWith('/order/')) {
    return Response.json({
      name: 'CO/SAMPLE/00001', state: 'submitted', state_label: 'Awaiting Approval', fulfilment: 'pickup',
      timeline: [{ state: 'submitted', label: 'Awaiting Approval', at: new Date().toISOString() },
        ...['approved', 'in_production', 'ready', 'picked_up'].map((state) => ({ state, label: state, at: null }))],
      expected_date: null, outlet: null, customer: { first_name: 'Sample', phone: '••••••0000' }, lines: [],
    });
  }
  throw new OrderError('not_found', 'Not in the sample data', 404);
}
