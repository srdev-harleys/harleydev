/* ==========================================================================
   Sidebar — the Odoo portal's quick-access links, built from the same
   config.json lists as the cards (brand.environments + applications), plus
   the mobile open/close toggle.
   ========================================================================== */
import { escapeHtml } from './dom-utils.js';

const APP_ICONS = { phone: '📱', board: '📋', docs: '📘' };

function isExternal(url) {
  return /^https?:\/\//.test(url);
}

function linkItem({ name, url, download, icon, note }) {
  const target = isExternal(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
  const dl = download ? ` download="${escapeHtml(download)}"` : '';
  return `<li><a href="${escapeHtml(url)}"${target}${dl}>
    <span class="portal-side__ico" aria-hidden="true">${icon}</span>${escapeHtml(name)}
    ${note ? `<span class="portal-side__note">${escapeHtml(note)}</span>` : ''}
  </a></li>`;
}

export function renderSidebar(config) {
  const envs = document.getElementById('side-envs');
  const apps = document.getElementById('side-apps');
  if (envs) {
    envs.innerHTML = (config.brand?.environments || [])
      .map((env) => linkItem({ name: env.name, url: env.url, icon: '🟣', note: env.environment }))
      .join('');
  }
  if (apps) {
    apps.innerHTML = (config.applications || [])
      .map((app) => linkItem({
        name: app.name.replace(/^Harley's /, ''),
        url: app.url,
        download: app.download,
        icon: APP_ICONS[app.icon] || '🔗',
      }))
      .join('');
  }
}

export function initSidebarToggle() {
  const btn = document.getElementById('portal-menu');
  const side = document.getElementById('portal-side');
  if (!btn || !side) return;
  const set = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('portal--side-open', open);
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  side.addEventListener('click', (e) => {
    if (e.target.closest('a')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
}

export function renderToday() {
  const el = document.getElementById('portal-date');
  if (!el) return;
  el.textContent = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(new Date());
}
