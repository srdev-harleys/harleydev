import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeDashboard, TABS, type Dashboard, type Workbook } from './compute';

// Where the Hygiene Audit dashboard gets its data, where it keeps it, and how it learns about
// edits (the flow is drawn in README.md). Stateless per request: the newest data lives in a store
// every server instance reads. It gets there by push (the sheet's Apps Script trigger POSTs each
// edit to /api/audit/webhook) and by pull (the CSV export of each tab of the link-shared sheet: on
// first load, on Refresh, and when the data is older than AUDIT_POLL_SECONDS).
//
// Rules that keep it from ever going backwards or blank:
//   - data only moves forward: a pull that started before the stored data was read is dropped, a
//     push older than the newest push is dropped (Apps Script sends `sentAt`), and pulls pause for
//     a minute after a push because the CSV export can trail an edit by a few seconds;
//   - only one pull at a time across all instances (a lease in the store);
//   - a failed read or a crash in the calculation keeps the last good numbers and reports the
//     error in the status bar; the store keeps them across restarts;
//   - the store down: pages read the sheet directly (or keep this instance's last copy) until it
//     is back; only live pushes wait;
//   - `version` is a hash of the numbers, so equal data has the same version everywhere.

const SHEET_ID = process.env.AUDIT_SHEET_ID || ''; // set per deployment: the repository is public, the sheet is link-shared
const POLL_SECONDS = Math.max(10, Number(process.env.AUDIT_POLL_SECONDS) || 30);
const PUSH_QUIET_MS = 60_000;
const OUT_OF_ORDER_MS = 120_000; // a push is in flight for at most ~1 min (UrlFetchApp's timeout)
const LEASE_MS = 60_000;
const TIMEOUT_MS = 15_000;
const MAX_TAB_ROWS = 5000;
const MAX_COLS = 80;

// ---------------------------------------------------------------- the store
//
//   redis  Upstash Redis over its REST API (plain fetch, no client library). Used when
//          KV_REST_API_URL + KV_REST_API_TOKEN (what Vercel's Upstash integration sets) or
//          UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. Required on Vercel, where
//          each request can run on a different instance.
//   file   otherwise: .data/audit-<sheet id>.json (or AUDIT_STORE_FILE). For one local server
//          (`next dev` / `next start`); it survives restarts and reboots.
//
// Two records. `meta` holds small string fields and is read on every status check. `data` holds
// the workbook and the computed dashboard (~290 KB of JSON, ~25 KB gzipped) and is read only when
// the version changes. Both are written in one transaction.

type Meta = Record<string, string>;
type Store = {
  kind: 'redis' | 'file';
  meta(): Promise<Meta>;
  data<T>(): Promise<T | null>;
  write(fields: Meta, data?: unknown): Promise<void>;
  /** true when this caller may read the sheet now; at most one holder until release() or `ms` pass */
  lease(ms: number): Promise<boolean>;
  release(): Promise<void>;
};

function openStore(): Store {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url.replace(/\/+$/, ''), token, `audit:${SHEET_ID}:`);
  if (process.env.VERCEL) {
    console.warn('[audit] No Upstash Redis configured: each Vercel instance keeps its own copy, so sheet pushes reach only some pages. Add the Upstash integration (KV_REST_API_URL / KV_REST_API_TOKEN).');
  }
  // Vercel's disk is read-only except /tmp
  return fileStore(process.env.AUDIT_STORE_FILE || join(process.env.VERCEL ? tmpdir() : join(process.cwd(), '.data'), `audit-${SHEET_ID}.json`));
}

