/* ==========================================================================
   Harleys Fine Baking ODOO DEV — Landing Page Script (ES Modules)
   --------------------------------------------------------------------------
   Entry point, loaded as <script type="module">. Each concern lives in its
   own file under modules/ — this file only wires them together and boots
   the page. index.html only ever references this one file.
   ========================================================================== */
import { loadConfig } from './modules/config-loader.js';
import { startClock } from './modules/clock.js';
import { renderApplications, renderInfoCards } from './modules/cards.js';
import { renderUpdates } from './modules/updates.js';
import { applyBrand } from './modules/brand.js';
import { attachRipple } from './modules/ripple.js';

async function init() {
  startClock();
  attachRipple(document.getElementById('launch-btn'));

  const loader = document.getElementById('page-loader');
  try {
    const config = await loadConfig();
    applyBrand(config.brand);
    renderApplications(document.getElementById('apps-grid'), config.applications);
    renderInfoCards(document.getElementById('info-grid'), config.infoCards);
    renderUpdates(document.getElementById('updates-list'), config.recentUpdates);
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
