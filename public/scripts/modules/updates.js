/* ==========================================================================
   Updates Renderer — builds the "Recent Updates" list from config
   ========================================================================== */
import { getIcon } from './icons.js';
import { escapeHtml } from './dom-utils.js';

export function renderUpdates(container, updates = []) {
  if (!container) return;
  container.innerHTML = '';

  const fmtDate = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });

  updates.forEach((update) => {
    const el = document.createElement('article');
    el.className = 'update-item';
    el.setAttribute('role', 'listitem');

    const parsed = update.date ? new Date(update.date) : null;
    const dateLabel = parsed && !isNaN(parsed) ? fmtDate.format(parsed) : (update.date || '');

    el.innerHTML = `
      <time class="update-item__date" datetime="${escapeHtml(update.date || '')}">${escapeHtml(dateLabel)}</time>
      <div class="update-item__body">
        <h3 class="update-item__title">${escapeHtml(update.title || 'Update')}</h3>
        <p class="update-item__desc">${escapeHtml(update.description || '')}</p>
        ${update.link ? `
        <a class="update-item__link" href="${escapeHtml(update.link)}">
          ${escapeHtml(update.linkLabel || 'Read more')} ${getIcon('external')}
        </a>` : ''}
      </div>
    `;
    container.appendChild(el);
  });

  if (!updates.length) {
    container.innerHTML = '<p class="section-subtitle">No recent updates.</p>';
  }
}