function redisStore(url: string, token: string, prefix: string): Store {
  const key = { meta: `${prefix}meta`, data: `${prefix}data`, lease: `${prefix}pull` };
  async function call(path: '' | '/multi-exec', body: unknown) {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => null);
    const failed = !res.ok || !json || json.error || (Array.isArray(json) && json.find((r: { error?: string }) => r.error)?.error);
    if (failed) throw new Error(`Redis did not accept the request (HTTP ${res.status}${typeof failed === 'string' ? `: ${failed}` : ''})`);
    return json;
  }
  return {
    kind: 'redis',
    async meta() {
      const flat: string[] = (await call('', ['HGETALL', key.meta])).result || [];
      const meta: Meta = {};
      for (let i = 0; i + 1 < flat.length; i += 2) meta[flat[i]] = flat[i + 1];
      return meta;
    },
    async data<T>() {
      const packed: string | null = (await call('', ['GET', key.data])).result;
      return packed ? (JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8')) as T) : null;
    },
    async write(fields, data) {
      const commands: string[][] = [];
      if (data !== undefined) commands.push(['SET', key.data, gzipSync(JSON.stringify(data)).toString('base64')]);
      if (Object.keys(fields).length) commands.push(['HSET', key.meta, ...Object.entries(fields).flat()]);
      if (commands.length) await call('/multi-exec', commands);
    },
    lease: async (ms) => (await call('', ['SET', key.lease, '1', 'NX', 'PX', String(ms)])).result === 'OK',
    release: async () => { await call('', ['DEL', key.lease]); },
  };
}

type FileState = { meta: Meta; data: unknown };

function fileStore(path: string): Store {
  // kept on globalThis so a dev hot reload of this file keeps the same state and write queue
  const g = globalThis as typeof globalThis & { __auditFileStores?: Record<string, { state: Promise<FileState>; saving: Promise<void>; leaseUntil: number }> };
  const own = ((g.__auditFileStores ??= {})[path] ??= {
    state: readFile(/*turbopackIgnore: true*/ path, 'utf8')
      .then((text) => JSON.parse(text) as FileState)
      .catch(() => ({ meta: {}, data: null })),
    saving: Promise.resolve(),
    leaseUntil: 0,
  });
  // writes go one after another, each one saving the whole current state
  const save = () => {
    own.saving = own.saving
      .then(async () => {
        const tmp = `${path}.${process.pid}.tmp`;
        await mkdir(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
        await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(await own.state));
        await rename(/*turbopackIgnore: true*/ tmp, path);
      })
      .catch((err) => console.warn('[audit] could not save', path, (err as Error).message));
    return own.saving;
  };
  return {
    kind: 'file',
    meta: async () => ({ ...(await own.state).meta }),
    data: async <T>() => (await own.state).data as T | null,
    async write(fields, data) {
      const state = await own.state;
      Object.assign(state.meta, fields);
      if (data !== undefined) state.data = data;
      await save();
    },
    async lease(ms) {
      if (Date.now() < own.leaseUntil) return false;
      own.leaseUntil = Date.now() + ms;
      return true;
    },
    release: async () => { own.leaseUntil = 0; },
  };
}

const store = openStore();

// ---------------------------------------------------------------- status and saving

type Edit = { tab: string; range: string; value?: string; oldValue?: string; user?: string; at: string };
type SyncSource = 'pull' | 'push' | 'refresh';
type Data = { version: string; workbook: Workbook; dashboard: Dashboard; gids: Record<string, number> };

