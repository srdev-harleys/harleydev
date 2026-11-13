// Self-check for the Hygiene Audit dashboard: `node lib/audit/audit.check.mjs` (Node 24 runs the .ts).
//   1. Scoring (compute.ts): a tiny workbook shaped like the real sheet, with the sheet's known
//      bugs planted in it, plus a fuzz run that must never throw.
//   2. Sheet sync (source.ts), with Google mocked: every failure case, run twice: with the local
//      file store, and with Redis through a stand-in for Upstash's REST API (a local HTTP server).
//      The Redis run also starts a second server instance in a worker thread, as Vercel does, and
//      checks that both see the same data.
import { registerHooks } from 'node:module';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { computeDashboard, parseAuditDate, parseMonth } from './compute.ts';

// ---------------------------------------------------------------- 1. scoring

function checkScoring() {
  const checks = (pts) => pts.map((p) => (p == null ? '' : p === 0 ? 'Non-Compliant (0)' : `Compliant (${p})`));
  const FULL = [3, 4, 5, 3, 5, 8, 4, 8, 7, 6, 7, 8, 6, 6, 5, 5, 5, 5]; // 100
  const head = [
    ['Compliant (3)', '3'],
    ['', '', '', '', 'Personal Hygiene & Grooming \n(Total Weightage: 15 Points)', '', '', '', 'Food Handling \n(Total Weightage: 25 Points)'],
    ['City', 'Location', 'Month', 'Date', 'Staff Uniform & Attire'],
  ];
  const entry = (name, date, pts, y) => ['Hyderabad', name, 'Sep 26', date, ...checks(pts), 'ASHA', '', y];

  const wb = {
    'Audit Summary': [
      ['', 'Month', '9/1/2026', '', '', '', '', 'Physicak Hy', 'Online Hy', 'Online Ratings'],
      ['', 'City', 'Hyderabad', '', '', '', '', '50', '25', '25'],
      [],
      ['', 'POS Deployment Name', 'No of Audits', 'Type', 'Total Score of Audits', 'Average to 80', 'Rating to 10', 'Opti Pro to 10', 'Total Score', 'Rank'],
      ['1', "Harley's - HYD - Alpha", '1', 'Cloud Kitchen', '100', '80', '7.5', '10', '97.5', '1'],
      ['2', "Harley's - HYD - Beta", '1', 'Cloud Kitchen', '0', '0', '5', '9', '14', '1'], // Y formula missing on Beta's row; rank typed
      ['3', "Harlye's - HYD - Gamma", '0', 'PO', '-', '-', '0', '0', '#VALUE!', '6'],
    ],
    'Cloud-Audit Entry Report': [
      ...head,
      entry("Harley's - HYD - Alpha", '24-09-2026', FULL, '100'),
      entry("Harley's  - HYD - Beta", '09-12-2026', [3, 4, 5, 3, 5, 8, 4, 8, 7, 6, 7, 8, 6, 6, 5, 5, 0, 0], ''), // 90, date mm-dd
    ],
    'PO-Audit Entry Report': [...head],
    Supporting: [[], [], ['Harleys', 'Hyderabad', "Harley's - HYD - Alpha", 'Addr A']],
    Ratings: [
      ['', '', '', '', '', '', '', '', '', '', '', '25'],
      ['ResID', 'Location', 'Brand', 'ODN', 'Aggregator', 'End of Sep', 'Start Of Sep', 'Rating Diff', 'Rank', 'Score'],
      ['1', 'Alpha', 'H', "Harley's - HYD - Alpha", 'zomato', '4.6', '4.5', '0.1', '1', '10'],
      ['2', 'Alpha', 'H', "Harley's - HYD - Alpha", 'swiggy', '4.6', '4.6', '0', '2', '5'],
      ['3', 'Beta', 'H', "Harley's - HYD - Beta", 'zomato', '4.4', '4.5', '-0.1', '3', '5'], // typed 5, should be 0
    ],
    Sheet6: [
      ['ResID', 'Location', 'Brand', 'ODN', 'Aggregator', '2026-08-31'],
      ['1', 'Alpha', 'H', "Harley's - HYD - Alpha", 'zomato', '4.5'],
      ['2', 'Alpha', 'H', "Harley's - HYD - Alpha", 'swiggy', '4.6'],
      ['3', 'Beta', 'H', "Harley's - HYD - Beta", 'zomato', '4.5'],
    ],
    Sheet11: [
      ['ResID', 'Location', 'Brand', 'Aggregator', '2026-10-04', '2026-09-27'],
      ['1', 'Alpha', 'H', 'zomato', '4.7', '4.6'],
      ['2', 'Alpha', 'H', 'swiggy', '4.5', '4.6'],
      ['3', 'Beta', 'H', 'zomato', '4.4', '4.4'],
      ['9', 'Delta', 'H', 'swiggy', '4.3', '4.2'], // no ODN anywhere: linked through OR's Swiggy RID
    ],
    OR: [
      ['s', '', '', '45'],
      ['Ownly ID', 'Swiggy RID', 'Zomato RID', 'Restaurant Name', 'City Name', 'POS Deployment Name', 'Display Area Name', 'Optipro Location Name', 'POS Location', 'Address', 'Lat Longs', 'Open Time - Close time 1', 'Open Time -Close Time -2', 'S Cost for 2', 'Outlet Type', 'S Cuisine', 'Swiggy Commission', 'Swiggy Online Status', 'Zomato Online Status'],
      ['', '2', '1', "Harley's Fine Baking", 'Hyderabad', "Harley's - HYD - Alpha", 'Alpha', 'Alpha', 'Alpha', 'Addr OR', '17.4,78.3', '8AM - 12AM', '-', '500', 'Cloud Kitchen', 'Bakery', '15', 'Live', 'Live'],
      ['', '20', '21', 'Tresley & Bento - Korean Cakes', 'Hyderabad', '#N/A', 'Alpha', '', 'Alpha', '', '', '', '', '', 'Cloud Kitchen', '', '15', 'Disabled', 'Live'],
      ['', '9', '', "Harley's Fine Baking", 'Bangalore', "Harley's - HYD - Delta", 'Delta', '', 'Delta', 'Addr D', '17.5, 78.4', '', '', '', 'QSR', '', '15', 'Live', ''],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['City', 'Outlets'], // a scratch table below the registry: not outlets
      ['Pune', '8', 'Harley\'s Fine Baking', 'Pune', 'Harley\'s - PUNE - Scratch'],
    ],
    OP: [
      ['26-Aug'],
      ['Location', '', 'OptiPulse Score'],
      ['Alpha', "Harley's - HYD - Alpha", '100'],
      ['Beta', "Harley's - HYD - Beta", '90'],
    ],
  };

  const d = computeDashboard(wb, new Date('2026-11-06T00:00:00Z'));
  const o = Object.fromEntries(d.outlets.map((x) => [x.short, x]));
  const sep = (n) => o[n].months['2026-09'];

  assert.deepEqual(d.months, ['2026-09']);
  assert.equal(sep('Alpha').total, 97.5); // 100*0.8 + (10+5)/2 + 100/10
  // the Audit Summary's month shows the Summary's numbers, even where they are wrong
  assert.equal(sep('Beta').total, 14);
  assert.equal(sep('Beta').auditAvg, 0);
  assert.equal(sep('Beta').recomputed, 72 + 0 + 9); // the audit rows: Y blank but checkpoints give 90; zomato 4.5 -> 4.4 = down = 0 pts
  assert.equal(sep('Gamma').total, null); // not audited: no #VALUE!, no rank
  assert.equal(sep('Alpha').rank, 1);
  assert.equal(sep('Beta').rank, 2);
  assert.equal(o.Gamma.type, 'PO'); // "Harlye's" typo still joins
  assert.equal(d.audits[1].date, '2026-09-12'); // 09-12-2026 read inside the audit month
  assert.equal(o.Alpha.months['2026-09'].ratings.find((l) => l.aggregator === 'zomato').end.date, '2026-09-27');

  // OR: brands per kitchen (a #N/A row joins by POS Location), directory-only outlets, rating links
  assert.deepEqual(o.Alpha.brands.map((b) => [b.name, b.swiggy, b.zomato]), [["Harley's Fine Baking", 'Live', 'Live'], ['Tresley & Bento - Korean Cakes', 'Disabled', 'Live']]);
  assert.equal(o.Alpha.brands[0].hours, '8AM - 12AM');
  assert.equal(o.Alpha.address, 'Addr A'); // Supporting first
  assert.deepEqual(o.Alpha.geo, [17.4, 78.3]); // OR fills what Supporting lacks
  assert.equal(o.Alpha.board, true);
  assert.equal(o.Delta.board, false); // in OR only: directory, never ranked
  assert.equal(o.Delta.type, 'PO'); // QSR
  assert.equal(sep('Delta').total, null);
  assert.equal(o.Delta.ratingSeries[0].points.length, 2); // Sheet11 row without ODN, found through OR's Swiggy RID
  assert.ok(!o.Scratch, 'rows below the first blank row of OR are not outlets');
  assert.equal(o.Delta.city, 'Bangalore');
  assert.ok(!d.cities.includes('Bangalore')); // directory outlets do not add cities to the page filter

  // October: start = 27 Sep, end = 4 Oct
  // (Summary rows without numbers, as when the sheet is switched to a new month: the dashboard computes)
  const octSummary = [['', 'Month', 'Oct 26'], ...wb['Audit Summary'].slice(1, 4), ...wb['Audit Summary'].slice(4).map((r) => r.slice(0, 4))];
  const oct = computeDashboard({ ...wb, 'Audit Summary': octSummary }, new Date('2026-11-06T00:00:00Z'));
  assert.equal(oct.outlets.find((x) => x.short === 'Alpha').months['2026-10'].ratingPts, (10 + 0) / 2);

  const titles = d.issues.map((i) => `${i.severity} ${i.cell ?? ''} ${i.title}`);
  const has = (re) => assert.ok(titles.some((t) => re.test(t)), `missing issue ${re}\n${titles.join('\n')}`);
  has(/^error Y5 .*Total Points shows blank, checkpoints add up to 90/);
  has(/^error I6 .*shows 14, the audit rows give 81/);
  has(/^error I7 .*#VALUE!/);
  has(/^warning D5 .*day and month swapped/);
  has(/^warning J5 .*typed 5, rating change gives 0/);
  has(/^info H1:J2 .*50 \/ 25 \/ 25/);
  has(/^warning J6 .*Rank shows 1, the totals give 2/);

  // The Summary shows totals to 1 decimal; ranking uses the full number when it rounds to what is shown
  const fine = structuredClone(wb);
  fine.OP[2][2] = '92.3'; // Alpha: 80 + 7.5 + 9.23 = 96.73
  fine['Audit Summary'][4].splice(7, 2, '9.2', '96.7');
  assert.equal(computeDashboard(fine, new Date('2026-11-06T00:00:00Z')).outlets.find((x) => x.short === 'Alpha').months['2026-09'].total, 96.73);

  assert.equal(parseMonth('Sep 26'), '2026-09');
  assert.equal(parseMonth('9/1/2026'), '2026-09');
  assert.equal(parseAuditDate('31-09-2026', '2026-09').note, 'invalid');
  assert.equal(parseAuditDate('24-09-2026', '2026-09').iso, '2026-09-24');

  // A column inserted before Date (e.g. "Shift") must not shift the checkpoints
  const shifted = structuredClone(wb);
  for (const r of shifted['Cloud-Audit Entry Report']) r.splice(3, 0, r === shifted['Cloud-Audit Entry Report'][2] ? 'Shift' : 'Morning');
  const s2 = computeDashboard(shifted, new Date('2026-11-06T00:00:00Z'));
  assert.equal(s2.outlets.find((x) => x.short === 'Alpha').months['2026-09'].recomputed, 97.5);
  assert.equal(s2.audits[1].total, 90);

  // Never throws, whatever is in the sheet: ragged rows, junk, missing tabs, huge numbers
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
  const junk = ['', ' ', '0', '-1', '1e309', 'NaN', '#VALUE!', '#N/A', 'Compliant (99)', 'Partial ()', 'Non-Compliant', '31-02-2026', '2026-13-45', 'Sep 26', '9/1/2026', "Harley's - HYD - Alpha", 'zomato', '4.5', '26-Aug', 'Location', 'Date', 'POS Deployment Name', '\n', '"', ','];
  for (let i = 0; i < 400; i++) {
    const book = {};
    for (const name of Object.keys(wb)) {
      if (rnd(6) === 0) continue; // tab missing
      const base = rnd(2) ? structuredClone(wb[name]) : [];
      for (let k = rnd(8); k > 0; k--) base.splice(rnd(base.length + 1), 0, Array.from({ length: rnd(30) }, () => junk[rnd(junk.length)]));
      for (const row of base) for (let k = rnd(3); k > 0; k--) row[rnd(row.length + 1)] = junk[rnd(junk.length)];
      book[name] = base;
    }
    try {
      const out = computeDashboard(book, new Date('2026-11-06T00:00:00Z'));
      JSON.stringify(out);
    } catch (err) {
      console.error(JSON.stringify(book).slice(0, 2000));
      throw err;
    }
  }
  assert.doesNotThrow(() => computeDashboard({}));

  console.log(`audit.check (scoring): ok (${titles.length} issues found as expected)`);
}

// ---------------------------------------------------------------- 2. sheet sync

// source.ts imports 'server-only' and extensionless paths, as Next.js allows
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith('.')) return next(`${spec}.ts`, ctx); throw e; }
  },
});

