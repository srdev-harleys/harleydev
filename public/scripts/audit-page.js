/* ==========================================================================
   Harleys Fine Baking ODOO DEV — Hygiene Audit page (audit.html)
   --------------------------------------------------------------------------
   Data: /api/audit (the audit Google Sheet, recomputed server-side).
   Live: the sheet's Apps Script trigger pushes each edit to the server.
   While the tab is visible, the page asks /api/audit/status every 10 s for
   the version of the numbers and reloads /api/audit when it changes. Same
   on one local server and on Vercel, where any instance can answer.
   Filters live in the URL, so a filtered view can be shared as a link.
   ========================================================================== */
import { loadConfig } from './modules/config-loader.js';
import { startClock } from './modules/clock.js';
import { setText, escapeHtml as esc } from './modules/dom-utils.js';
import {
  TYPES, f1, f2, monthName, band, sheetLink, sortOutlets,
  renderKpis, renderBoards, renderMissed, renderHeatmaps, renderIssues,
  renderLog, renderRatings, renderOptiPulse, renderDirectory, renderDrawer,
} from './modules/audit-views.js';

const STATUS_POLL_MS = 10_000;
// A tab left open all day checks once a minute, so it costs little on Vercel and Upstash.
const IDLE_POLL_MS = 60_000;
const IDLE_AFTER_MS = 30 * 60_000;
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const state = {
  data: null,
  dataVersion: null, // version of the numbers on screen (status.version can run ahead of it)
  dataAt: null, // when the numbers on screen were read from the sheet: never replaced by older ones
  status: null,
  sheet: null,
  month: params.get('month') || '',
  city: params.get('city') || 'all',
  type: TYPES.includes(params.get('type')) ? params.get('type') : 'all',
  q: params.get('q') || '',
  severity: params.get('sev') || 'all',
  sort: { key: 'rank', dir: 'asc' },
  opSort: { key: 'score', dir: 'desc' },
  dirCity: params.get('dir') || '', // outlet directory's own city ('' = follow the page's)
  openKey: params.get('outlet') || null,
  changed: new Set(),
  link: 'connecting', // connecting | ok | down: can this page reach the server
};

// ---------------------------------------------------------------- shell

async function applyShell() {
  try {
    const config = await loadConfig();
    setText('env-badge', config.brand?.environment || 'Testing');
    if (config.brand?.footer) setText('footer-notice', config.brand.footer.notice);
  } catch { /* the page works without config.json */ }
}

function syncUrl() {
  const url = new URL(location.href);
  const params = [['month', state.month, state.data?.defaultMonth], ['city', state.city, 'all'], ['type', state.type, 'all'], ['q', state.q, ''],
    ['sev', state.severity, 'all'], ['outlet', state.openKey, null], ['dir', state.dirCity, '']];
  for (const [k, v, dflt] of params) (v && v !== dflt ? url.searchParams.set(k, v) : url.searchParams.delete(k));
  history.replaceState(null, '', url);
}

// ---------------------------------------------------------------- view context

// outlets = the leaderboard's (Audit Summary + audited); all = every outlet the sheet knows (also
// Supporting/OR-only kitchens), for the ratings, OptiPulse and directory sections
function context() {
  const d = state.data;
  const q = state.q.trim().toLowerCase();
  const all = d.outlets.filter((o) =>
    (state.city === 'all' || o.city === state.city)
    && (state.type === 'all' || o.type === state.type)
    && (!q || o.name.toLowerCase().includes(q) || o.short.toLowerCase().includes(q)));
  const outlets = all.filter((o) => o.board);
  const keys = new Set(outlets.map((o) => o.key));
  const idx = d.months.indexOf(state.month);
  return {
    data: d,
    sheet: state.sheet,
    month: state.month,
    prevMonth: idx >= 0 ? d.months[idx + 1] ?? null : null,
    type: state.type,
    sort: state.sort,
    changed: state.changed,
    q,
    outlets,
    all,
    byKey: new Map(d.outlets.map((o) => [o.key, o])),
    auditsById: new Map(d.audits.map((a) => [a.id, a])),
    issues: d.issues.filter((i) => (!i.month || i.month === state.month) && (!i.outlet || keys.has(i.outlet))),
  };
}

