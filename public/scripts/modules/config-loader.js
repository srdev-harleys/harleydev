/* ==========================================================================
   Config Loader — fetch & parse config.json
   ========================================================================== */
export async function loadConfig() {
  const res = await fetch('config.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load config.json (${res.status})`);
  return res.json();
}
