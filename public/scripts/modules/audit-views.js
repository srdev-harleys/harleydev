/* ==========================================================================
   Hygiene Audit — everything the page draws: KPIs, leaderboards, missed
   checkpoints, heatmaps, audit log (entry tabs), online ratings (Ratings,
   Sheet11, Sheet6), OptiPulse (OP), outlet directory (Supporting, OR), data
   health and the outlet drawer. Pure functions of the view context built in
   audit-page.js; all text goes through escapeHtml.
   ========================================================================== */
import { escapeHtml as esc } from './dom-utils.js';
import { attachTip } from './chart-tip.js';

export const TYPES = ['Cloud Kitchen', 'PO'];
const kind = (cls, icon, label) => ({ cls, icon, label });
const STATUS = { C: kind('good', '✓', 'Compliant'), P: kind('warning', '◐', 'Partial'), N: kind('critical', '✕', 'Non-compliant') };
const SEVERITY = { error: kind('critical', '✕', 'Error'), warning: kind('warning', '!', 'Warning'), info: kind('info', 'i', 'Note') };
const AGG = { zomato: 'Zomato', swiggy: 'Swiggy' };
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const f1 = (n) => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1));
export const f2 = (n) => (n == null ? '—' : String(Math.round(n * 100) / 100));
const day = (iso) => (iso ? fmtDay.format(new Date(`${iso}T00:00:00`)) : '—');
export function monthName(m) {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1));
}

// Score bands shown next to totals. ponytail: fixed thresholds; make them a sheet setting if ops wants others.
export function band(total) {
  if (total == null) return { cls: 'none', label: 'Not audited' };
  if (total >= 85) return { cls: 'good', label: 'On track' };
  if (total >= 70) return { cls: 'warning', label: 'Watch' };
  return { cls: 'critical', label: 'Act now' };
}

const chip = (s, text) => `<span class="chip chip--${s.cls}"><span aria-hidden="true">${s.icon ?? ''}</span>${esc(text ?? s.label)}</span>`;
const statusChip = (status) => (status ? chip(STATUS[status]) : '<span class="chip chip--none">Blank</span>');
const bandChip = (total, b = band(total)) => `<span class="band band--${b.cls}">${esc(b.label)}</span>`;

export function sheetLink(sheet, tab, cell) {
  if (!sheet?.url) return null;
  const gid = sheet.gids?.[tab];
  if (gid == null) return sheet.url;
  return `${sheet.url}#gid=${gid}${cell ? `&range=${encodeURIComponent(cell)}` : ''}`;
}

function stack(m) {
  const seg = (pts, cls, label) => (pts > 0 ? `<span class="stack__seg stack__seg--${cls}" style="width:${pts}%" title="${label} ${f2(pts)}"></span>` : '');
  return `<span class="stack" aria-hidden="true">${seg(m.auditPts ?? 0, 'audit', 'Audit')}${seg(m.ratingPts, 'rating', 'Rating')}${seg(m.opPts, 'op', 'OptiPulse')}</span>`;
}

function delta(now, before) {
  if (now == null || before == null) return '<span class="delta delta--none">—</span>';
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return '<span class="delta delta--flat">0.0</span>';
  return `<span class="delta delta--${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}</span>`;
}

// ---------------------------------------------------------------- KPIs

export function renderKpis(el, ctx) {
  const { outlets, month, prevMonth, issues } = ctx;
  const ranked = outlets.filter((o) => o.months[month]?.total != null);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgTotal = avg(ranked.map((o) => o.months[month].total));
  const prevRanked = prevMonth ? outlets.filter((o) => o.months[prevMonth]?.total != null) : [];
  const prevAvg = avg(prevRanked.map((o) => o.months[prevMonth].total));
  const avgAudit = avg(ranked.map((o) => o.months[month].auditAvg));
  const best = [...ranked].sort((a, b) => b.months[month].total - a.months[month].total)[0];
  const worst = [...ranked].sort((a, b) => a.months[month].total - b.months[month].total)[0];
  const act = ranked.filter((o) => band(o.months[month].total).cls === 'critical').length;
  const errors = issues.filter((i) => i.severity === 'error').length;

  const tile = (label, value, note = '', extra = '') => `
    <article class="kpi ${extra}">
      <span class="kpi__label">${esc(label)}</span>
      <span class="kpi__value">${value}</span>
      <span class="kpi__note">${note}</span>
    </article>`;

  el.innerHTML = [
    tile('Outlets audited', `${ranked.length}<small> / ${outlets.length}</small>`, `${outlets.length - ranked.length} not audited in ${esc(monthName(month))}`),
    tile('Average score', f1(avgTotal), prevAvg != null ? `${delta(avgTotal, prevAvg)} vs ${esc(monthName(prevMonth))}` : 'out of 100'),
    tile('Average audit', f1(avgAudit), 'checkpoints, out of 100'),
    tile('Top outlet', best ? f1(best.months[month].total) : '—', best ? `<button type="button" class="link-btn" data-open="${esc(best.key)}">${esc(best.short)}</button> · ${esc(best.type)}` : 'no audits yet'),
    tile('Act now (below 70)', String(act), worst && act ? `Lowest: <button type="button" class="link-btn" data-open="${esc(worst.key)}">${esc(worst.short)}</button> ${f1(worst.months[month].total)}` : 'none this month', act ? 'kpi--alert' : ''),
    tile('Sheet errors', String(errors), errors ? '<button type="button" class="link-btn" data-goto-health="error">Review in Data health</button>' : 'formulas agree with entries', errors ? 'kpi--alert' : ''),
  ].join('');
}

// ---------------------------------------------------------------- leaderboards

