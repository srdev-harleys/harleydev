// Hygiene Audit dashboard: turns the audit Google Sheet (display values per tab) into scores.
//
// It recomputes what the sheet's formulas compute, from the raw entries, and reports every place
// where the sheet's own cells disagree (Data health). For the month the Audit Summary is set to,
// the Summary's numbers (E:I) win, typed-over cells included, so the dashboard always shows what
// the sheet shows; other months, and outlets the Summary does not list, use the recomputation.
// Plain TypeScript with no imports, so `node lib/audit/audit.check.mjs` can run it directly.
//
// Sheet formulas mirrored here (Audit Summary row, for the month in C1 and the city in C2):
//   C  audits = COUNTUNIQUEIFS(entry dates) · E  audit score = SUMIFS(entry!Y) / C · F = E × 80%
//   G  rating = SUMIFS(Ratings!J) / 2 · H  OptiPulse = SUMIFS(OP!C) / 10 · I  total = F + G + H
//   J  rank = COUNTIFS(type, I > this) + 1, separately for Cloud Kitchen and PO
//   entry!Y    sum of the number inside each of the 18 "Compliant (n)" dropdowns E:V
//   Ratings!F  VLOOKUP into Sheet11 (weekly snapshots); G (31 Aug snapshot) and J (10 if the rating
//              went up, 5 if flat, 0 if down) are typed by hand
//   OP!B       VLOOKUP(OP!A, Sheet6!B:D, 3): OptiPulse location name -> POS name
//   OR         IMPORTRANGE of the company outlet repository: one row per brand per kitchen. No score
//              reads it; it feeds the outlet directory and links Sheet11 ratings that have no ODN.

export type Workbook = Record<string, string[][]>;

export const TABS = {
  summary: 'Audit Summary', cloud: 'Cloud-Audit Entry Report', po: 'PO-Audit Entry Report', supporting: 'Supporting',
  ratings: 'Ratings', weekly: 'Sheet11', op: 'OP', mapping: 'Sheet6', registry: 'OR',
} as const;

// What the Audit Summary formulas apply: E*80%, SUM(J)/2, OP/10.
const WEIGHTS = { audit: 80, rating: 10, optipulse: 10 };

// Highest option of each checkpoint dropdown (data validation on E:V), same on both entry tabs.
const CHECKPOINT_MAX = [3, 4, 5, 3, 5, 8, 4, 8, 7, 6, 7, 8, 6, 6, 5, 5, 5, 5];
const FIRST_CHECK_COL = 4; // E
const TOTAL_COL = 24; // Y
// OP columns E:P, in sheet order
const OP_FIELDS = ['kpt', 'highKpt', 'rwt', 'foodReady', 'inaccurate', 'unfulfilled', 'online', 'aov', 'rating', 'orders', 'revenue', 'lostRevenue'] as const;

type OutletType = 'Cloud Kitchen' | 'PO';
type Form = 'cloud' | 'po';
type Status = 'C' | 'P' | 'N';
type Severity = 'error' | 'warning' | 'info';
type Issue = { severity: Severity; title: string; detail: string; tab: string; cell?: string; outlet?: string; month?: string };
type Section = { name: string; weight: number; checkpoints: { label: string; max: number }[] };
type Snapshot = { date: string; rating: number };
type Geo = [number, number] | null;

type Audit = {
  id: string; form: Form; row: number; outlet: string; outletName: string; city: string;
  month: string | null; date: string | null; dateRaw: string; auditor: string; comments: string;
  items: { status: Status | null; points: number | null; max: number }[];
  sections: { points: number; max: number }[];
  total: number; sheetTotal: number | null; complete: boolean;
};

type RatingLine = { resId: string; aggregator: string; start: Snapshot | null; end: Snapshot | null; diff: number | null; score: number };

type MonthResult = {
  audits: string[]; auditAvg: number | null; auditPts: number | null; ratingPts: number; ratings: RatingLine[]; opPts: number;
  total: number | null;
  recomputed: number | null; // what the audit rows give; differs from total when the Summary was typed over
  rank: number | null; rankOf: number;
};

type OptiPulse = { location: string; score: number; tier: string } & Record<(typeof OP_FIELDS)[number], number | null>;

// One brand sold from a kitchen (a row of tab OR). outletType: Cloud Kitchen, QSR, Ivory Lounge;
// swiggy / zomato: the online status (Live, Disabled, NA, blank).
type Brand = { name: string; outletType: string; swiggyId: string; zomatoId: string; swiggy: string; zomato: string; hours: string; costForTwo: number | null; cuisine: string };

type Outlet = {
  key: string; name: string; short: string; type: OutletType; city: string; address: string; geo: Geo; brands: Brand[];
  board: boolean; // on the leaderboard: listed on the Audit Summary or audited
  listed: boolean; summaryRow: number | null;
  ratingSeries: { resId: string; aggregator: string; points: Snapshot[] }[];
  optipulse: OptiPulse | null;
  months: Record<string, MonthResult>;
};

