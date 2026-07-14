# Harleys Fine Baking ODOO DEV — Landing Page

A premium, enterprise-grade internal portal launcher for the **Harleys Fine Baking ODOO DEV**
testing environment. Built with vanilla HTML5, CSS3, and JavaScript — no frameworks, no
external JavaScript libraries.

The page resembles an enterprise application launcher (à la Microsoft Azure Portal /
AWS Console) and dynamically renders application cards from a single `config.json`.

## Features

- ✔ Glassmorphism cards (backdrop blur + translucency)
- ✔ Smooth fade / rise page transitions
- ✔ Button hover animations + material **ripple** effect
- ✔ Animated background gradients + subtle grid
- ✔ Live date & time clock in the navigation bar
- ✔ Responsive & mobile optimized (CSS Grid + Flexbox)
- ✔ **Dark mode** via `prefers-color-scheme`
- ✔ Accessible (semantic HTML, ARIA roles, `:focus-visible`, reduced-motion support)
- ✔ Keyboard navigable
- ✔ SEO meta tags + Open Graph tags
- ✔ Favicon + logo placeholders
- ✔ Loading animation
- ✔ CSS variables (design tokens) + organized, modular CSS
- ✔ Modular ES6 JavaScript — application cards generated from `config.json`
- ✔ No external JavaScript libraries

## Folder Structure

```
/
├── index.html          # Semantic markup, SEO/OG meta, favicon
├── style.css           # Design tokens, glassmorphism, dark mode, animations
├── script.js           # Modular JS: clock, ripple, dynamic card rendering
├── config.json         # Single source of truth for apps & brand text
├── assets/
│   ├── logo.png        # Generated logo placeholder
│   ├── favicon.ico     # Generated favicon
│   └── icons/          # Reserved for future image assets
└── README.md
```

## Adding / Editing Applications

You only need to edit **`config.json`** — no HTML changes required.

```json
{
  "applications": [
    {
      "name": "Harleys ODOO DEV Testing",
      "url": "https://8fvgvhc8-8069.inc1.devtunnels.ms/",
      "icon": "erp",
      "status": "Online",
      "environment": "Testing"
    },
    {
      "name": "Harleys Production",
      "url": "https://erp.harleysfinebaking.com/",
      "icon": "erp",
      "status": "Online",
      "environment": "Production"
    },
    {
      "name": "BI Dashboard",
      "url": "https://bi.harleysfinebaking.com/",
      "icon": "server",
      "status": "Offline",
      "environment": "Analytics"
    }
  ]
}
```

Available icon keys: `erp`, `flask`, `server`, `support`.
Add more by extending the `Icons` object in `script.js`.

## Available Icons

| Key        | Used for                          |
|------------|-----------------------------------|
| `erp`      | Application launcher (default)    |
| `flask`    | Testing Environment info card     |
| `server`   | Availability info card            |
| `support`  | Support info card                 |

## Local Development

Any static server works. From the project root:

```bash
# Python
python3 -m http.server 8000
# then open http://localhost:8000

# or Node
npx serve .
```

> A static server is **required** for `fetch('config.json')` to work (browsers block
> `file://` fetches). On Vercel this works out of the box.

## Deploy to Vercel

This is a static site — import the repository into Vercel (or run `vercel`) with no
build step. It deploys as-is.

## Brand Colors

| Token      | Hex       | Usage            |
|------------|-----------|------------------|
| Primary    | `#1E3A5F` | Dark Navy        |
| Secondary  | `#F5F7FA` | Light surface    |
| Accent     | `#D4AF37` | Gold             |
| Success    | `#22C55E` | Online status    |

Typography: **Inter** (loaded from Google Fonts, with a system fallback stack).

---

*Designed for Internal Use Only · Powered by Odoo 19 Enterprise*