const columns = (list) => list.map(([key, label, num, title]) => ({ key, label, num, title })); // [key, label, numeric, tooltip]
const COLUMNS = columns([['rank', 'Rank', 1], ['outlet', 'Outlet'], ['audits', 'Audits', 1], ['auditAvg', 'Audit /100', 1], ['ratingPts', 'Rating /10', 1],
  ['opPts', 'OptiPulse /10', 1], ['total', 'Total /100', 1], ['delta', 'vs last month', 1], ['band', 'Status']]);

function sortValue(o, key, month, prevMonth) {
  const m = o.months[month];
  if (key === 'outlet') return o.short.toLowerCase();
  if (key === 'audits') return m.audits.length;
  if (key === 'delta') return m.total != null && prevMonth && o.months[prevMonth]?.total != null ? m.total - o.months[prevMonth].total : null;
  return m[key === 'band' ? 'total' : key];
}

// Outlets by value(outlet, sort.key); blanks (not audited) always last, ties by name
function sortBy(list, value, sort) {
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (va == null && vb == null) return a.short.localeCompare(b.short);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir || a.short.localeCompare(b.short);
  });
}

export const sortOutlets = (list, sort, month, prevMonth) => sortBy(list, (o, key) => sortValue(o, key, month, prevMonth), sort);

// Column headers that sort their table; `named` also gives each column its col-<key> class
function sortHead(cols, sort, attr, named = false) {
  return cols.map((c) => {
    const active = sort.key === c.key;
    const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const cls = [named && `col-${c.key}`, c.num && 'is-num'].filter(Boolean).join(' ');
    return `<th scope="col" class="${cls}" aria-sort="${aria}"><button type="button" class="sort-btn${active ? ' is-active' : ''}" ${attr}="${c.key}"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}<span aria-hidden="true">${active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</span></button></th>`;
  }).join('');
}

export function renderBoards(el, ctx) {
  const { outlets, month, prevMonth, type, sort, changed } = ctx;
  const types = type === 'all' ? TYPES : [type];
  const columns = COLUMNS.filter((c) => c.key !== 'delta' || prevMonth); // no earlier month, no comparison
  el.innerHTML = types.map((t) => {
    const list = sortOutlets(outlets.filter((o) => o.type === t), sort, month, prevMonth);
    if (!list.length) return '';
    const ranked = list.filter((o) => o.months[month].total != null).length;
    const rows = list.map((o) => {
      const m = o.months[month];
      const prev = prevMonth ? o.months[prevMonth]?.total : null;
      const none = m.total == null;
      const medal = m.rank && m.rank <= 3 ? ` rank--${m.rank}` : '';
      return `<tr class="board__row${none ? ' is-none' : ''}${changed.has(o.key) ? ' is-changed' : ''}" data-open="${esc(o.key)}" tabindex="0" aria-label="${esc(o.short)}, ${none ? 'not audited' : `rank ${m.rank}, total ${f1(m.total)}`}. Open details">
        <td class="is-num"><span class="rank${medal}">${m.rank ?? '—'}</span></td>
        <th scope="row"><span class="board__name">${esc(o.short)}</span>${o.listed ? '' : ' <span class="tag" title="Not on the Audit Summary list">unlisted</span>'}</th>
        <td class="is-num col-audits">${m.audits.length || '—'}</td>
        <td class="is-num col-auditAvg">${none ? '—' : f1(m.auditAvg)}</td>
        <td class="is-num col-ratingPts">${f2(m.ratingPts)}</td>
        <td class="is-num col-opPts">${f2(m.opPts)}</td>
        <td class="board__total"><div class="total-cell">${none ? '' : stack(m)}<strong class="board__total-n">${none ? '—' : f1(m.total)}</strong></div></td>
        ${prevMonth ? `<td class="is-num">${delta(m.total, prev)}</td>` : ''}
        <td>${bandChip(m.total)}</td>
      </tr>`;
    }).join('');
    return `<article class="panel panel--table board">
      <header class="board__head"><h3 class="panel__title">${esc(t)}</h3><span class="board__count">${ranked} ranked · ${list.length - ranked} not audited</span></header>
      <div class="team-table__scroll"><table class="team-table board__table"><thead><tr>${sortHead(columns, sort, 'data-sort', true)}</tr></thead><tbody>${rows}</tbody></table></div>
    </article>`;
  }).join('') || '<p class="daily__message">No outlets match these filters.</p>';
}

// ---------------------------------------------------------------- where points are lost

function monthAudits(ctx) {
  const keys = new Set(ctx.outlets.map((o) => o.key));
  return ctx.data.audits.filter((a) => a.month === ctx.month && keys.has(a.outlet));
}

export function renderMissed(el, ctx) {
  const audits = monthAudits(ctx);
  const byLabel = new Map();
  for (const a of audits) {
    let i = 0;
    for (const s of ctx.data.sections[a.form]) {
      for (const c of s.checkpoints) {
        const it = a.items[i++];
        const e = byLabel.get(c.label) ?? { label: c.label, section: s.name, lost: 0, short: 0, n: 0 };
        e.n += 1;
        const lost = c.max - (it.points ?? 0);
        e.lost += lost;
        if (lost > 0) e.short += 1;
        byLabel.set(c.label, e);
      }
    }
  }
  const top = [...byLabel.values()].filter((e) => e.lost > 0).sort((a, b) => b.lost - a.lost || b.short - a.short).slice(0, 7);
  if (!top.length) {
    el.innerHTML = `<li class="missed__empty">${audits.length ? 'Every checkpoint was fully compliant.' : 'No audits for these filters.'}</li>`;
    return;
  }
  el.innerHTML = top.map((e) => `
    <li class="missed__item">
      <div class="missed__text"><strong>${esc(e.label)}</strong><span>${esc(e.section)}</span></div>
      <div class="missed__bar"><span style="width:${(100 * e.short) / e.n}%"></span></div>
      <div class="missed__n"><strong>${e.short}</strong> of ${e.n} audits short · ${e.lost} pts</div>
    </li>`).join('');
}

