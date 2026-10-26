/* ==========================================================================
   Ripple Effect — material-style ripple on buttons
   ========================================================================== */
export function attachRipple(element) {
  if (!element) return;
  element.addEventListener('pointerdown', (e) => {
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    element.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}
