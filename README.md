# Harleys Fine Baking ODOO DEV — Landing Page

A premium, enterprise-grade internal portal launcher for the **Harleys Fine Baking ODOO DEV**
testing environment. Built with vanilla HTML5, CSS3, and JavaScript — no frameworks, no
build step, no external JavaScript libraries.

The page resembles an enterprise application launcher (à la Microsoft Azure Portal /
AWS Console) and dynamically renders application cards from a single `config.json`.
Brand colors and fonts match the public **harleys.com** site.

## Features

- ✔ Glassmorphism cards (backdrop blur + translucency)
- ✔ Smooth fade / rise page transitions
- ✔ Button hover animations + material **ripple** effect
- ✔ Animated background gradients + subtle grid
- ✔ Live date & time clock in the navigation bar
- ✔ A "Recent Updates" changelog, driven by `config.json`
- ✔ Responsive & mobile optimized (CSS Grid + Flexbox)
- ✔ **Dark mode** via `prefers-color-scheme`
- ✔ Accessible (semantic HTML, ARIA roles, `:focus-visible`, reduced-motion support)
- ✔ Keyboard navigable
- ✔ SEO meta tags + Open Graph tags
- ✔ Favicon + logo placeholders
- ✔ Loading animation
- ✔ CSS split into one file per concern under `styles/` — no single giant stylesheet
- ✔ JavaScript split into ES modules under `scripts/modules/` — no single giant script
- ✔ No external JavaScript libraries

## Folder Structure

```
/
├── index.html              # Semantic markup, SEO/OG meta, favicon
├── config.json              # Single source of truth for apps, brand text & updates
├── styles/
│   ├── tokens.css            # Raw brand colors & fonts (edit this to re-theme)
│   ├── theme.css               # Maps raw tokens → semantic vars (--primary, --bg...)
│   ├── base.css                  # Reset & base element styles
│   ├── background.css             # Animated gradient + grid
│   ├── loader.css                  # Page loader & page-transition animation
│   ├── topnav.css                   # Top navigation bar
│   ├── hero.css                      # Hero section
│   ├── buttons.css                    # Primary button + ripple
│   ├── app-cards.css                   # Application launcher cards
│   ├── info-cards.css                   # Environment info cards
│   ├── updates.css                       # Recent updates list
│   ├── footer.css                         # Footer
│   ├── responsive.css                      # Mobile breakpoints
│   ├── dark-mode.css                        # prefers-color-scheme: dark
│   ├── accessibility.css                     # Reduced motion / focus states
│   └── main.css                               # Entry point — @imports all of the above
├── scripts/
│   ├── modules/
│   │   ├── icons.js         # Inline SVG icon library
│   │   ├── dom-utils.js      # escapeHtml / setText helpers
│   │   ├── config-loader.js   # fetch('config.json')
│   │   ├── clock.js             # Live date & time
│   │   ├── cards.js               # Renders application + info cards
│   │   ├── updates.js              # Renders the Recent Updates list
│   │   ├── brand.js                 # Applies brand text from config
│   │   └── ripple.js                 # Button ripple effect
│   └── main.js                         # Entry point — imports modules, boots the page
├── assets/
│   ├── logo.png            # Logo (Harley's crest, used in topnav + hero)
│   ├── favicon.png         # Favicon (gold crown crest)
│   └── icons/              # Reserved for future image assets
├── docs/                   # User & Developer documentation site (own README-equivalent
│                            # structure under docs/assets/ — see docs/index.html)
└── README.md
```

Each stylesheet and script module is scoped to exactly one concern, so a future change
(e.g. "restyle the footer" or "add a new card type") touches exactly one file instead of
searching one large `style.css` / `script.js`.

## Adding / Editing Applications

You only need to edit **`config.json`** — no HTML changes required.

```json
{
  "applications": [
    {
      "name": "Harleys ODOO DEV Testing",
      "url": "https://admin.taildfc619.ts.net/",
      "icon": "erp",
      "status": "Online",
      "environment": "Testing",
      "featured": true
    },
    {
      "name": "Harleys Projects Board",
      "url": "https://github.com/users/harleystech/projects/1/views/1",
      "icon": "board",
      "status": "Online",
      "environment": "Task Tracking"
    },
    {
      "name": "Documentation Hub",
      "url": "docs/index.html",
      "icon": "docs",
      "status": "Online",
      "environment": "User & Developer Guides"
    }
  ]
}
```