export function renderHeatmaps(el, ctx) {
  const audits = monthAudits(ctx);
  const types = ctx.type === 'all' ? TYPES : [ctx.type];
  el.innerHTML = '';
  for (const t of types) {
    const form = t === 'PO' ? 'po' : 'cloud';
    const sections = ctx.data.sections[form];
    // latest audit per outlet this month, outlets in rank order
    const latest = new Map();
    for (const a of audits) {
      const o = ctx.byKey.get(a.outlet);
      if (o?.type !== t) continue;
      const cur = latest.get(a.outlet);
      if (!cur || (a.date ?? '') > (cur.date ?? '')) latest.set(a.outlet, a);
    }
    if (!latest.size) continue;
    const rows = [...latest.values()].sort((a, b) => (ctx.byKey.get(a.outlet).months[ctx.month].rank ?? 99) - (ctx.byKey.get(b.outlet).months[ctx.month].rank ?? 99));
    const checkpoints = sections.flatMap((s) => s.checkpoints);
    const look = (it) => (it.status ? STATUS[it.status] : { cls: 'none', label: 'Blank' });
    const name = (a) => ctx.byKey.get(a.outlet).short;
    const panel = document.createElement('article');
    panel.className = 'panel heat';
    const groupHead = sections.map((s) => `<th scope="colgroup" colspan="${s.checkpoints.length}" class="heat__group">${esc(s.name)} <small>${s.weight}</small></th>`).join('');
    const numHead = checkpoints.map((c, i) => `<th scope="col" class="heat__num" title="${esc(c.label)} (max ${c.max})">${i + 1}</th>`).join('');
    const body = rows.map((a) => `<tr><th scope="row"><button type="button" class="link-btn" data-open="${esc(a.outlet)}">${esc(name(a))}</button></th>${
      checkpoints.map((c, i) => `<td class="heat__cell heat__cell--${look(a.items[i]).cls}">${a.items[i].points ?? '–'}</td>`).join('')}<td class="heat__total">${a.total}</td></tr>`).join('');
    panel.innerHTML = `<h3 class="panel__title">${esc(t)} · checkpoint by checkpoint</h3>
      <div class="team-table__scroll"><table class="heat__table">
        <thead><tr><th></th>${groupHead}<th></th></tr><tr><th scope="col" class="heat__corner">Outlet</th>${numHead}<th scope="col" class="heat__num">Total</th></tr></thead>
        <tbody>${body}</tbody></table></div>
      <p class="heat__legend">${chip(STATUS.C)} ${chip(STATUS.P)} ${chip(STATUS.N)} <span>Hover a cell for the checkpoint; numbers match the columns of the entry tab (E → V).</span></p>`;
    panel.querySelectorAll('tbody tr').forEach((tr, r) => tr.querySelectorAll('.heat__cell').forEach((td, i) => {
      const it = rows[r].items[i];
      attachTip(td, `${it.points ?? '–'} / ${checkpoints[i].max}`, `${name(rows[r])} · ${checkpoints[i].label} · ${look(it).label}`, { focusable: false });
    }));
    el.appendChild(panel);
  }
  if (!el.children.length) el.innerHTML = '<p class="daily__message">No audits to show for these filters.</p>';
}

// ---------------------------------------------------------------- audit log (entry tabs)