export class SheetError extends Error {
  kind: 'not_public' | 'unreachable' | 'bad_response';
  constructor(kind: SheetError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

const num = (v?: string) => Number(v) || 0;
const hash = (dashboard: Dashboard) => createHash('sha256').update(JSON.stringify(dashboard)).digest('hex').slice(0, 16);
const iso = (v?: string) => (num(v) ? new Date(num(v)).toISOString() : null);
const sheetInfo = (gids: Record<string, number>) => ({ id: SHEET_ID, url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, gids });

function toStatus(meta: Meta, version = meta.version) {
  let lastEdit: Edit | null = null;
  try { lastEdit = meta.lastEdit ? JSON.parse(meta.lastEdit) : null; } catch { /* unreadable: leave it out */ }
  return {
    version: version || '', // hash of the numbers
    dataAt: iso(meta.dataMs), // when the data was read from the sheet
    updatedAt: iso(meta.updatedAt), // when the numbers last changed
    checkedAt: iso(meta.checkedAt), // when the sheet was last read or pushed
    source: (meta.source as SyncSource) || null, // what brought the last change
    lastEdit,
    lastPushAt: iso(meta.lastPushAt), // last time the sheet trigger called in
    pollSeconds: POLL_SECONDS,
    error: meta.error || null,
    storage: store.kind,
  };
}

// This instance's copy of the newest data: the data record is read only when the version changes.
const g = globalThis as typeof globalThis & { __auditData?: Data | null; __auditPull?: Promise<void> | null };

async function readData(meta: Meta): Promise<Data | null> {
  if (!meta.version) return null;
  if (g.__auditData?.version !== meta.version) g.__auditData = (await store.data<Data>()) ?? g.__auditData ?? null;
  return g.__auditData ?? null;
}

// Every new reading of the sheet goes through here.
async function save(workbook: Workbook, source: SyncSource, dataMs: number, opts: { gids: Record<string, number>; sentMs?: number | null; edit?: Edit }) {
  const now = Date.now();
  const meta = await store.meta();
  if (dataMs < num(meta.dataMs)) return { changed: false, version: meta.version || '', ignored: 'older' as const };
  if (opts.sentMs != null && opts.sentMs < num(meta.lastSentMs) && now - num(meta.lastPushMs) < OUT_OF_ORDER_MS) {
    return { changed: false, version: meta.version || '', ignored: 'out_of_order' as const };
  }
  let dashboard: Dashboard;
  try {
    dashboard = computeDashboard(workbook);
  } catch (err) {
    console.error('[audit] calculation failed; keeping the last good numbers', err);
    await store.write({ error: `The sheet has something the dashboard cannot read (${(err as Error).message}). Showing the last good numbers.`, checkedAt: String(now) });
    return { changed: false, version: meta.version || '', ignored: 'calculation' as const };
  }
  const version = hash(dashboard);
  const changed = version !== meta.version;
  const fields: Meta = { version, dataMs: String(dataMs), checkedAt: String(now), error: '' };
  if (changed) Object.assign(fields, { updatedAt: String(now), source });
  if (opts.edit) fields.lastEdit = JSON.stringify(opts.edit);
  if (source === 'push') Object.assign(fields, { lastPushMs: String(now), lastPushAt: String(now), lastSentMs: String(opts.sentMs ?? '') });
  const data: Data = { version, workbook, dashboard, gids: opts.gids };
  const gidsChanged = JSON.stringify(opts.gids) !== JSON.stringify(g.__auditData?.gids);
  // ponytail: check-then-write, not one atomic step across instances. Pulls hold a lease and the
  // trigger sends one push at a time, so only a pull and a push finishing in the same instant can
  // race; the next pull repairs it within a minute or two. Upgrade path: one Redis EVAL script.
  await store.write(fields, changed || gidsChanged ? data : undefined);
  g.__auditData = data;
  return { changed, version };
}

// ---------------------------------------------------------------- pull (CSV export)

// RFC 4180 CSV -> rows of strings (quoted fields may hold commas, quotes and newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function get(url: string, attempt = 1): Promise<string> {
  // Google occasionally drops one of the parallel connections: retry before giving up
  const retry = () => new Promise((r) => setTimeout(r, 400 * attempt)).then(() => get(url, attempt + 1));
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (attempt < 3) return retry();
    throw new SheetError('unreachable', `Google Sheets did not answer (${(err as Error).message})`);
  }
  const type = res.headers.get('content-type') || '';
  const sharedOff = res.status === 401 || res.status === 403 || (res.ok && url.includes('format=csv') && type.includes('text/html'));
  if (sharedOff) throw new SheetError('not_public', 'The sheet is no longer shared by link, so it can only update through the sheet trigger.');
  if (res.status >= 500 && attempt < 3) return retry();
  if (!res.ok) throw new SheetError('bad_response', `Google Sheets answered HTTP ${res.status}`);
  return res.text();
}

