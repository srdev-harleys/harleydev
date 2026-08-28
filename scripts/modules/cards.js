/* ==========================================================================
   Card Renderer — builds application + info cards from config
   ========================================================================== */
import { getIcon } from './icons.js';
import { escapeHtml } from './dom-utils.js';
import { toggleLinkPopover } from './link-popover.js';

/* Build application launcher cards from the "applications" array.
   An entry with no "url" of its own (e.g. the primary dev-environment
   card) falls back to defaultUrl — config.json's brand.launchUrl — so
   that link only ever needs to be written down once. An entry with a
   "links" array (more than one destination, e.g. Dev Link's Public/Office
   access points) renders its Launch control as a dropdown trigger instead
   of a direct link — see link-popover.js. */
export function renderApplications(container, applications = [], defaultUrl = '#') {
  if (!container) return;
  container.innerHTML = '';

  applications.forEach((app) => {
    const isOnline = (app.status || '').toLowerCase() === 'online';
    const isFeatured = !!app.featured;
    const hasMultiLink = Array.isArray(app.links) && app.links.length > 1;

    const card = document.createElement(hasMultiLink ? 'div' : 'a');
    card.className = 'app-card' + (isFeatured ? ' is-featured' : '');
    if (!hasMultiLink) {
      card.href = app.url || defaultUrl;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
    }
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `Launch ${app.name || 'application'}`);

    const launchMarkup = hasMultiLink
      ? `<button type="button" class="app-card__launch app-card__launch--btn" aria-haspopup="true" aria-expanded="false">
          Launch ${getIcon('chevronDown')}
        </button>`
      : `<span class="app-card__launch">
          Launch ${getIcon('external')}
        </span>`;

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
      ${launchMarkup}
    `;
    container.appendChild(card);

    if (hasMultiLink) {
      const trigger = card.querySelector('.app-card__launch--btn');
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLinkPopover(trigger, app.links);
      });
    }
  });

  if (!applications.length) {
    container.innerHTML = '<p class="section-subtitle">No applications configured.</p>';
  }
}

/* Build static information cards from the "infoCards" array. */
export function renderInfoCards(container, infoCards = []) {
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
