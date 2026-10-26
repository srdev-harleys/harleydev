/* ==========================================================================
   Clock — live date & time
   ========================================================================== */
export function startClock() {
  const clockEl = document.getElementById('clock');
  if (!clockEl) return;

  const fmtTime = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const fmtDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  });

  const tick = () => {
    const now = new Date();
    clockEl.textContent = `${fmtDate.format(now)} · ${fmtTime.format(now)}`;
    clockEl.setAttribute('datetime', now.toISOString());
  };

  tick();
  setInterval(tick, 1000);
}