// Tab name -> gid, from the sheet's public htmlview page (tabs can be renamed or re-created).
async function discoverGids() {
  const html = await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`);
  const gids: Record<string, number> = {};
  for (const m of html.matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*?gid=(\d+)/g)) {
    try { gids[JSON.parse(`"${m[1]}"`)] = Number(m[2]); } catch { /* odd escape: skip that tab */ }
  }
  // a private sheet answers with Google's sign-in page, which has no tab list
  if (!Object.keys(gids).length) throw new SheetError('not_public', 'Could not list the sheet tabs. Is the sheet still shared as "Anyone with the link: Viewer"?');
  return gids;
}

// Entry tabs carry formulas down to row 1000 that show "0": drop those empty trailing rows (as the
// Apps Script push does), which keeps the stored copy about half the size.
function trimRows(rows: string[][]) {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => c === '' || c === '0')) end--;
  return rows.slice(0, end);
}

async function readSheet() {
  if (!SHEET_ID) throw new SheetError('unreachable', 'AUDIT_SHEET_ID is not set on the server, so there is no sheet to read.');
  const gids = await discoverGids();
  const names = Object.values(TABS).filter((n) => gids[n] != null);
  const tabs = await Promise.all(names.map(async (n) => [n, trimRows(parseCsv(await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gids[n]}`)))] as const));
  return { gids, workbook: Object.fromEntries(tabs) as Workbook };
}

// Reads the whole sheet and saves it. One at a time per instance, and across instances through the
// store's lease: a caller that finds the lease taken returns at once and serves the stored data.
function pull(source: SyncSource): Promise<void> {
  g.__auditPull ??= (async () => {
    let leased = false;
    try {
      leased = await store.lease(LEASE_MS);
      if (!leased) return;
      const startedMs = Date.now();
      const { gids, workbook } = await readSheet();
      await save(workbook, source, startedMs, { gids });
    } catch (err) {
      const message = err instanceof SheetError ? err.message : `Could not read the sheet: ${(err as Error).message}`;
      await store.write({ error: message, checkedAt: String(Date.now()) }).catch(() => { /* the store itself is down */ });
      throw err instanceof SheetError ? err : new SheetError('unreachable', message);
    } finally {
      if (leased) await store.release().catch(() => { /* expires by itself */ });
      g.__auditPull = null;
    }
  })();
  return g.__auditPull;
}

function wantsPull(meta: Meta, force: boolean) {
  if (!meta.version) return true; // nothing stored yet
  const now = Date.now();
  if (now - num(meta.lastPushMs) < PUSH_QUIET_MS) return false; // pushed tabs are newer than the CSV export
  return force || now - num(meta.checkedAt) > POLL_SECONDS * 1000;
}

export async function getDashboard(opts: { refresh?: boolean } = {}) {
  let meta: Meta;
  try {
    meta = await store.meta();
  } catch (err) {
    // the store is unreachable: read the sheet directly, or serve this instance's last copy
    const why = `Live data store unreachable (${(err as Error).message}).`;
    let data = g.__auditData;
    let shown = "this server's last copy";
    try {
      const { gids, workbook } = await readSheet();
      const dashboard = computeDashboard(workbook);
      data = g.__auditData = { version: hash(dashboard), workbook, dashboard, gids };
      shown = 'the sheet as read just now';
    } catch (readErr) {
      if (!data) throw readErr instanceof SheetError ? readErr : new SheetError('unreachable', why);
    }
    return { dashboard: data.dashboard, status: { ...toStatus({}, data.version), error: `${why} Showing ${shown}; live updates resume when it is back.` }, sheet: sheetInfo(data.gids) };
  }
  if (wantsPull(meta, !!opts.refresh)) {
    try {
      await pull(opts.refresh ? 'refresh' : 'pull');
    } catch (err) {
      if (!meta.version) throw err; // nothing at all to show yet
    }
    meta = await store.meta();
  }
  let data = await readData(meta);
  if (!data && meta.version) {
    // status without its data record (lost or evicted): read the sheet again
    await pull('pull').catch(() => { /* reported below */ });
    data = await readData((meta = await store.meta()));
  }
  if (!data) throw new SheetError('unreachable', meta.error || 'The sheet is being read right now. Try again in a few seconds.');
  return { dashboard: data.dashboard, status: toStatus(meta, data.version), sheet: sheetInfo(data.gids) };
}

