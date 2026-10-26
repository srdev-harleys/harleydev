/* ==========================================================================
   Team Analytics — the team-wide blocks of the Daily Updates page:
   release pipeline (open tasks per stage, per person), last moves to
   Production, the My Tasks banner numbers per person, and the source notes.
   ========================================================================== */
import { escapeHtml } from './dom-utils.js';
import { attachTip } from './chart-tip.js';

const STAGE_NOTE = {
  dev: 'On the dev server',
  integration: 'In integration testing',
  uat: 'Awaiting production',
  production: 'Live in production',
};

/* Odoo's My Tasks banner, same groups, labels and order */
const BANNER = [
  { group: 'My Tasks', cols: [['todo', 'To Do'], ['overdue', 'Overdue'], ['due_today', 'Due today'], ['priority', '★ Priority']] },
  { group: 'My Day', cols: [['today', 'Today'], ['done_today', 'Done today'], ['stuck', '↻ Stuck']] },
  { group: 'My Performance', cols: [['closed_today', 'Done today'], ['closed_7d', 'Done 7d'], ['on_time_7d', 'On time 7d'],
    ['misc_today', 'Daily today'], ['misc_done_today', 'Daily done']] },
];

export function renderPipeline(container, pipeline = [], people = []) {
  if (!container) return;
  container.innerHTML = '';
  pipeline.forEach((stage) => {
    const counts = people.map((p) => ({ name: p.name, n: stage.by_person?.[p.user_id] ?? 0 }));
    const max = Math.max(1, ...counts.map((c) => c.n));
    const tile = document.createElement('article');
    tile.className = `stage-tile${stage.key === 'uat' ? ' is-awaiting' : ''}`;
    tile.innerHTML = `
      <div class="stage-tile__head">
        <h3 class="stage-tile__label">${escapeHtml(stage.stage)}</h3>
        <span class="stage-tile__note">${escapeHtml(STAGE_NOTE[stage.key] || '')}</span>
      </div>
      <div class="stage-tile__value">${stage.count}</div>
      <ul class="mini-bars"></ul>`;
    const list = tile.querySelector('.mini-bars');
    counts.forEach(({ name, n }) => {
      const li = document.createElement('li');
      li.className = `mini-bars__row${n ? '' : ' is-zero'}`;
      li.innerHTML = `<span class="mini-bars__name"></span>
        <span class="mini-bars__track"><span class="mini-bars__bar" style="width:${(100 * n) / max}%"></span></span>
        <span class="mini-bars__n">${n}</span>`;
      li.querySelector('.mini-bars__name').textContent = name;
      attachTip(li, `${n} task${n === 1 ? '' : 's'}`, `${name} · ${stage.stage}`);
      list.appendChild(li);
    });
    container.appendChild(tile);
  });
}

export function renderToProduction(container, rows = []) {
  if (!container) return;
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  container.innerHTML = rows.length ? '' : '<li class="prod-list__empty">No task has moved to Production yet.</li>';
  rows.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'prod-list__item';
    li.innerHTML = `
      <time class="prod-list__when" datetime="${escapeHtml(r.date)}">${escapeHtml(fmt.format(new Date(r.date)))}</time>
      <div class="prod-list__what">
        <span class="prod-list__ref">${escapeHtml(r.ref)}</span>
        <span class="prod-list__name">${escapeHtml(r.name)}</span>
      </div>
      <span class="prod-list__meta">${escapeHtml(r.from || '—')} → Production · ${escapeHtml(r.by)}</span>`;
    li.title = r.name;
    container.appendChild(li);
  });
}

export function renderTeamTable(container, people = []) {
  if (!container) return;
  const head1 = BANNER.map((g) => `<th scope="colgroup" colspan="${g.cols.length}" class="team-table__group">${g.group}</th>`).join('');
  const head2 = BANNER.flatMap((g) => g.cols.map(([, label], i) =>
    `<th scope="col" class="${i === 0 ? 'is-group-start' : ''}">${escapeHtml(label)}</th>`)).join('');
  const rows = people.map((p) => {
    const d = p.dashboard;
    const cells = BANNER.flatMap((g) => g.cols.map(([key], i) => {
      const cls = i === 0 ? 'is-group-start' : '';
      if (!d) return `<td class="${cls} is-zero">–</td>`;
      const v = d[key];
      const text = key === 'on_time_7d' ? (v === null ? '–' : `${v}%`) : v;
      return `<td class="${cls}${!v ? ' is-zero' : ''}">${escapeHtml(String(text))}</td>`;
    })).join('');
    return `<tr><th scope="row">${escapeHtml(p.name)}</th>${cells}</tr>`;
  }).join('');
  container.innerHTML = `
    <div class="team-table__scroll">
      <table class="team-table">
        <thead><tr><td></td>${head1}</tr><tr><th scope="col">Person</th>${head2}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function renderSourceNotes(container, aiEnabled) {
  if (!container) return;
  container.innerHTML = `
    <dl class="source-notes__list">
      <div>
        <dt><span class="source-badge is-saved">Generated in Odoo</span></dt>
        <dd>The text the person produced with <strong>Generate MoM / EOD</strong> on My Day in Odoo.
          Odoo rewrites it with the planner's AI (NVIDIA API, model set in Odoo Settings —
          ${aiEnabled ? 'currently <strong>on</strong>' : 'currently <strong>off</strong>, no key set'}) and falls back to
          the standard text when the AI is busy. If they generated it more than once that day, the latest one is shown.</dd>
      </div>
      <div>
        <dt><span class="source-badge is-live">Auto from My Day</span></dt>
        <dd>Nobody generated one that day, so Odoo builds the standard MoM / EOD text from the person's My Day:
          planned items, their notes, chatter and stage moves. Same template as Odoo's own, <strong>no AI call</strong>.</dd>
      </div>
      <div>
        <dt>Numbers &amp; charts</dt>
        <dd>Computed by Odoo as each person, with the same methods as their My Tasks banner and charts, so they match
          Odoo exactly. They are always as of now; the date picker only changes the MoM / EOD text and the day counts.
          This page never calls the AI itself.</dd>
      </div>
    </dl>`;
}