export function renderLog(el, hint, ctx) {
  const audits = monthAudits(ctx).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.outletName.localeCompare(b.outletName));
  const titled = (name) => name[0].toUpperCase() + name.slice(1).toLowerCase(); // ASHA -> Asha
  const by = new Map();
  for (const a of audits) {
    const who = a.auditor ? titled(a.auditor) : 'Not entered';
    by.set(who, (by.get(who) ?? 0) + 1);
  }
  hint.textContent = audits.length
    ? `${plural(audits.length, 'audit')} entered for ${monthName(ctx.month)}, newest first. Auditors: ${[...by].map(([w, n]) => `${w} ${n}`).join(', ')}.`
    : `No audit entered for ${monthName(ctx.month)}.`;
  if (!audits.length) { el.innerHTML = ''; return; }
  const rows = audits.map((a) => {
    const o = ctx.byKey.get(a.outlet);
    const short = a.items.filter((it) => it.points == null || it.points < it.max).length;
    const b = band(a.total);
    return `<tr class="board__row" data-open="${esc(a.outlet)}" tabindex="0" aria-label="${esc(o?.short ?? a.outletName)}, audit of ${esc(a.date ? day(a.date) : a.dateRaw)}, ${a.total} of 100. Open details">
      <td class="log__date">${a.date ? esc(day(a.date)) : `<span class="log__bad" title="Not a real date">${esc(a.dateRaw || 'no date')}</span>`}</td>
      <th scope="row">${esc(o?.short ?? a.outletName)}${a.comments ? `<span class="log__mcomment">${esc(a.comments)}</span>` : ''}</th>
      <td>${a.form === 'po' ? 'PO' : 'Cloud'} <span class="muted-inline">row ${a.row}</span></td>
      <td>${a.auditor ? esc(titled(a.auditor)) : '<span class="muted-inline">not entered</span>'}</td>
      <td class="is-num"><span class="score-pill band--${b.cls}">${a.total}</span></td>
      <td class="is-num">${short ? `${short} of ${a.items.length}` : '<span class="muted-inline">none</span>'}</td>
      <td class="log__comment">${a.comments ? `<span>${esc(a.comments)}</span>` : '<span class="muted-inline">—</span>'}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="team-table__scroll"><table class="team-table log">
    <colgroup><col class="c-date"><col class="c-outlet"><col class="c-form"><col class="c-by"><col class="c-score"><col class="c-short"><col></colgroup>
    <thead><tr><th scope="col">Date</th><th scope="col">Outlet</th><th scope="col">Form</th><th scope="col">Visited by</th><th scope="col" class="is-num">Score /100</th><th scope="col" class="is-num" title="Checkpoints scored below their maximum">Below max</th><th scope="col">Comments</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------- online ratings (Ratings, Sheet11, Sheet6)

// One aggregator's rating over every snapshot; the month's compared pair (start, end) is marked.
// The look: size, dot radii [pair, others], the band's least width and corner. The table's rows
// share one scale, so a 0.1 step looks the same everywhere.
const SPARK_ROW = { cls: 'spark spark--sm', W: 140, H: 34, P: 5, r: [3.5, 1.8], minBand: 2, rx: ' rx="3"' };
const SPARK_DRAWER = { cls: 'spark', W: 260, H: 64, P: 8, r: [5, 3.5], minBand: -Infinity, rx: '' };
function spark(series, line, scale, { cls, W, H, P, r, minBand, rx }, a11y) {
  const x = (d) => P + ((Date.parse(d) - scale.x0) / Math.max(1, scale.x1 - scale.x0)) * (W - 2 * P);
  const y = (v) => H - P - ((v - scale.lo) / Math.max(0.01, scale.hi - scale.lo)) * (H - 2 * P);
  const pts = series.points;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const key = new Set([line?.start?.date, line?.end?.date]);
  const band = line?.start && line?.end
    ? `<rect class="spark__band" x="${x(line.start.date).toFixed(1)}" y="0" width="${Math.max(minBand, x(line.end.date) - x(line.start.date)).toFixed(1)}" height="${H}"${rx}></rect>` : '';
  const dots = pts.map((p, i) => `<circle data-i="${i}" cx="${x(p.date).toFixed(1)}" cy="${y(p.rating).toFixed(1)}" r="${r[key.has(p.date) ? 0 : 1]}" class="spark__dot${key.has(p.date) ? ' is-key' : ''}"></circle>`).join('');
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${a11y}>${band}<path d="${path}" class="spark__line"></path>${dots}</svg>`;
}

function change(l) {
  if (!l) return '<span class="muted-inline">not tracked</span>';
  if (l.diff == null) return `<span class="muted-inline">${l.end ? `${l.end.rating}, no earlier snapshot` : 'no snapshot this month'}</span>`;
  const dir = l.diff > 0 ? 'up' : l.diff < 0 ? 'down' : 'flat';
  const arrow = { up: '▲', down: '▼', flat: '●' }[dir];
  return `<span class="rchange"><strong>${l.start.rating} → ${l.end.rating}</strong><span class="delta delta--${dir}">${arrow} ${l.diff > 0 ? '+' : ''}${l.diff.toFixed(1)}</span><span class="rchange__pts">${l.score} pts</span></span>`;
}

export function renderRatings(el, hint, ctx) {
  const list = ctx.all.filter((o) => o.ratingSeries.length);
  const lines = list.flatMap((o) => o.months[ctx.month]?.ratings ?? []);
  const count = (f) => lines.filter(f).length;
  const pairs = new Map();
  for (const l of lines) if (l.start && l.end) pairs.set(`${l.start.date}|${l.end.date}`, (pairs.get(`${l.start.date}|${l.end.date}`) ?? 0) + 1);
  const [usual] = [...pairs].sort((a, b) => b[1] - a[1])[0] ?? [];
  const [s, e] = usual ? usual.split('|') : [];
  hint.textContent = list.length
    ? `${monthName(ctx.month)}: the last snapshot in the month against the last one before it${s ? ` (${day(s)} → ${day(e)})` : ''}. Up = 10 pts, flat = 5, down = 0 per aggregator; the outlet's rating score is the sum ÷ 2. ${count((l) => l.diff > 0)} up · ${count((l) => l.diff === 0)} flat · ${count((l) => l.diff < 0)} down${count((l) => l.diff == null) ? ` · ${count((l) => l.diff == null)} without a pair` : ''}.`
    : 'No Swiggy or Zomato ratings tracked for these outlets.';
  if (!list.length) { el.innerHTML = ''; return; }
  const all = list.flatMap((o) => o.ratingSeries.flatMap((x) => x.points));
  const dates = all.map((p) => Date.parse(p.date));
  const vals = all.map((p) => p.rating);
  const scale = { x0: Math.min(...dates), x1: Math.max(...dates), lo: Math.min(...vals) - 0.05, hi: Math.max(...vals) + 0.05 };
  const rows = [...list].sort((a, b) => (b.months[ctx.month]?.ratingPts ?? -1) - (a.months[ctx.month]?.ratingPts ?? -1) || Number(b.board) - Number(a.board) || a.short.localeCompare(b.short)).map((o) => {
    const m = o.months[ctx.month];
    const cells = ['zomato', 'swiggy'].map((agg) => {
      const series = o.ratingSeries.find((x) => x.aggregator === agg);
      const line = m.ratings.find((l) => l.aggregator === agg);
      return `<td class="rspark" data-key="${esc(o.key)}" data-agg="${agg}">${series ? spark(series, line, scale, SPARK_ROW, 'aria-hidden="true"') : ''}</td><td>${change(line)}</td>`;
    }).join('');
    return `<tr class="board__row" data-open="${esc(o.key)}" tabindex="0" aria-label="${esc(o.short)}, rating score ${f2(m.ratingPts)} of 10. Open details">
      <th scope="row">${esc(o.short)}${o.board ? '' : ' <span class="tag" title="Not on the Audit Summary">not ranked</span>'}</th>
      ${cells}
      <td class="is-num"><strong>${f2(m.ratingPts)}</strong></td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="team-table__scroll"><table class="team-table rtable">
    <thead><tr><th scope="col">Outlet</th><th scope="col" class="rspark">Zomato <small>every weekly snapshot · month marked</small></th><th scope="col"><span class="ph-only">Zomato</span></th><th scope="col" class="rspark">Swiggy</th><th scope="col"><span class="ph-only">Swiggy</span></th><th scope="col" class="is-num">Rating /10</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="heat__legend rlegend"><span class="legend__swatch legend__swatch--band"></span> the two snapshots this month's score compares <span>· snapshots ${esc(day(new Date(scale.x0).toISOString().slice(0, 10)))} to ${esc(day(new Date(scale.x1).toISOString().slice(0, 10)))}, one scale for every line (${scale.lo.toFixed(2)}–${scale.hi.toFixed(2)})</span></p>`;
  el.querySelectorAll('.rspark').forEach((td) => {
    const o = ctx.byKey.get(td.dataset.key);
    const series = o?.ratingSeries.find((x) => x.aggregator === td.dataset.agg);
    if (!series) return;
    td.querySelectorAll('circle').forEach((c) => {
      const p = series.points[Number(c.dataset.i)];
      attachTip(c, String(p.rating), `${o.short} · ${AGG[series.aggregator] ?? series.aggregator} · ${day(p.date)}`, { focusable: false });
    });
  });
}

// ---------------------------------------------------------------- OptiPulse (OP)

const OP_COLS = columns([
  ['outlet', 'Outlet'], ['score', 'Score', 1, 'OptiPulse score, 0–100; ÷ 10 = the outlet\'s OptiPulse points'], ['tier', 'Tier'],
  ['kpt', 'Prep min', 1, 'Kitchen prep time (KPT), minutes'], ['highKpt', 'Slow preps', 1, 'High-KPT orders'], ['rwt', 'Rider wait', 1, 'Rider wait time (RWT), minutes'],
  ['foodReady', 'Ready %', 1, 'Food ready rate'], ['inaccurate', 'Inaccurate', 1, 'Inaccurate orders'], ['unfulfilled', 'Unfulfilled', 1, 'Merchant-led unfulfilled orders'],
  ['online', 'Online %', 1, 'Store online %'], ['aov', 'AOV ₹', 1, 'Average order value'], ['rating', 'Rating', 1], ['orders', 'Orders', 1], ['revenue', 'Revenue ₹', 1],
  ['lostRevenue', 'Lost ₹', 1, 'Lost revenue'],
]);

const tierCls = (t) => (/excellent/i.test(t) ? 'good' : /great|good/i.test(t) ? 'info' : /average|fair/i.test(t) ? 'warning' : /poor|bad/i.test(t) ? 'critical' : 'none');

export function renderOptiPulse(el, hint, ctx, sort) {
  const list = ctx.all.filter((o) => o.optipulse);
  const sum = (k) => list.reduce((a, o) => a + (o.optipulse[k] ?? 0), 0);
  const date = ctx.data.optipulseDate;
  hint.textContent = list.length
    ? `Zomato OptiPulse export${date ? ` of ${day(date)}` : ''}: ${plural(list.length, 'outlet')} · ${inr.format(sum('orders'))} orders · ₹${inr.format(sum('revenue'))} revenue · ₹${inr.format(sum('lostRevenue'))} lost. The score ÷ 10 is the outlet's OptiPulse points.`
    : 'No OptiPulse rows for these outlets.';
  if (!list.length) { el.innerHTML = ''; return; }
  const value = (o, k) => (k === 'outlet' ? o.short.toLowerCase() : k === 'tier' ? o.optipulse.tier : o.optipulse[k]);
  const fmt = (k, v) => (v == null ? '—' : ['aov', 'orders', 'revenue', 'lostRevenue', 'highKpt'].includes(k) ? inr.format(v) : String(v));
  const rows = sortBy(list, value, sort).map((o) => {
    const op = o.optipulse;
    const cells = OP_COLS.slice(3).map((c) => `<td class="is-num">${fmt(c.key, op[c.key])}</td>`).join('');
    return `<tr class="board__row" data-open="${esc(o.key)}" tabindex="0" aria-label="${esc(o.short)}, OptiPulse ${op.score}. Open details">
      <th scope="row">${esc(o.short)}${o.board ? '' : ' <span class="tag">not ranked</span>'}</th>
      <td class="is-num op-score"><span class="op-score__bar"><span style="width:${Math.max(0, Math.min(100, op.score))}%"></span></span><strong>${op.score}</strong></td>
      <td>${op.tier ? chip({ cls: tierCls(op.tier), icon: '' }, op.tier) : '—'}</td>
      ${cells}
    </tr>`;
  }).join('');
  const avg = list.reduce((a, o) => a + o.optipulse.score, 0) / list.length;
  const foot = OP_COLS.slice(3).map((c) => `<td class="is-num">${['orders', 'revenue', 'lostRevenue'].includes(c.key) ? inr.format(sum(c.key)) : ''}</td>`).join('');
  el.innerHTML = `<div class="team-table__scroll"><table class="team-table optable">
    <thead><tr>${sortHead(OP_COLS, sort, 'data-opsort')}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th scope="row">All ${list.length}</th><td class="is-num">avg <strong>${f1(avg)}</strong></td><td></td>${foot}</tr></tfoot></table></div>`;
}

// ---------------------------------------------------------------- outlet directory (Supporting, OR)

const statusCls = (s) => (/^live$/i.test(s) ? 'on' : /disabled|off|closed/i.test(s) ? 'off' : 'none');
function aggBadge(letter, name, status) {
  const cls = statusCls(status);
  const text = `${name}: ${status || 'not set'}`;
  return `<span class="agg agg--${cls}" title="${esc(text)}" aria-label="${esc(text)}">${letter}</span>`;
}

// "Harley's Fine Baking" -> "Fine Baking", "Tresley & Bento - Korean Cakes & Desserts" -> "Tresley & Bento",
// "The Cheesecake Box by Harley's" -> "The Cheesecake Box"
const brandShort = (name) => name.split(/\s+-\s*|\s*-\s+/)[0].replace(/^harley['’]s\s+|\s+by\s+harley['’]s$/gi, '').trim() || name;
const brandChip = (b) => `<span class="brand" title="${esc(`${b.name}${b.outletType ? ` · ${b.outletType}` : ''}`)}"><span class="brand__name">${esc(brandShort(b.name))}</span>${aggBadge('S', 'Swiggy', b.swiggy)}${aggBadge('Z', 'Zomato', b.zomato)}</span>`;

// brands live on both apps first, then on one, then off
const liveRank = (b) => -(statusCls(b.swiggy) === 'on') - (statusCls(b.zomato) === 'on');
const liveFirst = (brands) => [...brands].sort((a, b) => liveRank(a) - liveRank(b));

const mapHref = (geo) => (geo ? `https://www.google.com/maps/search/?api=1&query=${geo[0]},${geo[1]}` : null);

export function renderDirectory(el, hint, ctx, city) {
  const q = ctx.q;
  const list = ctx.data.outlets.filter((o) => (city === 'all' || o.city === city)
    && (!q || o.name.toLowerCase().includes(q) || o.short.toLowerCase().includes(q) || o.brands.some((b) => b.name.toLowerCase().includes(q))))
    .sort((a, b) => Number(b.board) - Number(a.board) || a.short.localeCompare(b.short));
  const brands = list.flatMap((o) => o.brands);
  const live = (k) => brands.filter((b) => statusCls(b[k]) === 'on').length;
  hint.textContent = list.length
    ? `${plural(list.length, 'kitchen')} · ${plural(brands.length, 'brand listing')} · ${live('swiggy')} live on Swiggy, ${live('zomato')} on Zomato. Kitchens on the leaderboard first. Commission, payment and phone columns of OR are left out.`
    : 'No kitchens match.';
  if (!list.length) { el.innerHTML = ''; return; }
  const rows = list.map((o) => {
    const main = o.brands.find((b) => /fine baking/i.test(b.name)) ?? o.brands[0];
    const href = mapHref(o.geo);
    return `<tr class="board__row" data-open="${esc(o.key)}" tabindex="0" aria-label="${esc(o.short)}, ${o.brands.length} brands. Open details">
      <th scope="row">${esc(o.short)}${city === 'all' ? `<span class="dir__city">${esc(o.city)}</span>` : ''}</th>
      <td>${o.board ? `${esc(o.type)}${o.listed ? '' : ' <span class="tag">unlisted</span>'}` : '<span class="muted-inline">not ranked</span>'}</td>
      <td class="dir__brands">${o.brands.length ? liveFirst(o.brands).map(brandChip).join('') : '<span class="muted-inline">not in OR</span>'}</td>
      <td class="dir__hours">${main?.hours ? esc(main.hours) : '<span class="muted-inline">—</span>'}</td>
      <td class="is-num">${main?.costForTwo != null ? `₹${inr.format(main.costForTwo)}` : '—'}</td>
      <td class="dir__addr">${o.address ? `<span>${esc(o.address)}</span>` : '<span class="muted-inline">no address</span>'}${href ? ` <a class="map-link" href="${esc(href)}" target="_blank" rel="noopener">Map ↗</a>` : ''}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="team-table__scroll"><table class="team-table dir">
    <colgroup><col class="c-kitchen"><col class="c-board"><col class="c-brands"><col class="c-hours"><col class="c-cost"><col></colgroup>
    <thead><tr><th scope="col">Kitchen</th><th scope="col">Leaderboard</th><th scope="col">Brands <small>S = Swiggy, Z = Zomato</small></th><th scope="col">Hours</th><th scope="col" class="is-num">For two</th><th scope="col">Address</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="heat__legend"><span class="agg agg--on">S</span> live <span class="agg agg--off">S</span> disabled <span class="agg agg--none">S</span> not set <span class="no-touch">· hover a badge for the status as typed in OR</span></p>`;
}

// ---------------------------------------------------------------- data health

export function renderIssues(el, ctx, severity) {
  const list = ctx.issues.filter((i) => severity === 'all' || i.severity === severity);
  if (!list.length) {
    el.innerHTML = `<li class="issue issue--empty">${ctx.issues.length ? 'Nothing at this level.' : 'No problems found: every formula cell matches its inputs.'}</li>`;
    return;
  }
  el.innerHTML = list.map((i) => {
    const s = SEVERITY[i.severity];
    const href = sheetLink(ctx.sheet, i.tab, i.cell);
    const where = `${i.tab}${i.cell ? `!${i.cell}` : ''}`;
    return `<li class="issue">
      ${chip(s)}
      <div class="issue__text"><strong>${esc(i.title)}</strong><span>${esc(i.detail)}</span></div>
      <div class="issue__actions">
        ${i.outlet && ctx.byKey.has(i.outlet) ? `<button type="button" class="chip-btn" data-open="${esc(i.outlet)}">Outlet</button>` : ''}
        ${href ? `<a class="chip-btn" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(where)}">${esc(i.cell ? where.replace(/^.*?!/, '') : i.tab)} ↗</a>` : ''}
      </div>
    </li>`;
  }).join('');
}

// ---------------------------------------------------------------- outlet drawer

function bar(label, value, max, cls) {
  const pct = max ? Math.max(0, Math.min(100, (100 * (value ?? 0)) / max)) : 0;
  return `<li class="build__row">
    <span class="build__label">${esc(label)}</span>
    <span class="build__track"><span class="build__fill build__fill--${cls}" style="width:${pct}%"></span></span>
    <span class="build__n"><strong>${value == null ? '—' : f2(value)}</strong> / ${max}</span>
  </li>`;
}

function auditCard(a, ctx) {
  const tab = a.form === 'po' ? 'PO-Audit Entry Report' : 'Cloud-Audit Entry Report';
  const sections = ctx.data.sections[a.form];
  const href = sheetLink(ctx.sheet, tab, `A${a.row}:Y${a.row}`);
  let i = 0;
  const groups = sections.map((s, si) => {
    const items = s.checkpoints.map((c) => {
      const it = a.items[i++];
      return `<li class="check${it.points != null && it.points < c.max ? ' is-short' : ''}">
        <span class="check__label">${esc(c.label)}</span>${statusChip(it.status)}<span class="check__n">${it.points ?? '–'}/${c.max}</span></li>`;
    }).join('');
    const sec = a.sections[si];
    return `<div class="checks__group">
      <div class="checks__head"><strong>${esc(s.name)}</strong><span>${sec.points}/${sec.max}</span></div>
      <ul class="checks">${items}</ul></div>`;
  }).join('');
  const short = a.items.filter((it, k) => it.points != null && it.points < a.items[k].max).length;
  return `<article class="audit-card">
    <header class="audit-card__head">
      <div><strong>${esc(a.date ? day(a.date) : a.dateRaw || 'no date')}</strong><span>${a.auditor ? `by ${esc(a.auditor)}` : 'auditor not entered'} · ${a.form === 'po' ? 'PO' : 'Cloud'} form, row ${a.row}</span></div>
      <div class="audit-card__total"><strong>${a.total}</strong>/100</div>
    </header>
    <ul class="build">${sections.map((s, si) => bar(s.name, a.sections[si].points, a.sections[si].max, 'audit')).join('')}</ul>
    ${a.comments ? `<blockquote class="audit-card__comment">${esc(a.comments)}</blockquote>` : ''}
    <details class="audit-card__details">
      <summary>All 18 checkpoints · ${short} short${a.complete ? '' : ' · some blank'}</summary>
      <div class="checks__wrap">${groups}</div>
    </details>
    ${href ? `<a class="chip-btn" href="${esc(href)}" target="_blank" rel="noopener">Open row ${a.row} in sheet ↗</a>` : ''}
  </article>`;
}

export function renderDrawer(els, ctx, o) {
  const m = o.months[ctx.month];
  const mName = monthName(ctx.month);
  els.eyebrow.textContent = o.board ? `${o.type} · ${o.city}${o.listed ? '' : ' · not on Audit Summary'}` : `${o.city} · not on the leaderboard`;
  els.title.textContent = o.short;

  const audits = m.audits.map((id) => ctx.auditsById.get(id)).filter(Boolean).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const history = ctx.data.months.filter((mo) => o.months[mo]).map((mo) => ({ mo, r: o.months[mo] }));
  const issues = ctx.data.issues.filter((i) => i.outlet === o.key && (!i.month || i.month === ctx.month));
  const op = o.optipulse;

  const ratingRows = m.ratings.length ? m.ratings.map((l, idx) => {
    const name = AGG[l.aggregator] ?? l.aggregator ?? 'Rating';
    const change = l.diff == null ? 'no snapshot pair for this month' : `${l.start.rating} → ${l.end.rating} (${l.diff > 0 ? '+' : ''}${l.diff})`;
    const cls = l.diff == null ? 'none' : l.diff > 0 ? 'good' : l.diff === 0 ? 'info' : 'critical';
    return `<div class="rating">
      <div class="rating__head"><strong>${esc(name)}</strong>${chip({ cls, icon: '' }, `${l.score} pts`)}</div>
      <p class="rating__change">${esc(change)}${l.start && l.end ? `<span>${esc(day(l.start.date))} → ${esc(day(l.end.date))}</span>` : ''}</p>
      <div class="rating__spark" data-series="${idx}"></div>
    </div>`;
  }).join('') : '<p class="muted">No Swiggy or Zomato rating is tracked for this outlet (Ratings / Sheet6 / Sheet11).</p>';

  const kv = (label, v, unit = '') => `<div class="kv"><span>${esc(label)}</span><strong>${v == null ? '—' : esc(String(v)) + unit}</strong></div>`;
  const opBlock = op ? `<div class="kv-grid">
      ${kv('OptiPulse score', op.score)}${kv('Tier', op.tier)}${kv('Kitchen prep time', op.kpt, ' min')}${kv('High-KPT orders', op.highKpt)}
      ${kv('Rider wait time', op.rwt, ' min')}${kv('Food ready rate', op.foodReady, '%')}${kv('Inaccurate orders', op.inaccurate)}${kv('Unfulfilled (merchant)', op.unfulfilled)}
      ${kv('Store online', op.online, '%')}${kv('Avg order value', op.aov == null ? null : `₹${inr.format(op.aov)}`)}${kv('Zomato rating', op.rating)}
      ${kv('Orders', op.orders == null ? null : inr.format(op.orders))}${kv('Revenue', op.revenue == null ? null : `₹${inr.format(op.revenue)}`)}${kv('Lost revenue', op.lostRevenue == null ? null : `₹${inr.format(op.lostRevenue)}`)}
    </div><p class="muted">Zomato OptiPulse export${ctx.data.optipulseDate ? ` of ${esc(day(ctx.data.optipulseDate))}` : ''} (tab OP, location "${esc(op.location)}").</p>`
    : `<p class="muted">No OptiPulse row for this outlet in tab OP${o.board ? ', so it scores 0 of 10' : ''}.</p>`;

  const brands = o.brands.length ? `<div class="team-table__scroll"><table class="mini-table">
      <thead><tr><th scope="col">Brand</th><th scope="col">Swiggy</th><th scope="col">Zomato</th><th scope="col">Hours</th><th scope="col" class="is-num">For two</th></tr></thead>
      <tbody>${liveFirst(o.brands).map((b) => `<tr>
        <th scope="row">${esc(b.name)}<span>${esc([b.outletType, b.cuisine.replace(/,\s*/g, ', ')].filter(Boolean).join(' · '))}</span><span class="mini-table__ph">${esc([b.hours, b.costForTwo == null ? '' : `₹${inr.format(b.costForTwo)} for two`].filter(Boolean).join(' · '))}</span></th>
        <td class="mini-table__status">${aggBadge('S', 'Swiggy', b.swiggy)} ${esc(b.swiggy || '—')}${b.swiggyId ? `<span>${esc(b.swiggyId)}</span>` : ''}</td>
        <td class="mini-table__status">${aggBadge('Z', 'Zomato', b.zomato)} ${esc(b.zomato || '—')}${b.zomatoId ? `<span>${esc(b.zomatoId)}</span>` : ''}</td>
        <td>${esc(b.hours || '—')}</td>
        <td class="is-num">${b.costForTwo == null ? '—' : `₹${inr.format(b.costForTwo)}`}</td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">This kitchen has no row in tab OR.</p>';
  const href = mapHref(o.geo);

  els.body.innerHTML = `
    ${o.board ? '' : '<section class="drawer__section"><p class="muted">Not on the Audit Summary and not audited, so it has no hygiene score. Listed here from Supporting / OR.</p></section>'}
    <section class="drawer__section score-card"${o.board ? '' : ' hidden'}>
      <div class="score-card__main">
        <span class="score-card__total">${m.total == null ? '—' : f1(m.total)}</span>
        <div>${bandChip(m.total)}<p class="muted">${m.total == null ? `No audit in ${esc(mName)}` : `#${m.rank} of ${m.rankOf} ${esc(o.type)} · ${esc(mName)}`}</p></div>
      </div>
      <ul class="build">
        ${bar(`Audit (${m.auditAvg == null ? 'no audit' : `${f1(m.auditAvg)} × 80%`})`, m.auditPts, 80, 'audit')}
        ${bar('Rating trend', m.ratingPts, 10, 'rating')}
        ${bar('OptiPulse', m.opPts, 10, 'op')}
      </ul>
    </section>
    ${issues.length ? `<section class="drawer__section"><h3>Needs fixing in the sheet</h3><ul class="mini-issues">${issues.map((i) => `<li>${chip({ cls: i.severity === 'error' ? 'critical' : i.severity === 'warning' ? 'warning' : 'info', icon: '' }, i.severity)} ${esc(i.title)}</li>`).join('')}</ul></section>` : ''}
    ${o.board ? `<section class="drawer__section"><h3>Audits · ${esc(mName)}</h3>${audits.length ? audits.map((a) => auditCard(a, ctx)).join('') : `<p class="muted">No audit entered for ${esc(mName)}.</p>`}</section>` : ''}
    <section class="drawer__section"><h3>Online rating trend</h3>${o.board ? '<p class="muted">Up = 10, flat = 5, down = 0 per aggregator; the sum is divided by 2.</p>' : ''}${ratingRows}</section>
    <section class="drawer__section"><h3>OptiPulse</h3>${opBlock}</section>
    ${history.length > 1 ? `<section class="drawer__section"><h3>Month by month</h3><ul class="history">${history.map(({ mo, r }) => `<li><span>${esc(monthName(mo))}</span><strong>${r.total == null ? '—' : f1(r.total)}</strong><span>${r.rank ? `#${r.rank} of ${r.rankOf}` : 'not audited'}</span></li>`).join('')}</ul></section>` : ''}
    <section class="drawer__section"><h3>Brands at this kitchen</h3>${brands}</section>
    ${o.address || href ? `<section class="drawer__section"><h3>Address</h3>${o.address ? `<p class="muted">${esc(o.address)}</p>` : ''}${href ? `<a class="chip-btn" href="${esc(href)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>` : ''}</section>` : ''}
  `;

  // sparklines with per-point tooltips
  els.body.querySelectorAll('.rating__spark').forEach((holder) => {
    const line = m.ratings[Number(holder.dataset.series)];
    const series = o.ratingSeries.find((s) => s.resId === line.resId);
    if (!series) return;
    const pts = series.points;
    if (pts.length < 2) return; // one snapshot: nothing to draw
    const vals = pts.map((p) => p.rating);
    const scale = { x0: Date.parse(pts[0].date), x1: Date.parse(pts[pts.length - 1].date), lo: Math.min(...vals) - 0.05, hi: Math.max(...vals) + 0.05 };
    holder.innerHTML = spark(series, line, scale, SPARK_DRAWER, `role="img" aria-label="${esc(AGG[series.aggregator] ?? series.aggregator)} rating from ${pts[0].rating} to ${pts[pts.length - 1].rating}"`);
    holder.querySelectorAll('circle').forEach((c) => {
      const p = series.points[Number(c.dataset.i)];
      attachTip(c, String(p.rating), `${AGG[series.aggregator] ?? series.aggregator} · ${day(p.date)}`);
    });
  });
}
