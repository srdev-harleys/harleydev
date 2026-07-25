/* ==========================================================================
   Small DOM helpers shared across renderer modules
   ========================================================================== */
export function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value != null) el.textContent = value;
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
