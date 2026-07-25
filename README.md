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