export type Dashboard = {
  weights: typeof WEIGHTS; months: string[]; defaultMonth: string | null; cities: string[]; summaryMonth: string | null;
  sections: Record<Form, Section[]>; outlets: Outlet[]; audits: Audit[];
  optipulseDate: string | null; ratingDates: string[]; issues: Issue[];
};

// ---------------------------------------------------------------- small parsers

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const cell = (rows: string[][] | undefined, r: number, c: number) => (rows?.[r]?.[c] ?? '').trim();
const pad = (n: number) => String(n).padStart(2, '0');
const colName = (c: number): string => (c < 0 ? '?' : (c >= 26 ? colName(Math.floor(c / 26) - 1) : '') + String.fromCharCode(65 + (c % 26)));
const round2 = (n: number) => Math.round(n * 100) / 100;

function num(s: string): number | null {
  const t = s.replace(/[,₹%\s]/g, '');
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}

// "Harlye's  - HYD - Madhapur" and "Harley's - HYD - Madhapur" are the same outlet
const outletKey = (name: string) => name.toLowerCase().replace(/harlye/g, 'harley').replace(/[^a-z0-9]/g, '');
const shortName = (name: string) => name.replace(/^\s*harl\w*['’]?s\s*-\s*[a-z]+\s*-\s*/i, '').trim() || name.trim();

function validDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// "Sep 26", "September 2026", "9/1/2026", "2026-09-01" -> "2026-09"
export function parseMonth(s: string): string | null {
  const t = s.trim();
  let m = /^([a-z]{3,9})\.?[\s\-'’]*(\d{2}|\d{4})$/i.exec(t);
  if (m) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return mon ? `${y}-${pad(mon)}` : null;
  }
  m = /^(\d{4})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${pad(Number(m[2]))}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    // a month cell holds the 1st: whichever part is not 1 is the month; else read it US-style (m/d)
    const mon = a === 1 && b !== 1 ? b : a;
    return mon >= 1 && mon <= 12 ? `${m[3]}-${pad(mon)}` : null;
  }
  return null;
}

// Audit dates are typed dd-mm-yyyy, but the Date dropdown's first 12 entries were entered as
// mm-dd and Sheets stored them as 9 Jan..9 Dec. Use the reading that falls in the audit's month.
export function parseAuditDate(raw: string, month: string | null): { iso: string | null; note: 'swapped' | 'invalid' | 'outside_month' | null } {
  const t = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  const candidates: [number, number, number][] = [];
  if (m) {
    candidates.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  } else {
    m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(t);
    if (!m) return { iso: null, note: t ? 'invalid' : null };
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [a, b] = [Number(m[1]), Number(m[2])];
    candidates.push([y, b, a], [y, a, b]); // dd-mm first, then mm-dd
  }
  const valid = candidates.filter(([y, mo, d]) => validDate(y, mo, d));
  if (!valid.length) return { iso: null, note: 'invalid' };
  if (!month) return { iso: iso(...valid[0]), note: null };
  const idx = valid.findIndex(([y, mo]) => `${y}-${pad(mo)}` === month);
  if (idx < 0) return { iso: iso(...valid[0]), note: 'outside_month' };
  const picked = valid[idx];
  return { iso: iso(...picked), note: picked === candidates[0] ? null : 'swapped' };
}

const parseHeaderDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null);

// "26-Aug" (no year): the most recent such day not after `now`
function parseDayMonth(s: string, now: Date): string | null {
  const m = /^(\d{1,2})[\s\-]([a-z]{3})/i.exec(s.trim());
  if (!m) return parseHeaderDate(s);
  const mon = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  if (!mon) return null;
  let y = now.getUTCFullYear();
  if (iso(y, mon, Number(m[1])) > now.toISOString().slice(0, 10)) y -= 1;
  return iso(y, mon, Number(m[1]));
}

// "2026-09" or "2026-09-27" -> "Sep 2026"
function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
}
const dayLabel = (isoDate: string) => `${Number(isoDate.split('-')[2])} ${monthLabel(isoDate)}`;

function parseCheck(s: string): { status: Status | null; points: number | null } {
  const t = s.trim();
  if (!t) return { status: null, points: null };
  const n = /(\d+)/.exec(t);
  const status: Status | null = /non/i.test(t) ? 'N' : /partial/i.test(t) ? 'P' : /compliant/i.test(t) ? 'C' : null;
  return { status, points: n ? Number(n[1]) : null };
}

// ---------------------------------------------------------------- the sheet, tab by tab

// Columns of an entry tab, found by their header text so an inserted or moved column does not
// shift every checkpoint. The checkpoints are whatever sits between "Date" and "Visited BY".
type EntryLayout = {
  header: number; city: number; location: number; month: number; date: number;
  checks: number[]; maxes: number[]; auditor: number; comments: number; total: number;
};

const findCol = (row: string[] | undefined, re: RegExp) => (row ?? []).findIndex((c) => re.test((c ?? '').replace(/\s+/g, ' ').trim()));

