/* ==========================================================================
   Card Renderer — builds application + info cards from config
   ========================================================================== */
import { getIcon } from './icons.js';
import { escapeHtml } from './dom-utils.js';

/* Build application launcher cards from the "applications" array. */
export function renderApplications(container, applications = []) {
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
