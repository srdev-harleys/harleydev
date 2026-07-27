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
import { renderEnvNavLinks, renderHeroActions } from './modules/environments.js';

async function init() {
  startClock();

  const loader = document.getElementById('page-loader');
  try {
    const config = await loadConfig();
    applyBrand(config.brand);

    const environments = config.brand?.environments || [];
    renderEnvNavLinks(document.getElementById('env-links'), environments);
    renderHeroActions(document.getElementById('hero-actions'), environments);

    // Applications grid: one card per environment (UAT, Integration, Dev),
    // in the same order as the hero/nav, followed by the rest of
    // config.json's applications list (Projects Board, Documentation Hub).
    const envCards = environments.map((env) => ({
      name: env.name,
      url: env.url,
      icon: 'erp',
      status: 'Online',
      environment: env.environment,
    }));
    renderApplications(document.getElementById('apps-grid'), [...envCards, ...(config.applications || [])]);

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
