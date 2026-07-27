/* ==========================================================================
   Brand — applies brand-level text from config to the hero / nav / footer
   ========================================================================== */
import { setText } from './dom-utils.js';

export function applyBrand(brand = {}) {
  setText('hero-title', brand.name);
  setText('hero-subtitle', brand.subtitle);
  setText('hero-desc', brand.description);
  setText('env-badge', brand.environment || 'Testing');

  const projectsLink = document.getElementById('projects-link');
  if (projectsLink && brand.projectsUrl) projectsLink.href = brand.projectsUrl;

  if (brand.footer) {
    setText('footer-powered', brand.footer.poweredBy);
    setText('footer-notice', brand.footer.notice);
    document.title = `${brand.name} — ${brand.subtitle || ''}`.trim();
  }
}