// ---------------------------------------------------------------- a two-outlet sheet, served as Google would

const checks = Array(18).fill('Compliant (5)');
const op = (v) => [['26-Aug'], ['Location', '', 'OptiPulse Score'], ['Alpha', "Harley's - HYD - Alpha", String(v)]];
let sheet = {
  'Audit Summary': [['', 'Month', 'Sep 26'], [], [], ['', 'POS Deployment Name', 'No of Audits', 'Type'], ['1', "Harley's - HYD - Alpha", '1', 'Cloud Kitchen'], ['2', "Harley's - HYD - Beta", '1', 'Cloud Kitchen']],
  'Cloud-Audit Entry Report': [[], [], ['City', 'Location', 'Month', 'Date'], ['Hyderabad', "Harley's - HYD - Alpha", 'Sep 26', '10-09-2026', ...checks, 'A', '', '90'], ['Hyderabad', "Harley's - HYD - Beta", 'Sep 26', '11-09-2026', ...checks, 'A', '', '90']],
  OP: op(80),
};
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
const google = { mode: 'ok', delay: 0, calls: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://docs.google.com/')) return realFetch(url, init); // the Redis stand-in
  google.calls++;
  if (google.delay) await new Promise((r) => setTimeout(r, google.delay));
  if (google.mode === 'down') throw new TypeError('fetch failed');
  if (google.mode === 'private') return new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } });
  if (google.mode === '500') return new Response('oops', { status: 500 });
  const names = Object.keys(sheet);
  if (String(url).includes('htmlview')) return new Response(names.map((n, i) => `{name: "${n}", pageUrl: "x?gid=${i + 1}"}`).join(','), { headers: { 'content-type': 'text/html' } });
  return new Response(csv(sheet[names[Number(String(url).match(/gid=(\d+)/)[1]) - 1]]), { headers: { 'content-type': 'text/csv' } });
};

