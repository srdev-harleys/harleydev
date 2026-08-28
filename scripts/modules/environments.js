/* ==========================================================================
   Environments — renders the environment links that appear in the top nav
   and the hero actions. config.json's brand.environments is the single
   source of truth for both, and (via main.js) for the matching Applications
   cards too. An entry with a "links" array (more than one destination, e.g.
   Dev Link's Public/Office access points) renders as a dropdown trigger
   instead of a plain link — see link-popover.js.
   ========================================================================== */
import { escapeHtml } from './dom-utils.js';
import { attachRipple } from './ripple.js';
import { toggleLinkPopover } from './link-popover.js';
import { getIcon } from './icons.js';

function caretIcon() {
  return getIcon('chevronDown').replace('<svg ', '<svg class="dropdown-caret" ');
}

export function renderEnvNavLinks(container, environments = []) {
  if (!container) return;
  container.innerHTML = '';

  environments.forEach((env) => {
    const hasMultiLink = Array.isArray(env.links) && env.links.length > 1;

    if (hasMultiLink) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'topnav__link topnav__link--dropdown';
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = `${escapeHtml(env.name)} ${caretIcon()}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLinkPopover(btn, env.links);
      });
      container.appendChild(btn);
    } else {
      const a = document.createElement('a');
      a.className = 'topnav__link';
      a.href = env.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = env.name;
      container.appendChild(a);
    }
  });
}

export function renderHeroActions(container, environments = []) {
  if (!container) return;
  container.innerHTML = '';

  environments.forEach((env) => {
    const hasMultiLink = Array.isArray(env.links) && env.links.length > 1;
    const btn = document.createElement(hasMultiLink ? 'button' : 'a');
    btn.className = 'btn-primary' + (hasMultiLink ? ' btn-primary--dropdown' : '');

    if (hasMultiLink) {
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = `<span class="btn-label">${escapeHtml(env.name)}</span> ${caretIcon()}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLinkPopover(btn, env.links);
      });
    } else {
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
    }

    container.appendChild(btn);
    attachRipple(btn);
  });
}