function entryLayout(rows: string[][] | undefined, tab: string, issues: Issue[]): EntryLayout {
  const fixed: EntryLayout = {
    header: 2, city: 0, location: 1, month: 2, date: 3,
    checks: CHECKPOINT_MAX.map((_, i) => FIRST_CHECK_COL + i), maxes: CHECKPOINT_MAX,
    auditor: 22, comments: 23, total: TOTAL_COL,
  };
  if (!rows?.length) return fixed;
  const header = rows.slice(0, 10).findIndex((row) => findCol(row, /^location$/i) >= 0 && findCol(row, /^date$/i) >= 0);
  if (header < 0) {
    issues.push({ severity: 'warning', tab, title: `${tab}: header row not found`, detail: 'No row with "Location" and "Date" in the first 10 rows; reading the original column positions (A–Y).' });
    return fixed;
  }
  const h = rows[header];
  const date = findCol(h, /^date$/i);
  const auditor = findCol(h, /visited/i);
  const comments = findCol(h, /^comments?$/i);
  const total = findCol(h, /total/i);
  const end = [auditor, comments, total].filter((c) => c > date).sort((a, b) => a - b)[0] ?? date + 1 + CHECKPOINT_MAX.length;
  const checks = Array.from({ length: Math.max(0, end - date - 1) }, (_, i) => date + 1 + i);
  let maxes = CHECKPOINT_MAX;
  if (checks.length !== CHECKPOINT_MAX.length) {
    // the dropdown maxima are only known for the 18-column form; otherwise use the best score seen
    maxes = checks.map((c) => Math.max(1, ...rows.slice(header + 1).map((row) => parseCheck(row[c] ?? '').points ?? 0)));
    issues.push({ severity: 'warning', tab, title: `${tab}: ${checks.length} checkpoint columns, expected 18`,
      detail: 'Columns were added or removed between Date and Visited BY. Totals still add up the entries, but each checkpoint\'s maximum is estimated from the best score entered.' });
  }
  const or = (c: number, dflt: number) => (c >= 0 ? c : dflt); // header missing: its usual spot
  return {
    header, city: or(findCol(h, /^city$/i), 0), location: findCol(h, /^location$/i), month: or(findCol(h, /^month$/i), 2), date,
    checks, maxes, auditor: or(auditor, end), comments: or(comments, end + 1), total: or(total, end + 2),
  };
}