const SRC = new URL('./source.ts', import.meta.url).href;
let loads = 0;
async function freshInstance(env) {
  Object.assign(process.env, env);
  for (const k of ['__auditData', '__auditPull', '__auditFileStores']) delete globalThis[k];
  return import(`${SRC}?instance=${++loads}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const total = (d, short = 'Alpha') => d.dashboard.outlets.find((o) => o.short === short).months['2026-09'].total;

// ---------------------------------------------------------------- the second instance (worker thread)

if (!isMainThread) {
  const src = await freshInstance(workerData.env);
  parentPort.on('message', async ({ id, cmd, arg }) => {
    try {
      let result;
      if (cmd === 'google') result = Object.assign(google, arg) && null;
      if (cmd === 'total') result = total(await src.getDashboard(arg));
      if (cmd === 'status') result = await src.getStatus();
      if (cmd === 'pull') result = await src.getDashboard({ refresh: true }).then(() => google.calls);
      parentPort.postMessage({ id, result });
    } catch (err) {
      parentPort.postMessage({ id, error: err.message });
    }
  });
  parentPort.postMessage({ ready: true });
} else {
  checkScoring();

  // ---------------------------------------------------------------- stand-in for Upstash's REST API

  const TOKEN = 'test-token';
  const kv = new Map();
  const hashes = new Map();
  const expires = new Map();
  const live = (k) => {
    if (expires.has(k) && Date.now() > expires.get(k)) { kv.delete(k); expires.delete(k); }
    return kv.has(k);
  };
  const run = ([cmd, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case 'GET': return live(a[0]) ? kv.get(a[0]) : null;
      case 'SET': {
        const [k, v, ...opt] = a;
        if (opt.includes('NX') && live(k)) return null;
        kv.set(k, v);
        const px = opt.indexOf('PX');
        if (px >= 0) expires.set(k, Date.now() + Number(opt[px + 1])); else expires.delete(k);
        return 'OK';
      }
      case 'DEL': return Number(kv.delete(a[0]) || hashes.delete(a[0]));
      case 'HSET': {
        if (a.length < 3 || a.length % 2 === 0) throw new Error("ERR wrong number of arguments for 'hset' command");
        const h = hashes.get(a[0]) ?? new Map();
        hashes.set(a[0], h);
        for (let i = 1; i < a.length; i += 2) h.set(a[i], String(a[i + 1]));
        return (a.length - 1) / 2;
      }
      case 'HGETALL': return [...(hashes.get(a[0]) ?? new Map())].flat();
      default: throw new Error(`ERR unknown command '${cmd}'`);
    }
  };
  const redis = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (code, json) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(json));
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Unauthorized' });
      const one = (c) => { try { return { result: run(c) }; } catch (e) { return { error: e.message }; } };
      const parsed = JSON.parse(body);
      if (req.url === '/multi-exec') return send(200, parsed.map(one));
      const r = one(parsed);
      send(r.error ? 400 : 200, r);
    });
  });
  await new Promise((r) => redis.listen(0, '127.0.0.1', r));
  const REDIS_URL = `http://127.0.0.1:${redis.address().port}`;

  // ---------------------------------------------------------------- the cases, for each store

  const dir = mkdtempSync(join(tmpdir(), 'audit-check-'));
  const FILE = join(dir, 'store.json');
  const stores = {
    file: { AUDIT_STORE_FILE: FILE, KV_REST_API_URL: '', KV_REST_API_TOKEN: '' },
    redis: { KV_REST_API_URL: REDIS_URL, KV_REST_API_TOKEN: TOKEN },
  };
  process.env.AUDIT_WEBHOOK_SECRET = 'test';
  process.env.AUDIT_SHEET_ID = 'test-sheet';

  for (const [kind, env] of Object.entries(stores)) {
    sheet = { ...sheet, OP: op(80) };
    Object.assign(google, { mode: 'ok', delay: 0, calls: 0 });
    let src = await freshInstance(env);

    // cold start, Google down, nothing stored: a clear error, no crash
    google.mode = 'down';
    await assert.rejects(src.getDashboard(), /did not answer/, kind);

    // Google up: numbers, saved in the store
    google.mode = 'ok';
    const d1 = await src.getDashboard({ refresh: true });
    assert.equal(total(d1), 72 + 8, kind); // 90 * 0.8 + OptiPulse 80 / 10
    assert.equal(d1.status.storage, kind);
    assert.match(d1.status.version, /^[0-9a-f]{16}$/);
    if (kind === 'file') { await wait(50); assert.ok(existsSync(FILE), 'file store written'); }

    // Google down / private / 500 later: the last good numbers stay, with the reason
    for (const [m, re] of [['down', /did not answer/], ['private', /still shared/], ['500', /HTTP 500/]]) {
      google.mode = m;
      google.calls = 0;
      const d = await src.getDashboard({ refresh: true });
      assert.equal(d.status.version, d1.status.version, `${kind} ${m}`);
      assert.match(d.status.error, re, `${kind} ${m}`);
      if (m === '500') assert.ok(google.calls >= 3, 'retries a 5xx');
    }
    google.mode = 'ok';
    assert.equal((await src.getDashboard({ refresh: true })).status.error, null);

    // no push yet: the sheet is due for a read once the data is older than 30 s
    const realNow = Date.now;
    const later = (ms) => { Date.now = () => realNow() + ms; };
    later(40_000);
    assert.equal((await src.getStatus()).due, true, `${kind}: no read after 30 s without a trigger`);
    Date.now = realNow;

    // a push landing while a slow pull reads wins; the pull's older result is dropped
    google.delay = 150;
    const slow = src.getDashboard({ refresh: true });
    await wait(30);
    const pushed = await src.ingestPush({ tabs: { OP: op(50) }, sentAt: 1000, edit: { tab: 'OP', range: 'C3', value: '50' } });
    assert.equal(pushed.changed, true, kind);
    await slow;
    google.delay = 0;
    assert.equal(total(await src.getDashboard()), 72 + 5, `${kind}: slow pull overwrote the push`);
    // Refresh right after a push keeps the pushed numbers (the CSV export trails edits)
    assert.equal(total(await src.getDashboard({ refresh: true })), 72 + 5);
    const st = (await src.getStatus()).status;
    assert.equal(st.lastEdit.value, '50');
    assert.ok(st.lastPushAt && st.source === 'push');

    // out-of-order pushes: an older sentAt arriving later is ignored
    await src.ingestPush({ tabs: { OP: op(70) }, sentAt: 3000 });
    assert.equal((await src.ingestPush({ tabs: { OP: op(60) }, sentAt: 2000 })).ignored, 'out_of_order');
    assert.equal(total(await src.getDashboard()), 72 + 7);

    // junk an authenticated caller could send never throws
    for (const body of [{}, { tabs: null }, { tabs: { OP: 'x', Ratings: [1, null, { a: 1 }] } }, { edit: { tab: { a: 1 } }, sentAt: 'soon', gids: { OP: 'x' } }]) {
      await src.ingestPush({ ...body, sentAt: 9000 });
    }
    await src.ingestPush({ tabs: { OP: op(10) }, sentAt: 10_000 });
    assert.equal(total(await src.getDashboard()), 72 + 1);

    // pulls pause for a minute after a push, then the 30-s reads resume (they catch missed pushes)
    later(30_000);
    assert.equal((await src.getStatus()).due, false, `${kind}: read the CSV right after a push`);
    later(2 * 60_000);
    assert.equal((await src.getStatus()).due, true, `${kind}: no read after a push, so a missed push is never caught`);
    Date.now = realNow;

    // restart while Google is down: the stored numbers are served (no read: a push just landed)
    google.mode = 'down';
    src = await freshInstance(env);
    const r1 = await src.getDashboard({ refresh: true });
    assert.equal(total(r1), 72 + 1, `${kind}: restart lost the data`);
    assert.equal(r1.status.source, 'push');
    google.mode = 'ok';

    if (kind === 'redis') {
      const instances = [];
      const startWorker = async (workerEnv) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { env: workerEnv }, execArgv: ['--conditions=react-server', '--no-warnings'] });
        instances.push(worker);
        await new Promise((r) => worker.once('message', r));
        let seq = 0;
        return (cmd, arg) => new Promise((resolve, reject) => {
          const id = ++seq;
          const on = (m) => { if (m.id !== id) return; worker.off('message', on); m.error ? reject(new Error(m.error)) : resolve(m.result); };
          worker.on('message', on);
          worker.postMessage({ id, cmd, arg });
        });
      };

      // a second instance (as on Vercel) sees pushes that landed on the first
      const b = await startWorker(env);
      assert.equal(await b('total'), 72 + 1);
      await src.ingestPush({ tabs: { OP: op(30) }, sentAt: 20_000 });
      assert.equal(await b('total'), 72 + 3, 'second instance missed the push');
      assert.equal((await b('status')).status.version, (await src.getStatus()).status.version);

      // two instances asked to read the sheet at the same moment: only one reads it (the lease)
      const leaseEnv = { ...env, AUDIT_SHEET_ID: 'lease-test' };
      src = await freshInstance(leaseEnv);
      await src.getDashboard();
      const c = await startWorker(leaseEnv);
      await c('google', { delay: 200, calls: 0 });
      google.delay = 200;
      google.calls = 0;
      const [, workerCalls] = await Promise.all([src.getDashboard({ refresh: true }), c('pull')]);
      assert.equal(google.calls + workerCalls, 4, `both instances read the sheet (${google.calls} + ${workerCalls} requests)`);
      google.delay = 0;
      for (const w of instances) await w.terminate();

      // Redis down: this instance serves its last copy and says why
      const closed = new Promise((r) => redis.close(r));
      redis.closeAllConnections();
      await closed;
      const down = await src.getDashboard();
      assert.equal(total(down), 72 + 8);
      assert.match(down.status.error, /store unreachable.*read just now/);

      // Redis down on a cold instance: it reads the sheet itself; with Google down too, a clear error
      src = await freshInstance(env);
      google.mode = 'down';
      await assert.rejects(src.getDashboard(), /did not answer/);
      google.mode = 'ok';
      assert.equal(total(await src.getDashboard()), 72 + 8, 'cold instance with Redis down showed nothing');
      google.mode = 'down';
      assert.match((await src.getDashboard()).status.error, /store unreachable.*last copy/);
      google.mode = 'ok';
    }
    console.log(`audit.check (sync, ${kind} store): ok`);
  }
  await wait(100); // let the last file write finish
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  console.log('audit.check: ok');
  process.exit(0);
}
