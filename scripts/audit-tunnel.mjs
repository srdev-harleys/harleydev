// Gives the local dashboard a public HTTPS address for the sheet's Apps Script trigger.
//
//   node scripts/audit-tunnel.mjs            (needs `next dev` on :3000 and cloudflared)
//
// Google's servers cannot reach localhost, so a Cloudflare quick tunnel (no account needed)
// forwards to a tiny gate on 127.0.0.1:3099 that lets through ONLY `POST /api/audit/webhook`.
// The rest of the local portal (Odoo-backed /api/updates etc.) is never exposed.
// The trycloudflare address changes on every start: paste the new one into the sheet's
// menu Audit Dashboard → Connect dashboard… (the secret stays the same). Cloudflare also drops a
// quick tunnel's address when its connection breaks (laptop asleep, network change); a watchdog
// checks the address every minute and starts a new tunnel when it stops answering.
import http from 'node:http';
import { spawn } from 'node:child_process';

const TARGET = process.env.AUDIT_TARGET || 'http://127.0.0.1:3000';
const GATE_PORT = Number(process.env.AUDIT_GATE_PORT) || 3099;
const CLOUDFLARED = process.env.CLOUDFLARED || 'cloudflared';
const PATH = '/api/audit/webhook';

const time = () => new Date().toLocaleTimeString();

const gate = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__gate') return res.writeHead(204).end(); // the watchdog
  if (req.method !== 'POST' || req.url !== PATH) {
    // logged so a wrong address in the sheet (e.g. …/audit pasted) shows up here
    console.log(`${time()}  ${req.method} ${req.url.slice(0, 80)} → 404 (only POST ${PATH} is let through)`);
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
    return;
  }
  const upstream = http.request(new URL(PATH, TARGET), {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] || 'application/json', authorization: req.headers.authorization || '' },
  }, (up) => {
    res.writeHead(up.statusCode || 502, { 'content-type': up.headers['content-type'] || 'application/json' });
    up.pipe(res);
  });
  upstream.setTimeout(30_000, () => upstream.destroy(new Error('no answer in 30 s')));
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`dashboard not running: ${err.message}\n`);
  });
  req.pipe(upstream);
  const t = time();
  res.on('finish', () => console.log(`${t}  push from sheet → ${res.statusCode}`));
});

function startTunnel() {
  const t = { url: null, replaced: false };
  t.cf = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${GATE_PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const scan = (buf) => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString())?.[0];
    if (url && !t.url) {
      t.url = url;
      console.log(`\n${time()}  Public webhook address:\n  ${url}\n\nIn the sheet: Audit Dashboard → Connect dashboard… → paste it, then the secret.\n`);
    }
  };
  t.cf.stdout.on('data', scan);
  t.cf.stderr.on('data', scan);
  t.cf.on('error', (err) => {
    console.error(`Could not start cloudflared (${err.message}). Install it, or set CLOUDFLARED=/path/to/cloudflared.`);
    process.exit(1);
  });
  t.cf.on('exit', (code) => {
    if (t.replaced) return;
    console.error(`cloudflared exited (${code})`);
    process.exit(code ?? 1);
  });
  return t;
}

gate.listen(GATE_PORT, '127.0.0.1', () => {
  console.log(`gate on http://127.0.0.1:${GATE_PORT} → ${TARGET}${PATH} (POST only)`);
  let tunnel = startTunnel();
  let fails = 0;
  setInterval(async () => {
    if (!tunnel.url) return;
    const ok = await fetch(`${tunnel.url}/__gate`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.status === 204, () => false);
    fails = ok ? 0 : fails + 1;
    if (fails < 3) return;
    console.log(`\n${time()}  The address ${tunnel.url} stopped answering. Starting a new tunnel; Connect the sheet again with the new address.`);
    tunnel.replaced = true;
    tunnel.cf.kill();
    tunnel = startTunnel();
    fails = 0;
  }, 60_000);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { tunnel.cf.kill(); process.exit(0); });
});
