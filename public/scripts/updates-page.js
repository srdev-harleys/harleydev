/* ==========================================================================
   Harleys Fine Baking ODOO DEV — Daily Updates page (updates.html)
   --------------------------------------------------------------------------
   Same shell as the launcher (clock, nav links, brand text from config.json);
   everything else comes from /api/updates, which asks the inhouse Odoo.
   The date + MoM/EOD filters scope the whole page.
   ========================================================================== */
import { loadConfig } from './modules/config-loader.js';
import { startClock } from './modules/clock.js';
import { renderEnvNavLinks } from './modules/environments.js';
import { renderPipeline, renderToProduction, renderTeamTable, renderSourceNotes } from './modules/team-analytics.js';
import { renderPeople } from './modules/daily-updates.js';
import { setText, copyText } from './modules/dom-utils.js';

const STORAGE_KEY = 'harleys.dailyUpdates.kind';
const KIND_LABEL = { mom: 'Sprint MoM', eod: 'EOD' };
const ERROR_TEXT = {
  unreachable: 'Odoo is not reachable right now (the inhouse server or its tunnel may be down).',
  forbidden: 'Odoo refused the request: the portal token does not match.',
  not_configured: 'The portal is not connected to Odoo yet (missing settings).',
};

// today's date in IST (Odoo's planner runs on Asia/Kolkata), as YYYY-MM-DD
function istToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function readKind() {
  try { return localStorage.getItem(STORAGE_KEY) === 'mom' ? 'mom' : 'eod'; } catch { return 'eod'; }
}

async function applyShell() {
  try {
    const config = await loadConfig();
    const brand = config.brand || {};
    setText('env-badge', brand.environment || 'Testing');
    renderEnvNavLinks(document.getElementById('env-links'), brand.environments || []);
    if (brand.footer) {
      setText('footer-powered', brand.footer.poweredBy);
      setText('footer-notice', brand.footer.notice);
    }
  } catch (err) {
    console.error('[Harleys ODOO DEV] Config error:', err); // the page still works without the nav links
  }
}

function init() {
  startClock();
  applyShell();

  const body = document.getElementById('daily-body');
  const summary = document.getElementById('daily-summary');
  const dateInput = document.getElementById('daily-date');
  const kindButtons = document.querySelectorAll('.segmented__btn');
  const copyAll = document.getElementById('copy-all');

  const params = new URLSearchParams(location.search);
  const state = { kind: readKind(), date: params.get('date') || istToday(), data: null, error: null, loading: false };
  dateInput.value = state.date;
  dateInput.max = istToday();

  const render = () => {
    kindButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === state.kind)));
    body.classList.toggle('is-loading', state.loading); // refetch keeps the old render, dimmed

    if (state.error) {
      summary.textContent = fmtDay(state.date);
      body.hidden = true;
      showMessage(`<p>${ERROR_TEXT[state.error] || 'Could not load the updates.'}</p>
        <button type="button" class="chip-btn" data-retry>Try again</button>`);
      document.querySelector('[data-retry]').addEventListener('click', load);
      return;
    }
    if (!state.data) {
      summary.textContent = `Loading ${fmtDay(state.date)}…`;
      return;
    }
    showMessage('');
    body.hidden = false;
    const { data } = state;
    const people = data.people || [];
    const withText = people.filter((p) => p[state.kind]?.text).length;
    const article = state.kind === 'eod' ? 'an' : 'a';
    summary.textContent = `${fmtDay(data.date)} · ${withText} of ${people.length} with ${article} ${KIND_LABEL[state.kind]} · live from Odoo`;

    renderPipeline(document.getElementById('pipeline'), data.pipeline, people);
    renderToProduction(document.getElementById('to-production'), (data.to_production || []).slice(0, 5));
    renderTeamTable(document.getElementById('team-table'), people);
    renderPeople(document.getElementById('people'), people, state.kind);
    setText('people-hint', `${KIND_LABEL[state.kind]} for ${fmtDay(data.date)}, with each person's My Tasks charts (as of now).`);
    renderSourceNotes(document.getElementById('source-notes'), data.ai_enabled);
  };

  function showMessage(html) {
    let box = document.getElementById('daily-message');
    if (!box) {
      box = document.createElement('div');
      box.id = 'daily-message';
      box.className = 'daily__message';
      body.before(box);
    }
    box.innerHTML = html;
    box.hidden = !html;
  }

  let requestId = 0;
  async function load() {
    const id = ++requestId;
    state.loading = true;
    state.error = null;
    render();
    try {
      const res = await fetch(`/api/updates?date=${encodeURIComponent(state.date)}`);
      const json = await res.json().catch(() => ({}));
      if (id !== requestId) return; // a newer date was picked meanwhile
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      state.data = json;
    } catch (err) {
      if (id !== requestId) return;
      console.error('[Daily Updates]', err);
      state.error = err.message;
    }
    state.loading = false;
    render();
  }

  kindButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.kind = btn.dataset.kind;
    try { localStorage.setItem(STORAGE_KEY, state.kind); } catch { /* private mode */ }
    render();
  }));

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    state.date = dateInput.value;
    const url = new URL(location.href);
    url.searchParams.set('date', state.date);
    history.replaceState(null, '', url);
    load();
  });

  copyAll.addEventListener('click', () => {
    const texts = (state.data?.people || []).map((p) => p[state.kind]?.text).filter(Boolean);
    if (texts.length) copyText(copyAll, texts.join('\n\n'));
  });

  load().finally(() => {
    document.getElementById('page-loader')?.classList.add('hidden');
    document.body.classList.add('ready');
  });
}

document.addEventListener('DOMContentLoaded', init);
