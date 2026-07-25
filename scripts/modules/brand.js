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
  if (launchBtn) {
    if (brand.launchUrl) launchBtn.href = brand.launchUrl;
    const label = launchBtn.querySelector('.btn-label');
    if (label && brand.launchLabel) label.textContent = brand.launchLabel;
  }

  if (brand.footer) {
    setText('footer-powered', brand.footer.poweredBy);
    setText('footer-notice', brand.footer.notice);
    document.title = `${brand.name} — ${brand.subtitle || ''}`.trim();
  }
}