function readSections(rows: string[][] | undefined, layout: EntryLayout): Section[] {
  const sections: Section[] = [];
  layout.checks.forEach((c, i) => {
    const head = cell(rows, layout.header - 1, c);
    if (head || !sections.length) {
      const weight = num(/(\d+)\s*points/i.exec(head)?.[1] ?? '') ?? 0;
      sections.push({ name: head.split(/\n|\(/)[0].trim() || 'Checkpoints', weight, checkpoints: [] });
    }
    const label = cell(rows, layout.header, c).replace(/\s+/g, ' ') || `Checkpoint ${i + 1}`;
    sections[sections.length - 1].checkpoints.push({ label, max: layout.maxes[i] });
  });
  return sections;
}

function readAudits(rows: string[][] | undefined, form: Form, layout: EntryLayout, sections: Section[], tab: string, issues: Issue[]): Audit[] {
  const audits: Audit[] = [];
  const L = layout;
  for (let r = L.header + 1; r < (rows?.length ?? 0); r++) {
    const name = cell(rows, r, L.location);
    if (!name) continue;
    const month = parseMonth(cell(rows, r, L.month));
    const dateRaw = cell(rows, r, L.date);
    const date = parseAuditDate(dateRaw, month);
    const items = L.checks.map((c, i) => ({ ...parseCheck(cell(rows, r, c)), max: L.maxes[i] }));
    let offset = 0;
    const secs = sections.map((s) => {
      const slice = items.slice(offset, (offset += s.checkpoints.length));
      return { points: slice.reduce((a, it) => a + (it.points ?? 0), 0), max: s.checkpoints.reduce((a, c) => a + c.max, 0) };
    });
    const total = items.reduce((a, it) => a + (it.points ?? 0), 0);
    const blanks = items.filter((it) => it.points == null).length;
    const sheetTotal = L.total >= 0 ? num(cell(rows, r, L.total)) : null;
    const row = r + 1;
    const audit: Audit = {
      id: `${form}-${row}`, form, row, outlet: outletKey(name), outletName: name.replace(/\s+/g, ' '), city: cell(rows, r, L.city),
      month, date: date.iso, dateRaw, auditor: cell(rows, r, L.auditor), comments: cell(rows, r, L.comments),
      items, sections: secs, total, sheetTotal, complete: blanks === 0,
    };
    audits.push(audit);

    const base = { tab, outlet: audit.outlet, month: month ?? undefined };
    const who = `${shortName(name)} (row ${row})`;
    if (!month) issues.push({ ...base, severity: 'error', cell: `${colName(L.month)}${row}`, title: `${who}: no month`, detail: `Month "${cell(rows, r, L.month)}" can't be read, so this audit is not counted in any month.` });
    if (blanks) issues.push({ ...base, severity: 'warning', cell: `${colName(L.checks[0])}${row}:${colName(L.checks[L.checks.length - 1])}${row}`, title: `${who}: ${blanks} checkpoint${blanks > 1 ? 's' : ''} blank`, detail: 'The sheet\'s Total Points formula returns 0 when any checkpoint is blank. The dashboard adds up the filled ones.' });
    if (L.total >= 0 && sheetTotal !== total) {
      const why = sheetTotal == null
        ? 'The Total Points formula is missing on this row, so the Audit Summary counts this audit as 0.'
        : blanks ? 'A blank checkpoint makes the formula fall back to 0.' : 'The cell no longer matches its checkpoints.';
      issues.push({ ...base, severity: 'error', cell: `${colName(L.total)}${row}`, title: `${who}: Total Points shows ${sheetTotal ?? 'blank'}, checkpoints add up to ${total}`, detail: why });
    }
    if (date.note === 'swapped') issues.push({ ...base, severity: 'warning', cell: `${colName(L.date)}${row}`, title: `${who}: date ${dateRaw} has day and month swapped`, detail: `Sheets stores it as a date outside the audit month; the dashboard reads it as ${dayLabel(date.iso!)}. Cause: Supporting!H2:H13 were typed mm-dd and parsed as dd-mm.` });
    else if (date.note === 'invalid') issues.push({ ...base, severity: 'error', cell: `${colName(L.date)}${row}`, title: `${who}: "${dateRaw}" is not a real date`, detail: 'Pick an existing date. (Supporting!H32 offers 31-09-2026, which does not exist.)' });
    else if (date.note === 'outside_month') issues.push({ ...base, severity: 'warning', cell: `${colName(L.date)}${row}`, title: `${who}: date ${dateRaw} is outside the audit month`, detail: `Month column says ${month ? monthLabel(month) : '?'}.` });
  }
  return audits;
}

type RatingIndex = {
  byResId: Map<string, { outlet: string; aggregator: string; snaps: Map<string, number> }>;
  dates: Set<string>;
};

function readRatings(wb: Workbook, registry: RegistryRow[]): RatingIndex {
  const byResId: RatingIndex['byResId'] = new Map();
  // IDs that have snapshots; the lookup lists (Sheet6 I:M, OR) only fill in their outlet
  const snapIds = new Set([TABS.weekly, TABS.mapping].flatMap((t) => (wb[t] ?? []).slice(1).map((r) => (r[0] ?? '').trim())));
  const dates = new Set<string>();
  const link = (resId: string, odn: string, aggregator: string) => {
    if (!resId) return;
    const e = byResId.get(resId) ?? { outlet: '', aggregator: '', snaps: new Map() };
    if (odn && !e.outlet) e.outlet = outletKey(odn);
    if (aggregator && !e.aggregator) e.aggregator = aggregator.toLowerCase();
    byResId.set(resId, e);
  };
  const snap = (rows: string[][] | undefined, firstCol: number) => {
    const head = rows?.[0] ?? [];
    for (let c = firstCol; c < head.length; c++) {
      const d = parseHeaderDate(head[c] ?? '');
      if (!d) continue;
      for (let r = 1; r < rows!.length; r++) {
        const resId = cell(rows, r, 0);
        const v = num(cell(rows, r, c));
        if (!resId || v == null || !byResId.has(resId)) continue;
        byResId.get(resId)!.snaps.set(d, v);
        dates.add(d);
      }
    }
  };

  const mapping = wb[TABS.mapping];
  for (let r = 1; r < (mapping?.length ?? 0); r++) link(cell(mapping, r, 0), cell(mapping, r, 3), cell(mapping, r, 4));
  const ratings = wb[TABS.ratings];
  for (let r = 2; r < (ratings?.length ?? 0); r++) link(cell(ratings, r, 0), cell(ratings, r, 3), cell(ratings, r, 4));
  const lookup = (resId: string, odn: string, aggregator: string) => { if (snapIds.has(resId) && odn && !odn.startsWith('#')) link(resId, odn, aggregator); };
  for (let r = 1; r < (mapping?.length ?? 0); r++) { // Sheet6 I:M: Swiggy RID, Zomato RID, …, POS name
    lookup(cell(mapping, r, 8), cell(mapping, r, 12), 'swiggy');
    lookup(cell(mapping, r, 9), cell(mapping, r, 12), 'zomato');
  }
  for (const b of registry) {
    lookup(b.swiggyId, b.pos, 'swiggy');
    lookup(b.zomatoId, b.pos, 'zomato');
  }
  const weekly = wb[TABS.weekly];
  for (let r = 1; r < (weekly?.length ?? 0); r++) link(cell(weekly, r, 0), '', cell(weekly, r, 3));

  snap(mapping, 5);
  snap(weekly, 4);
  return { byResId, dates };
}

// End = last snapshot inside the month, start = last snapshot before it. For Sep 2026 that is
// 27 Sep (Ratings!F) vs 31 Aug (Ratings!G), the pair the sheet compares.
function ratingLine(resId: string, aggregator: string, snaps: Map<string, number>, month: string): RatingLine {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  let start: RatingLine['start'] = null;
  let end: RatingLine['end'] = null;
  for (const d of [...snaps.keys()].sort()) {
    if (d < first) start = { date: d, rating: snaps.get(d)! };
    else if (d < next) end = { date: d, rating: snaps.get(d)! };
  }
  const diff = start && end ? round2(end.rating - start.rating) : null;
  const score = diff == null ? 0 : diff > 0 ? 10 : diff === 0 ? 5 : 0;
  return { resId, aggregator, start, end, diff, score };
}

function readOptiPulse(wb: Workbook) {
  const rows = wb[TABS.op];
  const loc2odn = new Map<string, string>();
  const mapping = wb[TABS.mapping];
  for (let r = 1; r < (mapping?.length ?? 0); r++) {
    const loc = cell(mapping, r, 1);
    if (loc && cell(mapping, r, 3)) loc2odn.set(loc.toLowerCase(), cell(mapping, r, 3));
  }
  const byOutlet = new Map<string, OptiPulse>();
  for (let r = 2; r < (rows?.length ?? 0); r++) {
    const location = cell(rows, r, 0);
    const score = num(cell(rows, r, 2));
    if (!location || score == null) continue;
    const odn = num(cell(rows, r, 1)) == null && cell(rows, r, 1) && !cell(rows, r, 1).startsWith('#')
      ? cell(rows, r, 1)
      : loc2odn.get(location.toLowerCase()) ?? '';
    if (!odn) continue;
    const kpis = Object.fromEntries(OP_FIELDS.map((k, i) => [k, num(cell(rows, r, 4 + i))])) as Record<(typeof OP_FIELDS)[number], number | null>;
    byOutlet.set(outletKey(odn), { location, score, tier: cell(rows, r, 3), ...kpis });
  }
  return byOutlet;
}

const latLng = (s: string): Geo => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

type RegistryRow = Brand & { pos: string; posLocation: string; city: string; address: string; geo: Geo };

// Tab OR: rows from its header down to the first blank row (below that sit scratch tables).
// Columns are found by header text; commission, payment and phone columns are not read.
function readRegistry(wb: Workbook): RegistryRow[] {
  const rows = wb[TABS.registry];
  const header = rows?.slice(0, 5).findIndex((r) => findCol(r, /^POS Deployment Name$/i) >= 0 && findCol(r, /^Restaurant Name$/i) >= 0) ?? -1;
  if (!rows || header < 0) return [];
  const h = rows[header];
  const col = (re: RegExp) => findCol(h, re);
  const C = {
    swiggyId: col(/^Swiggy RID$/i), zomatoId: col(/^Zomato RID$/i), brand: col(/^Restaurant Name$/i), city: col(/^City Name$/i),
    pos: col(/^POS Deployment Name$/i), posLocation: col(/^POS Location$/i), address: col(/^Address$/i), geo: col(/^Lat Longs?$/i),
    open1: col(/^Open Time\s*-\s*Close time 1$/i), open2: col(/^Open Time\s*-\s*Close Time\s*-?\s*2$/i),
    cost: col(/Cost for 2/i), type: col(/^Outlet Type$/i), cuisine: col(/Cuisine/i),
    swiggy: col(/^Swiggy Online Status$/i), zomato: col(/^Zomato Online Status$/i),
  };
  const out: RegistryRow[] = [];
  for (let r = header + 1; r < rows.length; r++) {
    const at = (c: number) => (c >= 0 ? cell(rows, r, c) : '');
    const id = (c: number) => (at(c).startsWith('#') ? '' : at(c)); // #N/A: no ID
    if (!at(C.brand) && !at(C.city) && !at(C.pos)) break;
    if (!at(C.brand) || !at(C.city)) continue;
    const hours = [at(C.open1), at(C.open2)].filter((x) => x && x !== '-').join(' · ');
    out.push({
      name: at(C.brand).replace(/’/g, "'"), outletType: at(C.type), swiggyId: id(C.swiggyId), zomatoId: id(C.zomatoId),
      swiggy: at(C.swiggy), zomato: at(C.zomato), hours, costForTwo: num(at(C.cost)), cuisine: at(C.cuisine),
      pos: at(C.pos), posLocation: at(C.posLocation), city: at(C.city), address: at(C.address), geo: latLng(at(C.geo)),
    });
  }
  return out;
}

// ---------------------------------------------------------------- everything together

export function computeDashboard(wb: Workbook, now = new Date()): Dashboard {
  const issues: Issue[] = [];
  const summary = wb[TABS.summary];
  for (const name of Object.values(TABS)) {
    if (!wb[name]?.length) {
      issues.push({ severity: name === TABS.cloud || name === TABS.po || name === TABS.summary ? 'error' : 'warning', tab: name, title: `Tab "${name}" not found or empty`,
        detail: 'It was renamed, deleted or emptied. Everything that comes from it is missing until the name is restored.' });
    }
  }
  const layouts = { cloud: entryLayout(wb[TABS.cloud], TABS.cloud, issues), po: entryLayout(wb[TABS.po], TABS.po, issues) };
  const sections = { cloud: readSections(wb[TABS.cloud], layouts.cloud), po: readSections(wb[TABS.po], layouts.po) };
  const audits = [
    ...readAudits(wb[TABS.cloud], 'cloud', layouts.cloud, sections.cloud, TABS.cloud, issues),
    ...readAudits(wb[TABS.po], 'po', layouts.po, sections.po, TABS.po, issues),
  ];

  // Outlet master: the Audit Summary list and the audits (the leaderboard), then every other outlet
  // that Supporting or OR know, for the directory. City/address/location: Supporting, else OR.
  const supporting = wb[TABS.supporting];
  const registry = readRegistry(wb);
  const info = new Map<string, { name: string; city: string; address: string; geo: Geo }>();
  for (let r = 2; r < (supporting?.length ?? 0); r++) {
    const name = cell(supporting, r, 2);
    if (name && name !== '<>') info.set(outletKey(name), { name, city: cell(supporting, r, 1), address: cell(supporting, r, 3), geo: latLng(cell(supporting, r, 4)) });
  }
  // OR rows whose POS name is #N/A: the kitchen their POS Location names (Sheet6's location lists
  // know "Appa Junction" = TSPA Junction), else one with that short name in the same city
  const loc2pos = new Map<string, string>();
  const mapping = wb[TABS.mapping];
  for (let r = 1; r < (mapping?.length ?? 0); r++) {
    for (const [l, p] of [[1, 3], [11, 12]]) if (cell(mapping, r, l) && cell(mapping, r, p)) loc2pos.set(cell(mapping, r, l).toLowerCase(), cell(mapping, r, p));
  }
  const posOf = (b: RegistryRow) => {
    if (b.pos && !b.pos.startsWith('#')) return b.pos;
    const loc = b.posLocation.toLowerCase();
    const match = registry.find((x) => x.city === b.city && x.pos && !x.pos.startsWith('#') && shortName(x.pos.replace(/\s+/g, ' ')).toLowerCase() === loc);
    return loc2pos.get(loc) || match?.pos || `${b.city} - ${b.posLocation || b.name}`;
  };
  for (const b of registry) {
    const key = outletKey(posOf(b));
    const cur = info.get(key);
    if (!cur) info.set(key, { name: posOf(b), city: b.city, address: b.address, geo: b.geo });
    else {
      cur.address ||= b.address;
      cur.geo ||= b.geo;
    }
  }

  const outlets = new Map<string, Outlet>();
  const add = (name: string, type: OutletType, listed: boolean, summaryRow: number | null, cityHint = '') => {
    const key = outletKey(name);
    if (outlets.has(key)) return outlets.get(key)!;
    const meta = info.get(key);
    const o: Outlet = {
      key, name: name.replace(/\s+/g, ' ').trim(), short: shortName(name.replace(/\s+/g, ' ')), type,
      city: meta?.city || cityHint || 'Unknown', address: meta?.address ?? '', geo: meta?.geo ?? null, brands: [],
      board: true, listed, summaryRow, ratingSeries: [], optipulse: null, months: {},
    };
    outlets.set(key, o);
    return o;
  };

  let headerRow = summary?.findIndex((row) => (row[1] ?? '').trim() === 'POS Deployment Name') ?? -1;
  if (headerRow < 0) headerRow = 3;
  for (let r = headerRow + 1; r < (summary?.length ?? 0); r++) {
    const name = cell(summary, r, 1);
    if (!name) continue;
    add(name, /po/i.test(cell(summary, r, 3)) ? 'PO' : 'Cloud Kitchen', true, r + 1);
  }
  for (const a of audits) {
    const known = outlets.get(a.outlet);
    const type: OutletType = a.form === 'po' ? 'PO' : 'Cloud Kitchen';
    const where = { severity: 'warning' as const, tab: TABS[a.form], cell: `B${a.row}`, outlet: a.outlet, month: a.month ?? undefined };
    if (!known) {
      add(a.outletName, type, false, null, a.city);
      issues.push({ ...where, title: `${shortName(a.outletName)} is not on the Audit Summary list`, detail: 'The sheet never ranks this outlet. The dashboard ranks it under its audit form.' });
    } else if (known.type !== type) {
      issues.push({ ...where, title: `${known.short} is ${known.type} but was audited on the ${type} form`, detail: 'The Audit Summary only reads the form that matches the outlet type, so this audit is ignored there.' });
    }
  }
  // the rest: directory only. Type from OR (QSR / Ivory Lounge are what the Summary calls PO).
  for (const [key, meta] of info) {
    if (outlets.has(key)) continue;
    const own = registry.filter((b) => outletKey(posOf(b)) === key);
    const main = own.find((b) => /fine baking/i.test(b.name)) ?? own[0];
    add(meta.name, /qsr|ivory|po/i.test(main?.outletType ?? '') ? 'PO' : 'Cloud Kitchen', false, null).board = false;
  }
  for (const b of registry) {
    const { pos, posLocation, city, address, geo, ...brand } = b;
    outlets.get(outletKey(posOf(b)))?.brands.push(brand);
  }

  // Ratings
  const ratingIdx = readRatings(wb, registry);
  for (const [resId, e] of ratingIdx.byResId) {
    const o = outlets.get(e.outlet);
    if (!o || !e.snaps.size) continue;
    o.ratingSeries.push({ resId, aggregator: e.aggregator, points: [...e.snaps].sort(([a], [b]) => a.localeCompare(b)).map(([date, rating]) => ({ date, rating })) });
  }
  const unlinked = [...ratingIdx.byResId].filter(([, e]) => e.snaps.size && !outlets.has(e.outlet)).map(([id]) => id);
  if (unlinked.length) {
    issues.push({ severity: 'info', tab: TABS.weekly, title: `${unlinked.length} rating row${unlinked.length > 1 ? 's' : ''} not linked to an outlet`,
      detail: `ResID ${unlinked.join(', ')}: no ODN in Ratings or Sheet6, and no Swiggy/Zomato RID match in OR. Their ratings are not shown.` });
  }

  // OptiPulse
  const op = readOptiPulse(wb);
  for (const [key, v] of op) {
    const o = outlets.get(key);
    if (o) o.optipulse = v;
  }
  const optipulseDate = parseDayMonth(cell(wb[TABS.op], 0, 0), now);

  // Months: every audit month plus the one the Audit Summary is set to
  const summaryMonth = parseMonth(cell(summary, 0, 2));
  const months = [...new Set([...audits.map((a) => a.month), summaryMonth].filter((m): m is string => !!m))].sort().reverse();

  for (const month of months) {
    for (const o of outlets.values()) {
      const mine = audits.filter((a) => a.outlet === o.key && a.month === month);
      const auditAvg = mine.length ? mine.reduce((s, a) => s + a.total, 0) / mine.length : null;
      const ratings = o.ratingSeries.map((s) => ratingLine(s.resId, s.aggregator, new Map(s.points.map((p) => [p.date, p.rating])), month));
      const ratingPts = ratings.reduce((s, l) => s + l.score, 0) / 2;
      const opPts = o.optipulse ? o.optipulse.score / 10 : 0;
      const auditPts = auditAvg == null ? null : auditAvg * (WEIGHTS.audit / 100);
      const recomputed = auditPts == null ? null : round2(auditPts + ratingPts + opPts);
      const res: MonthResult = {
        audits: mine.map((a) => a.id), auditAvg: auditAvg == null ? null : round2(auditAvg), auditPts: auditPts == null ? null : round2(auditPts),
        ratingPts: round2(ratingPts), ratings, opPts: round2(opPts), total: recomputed, recomputed, rank: null, rankOf: 0,
      };
      // the month the Audit Summary shows: its numbers, as the sheet shows them
      const r = o.summaryRow ? o.summaryRow - 1 : -1;
      const sheetTotal = month === summaryMonth && r >= 0 ? num(cell(summary, r, 8)) : null;
      if (sheetTotal != null) {
        const at = (c: number) => num(cell(summary, r, c));
        res.auditPts = at(5) ?? res.auditPts;
        res.auditAvg = at(4) ?? (res.auditPts == null ? null : round2(res.auditPts / (WEIGHTS.audit / 100)));
        res.ratingPts = at(6) ?? res.ratingPts;
        res.opPts = at(7) ?? res.opPts;
        // the sheet shows 1 decimal (92.6) but ranks by the full number (92.63): keep the full one when it rounds to what is shown
        res.total = recomputed != null && Math.abs(sheetTotal - recomputed) <= 0.05 ? recomputed : sheetTotal;
      }
      o.months[month] = res;
    }
    for (const type of ['Cloud Kitchen', 'PO'] as OutletType[]) {
      const ranked = [...outlets.values()].filter((o) => o.type === type && o.months[month].total != null);
      for (const o of ranked) {
        const t = o.months[month].total!;
        o.months[month].rank = 1 + ranked.filter((x) => x.months[month].total! > t).length;
        o.months[month].rankOf = ranked.length;
      }
    }
    const missing = [...outlets.values()].filter((o) => o.listed && o.months[month].total == null);
    if (missing.length) {
      issues.push({ severity: 'info', tab: TABS.summary, month, title: `${missing.length} listed outlet${missing.length > 1 ? 's have' : ' has'} no audit in ${monthLabel(month)}`,
        detail: `${missing.map((o) => o.short).join(', ')}. They are left out of the ranking.` });
    }
  }

  // Ratings / OptiPulse coverage
  // only for outlets that get ranked somewhere; an outlet never audited would just add noise
  for (const o of outlets.values()) {
    if (!Object.values(o.months).some((m) => m.total != null)) continue;
    const aggs = [...new Set(o.ratingSeries.map((s) => s.aggregator))];
    if (aggs.length < 2) {
      issues.push({ severity: 'warning', tab: TABS.ratings, outlet: o.key,
        title: aggs.length ? `${o.short}: only ${aggs[0]} rating is tracked` : `${o.short}: no Swiggy/Zomato rating tracked`,
        detail: `The rating score is always divided by 2, so this outlet can get at most ${aggs.length * 5}/10.` });
    }
    if (!o.optipulse) {
      issues.push({ severity: 'warning', tab: TABS.op, outlet: o.key, title: `${o.short}: no OptiPulse row`, detail: 'Scores 0 of 10 for OptiPulse.' });
    }
  }
  if (optipulseDate) {
    issues.push({ severity: 'info', tab: TABS.op, cell: 'A1', title: `OptiPulse is a single export from ${dayLabel(optipulseDate)}`,
      detail: 'The same OptiPulse score is used for every month until a new export is pasted into OP.' });
  }

  // Cells the sheet computes or types by hand, checked against the recomputation
  if (summaryMonth) {
    for (const o of outlets.values()) {
      if (!o.summaryRow) continue;
      const r = o.summaryRow - 1;
      const res = o.months[summaryMonth];
      const shown = cell(summary, r, 8);
      const shownNum = num(shown);
      if (res.recomputed == null) {
        if (shownNum == null && shown) {
          issues.push({ severity: 'error', tab: TABS.summary, cell: `I${o.summaryRow}`, outlet: o.key, month: summaryMonth,
            title: `${o.short}: Total shows ${shown}`, detail: 'No audit this month: E is "-", and F+G+H fails on text. The dashboard shows "Not audited" instead.' });
        }
      } else if (shownNum == null || Math.abs(shownNum - res.recomputed) > 0.06) {
        issues.push({ severity: 'error', tab: TABS.summary, cell: `I${o.summaryRow}`, outlet: o.key, month: summaryMonth,
          title: `${o.short}: Audit Summary shows ${shown || 'blank'}, the audit rows give ${res.recomputed}`,
          detail: shownNum == null
            ? 'The dashboard uses the audit rows for this outlet.'
            : "The dashboard shows the sheet's number. Usually a number typed over a formula in E:I, or an audit row whose Total Points cell is wrong (see the row issue)." });
      }
      const shownRank = num(cell(summary, r, 9));
      if (res.rank != null && shownRank != null && shownRank !== res.rank) {
        issues.push({ severity: 'warning', tab: TABS.summary, cell: `J${o.summaryRow}`, outlet: o.key, month: summaryMonth,
          title: `${o.short}: Rank shows ${shownRank}, the totals give ${res.rank}`,
          detail: `Rank should be COUNTIFS(type, Total > this) + 1 within ${o.type}. Usually a number typed over the formula. The dashboard ranks by the totals.` });
      }
      const shownCount = num(cell(summary, r, 2));
      if (shownCount != null && shownCount !== res.audits.length && res.audits.length > 0) {
        issues.push({ severity: 'warning', tab: TABS.summary, cell: `C${o.summaryRow}`, outlet: o.key, month: summaryMonth,
          title: `${o.short}: ${shownCount} audit${shownCount === 1 ? '' : 's'} counted, ${res.audits.length} entered`,
          detail: 'No of Audits counts distinct dates, so two audits on one day count once and the average comes out too high.' });
      }
    }
    const ratings = wb[TABS.ratings];
    for (let r = 2; r < (ratings?.length ?? 0); r++) {
      const resId = cell(ratings, r, 0);
      const typed = num(cell(ratings, r, 9));
      const e = ratingIdx.byResId.get(resId);
      if (!resId || typed == null || !e) continue;
      const line = ratingLine(resId, e.aggregator, e.snaps, summaryMonth);
      if (line.diff != null && line.score !== typed) {
        issues.push({ severity: 'warning', tab: TABS.ratings, cell: `J${r + 1}`, outlet: e.outlet, month: summaryMonth,
          title: `${cell(ratings, r, 1)} ${e.aggregator}: Score typed ${typed}, rating change gives ${line.score}`,
          detail: `Rating went ${line.start!.rating} → ${line.end!.rating}. Score is typed by hand, not a formula.` });
      }
    }
  }

  const head = (c: number) => num(cell(summary, 1, c));
  const headerWeights = [head(7), head(8), head(9)];
  if (headerWeights.every((w) => w != null) && headerWeights.join() !== [WEIGHTS.audit, WEIGHTS.rating, WEIGHTS.optipulse].join()) {
    issues.push({ severity: 'info', tab: TABS.summary, cell: 'H1:J2', title: `Header lists weights ${headerWeights.join(' / ')}, formulas use ${WEIGHTS.audit} / ${WEIGHTS.rating} / ${WEIGHTS.optipulse}`,
      detail: 'No formula reads H2:J2. The dashboard follows the formulas.' });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  const list = [...outlets.values()].sort((a, b) => a.short.localeCompare(b.short));
  return {
    weights: WEIGHTS,
    months,
    defaultMonth: summaryMonth && months.includes(summaryMonth) ? summaryMonth : months[0] ?? null,
    cities: [...new Set(list.filter((o) => o.board).map((o) => o.city))].sort(),
    summaryMonth,
    sections,
    outlets: list,
    audits,
    optipulseDate,
    ratingDates: [...ratingIdx.dates].sort(),
    issues,
  };
}
