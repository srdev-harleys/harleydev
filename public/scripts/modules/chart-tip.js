/* ==========================================================================
   Chart Tip — one shared hover/focus tooltip for the Daily Updates charts.
   Values lead, labels follow; text only (textContent), never markup.
   ========================================================================== */
let tip = null;

function place(x, y) {
  const r = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function show(value, label, x, y) {
  tip ||= document.getElementById('chart-tip');
  if (!tip) return;
  tip.replaceChildren();
  const v = document.createElement('strong');
  v.textContent = value;
  const l = document.createElement('span');
  l.textContent = label;
  tip.append(v, l);
  tip.hidden = false;
  place(x, y);
}

function hide() {
  if (tip) tip.hidden = true;
}

/* Give a mark a tooltip on hover and keyboard focus. */
export function attachTip(el, value, label) {
  el.tabIndex = 0;
  el.setAttribute('aria-label', `${label}: ${value}`);
  el.addEventListener('pointermove', (e) => show(value, label, e.clientX, e.clientY));
  el.addEventListener('pointerleave', hide);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    show(value, label, r.left + r.width / 2, r.top);
  });
  el.addEventListener('blur', hide);
}