The "Recent Updates" section works the same way, via the top-level `recentUpdates` array
— add a `{ date, title, description, link, linkLabel }` entry and it appears automatically.

Available icon keys: `erp`, `flask`, `server`, `support`, `board`, `docs`.
Add more by extending the `Icons` object in `scripts/modules/icons.js`.

## Available Icons

| Key        | Used for                          |
|------------|-----------------------------------|
| `erp`      | Application launcher (default)    |
| `flask`    | Testing Environment info card     |
| `server`   | Availability info card            |
| `support`  | Support info card                 |
| `board`    | Project/task-tracking links       |
| `docs`     | Documentation links                |

## Local Development

Any static server works. From the project root:

```bash
# Python
python3 -m http.server 8000
# then open http://localhost:8000

# or Node
npx serve .
```

> A static server is **required** — both `fetch('config.json')` and the ES module
> `<script type="module">` in `index.html` are blocked on `file://` by browsers. On
> Vercel (or any static host) this works out of the box.

## Hygiene Audit dashboard (`/audit`)

Monthly outlet ranking recomputed from the audit Google Sheet: audit × 80% + rating trend (10)
+ OptiPulse (10), ranked per Cloud Kitchen / PO, with every tab of the sheet on the page and a
Data health list of sheet cells that disagree with their inputs.

