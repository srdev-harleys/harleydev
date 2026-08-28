/* ==========================================================================
   Link Popover — one reusable flyout menu (appended to <body>) for any
   trigger that offers more than one destination for the same link (e.g.
   Dev Link's Public vs Office access points). Positioned next to whichever
   trigger opened it, appended to body so it's never clipped by a card's
   own overflow:hidden or a grid row.
   ========================================================================== */
import { escapeHtml } from './dom-utils.js';

let panel = null;
let activeTrigger = null;

function closePopover() {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
  activeTrigger = null;
}

function positionPanel(trigger) {
  const rect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  let left = rect.left;
  const maxLeft = window.innerWidth - panelRect.width - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  panel.style.top = `${rect.bottom + 8}px`;
  panel.style.left = `${left}px`;
}

function ensurePanel() {
  if (panel) return;
  panel = document.createElement('div');
  panel.className = 'link-popover';
  panel.setAttribute('role', 'menu');
  panel.hidden = true;
  document.body.appendChild(panel);

  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== activeTrigger && !(activeTrigger && activeTrigger.contains(e.target))) {
      closePopover();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });
  window.addEventListener('resize', closePopover);
  window.addEventListener('scroll', closePopover, true);
}

/* Toggle the shared popover open for `trigger`, listing `links`
   ({label, url} objects). Calling this again on the same open trigger
   closes it. */
export function toggleLinkPopover(trigger, links = []) {
  ensurePanel();
  const reopening = activeTrigger === trigger && !panel.hidden;
  closePopover();
  if (reopening) return;

  panel.innerHTML = links
    .map((l) => `<a class="link-popover__item" role="menuitem" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`)
    .join('');
  panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', closePopover));

  panel.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  activeTrigger = trigger;
  positionPanel(trigger);
}
