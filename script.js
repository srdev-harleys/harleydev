/* ==========================================================================
   Harleys Fine Baking ODOO DEV — Landing Page Script (Vanilla JS, ES6 modules)
   --------------------------------------------------------------------------
   Modules:
   1. Icon Library   — inline SVG icon set (no external libs)
   2. Config Loader  — fetch & parse config.json
   3. Clock          — live date & time
   4. Card Renderer  — builds application + info cards from config
   5. Ripple Effect  — material-style ripple on buttons
   6. Bootstrap      — init on DOMContentLoaded
   ========================================================================== */

'use strict';

/* ==========================================================================
   1. ICON LIBRARY
   ========================================================================== */
const Icons = {
  // App / generic ODOO DEV launch
  erp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  // Flask / test
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 14h9"/></svg>',
  // Server / availability
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  // Support headset
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="13" width="4" height="6" rx="1.5"/><rect x="17.5" y="13" width="4" height="6" rx="1.5"/><path d="M20 19v1a3 3 0 0 1-3 3h-4"/></svg>',
  // External link arrow
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>'
};

/* Resolve an icon key to markup, falling back to the ODOO DEV grid icon. */
function getIcon(key) {
  return Icons[key] || Icons.erp;
}

/* ==========================================================================
   2. CONFIG LOADER
   ========================================================================== */
async function loadConfig() {
  const res = await fetch('config.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load config.json (${res.status})`);
  return res.json();
}

/* ==========================================================================
   3. CLOCK (live date & time)
   ========================================================================== */
function startClock() {
  const clockEl = document.getElementById('clock');
  if (!clockEl) return;

  const fmtTime = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const fmtDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  });

  const tick = () => {
    const now = new Date();
    clockEl.textContent = `${fmtDate.format(now)} · ${fmtTime.format(now)}`;
    clockEl.setAttribute('datetime', now.toISOString());
  };

  tick();
  setInterval(tick, 1000);
}

/* ==========================================================================
   4. CARD RENDERER
   ========================================================================== */

/* Build application launcher cards from the "applications" array. */
function renderApplications(container, applications = []) {
  if (!container) return;
  container.innerHTML = '';

  applications.forEach((app) => {
    const isOnline = (app.status || '').toLowerCase() === 'online';
    const isFeatured = !!app.featured;
    const card = document.createElement('a');
    card.className = 'app-card' + (isFeatured ? ' is-featured' : '');
    card.href = app.url || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `Launch ${app.name || 'application'}`);

    card.innerHTML = `
      ${isFeatured ? '<span class="app-card__ribbon">Primary</span>' : ''}
      <div class="app-card__head">
        <div class="app-card__icon" aria-hidden="true">${getIcon(app.icon)}</div>
        <span class="status-pill ${isOnline ? 'is-online' : 'is-offline'}">
          <span class="dot" aria-hidden="true"></span>${app.status || 'Unknown'}
        </span>
      </div>
      <div>
        <h3 class="app-card__name">${escapeHtml(app.name || 'Application')}</h3>
        <span class="app-card__env">${escapeHtml(app.environment || 'Environment')}</span>
      </div>
      <span class="app-card__launch">
        Launch ${getIcon('external')}
      </span>
    `;
    container.appendChild(card);
  });

  if (!applications.length) {
    container.innerHTML = '<p class="section-subtitle">No applications configured.</p>';
  }
}

/* Build static information cards from the "infoCards" array. */
function renderInfoCards(container, infoCards = []) {
  if (!container) return;
  container.innerHTML = '';

  infoCards.forEach((card) => {
    const el = document.createElement('article');
    el.className = 'info-card';
    el.setAttribute('role', 'listitem');
    el.innerHTML = `
      <div class="info-card__icon" aria-hidden="true">${getIcon(card.icon)}</div>
      <h3 class="info-card__title">${escapeHtml(card.title || 'Information')}</h3>
      <p class="info-card__desc">${escapeHtml(card.description || '')}</p>
    `;
    container.appendChild(el);
  });
}

/* Apply brand-level text from config to the hero / nav / footer. */
function applyBrand(brand = {}) {
  setText('hero-title', brand.name);
  setText('hero-subtitle', brand.subtitle);
  setText('hero-desc', brand.description);
  setText('env-badge', brand.environment || 'Testing');

  const launchBtn = document.getElementById('launch-btn');
  if (launchBtn) {
    if (brand.launchUrl) launchBtn.href = brand.launchUrl;
    const label = launchBtn.querySelector('.btn-label');
    if (label && brand.launchLabel) label.textContent = brand.launchLabel;
  }

  if (brand.footer) {
    setText('footer-powered', brand.footer.poweredBy);
    setText('footer-notice', brand.footer.notice);
    document.title = `${brand.name} — ${brand.subtitle || ''}`.trim();
  }
}

/* Small helpers */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value != null) el.textContent = value;
}
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   5. RIPPLE EFFECT
   ========================================================================== */
function attachRipple(element) {
  if (!element) return;
  element.addEventListener('pointerdown', (e) => {
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    element.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}

/* ==========================================================================
   6. BOOTSTRAP
   ========================================================================== */
async function init() {
  startClock();
  attachRipple(document.getElementById('launch-btn'));

  const loader = document.getElementById('page-loader');
  try {
    const config = await loadConfig();
    applyBrand(config.brand);
    renderApplications(document.getElementById('apps-grid'), config.applications);
    renderInfoCards(document.getElementById('info-grid'), config.infoCards);
  } catch (err) {
    console.error('[Harleys ODOO DEV] Config error:', err);
    const grid = document.getElementById('apps-grid');
    if (grid) grid.innerHTML =
      '<p class="section-subtitle">Unable to load applications. Please check config.json.</p>';
  } finally {
    // Hide loader + reveal content
    if (loader) loader.classList.add('hidden');
    document.body.classList.add('ready');
  }
}

document.addEventListener('DOMContentLoaded', init);