| Piece | File |
|---|---|
| Scoring (mirrors the sheet's formulas; the Audit Summary's month shows the Summary's own numbers) | `lib/audit/compute.ts` |
| Sheet reading, push intake, sync rules, shared store (Upstash Redis or a local file) | `lib/audit/source.ts` |
| Check for both, Google and Redis mocked | `node lib/audit/audit.check.mjs` |
| API: `/api/audit` (data), `/api/audit/status` (version, polled), `/api/audit/webhook` (sheet push) | `app/api/audit/[[...path]]/route.ts` |
| Page | `public/audit.html`, `public/scripts/audit-page.js`, `public/scripts/modules/audit-views.js`, `public/styles/audit.css` |
| Sheet trigger (Apps Script) | `scripts/audit-sheet-trigger.gs` |
| Public address for the trigger, local only (cloudflared quick tunnel, webhook-only gate) | `scripts/audit-tunnel.mjs` |

The API is stateless, like `/api/updates`. The newest data lives in a store that every server
instance reads, so the same code runs on one local server and on Vercel:

```
Sheet edit ─▶ Apps Script ─▶ POST /api/audit/webhook ─▶ store ◀─ CSV pull (fallback)
                                                          │
                      page ─ every 10 s ─▶ /api/audit/status (version) ─▶ /api/audit when it changed
```

1. **Push.** The sheet's installable `onEdit`/`onChange` triggers POST the tabs to `/api/audit/webhook`
   (`Authorization: Bearer $AUDIT_WEBHOOK_SECRET`). The server recomputes and saves to the store.
2. **Poll.** While the tab is visible, the page asks `/api/audit/status` for the version every 10 s
   (every minute after 30 min without input) and loads `/api/audit` only when it changed. Edits show up
   within about 10 s locally and 15 s on Vercel, where the CDN answers repeat polls for 4 s (`s-maxage=4`).
3. **Pull (fallback).** When a status check finds the data older than `AUDIT_POLL_SECONDS` (30 s), on
   first load and on Refresh, the server re-reads the link-shared sheet's CSV export. Only one instance
   reads at a time, through a lease in the store.

The store is **Upstash Redis** when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set (the Vercel Upstash
integration sets them; `UPSTASH_REDIS_REST_URL` / `_TOKEN` also work): REST through `fetch`, no client
library, data gzipped (about 25 KB). Otherwise it is the **local file** `.data/audit-<sheet id>.json`
(gitignored; `AUDIT_STORE_FILE` overrides), for one server; it survives restarts.

What happens when something fails (`audit.check.mjs` runs these cases against both stores, with a
second instance in a worker thread for Redis):
- **Tunnel, trigger, or laptop offline.** Pushes stop; pulls keep the page within about 30 s of the sheet.
- **Google unreachable, sheet made private, or HTTP 5xx.** The last good numbers stay and the status bar
  shows the reason. 5xx and network errors are retried.
- **Server restart or new Vercel instance.** The data comes from the store, so nothing is lost.
- **Redis unreachable.** Page loads read the sheet directly (or serve the instance's last copy if Google
  is down too), with the reason in the status bar. Pushes answer 502 until Redis is back.
- **Pushes and pulls out of order.** Data only moves forward: a pull that started before the stored data
  was read is dropped, a push older than the last push is dropped (by its `sentAt`), and pulls pause for
  60 s after a push, because the CSV export trails edits.
- **Page loses the server.** The status bar says so, the page keeps its numbers, and checks back off to
  every 30 s. It catches up when the server answers, the tab becomes visible or the network comes back.
- **Odd sheet content.** Columns are found by their headers, so an inserted column is fine. Blank, junk,
  or missing tabs are reported under Data health and never crash the page (fuzz-tested).

### Local demo

```bash
npm run dev                      # http://localhost:3000/audit (file store, works with pull only)
node scripts/audit-tunnel.mjs    # needs cloudflared; prints https://….trycloudflare.com
```
In the sheet: Extensions → Apps Script → paste `scripts/audit-sheet-trigger.gs` → Save → reload the sheet →
**Audit Dashboard → Connect dashboard…** → paste the tunnel address, then the secret from `.env.local`.
The address changes each time `audit-tunnel.mjs` starts: run **Connect dashboard…** again with the new
one (until then the page falls back to pulls). To run locally against the same Redis as Vercel, put its
`KV_REST_API_URL` / `KV_REST_API_TOKEN` in `.env.local`; use a separate database to keep tests apart.

### On Vercel

1. Add the **Upstash Redis** integration (Storage / Marketplace) to the project; it sets
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without it every instance keeps its own copy, so pushes
   reach only some pages (the logs warn). Create the database in Mumbai (`ap-south-1`), next to the
   functions (`bom1` in `vercel.json`).
2. Set `AUDIT_WEBHOOK_SECRET` (and `AUDIT_SHEET_ID` for a different sheet) in the project's env vars.
3. In the sheet, run **Connect dashboard…** with the production address, for example `https://<domain>`
   (the script adds `/api/audit/webhook`). Not a preview URL: Vercel's deployment protection would answer
   the trigger with 401.

Usage, measured on the production build: a status check is 1 Redis command, a push 4, a sheet read
4–7. One tab in use costs about 360 CDN requests and 840 Redis commands an hour; an idle tab about 60
and 300. Open tabs share the CDN cache, so Redis use does not grow with viewers, but CDN requests do.
Hobby includes 1M CDN requests and 1M function calls a month (a feature that runs out pauses for the
rest of the 30 days) and Upstash free 500K commands. The API sets `maxDuration = 60`; a sheet read
takes about 3 s.

## Deploy to Vercel

This is a static site — import the repository into Vercel (or run `vercel`) with no
build step. It deploys as-is.

## Brand Colors

Matches harleys.com's actual theme: the default shadcn/ui **Neutral** palette
(grayscale — no custom brand hue) plus its 5 chart accent colors, used sparingly for
status indicators only (e.g. the "Online" dot). The canonical values live in
`styles/tokens.css` — change them there and every page (including `docs/`) picks it up
automatically.

| Token                 | Hex       | Usage                              |
|-----------------------|-----------|-------------------------------------|
| `--color-bg`           | `#FFFFFF` | Page background                     |
| `--color-fg`           | `#0A0A0A` | Primary text                        |
| `--color-primary`      | `#171717` | Buttons, links, icon fills          |
| `--color-primary-fg`   | `#FAFAFA` | Text/icons on a primary-filled bg   |
| `--color-secondary`    | `#F5F5F5` | Subtle surfaces, hover backgrounds  |
| `--color-muted-fg`     | `#737373` | Secondary/muted text                |
| `--color-destructive`  | `#EF4444` | Offline / error states              |
| `--color-border`       | `#E5E5E5` | Borders, dividers                   |
| `--chart-teal`         | `#2A9D90` | "Online" status accent              |
| `--chart-gold`         | `#E8C468` | "Primary" featured-card ribbon      |

Dark mode flips background/foreground and moves surfaces to ~15% gray, following the
same shadcn Neutral convention.

Typography: **Arial** is the real site-wide body font on harleys.com — so it's the
default here too. **Montserrat** and **Imperial Script** are loaded from Google Fonts
as opt-in accent fonts, applied selectively to headings/branding the same way the real
site uses them, never to body copy.

---

*Designed for Internal Use Only · Powered by Odoo 19 Enterprise*
