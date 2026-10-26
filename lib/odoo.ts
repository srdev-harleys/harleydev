import 'server-only';

// Server-side client for the inhouse Odoo's /harleys/daily-updates endpoint (harleys_customization).
// The token never leaves the server; the browser only ever talks to /api/updates.

export type OdooErrorKind = 'not_configured' | 'unreachable' | 'forbidden' | 'bad_response';

export class OdooError extends Error {
  constructor(public kind: OdooErrorKind, message: string) {
    super(message);
  }
}

export type Report = { text: string | null; source: 'saved' | 'live' | 'none' | 'error'; at?: string };

// shapes of Odoo's own project.task.retrieve_my_dashboard() / retrieve_my_charts(), passed through as-is
type MyDashboard = Record<string, number | null>;
type MyCharts = {
  by_stage: { id: number | false; count: number; label: string }[];
  activity: { date: string; closed: number; open: number; start: string; end: string }[];
  recent: { task_id: number; ref: string; name: string; old: string; new: string; date: string; author: string }[];
};

export type DailyUpdates = {
  date: string;
  today: string;
  ai_enabled: boolean;
  pipeline: { key: string; stage: string; count: number; by_person: Record<string, number> }[];
  to_production: { ref: string; name: string; from: string; by: string; date: string }[];
  people: {
    user_id: number;
    name: string;
    day: { planned: number; done: number; carried: number };
    dashboard: MyDashboard | null;
    charts: MyCharts | null;
    eod: Report;
    mom: Report;
  }[];
};

const TIMEOUT_MS = 10_000; // a dead ngrok tunnel must fail fast, not hang the page

export async function fetchDailyUpdates(date?: string): Promise<DailyUpdates> {
  const base = process.env.ODOO_URL;
  const token = process.env.HARLEYS_PORTAL_TOKEN;
  if (!base || !token) throw new OdooError('not_configured', 'ODOO_URL / HARLEYS_PORTAL_TOKEN not set');

  const url = new URL('/harleys/daily-updates', base);
  if (date) url.searchParams.set('date', date);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'X-Portal-Token': token, 'ngrok-skip-browser-warning': '1' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    throw new OdooError('unreachable', `Odoo did not answer: ${(err as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new OdooError('forbidden', 'Odoo rejected the portal token');
  if (!res.ok) throw new OdooError(res.status >= 500 ? 'unreachable' : 'bad_response', `Odoo answered HTTP ${res.status}`);
  try {
    return (await res.json()) as DailyUpdates;
  } catch {
    throw new OdooError('bad_response', 'Odoo answered with something that is not JSON');
  }
}