// ---------------------------------------------------------------- render

function fillSelect(el, options, value) {
  el.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function render() {
  const d = state.data;
  if (!d) return;
  if (!d.months.includes(state.month)) state.month = d.defaultMonth || d.months[0] || '';
  if (state.city !== 'all' && !d.cities.includes(state.city)) state.city = 'all';

  fillSelect($('f-month'), d.months.map((m) => [m, monthName(m)]), state.month);
  fillSelect($('f-city'), [['all', 'All cities'], ...d.cities.map((c) => [c, c])], state.city);
  document.querySelectorAll('#f-type .segmented__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
  document.querySelectorAll('#f-severity .segmented__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.severity === state.severity)));
  $('f-search').value = state.q;
  $('btn-sheet').href = state.sheet?.url || '#';

  const ctx = context();
  const summaryNote = d.summaryMonth && d.summaryMonth !== state.month ? ` · the sheet's Audit Summary is set to ${monthName(d.summaryMonth)}` : '';
  setText('audit-summary', `${monthName(state.month) || 'No audits yet'} · ${state.city === 'all' ? 'All cities' : state.city} · ${ctx.outlets.length} outlets${summaryNote}`);

  if (!d.months.length) {
    $('boards').innerHTML = '<p class="daily__message">The sheet has no audits yet. Entries in Cloud-Audit or PO-Audit Entry Report appear here as soon as they are typed.</p>';
  } else {
    renderKpis($('kpis'), ctx);
    renderBoards($('boards'), ctx);
    renderMissed($('missed'), ctx);
    renderHeatmaps($('heatmaps'), ctx);
  }
  renderLog($('log'), $('log-hint'), ctx);
  renderRatings($('ratings'), $('ratings-hint'), ctx);
  renderOptiPulse($('optipulse'), $('op-hint'), ctx, state.opSort);
  const dirCities = [...new Set(d.outlets.map((o) => o.city))].sort();
  const dirCity = state.dirCity || (state.city !== 'all' ? state.city : d.cities.length === 1 ? d.cities[0] : 'all');
  fillSelect($('f-dir-city'), [['all', `All cities (${d.outlets.length})`], ...dirCities.map((c) => [c, `${c} (${d.outlets.filter((o) => o.city === c).length})`])], dirCity);
  renderDirectory($('directory'), $('dir-hint'), ctx, dirCities.includes(dirCity) ? dirCity : 'all');
  // each section names the tabs it comes from, linked to them
  document.querySelectorAll('[data-src]').forEach((a) => {
    const href = sheetLink(state.sheet, a.dataset.src, '');
    if (href) a.href = href;
  });
  renderIssues($('issues'), ctx, state.severity);
  const errors = ctx.issues.filter((i) => i.severity === 'error').length;
  $('health-title').innerHTML = `Data health ${ctx.issues.length ? `<span class="count${errors ? ' count--alert' : ''}">${ctx.issues.length}</span>` : ''}`;

  if (state.openKey) openDrawer(state.openKey, { keepFocus: true });
  syncUrl();
}

// ---------------------------------------------------------------- live status bar

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderLive() {
  const st = state.status;
  const [mode, text] = state.link !== 'ok'
    ? ['down', state.link === 'connecting' ? 'Connecting…' : 'Cannot reach the dashboard server, retrying. The numbers below may be out of date']
    : st?.lastPushAt ? ['live', 'Live: sheet edits show up here within about 15 s']
      : ['polling', `Auto-refresh every ${st?.pollSeconds ?? 30} s (sheet trigger not connected yet)`];
  $('live-bar').dataset.state = st?.error ? 'warn' : mode;
  const updated = st?.updatedAt ? ` · numbers changed ${ago(st.updatedAt)}` : '';
  const checked = st?.checkedAt ? ` · sheet read ${ago(st.checkedAt)}` : '';
  $('live-text').textContent = `${text}${updated}${checked}${st?.error ? ` · ${st.error}` : ''}`;

  const e = st?.lastEdit;
  const editEl = $('live-edit');
  if (!e) { editEl.textContent = ''; return; }
  const isCell = /^[A-Z]+\d/.test(e.range); // "E8"; a row insert or a menu action comes as a word
  const where = isCell ? `${e.tab}!${e.range}` : e.tab;
  const href = sheetLink(state.sheet, e.tab, isCell ? e.range : '');
  const change = e.oldValue || e.value ? ` “${esc(e.oldValue || '')}” → “${esc(e.value || '')}”` : e.range && !isCell ? ` (${esc(e.range)})` : '';
  editEl.innerHTML = `Last edit ${esc(ago(e.at))}: ${href && /!/.test(where) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(where)}</a>` : esc(where)}${change}${e.user ? ` by ${esc(e.user)}` : ''}`;
}

// ---------------------------------------------------------------- what changed (toast + row flash)

function diff(before, after, month) {
  if (!before || !month) return { keys: new Set(), lines: [] };
  const old = new Map(before.outlets.map((o) => [o.key, o]));
  const keys = new Set();
  const lines = [];
  for (const o of after.outlets) {
    if (!o.board) continue;
    const a = old.get(o.key)?.months[month];
    const b = o.months[month];
    if (!b) continue;
    if (!a) { keys.add(o.key); lines.push(`New outlet: ${o.short}`); continue; }
    if (a.total !== b.total || a.audits.length !== b.audits.length || a.ratingPts !== b.ratingPts || a.opPts !== b.opPts) {
      keys.add(o.key);
      if (a.audits.length !== b.audits.length) lines.push(`${o.short}: ${b.audits.length > a.audits.length ? 'new audit' : 'audit removed'}`);
      else lines.push(`${o.short}: ${f1(a.total)} → ${f1(b.total)}${a.rank !== b.rank && b.rank ? ` (rank ${a.rank ?? '—'} → ${b.rank})` : ''}`);
    }
  }
  const oldIssues = before.issues.length;
  if (after.issues.length !== oldIssues) lines.push(`Data health: ${oldIssues} → ${after.issues.length} issues`);
  return { keys, lines };
}

function toast(title, lines = []) {
  const box = document.createElement('div');
  box.className = 'toast';
  box.innerHTML = `<strong>${esc(title)}</strong>${lines.slice(0, 4).map((l) => `<span>${esc(l)}</span>`).join('')}${lines.length > 4 ? `<span>and ${lines.length - 4} more</span>` : ''}`;
  $('toasts').appendChild(box);
  setTimeout(() => box.classList.add('is-leaving'), 6000);
  setTimeout(() => box.remove(), 6600);
}

// ---------------------------------------------------------------- data

let loading = null;
let retryMs = 0; // after a failed read: 5 s, 10 s, 20 s, 30 s… until it works
let retryTimer = null;
let again = false; // a load was asked for while one was running: run once more after it
async function load({ refresh = false, announce = false } = {}) {
  if (loading && !refresh && !announce) { again = true; return loading; }
  if (loading) await loading.catch(() => {});
  loading = (async () => {
    $('btn-refresh').disabled = true;
    $('btn-refresh').textContent = refresh ? 'Reading sheet…' : 'Refresh';
    try {
      const res = await fetch(`/api/audit${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.dashboard) throw new Error(json.message || json.error || `HTTP ${res.status}`);
      // never swap the numbers on screen for older ones (a slower response, another server instance)
      if (state.data && json.status.dataAt && state.dataAt && json.status.dataAt < state.dataAt) return;
      const before = state.data;
      const versionChanged = state.dataVersion != null && json.status.version !== state.dataVersion;
      state.data = json.dashboard;
      state.status = json.status;
      state.dataVersion = json.status.version;
      state.dataAt = json.status.dataAt;
      state.sheet = json.sheet;
      retryMs = 0;
      clearTimeout(retryTimer);
      if (before && versionChanged) {
        const { keys, lines } = diff(before, state.data, state.month);
        state.changed = keys;
        if (announce || lines.length) toast(lines.length ? 'Sheet updated' : 'Sheet re-read, nothing changed', lines);
        setTimeout(() => { state.changed = new Set(); document.querySelectorAll('.is-changed').forEach((r) => r.classList.remove('is-changed')); }, 4000);
      } else if (announce) {
        toast('Sheet re-read', ['Nothing changed since the last read.']);
      }
      showError('');
      render();
    } catch (err) {
      console.error('[Hygiene Audit]', err);
      if (err instanceof TypeError) err = new Error('No connection to the dashboard server'); // fetch() network failure
      if (!state.data) showError(`Could not read the audit sheet: ${err.message}`);
      else if (!retryMs || announce) toast('Could not read the sheet', [`${err.message}. Trying again shortly.`]);
      retryMs = Math.min(30_000, (retryMs || 2500) * 2);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => load(), retryMs);
    } finally {
      $('btn-refresh').disabled = false;
      $('btn-refresh').textContent = 'Refresh';
      renderLive();
      loading = null;
      if (again) { again = false; load(); }
    }
  })();
  return loading;
}

