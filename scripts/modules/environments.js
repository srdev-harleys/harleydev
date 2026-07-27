/* ==========================================================================
   Environments — renders the Production / UAT Test / Integration Test / Dev
   links that appear in the top nav and the hero actions. config.json's
   brand.environments is the single source of truth for both, and (via
   main.js) for the matching Applications cards too.
   ========================================================================== */
import { escapeHtml } from './dom-utils.js';
import { attachRipple } from './ripple.js';

export function renderEnvNavLinks(container, environments = []) {
  if (!container) return;
  container.innerHTML = environments
    .map((env) => `<a class="topnav__link" href="${escapeHtml(env.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(env.name)}</a>`)
    .join('');
}

export function renderHeroActions(container, environments = []) {
  if (!container) return;
  container.innerHTML = '';

  environments.forEach((env) => {
    const btn = document.createElement('a');
    btn.className = 'btn-primary';
    btn.href = env.url;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.setAttribute('role', 'button');
    btn.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M14 3v2h3.59l-9.3 9.29 1.42 1.42L19 6.41V10h2V3m-2 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2Z"/>
      </svg>
      <span class="btn-label">${escapeHtml(env.name)}</span>
    `;
    container.appendChild(btn);
    attachRipple(btn);
  });
}