/** For /api/audit/status: the status, and whether the sheet is due for a read (done after the reply). */
export async function getStatus() {
  const meta = await store.meta();
  return { status: toStatus(meta), due: wantsPull(meta, false) };
}

export const pullInBackground = () => pull('pull').catch(() => { /* reported through status.error */ });

// ---------------------------------------------------------------- webhook (Apps Script push)

export function checkSecret(header: string | null) {
  const secret = process.env.AUDIT_WEBHOOK_SECRET;
  if (!secret) return 'not_configured' as const;
  const given = createHash('sha256').update((header || '').replace(/^Bearer\s+/i, '')).digest();
  const want = createHash('sha256').update(secret).digest();
  return timingSafeEqual(given, want) ? 'ok' as const : 'forbidden' as const;
}

function asString(v: unknown, max = 500) {
  if (typeof v === 'string') return v.slice(0, max);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

export async function ingestPush(body: { tabs?: unknown; gids?: unknown; edit?: unknown; sentAt?: unknown }) {
  const now = Date.now();
  // sentAt = when the trigger read the sheet (Google's clock): only compared with other pushes.
  const sent = typeof body.sentAt === 'number' && Number.isFinite(body.sentAt) ? Math.min(body.sentAt, now + 5000) : null;
  const e = (body.edit && typeof body.edit === 'object' ? body.edit : {}) as Record<string, unknown>;
  const edit: Edit | undefined = e.tab || e.range
    ? { tab: asString(e.tab, 100) ?? '', range: asString(e.range, 50) ?? '', value: asString(e.value), oldValue: asString(e.oldValue), user: asString(e.user, 200), at: new Date(now).toISOString() }
    : undefined;

  const gids: Record<string, number> = {};
  if (body.gids && typeof body.gids === 'object') {
    for (const [k, v] of Object.entries(body.gids as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) gids[k] = v;
  }
  const tabs: Workbook = {};
  if (body.tabs && typeof body.tabs === 'object') {
    for (const name of Object.values(TABS)) {
      const rows = (body.tabs as Record<string, unknown>)[name];
      if (!Array.isArray(rows)) continue;
      tabs[name] = rows.slice(0, MAX_TAB_ROWS).map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLS).map((c) => asString(c, 2000) ?? '') : []));
    }
  }

  if (!Object.keys(tabs).length) {
    // a ping without data (the Connect test): note it and read the sheet now
    await store.write({ lastPushAt: String(now), ...(edit ? { lastEdit: JSON.stringify(edit) } : {}) });
    await pull('push').catch(() => { /* reported through status.error */ });
    return { changed: false, version: (await store.meta()).version || '', pulled: true };
  }
  const meta = await store.meta();
  const prev = await readData(meta);
  // received now, so it is newer than any pull that started before it, whatever the clocks say
  const dataMs = Math.max(now, num(meta.dataMs));
  const result = await save({ ...prev?.workbook, ...tabs }, 'push', dataMs, { gids: { ...prev?.gids, ...gids }, sentMs: sent, edit });
  return { ...result, pulled: false };
}
