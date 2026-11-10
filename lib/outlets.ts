// Turns Odoo's internal outlet records (/outlets, e.g. "KA-BLR-Cloud FC HSR Layout") into what the
// public site shows: a clean locality name, a customer-facing type and a city, grouped by city.

export type RawOutlet = { id: number; name: string; code: string; area: string; km: number | null };

export type OutletKind = 'Ivory Lounge' | 'Express Outlet' | 'Cloud Kitchen' | 'Delivery Kitchen';

export type Outlet = {
  id: number;
  code: string;
  name: string; // the locality, e.g. "HSR Layout"
  kind: OutletKind;
  city: string;
  area: string; // cleaned address, '' when Odoo has none
  comingSoon: boolean;
  mapsUrl: string;
};

export type City = { key: string; name: string; image: string; outlets: Outlet[] };

// code prefix → city, in the order the site lists them (Hyderabad is home)
export const CITIES: { key: string; name: string; image: string }[] = [
  { key: 'HYD', name: 'Hyderabad', image: '/assets/site/hyderabad.webp' },
  { key: 'BLR', name: 'Bengaluru', image: '/assets/site/bengaluru.webp' },
  { key: 'MUM', name: 'Mumbai', image: '/assets/site/mumbai.webp' },
  { key: 'PUN', name: 'Pune', image: '/assets/site/pune.webp' },
  { key: 'NCR', name: 'Delhi NCR', image: '/assets/site/ncr.webp' },
  { key: 'VIJ', name: 'Vijayawada', image: '/assets/site/vijayawada.webp' },
];

// most specific first; "Lower Parel FC" has no "Cloud" in it
const KINDS: [RegExp, OutletKind][] = [
  [/ivory lounge/i, 'Ivory Lounge'],
  [/express outlet/i, 'Express Outlet'],
  [/cloud kitchen/i, 'Cloud Kitchen'],
  [/(cloud )?fc\b/i, 'Delivery Kitchen'],
];

const KIND_ORDER: OutletKind[] = ['Ivory Lounge', 'Express Outlet', 'Cloud Kitchen', 'Delivery Kitchen'];

function titleCase(s: string): string {
  // only fix ALL-CAPS words of 5+ letters ("GUNTUR"), keep codes like "BKC", "PCMC", "NBL"
  return s.replace(/\b[A-Z]{5,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
}

function cleanArea(area: string): string {
  const a = area
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ');
  return /not decided/i.test(a) ? '' : a;
}

export function toOutlet(raw: RawOutlet): Outlet | null {
  const city = CITIES.find((c) => raw.code.startsWith(`${c.key}-`));
  if (!city) return null; // HARLEYS GROUP (WH) and anything not yet mapped to a city
  const match = KINDS.find(([re]) => re.test(raw.name));
  const kind = match?.[1] ?? 'Delivery Kitchen';

  // drop the "TG-HYD-" / "NCR - " prefix, then the type words, then stray dashes
  let name = raw.name.replace(/^[A-Z]{2,3}\s*-\s*([A-Z]{3}\s*-\s*)?/, '');
  name = name.replace(/ivory lounge|express outlet|cloud kitchen|cloud fc|\bfc\b/gi, '');
  name = titleCase(name.replace(/^[\s-]+|[\s-]+$/g, '').replace(/\s+/g, ' ')) || city.name;

  const area = cleanArea(raw.area);
  const query = `Harley's Fine Baking ${name} ${city.name}`;
  return {
    id: raw.id,
    code: raw.code,
    name,
    kind,
    city: city.name,
    area,
    comingSoon: /not decided/i.test(raw.area),
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
  };
}

/** Clean, de-duplicate (Odoo has two VIJ-GTR records) and group by city; customer-facing types first. */
export function groupOutlets(raw: RawOutlet[]): City[] {
  const byCode = new Map<string, Outlet>();
  for (const r of raw) {
    const o = toOutlet(r);
    if (!o) continue;
    const prev = byCode.get(o.code);
    if (!prev || (!prev.area && o.area)) byCode.set(o.code, o);
  }
  const outlets = [...byCode.values()];
  return CITIES.map((c) => ({
    ...c,
    outlets: outlets
      .filter((o) => o.city === c.name)
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)),
  })).filter((c) => c.outlets.length > 0);
}
