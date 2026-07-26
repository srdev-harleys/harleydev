/* ==========================================================================
   Brand — applies brand-level text from config to the hero / nav / footer
   ========================================================================== */
import { setText } from './dom-utils.js';

export function applyBrand(brand = {}) {
  setText('hero-title', brand.name);
  setText('hero-subtitle', brand.subtitle);
  setText('hero-desc', brand.description);
  setText('env-badge', brand.environment || 'Testing');

  const launchBtn = document.getElementById('launch-btn');
  if (launchBtn && brand.launchUrl) launchBtn.href = brand.launchUrl;

  // Top-nav quick links — same source of truth as the hero button and the
  // Applications cards (config.json), so the URL only ever lives in one file.
  const devLink = document.getElementById('dev-link');
  if (devLink && brand.launchUrl) devLink.href = brand.launchUrl;
  const projectsLink = document.getElementById('projects-link');
  if (projectsLink && brand.projectsUrl) projectsLink.href = brand.projectsUrl;

  if (brand.footer) {
    setText('footer-powered', brand.footer.poweredBy);
    setText('footer-notice', brand.footer.notice);
    document.title = `${brand.name} — ${brand.subtitle || ''}`.trim();
  }
}
