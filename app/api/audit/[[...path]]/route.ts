import { after, NextResponse, type NextRequest } from 'next/server';
import { checkSecret, getDashboard, getStatus, ingestPush, pullInBackground, SheetError } from '@/lib/audit/source';

// The Hygiene Audit dashboard's API, one file for its three addresses:
//   GET  /api/audit          the dashboard, recomputed from the Google Sheet. ?refresh=1 reads the
//                            sheet now instead of using the last snapshot.
//   GET  /api/audit/status   its version and sync status (a few hundred bytes). Open pages poll it
//                            and fetch /api/audit only when the version changes. On Vercel the CDN
//                            answers repeat polls for a few seconds, so many open pages cost one
//                            function call per few seconds. When the data is older than
//                            AUDIT_POLL_SECONDS, the sheet is read after this reply is sent.
//   POST /api/audit/webhook  the sheet's Apps Script trigger (scripts/audit-sheet-trigger.gs).
//                            Authorization: Bearer <AUDIT_WEBHOOK_SECRET>.
//                            Body: { edit?, gids?, tabs?: { [tab]: string[][] } }.

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // a sheet read is ~3 s, up to ~45 s while Google retries
const MAX_BYTES = 4 * 1024 * 1024; // Vercel refuses bodies over 4.5 MB itself; a push is ~250 KB

type Context = { params: Promise<{ path?: string[] }> };
const pathOf = async ({ params }: Context) => (await params).path?.join('/') ?? '';
// an address this file has, asked with the other method: 405, as a route without that handler answers
const notHere = (path: string) => new NextResponse(null, { status: ['', 'status', 'webhook'].includes(path) ? 405 : 404 });
const error = (name: string, status: number, err?: unknown, headers?: HeadersInit) =>
  NextResponse.json(err ? { error: name, message: (err as Error).message } : { error: name }, { status, headers });

export async function GET(request: NextRequest, context: Context) {
  const path = await pathOf(context);
  try {
    if (path === 'status') {
      const { status, due } = await getStatus();
      if (due) after(pullInBackground);
      return NextResponse.json(status, { headers: { 'Cache-Control': 'public, s-maxage=4' } });
    }
    if (path) return notHere(path);
    const data = await getDashboard({ refresh: request.nextUrl.searchParams.get('refresh') === '1' });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`[api/audit${path && '/status'}]`, err);
    if (path) return error('store_unreachable', 502, err, { 'Cache-Control': 'no-store' });
    return error(err instanceof SheetError ? err.kind : 'unreachable', 502, err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const path = await pathOf(context);
  if (path !== 'webhook') return notHere(path);
  const auth = checkSecret(request.headers.get('authorization'));
  if (auth === 'not_configured') return error('not_configured', 503);
  if (auth === 'forbidden') return error('forbidden', 401);

  const text = await request.text();
  if (text.length > MAX_BYTES) return error('too_large', 413);
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return error('bad_json', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error('bad_body', 400);

  try {
    return NextResponse.json({ ok: true, ...(await ingestPush(body)) });
  } catch (err) {
    console.error('[api/audit/webhook]', err);
    return error('store_unreachable', 502, err);
  }
}
