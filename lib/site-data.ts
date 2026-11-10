import 'server-only';
import { unstable_cache } from 'next/cache';
import { callOdoo } from '@/lib/custom-orders';
import { groupOutlets, type City, type OutletKind, type RawOutlet } from '@/lib/outlets';

// Odoo outlets for the public landing page, through the same harleys_custom API as /order (token
// stays server-side). Cached for an hour so visitors never wait on Odoo; a failed call throws inside
// the cache (so the failure isn't cached) and the page renders without the list.

// walk-in outlets only; cloud kitchens and delivery kitchens aren't places customers visit
const MAIN_KINDS: OutletKind[] = ['Ivory Lounge', 'Express Outlet'];

const cachedOutlets = unstable_cache(
  async (): Promise<RawOutlet[]> => (await callOdoo('/outlets', { timeout: 8_000 })).json(),
  ['site-outlets'],
  { revalidate: 3600 },
);

export async function getCities(): Promise<City[]> {
  try {
    return groupOutlets(await cachedOutlets())
      .map((c) => ({ ...c, outlets: c.outlets.filter((o) => MAIN_KINDS.includes(o.kind)) }))
      .filter((c) => c.outlets.length > 0);
  } catch (err) {
    console.error('[site] outlets unavailable:', (err as Error).message);
    return [];
  }
}