function showError(text) {
  let box = $('audit-message');
  if (!box) {
    box = document.createElement('div');
    box.id = 'audit-message';
    box.className = 'daily__message';
    $('audit-body').before(box);
  }
  box.innerHTML = text ? `<p>${esc(text)}</p><button type="button" class="chip-btn" data-retry>Try again</button>` : '';
  box.hidden = !text;
  $('audit-body').hidden = !!text;
  box.querySelector('[data-retry]')?.addEventListener('click', () => load({ refresh: true }));
}

// ---------------------------------------------------------------- live status

// A few hundred bytes every 10 s while the tab is visible (every minute after 30 min without
// input); the full data only when its version changes. Backs off to 30 s while the server cannot
// be reached.
let statusTimer = null;
let statusFails = 0;
let lastInput = Date.now();
const idle = () => Date.now() - lastInput > IDLE_AFTER_MS;
async function checkStatus() {
  clearTimeout(statusTimer);
  if (!document.hidden) {
    try {
      const res = await fetch('/api/audit/status', { cache: 'no-store' });
      const st = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(st.message || `HTTP ${res.status}`);
      state.status = { ...state.status, ...st };
      state.link = 'ok';
      statusFails = 0;
      // a cached status can trail the data on screen by a few seconds: only newer data counts
      const newer = !(state.dataAt && st.dataAt && st.dataAt < state.dataAt);
      if (st.version && st.version !== state.dataVersion && newer) load();
    } catch (err) {
      console.warn('[Hygiene Audit] status check failed:', err.message);
      statusFails++;
      state.link = 'down';
    }
    renderLive();
  }
  statusTimer = setTimeout(checkStatus, idle() ? IDLE_POLL_MS : Math.min(30_000, STATUS_POLL_MS * 2 ** Math.min(statusFails, 3)));
}

