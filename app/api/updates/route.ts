import { NextResponse, type NextRequest } from 'next/server';
import { fetchDailyUpdates, OdooError } from '@/lib/odoo';

// GET /api/updates?date=YYYY-MM-DD → every person's MoM/EOD for that day (today, IST, when omitted)
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date') || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }
  try {
    const data = await fetchDailyUpdates(date);
    return NextResponse.json(data, {
      // short CDN cache: a page refresh storm stays off the tunnel, edits still show within a minute
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (err) {
    const kind = err instanceof OdooError ? err.kind : 'unreachable';
    console.error('[api/updates]', err);
    return NextResponse.json({ error: kind }, { status: 502 });
  }
}
