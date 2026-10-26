/* ==========================================================================
   Daily Updates Renderer — one row per person: their MoM or EOD text next
   to their My Tasks charts (open tasks by stage, done per day over 14 days).
   Data comes from /api/updates (the inhouse Odoo).
   ========================================================================== */
import { escapeHtml, copyText } from './dom-utils.js';
import { attachTip } from './chart-tip.js';

const KIND_LABEL = { mom: 'Sprint MoM', eod: 'EOD' };
const SOURCE_LABEL = { saved: 'Generated in Odoo', live: 'Auto from My Day' };

const fmtShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

function stageBars(byStage = []) {
  if (!byStage.length) return '<p class="person__empty">No open tasks</p>';
  const max = Math.max(1, ...byStage.map((s) => s.count));
  return `<ul class="mini-bars mini-bars--stages">${byStage.map((s) => `
    <li class="mini-bars__row">
      <span class="mini-bars__name">${escapeHtml(s.label)}</span>
      <span class="mini-bars__track"><span class="mini-bars__bar" style="width:${(100 * s.count) / max}%"></span></span>
      <span class="mini-bars__n">${s.count}</span>
    </li>`).join('')}</ul>`;
}

function activityChart(el, activity = []) {
  const max = Math.max(1, ...activity.map((d) => d.closed));
  const cols = el.querySelector('.activity__cols');
  const peak = activity.findIndex((d) => d.closed && d.closed === max); // only the tallest bar is labelled
  activity.forEach((d, i) => {
    const col = document.createElement('span');
    col.className = 'activity__col';
    const height = d.closed ? Math.max(6, (100 * d.closed) / max) : 0;
    col.innerHTML = `<span class="activity__bar${d.closed ? '' : ' is-zero'}" style="height:${height}%"></span>`
      + (i === peak ? `<span class="activity__peak" style="bottom:calc(${height}% + 2px)">${d.closed}</span>` : '');
    attachTip(col, `${d.closed} done`, fmtLong.format(new Date(`${d.date}T00:00:00`)));
    cols.appendChild(col);
  });
  if (activity.length) {
    el.querySelector('.activity__from').textContent = fmtShort.format(new Date(`${activity[0].date}T00:00:00`));
    el.querySelector('.activity__to').textContent = 'Today';
  }
}

export function renderPeople(container, people = [], kind = 'eod') {
  if (!container) return;
  container.innerHTML = '';
  const label = KIND_LABEL[kind];

  people.forEach((person) => {
    const report = person[kind] || {};
    const day = person.day || {};
    const charts = person.charts;
    const activity = charts?.activity || [];
    const done14 = activity.reduce((n, d) => n + d.closed, 0);
    const openNow = person.dashboard?.open;

    const el = document.createElement('article');
    el.className = 'person';
    el.setAttribute('role', 'listitem');
    el.innerHTML = `
      <div class="person__report">
        <header class="person__head">
          <h3 class="person__name">${escapeHtml(person.name)}</h3>
          <ul class="person__day" aria-label="Their day">
            <li><strong>${day.planned ?? 0}</strong> planned</li>
            <li><strong>${day.done ?? 0}</strong> done</li>
            <li><strong>${day.carried ?? 0}</strong> carried over</li>
          </ul>
        </header>
        ${report.text ? `
          <div class="person__source">
            <span class="source-badge is-${escapeHtml(report.source)}">${escapeHtml(SOURCE_LABEL[report.source] || '')}</span>
            ${report.at ? `<span class="person__at">at ${escapeHtml(fmtTime.format(new Date(report.at)))}</span>` : ''}
            <button type="button" class="chip-btn" data-copy>Copy</button>
          </div>
          <pre class="person__text">${escapeHtml(report.text)}</pre>`
        : `<p class="person__empty">${report.source === 'error'
            ? `Could not build the ${label} for this person.`
            : `No ${label} for this day: nothing planned on their My Day.`}</p>`}
      </div>
      <div class="person__charts">
        <section>
          <h4 class="person__chart-title">Tasks by stage</h4>
          ${charts ? stageBars(charts.by_stage) : '<p class="person__empty">Charts unavailable</p>'}
        </section>
        <section class="activity">
          <h4 class="person__chart-title">Done per day · last 14 days</h4>
          <div class="activity__cols" role="img" aria-label="Tasks done per day over the last 14 days"></div>
          <div class="activity__axis"><span class="activity__from"></span><span class="activity__to"></span></div>
          <p class="activity__caption"><strong>${done14}</strong> done in 14 days${openNow != null ? ` · <strong>${openNow}</strong> open now` : ''}</p>
        </section>
      </div>`;
    el.querySelector('[data-copy]')?.addEventListener('click', (e) => copyText(e.currentTarget, report.text));
    if (charts) activityChart(el.querySelector('.activity'), activity);
    container.appendChild(el);
  });
}