// ---------------------------------------------------------------- drawer

let lastFocus = null;
function openDrawer(key, { keepFocus = false } = {}) {
  const ctx = context();
  const o = ctx.byKey.get(key);
  if (!o || !o.months[state.month]) { closeDrawer(); return; }
  if (!keepFocus || $('drawer').hidden) lastFocus = document.activeElement;
  state.openKey = key;
  renderDrawer({ eyebrow: $('drawer-eyebrow'), title: $('drawer-title'), body: $('drawer-body') }, ctx, o);
  const wasHidden = $('drawer').hidden;
  $('drawer').hidden = false;
  $('drawer-backdrop').hidden = false;
  document.body.classList.add('has-drawer');
  if (wasHidden) {
    $('drawer-body').scrollTop = 0;
    $('drawer').focus();
  }
  syncUrl();
}

function closeDrawer() {
  if ($('drawer').hidden) return;
  $('drawer').hidden = true;
  $('drawer-backdrop').hidden = true;
  document.body.classList.remove('has-drawer');
  state.openKey = null;
  syncUrl();
  lastFocus?.focus?.();
}

function trapFocus(e) {
  if (e.key !== 'Tab' || $('drawer').hidden) return;
  const f = [...$('drawer').querySelectorAll('button, a[href], summary, [tabindex="0"]')].filter((el) => el.offsetParent);
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === $('drawer'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---------------------------------------------------------------- export

function exportCsv() {
  const ctx = context();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Month', 'Type', 'Rank', 'Outlet', 'City', 'Audits', 'Audit avg /100', 'Audit pts /80', 'Rating /10', 'OptiPulse /10', 'Total /100', 'Status']];
  for (const t of TYPES) {
    for (const o of sortOutlets(ctx.outlets.filter((x) => x.type === t), state.sort, ctx.month, ctx.prevMonth)) {
      const m = o.months[ctx.month];
      rows.push([ctx.month, t, m.rank ?? '', o.name, o.city, m.audits.length, m.auditAvg ?? '', m.auditPts ?? '', f2(m.ratingPts), f2(m.opPts), m.total ?? '', band(m.total).label]);
    }
  }
  const blob = new Blob([`﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hygiene-audit-${ctx.month || 'all'}${state.city !== 'all' ? `-${state.city}` : ''}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- wiring

function init() {
  startClock();
  applyShell();

  for (const [id, key] of [['f-month', 'month'], ['f-city', 'city'], ['f-dir-city', 'dirCity']]) $(id).addEventListener('change', (e) => { state[key] = e.target.value; render(); });
  document.querySelectorAll('#f-type .segmented__btn').forEach((b) => b.addEventListener('click', () => { state.type = b.dataset.type; render(); }));
  document.querySelectorAll('#f-severity .segmented__btn').forEach((b) => b.addEventListener('click', () => { state.severity = b.dataset.severity; render(); }));
  let typing;
  $('f-search').addEventListener('input', (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => { state.q = e.target.value; render(); }, 150);
  });
  $('btn-refresh').addEventListener('click', () => load({ refresh: true, announce: true }));
  $('btn-export').addEventListener('click', exportCsv);
  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-backdrop').addEventListener('click', closeDrawer);

  document.addEventListener('click', (e) => {
    if (e.target.closest('a[href]')) return; // a link inside a row (map, sheet) opens that, not the drawer
    const open = e.target.closest('[data-open]');
    if (open) { openDrawer(open.dataset.open); return; }
    // a column header: sort by it, or reverse. Names and rank start ascending, numbers descending
    for (const [attr, prop, ascFirst] of [['opsort', 'opSort', ['outlet', 'tier']], ['sort', 'sort', ['outlet', 'rank']]]) {
      const key = e.target.closest(`[data-${attr}]`)?.dataset[attr];
      if (!key) continue;
      const cur = state[prop];
      state[prop] = { key, dir: cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : ascFirst.includes(key) ? 'asc' : 'desc' };
      render();
      document.querySelector(`[data-${attr}="${key}"]`)?.focus();
      return;
    }
    const health = e.target.closest('[data-goto-health]');
    if (health) {
      state.severity = health.dataset.gotoHealth;
      render();
      $('health-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
    trapFocus(e);
    const row = e.target.closest?.('tr[data-open]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(row.dataset.open); }
    if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('f-search').focus(); }
  });
  setInterval(renderLive, 10_000);

  load().finally(() => {
    $('page-loader')?.classList.add('hidden');
    document.body.classList.add('ready');
    checkStatus();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStatus(); });
    window.addEventListener('online', () => checkStatus());
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
      document.addEventListener(type, () => {
        const wasIdle = idle();
        lastInput = Date.now();
        if (wasIdle) checkStatus();
      }, { passive: true });
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
