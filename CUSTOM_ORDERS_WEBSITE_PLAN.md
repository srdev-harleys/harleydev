# Unlisted "Order from Harley's" page: build brief for this repo

_For a Claude Code session in `~/Vineeth/harleydev`. Updated 2026-11-03: the Odoo side is built (module
`harleys_custom` in `~/Vineeth/Odoo/odoo_harleys-dev/harleys_custom`), so build against the real API
below, and test locally against the dev Odoo on `http://localhost:8069` (database `odoo-e`)._

## Goal

A customer-facing page for **custom cakes** and **bulk orders**: a guided form plus an optional chat
assistant. Every order placed here lands in Odoo as **Awaiting Approval** for a Harley's manager. It
creates nothing else in Odoo: no sales order, no stock, no price.

## Ground rules

- **Unlisted.** The route is `/order`. Nothing in `public/` (no `index.html` or `config.json` card) links to it. Set `robots: { index: false, follow: false }` on every `/order` route.
- **No prices anywhere:** not on the page, not in the chat, not in the payload. The review step says "Harley's will call you to confirm the details and price".
- **Pickup only, no store picker.** The customer enters a pincode and address. Show "Nearest Harley's for pickup: <outlet, area>" when Odoo suggests one, with "We'll confirm the pickup outlet when we call". When there's no suggestion, show nothing.
- **Lookups never block.** If a pincode or email lookup fails, or takes more than 3 seconds, the customer just types and carries on.
- **Secrets stay on the server.** The browser only calls this site's own `/api/order/*`. Copy the pattern in `lib/odoo.ts` and `app/api/updates/route.ts`: `server-only`, a fast-fail timeout, and typed error kinds.
- Read `AGENTS.md` first. This is **Next.js 16.4 / React 19.3**, so check `node_modules/next/dist/docs/` before writing route handlers, metadata or `next/image` config.

## Environment

These are separate from the Daily Updates variables (`ODOO_URL`, `HARLEYS_PORTAL_TOKEN`), which point at the inhouse Odoo. Add them to `.env.example` with empty values, then fill in `.env.local` yourself:

```
# Harley's Custom orders (Odoo module harleys_custom). Empty URL = built-in mock data.
CUSTOM_ODOO_URL=http://localhost:8069
CUSTOM_ODOO_DB=odoo-e
# = Odoo System Parameter harleys_custom.portal_token
CUSTOM_PORTAL_TOKEN=
# Optional: chat assistant (hidden when empty)
ANTHROPIC_API_KEY=
# Optional: bot check on Place order (skipped when empty, e.g. locally)
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

Send `X-Portal-Token: $CUSTOM_PORTAL_TOKEN` on every call. Also send `X-Odoo-Database: $CUSTOM_ODOO_DB` when it's set, and `ngrok-skip-browser-warning: 1`, as `lib/odoo.ts` does. Use a 10-second timeout, except order placement with photos, which gets 60 seconds.

## Odoo API (already built: `harleys_custom/controllers/api.py`)

Base: `$CUSTOM_ODOO_URL/harleys/custom/v1/web`. All responses are JSON, except images.

| Status | Meaning |
|---|---|
| 403 `{"error"}` | Wrong or missing token, or website orders are off (no token set in Odoo) |
| 409 `{"error"}` | Odoo refused the data. Show the message, e.g. "… needs customer name, phone" |
| 404 `{"error"}` | Unknown order or image |

### `GET /catalog`

```json
{"sections": [{
  "id": 1, "name": "Cakes", "order_type": "custom|bulk", "lead_hours": 48,
  "options": [{"key": "weight", "label": "Weight", "type": "choice|multi|text|number|yes_no|colours",
               "allow_custom": false, "unit": "kg", "step": 0.5,
               "required": true, "choices": ["0.5 kg", "1 kg"], "max_length": 0, "hint": ""}],
  "products": [{"id": 12, "name": "Honey Medovik Cake", "image": true, "description": ""}]
}]}
```

- Render each section's options generically from `type`. `max_length > 0` caps text inputs; the cake message is 40 characters.
  - `number`: a stepper by `step`, with `unit` after it (weight: 0.5 kg steps); `choices` are quick picks. Send the number.
  - `choice` with more than 8 `choices` (flavours, ~60): a searchable dropdown, not buttons. With `allow_custom`, the typed text is the answer.
  - `colours` (cake theme): each choice is `"Name #RRGGBB"`: show swatches, several can be picked, plus a text box for the theme.
    Send one string: the picked names then the typed text, joined by `", "` (e.g. `"Pink, Gold, unicorn theme"`).
  - The customer's email gets an update when the order is received, confirmed, in production, ready, rejected or cancelled
    (sent by Odoo, no SMS). Say so next to the email field.
- Lead time is a **hint only**. If the expected date falls within `lead_hours`, show "Custom cakes usually need 48 hours; we'll confirm", but don't block.
- Cache this for 5 minutes: `s-maxage=300, stale-while-revalidate=3600`.

### `GET /image/<product_id>/<256|512|1024>`

- Returns a PNG or JPEG. Call it only when `image` is true; otherwise show a branded placeholder.
- Proxy it through `/api/order/image/[id]/[size]` with a long cache (1 day).
- Allow the route in `next/image` with a local loader, or serve it unoptimised; Odoo already sizes the image.

### `GET /pincode/<6 digits>`

```json
{"pincode": "560034", "found": true, "areas": ["Koramangala VI Bk", "…"], "city": "Bangalore",
 "district": "Bangalore", "state": "Karnataka", "outlet": {"name": "KA-BLR-…", "area": "…"} }
```

- `outlet` is `null` when no pickup outlet matches.
- Use `areas` as suggestions for the Area field; the customer can still type one.
- `found: false` means nothing is filled in. That's fine.

### `POST /email` `{"email": "a@b.com"}`

- Returns `{"status": "valid|disposable|no_domain|invalid|unchecked", "label": "Looks Valid"}`.
- Show it as a small badge. It never blocks, and email is optional.

### `POST /order`

The body is the shared payload, the same one the app sends:

```json
{"client_uuid": "random-32-hex", "order_type": "custom|bulk",
 "customer": {"name": "", "phone": "", "email": "", "pincode": "", "area": "", "city": "",
              "district": "", "state": "", "address": "", "landmark": ""},
 "expected_date": "YYYY-MM-DD", "expected_time": "6 pm", "occasion": "", "notes": "",
 "lines": [{"product_id": 12, "custom_name": "", "section_id": 1, "qty": 1,
            "options": {"weight": "1 kg", "eggless": true, "message": "Happy birthday"},
            "notes": "", "photos": ["<base64 jpeg>"]}]}
```

**Required:**
- `customer.name`;
- `customer.phone`: an Indian mobile, sent as 10 digits (`+91 …` is accepted too);
- `expected_date`: today or later;
- at least one line with either `product_id` or `custom_name`.

**Optional:**
- `section_id` on a "something else" line, to borrow that section's options.
- Up to **5 photos per line**. Resize them in the browser to at most 1600 px as JPEG at quality 0.8 before sending; Odoo refuses anything over 8 MB.
- `options` maps option keys to values: a string, a number, `true` for yes/no, or a list for `multi`. Unknown keys are dropped.

**Do not send** `advance` or a pickup outlet. Odoo ignores them for website orders and sets the outlet from the pincode.

**Response:** `{"name": "CO/2026/00012", "access_token": "…"}`. A resend with the same `client_uuid` returns the same order, so it's safe to retry. Generate the UUID once per checkout and keep it in `sessionStorage`.

### `GET /order/<access_token>`

The status page data, which holds no personal data beyond what's shown:

```json
{"name": "CO/2026/00012", "state": "submitted", "state_label": "Awaiting Approval",
 "timeline": [{"state": "submitted|approved|in_production|ready|picked_up", "label": "…", "at": "2026-11-03T10:00:00Z|null"}],
 "expected_date": "2026-12-24", "outlet": {"name": "…"} ,
 "customer": {"first_name": "Meera", "phone": "••••••3210"},
 "lines": [{"name": "…", "qty": 1, "options": [{"key": "weight", "label": "Weight", "value": "1 kg"}], "notes": ""}]}
```

`state` can also be `draft` (a manager asked for changes), `rejected` or `cancelled`. Show those as "We'll call you", "Not possible this time" and "Cancelled".

## What to build

### Pages

1. **`/order`** offers two entry choices, "Design a custom cake" and "Bulk / party order", plus a "Chat with us instead" toggle, which only appears when `ANTHROPIC_API_KEY` is set. The guided form has four steps, with progress at the top and the step in the URL (`?step=`) so back and forward work. A cart drawer and a sticky "Cart · N items" bar are visible on mobile.
   1. **Pick:** a section-chip filter, search, and a large-image grid. A product sheet shows the gallery, quantity, the generated options form, notes and the photo upload. A **Something else** card covers items that aren't in the catalogue.
   2. **You:** phone, then name, then email with its badge, then pincode, which fills city, state and the area suggestions. Then address and landmark.
   3. **When:** a required date picker that allows today onwards, with the lead-time hint, and an optional time. The suggested pickup outlet is shown read only.
   4. **Review:** a summary, a consent tick ("Harley's may call / WhatsApp me about this order"), then **Place order**.
2. **Success** shows the order number, a "Save this link" status link, and a WhatsApp share of that link.
3. **`/order/[token]`** shows the timeline, items, date and outlet.
4. **Chat assistant (optional, last):**
   - A panel on `/order` that builds the **same payload**.
   - It uses Claude tool use: `search_catalog`, `get_options`, `lookup_pincode`, `check_email`, `add_line`, `set_customer`, `set_expected_date` and `review_order`. These run server-side against the handlers below, and the cart lives server-side per session.
   - The cart fills in live beside the chat.
   - **Placing the order always needs the customer to press Confirm.** The model never submits.
   - No prices, and no products the tools didn't return. Use model `claude-sonnet-5-5` with streaming.

### Server

The Odoo client is `lib/custom-orders.ts` (`server-only`), with types in `lib/custom-orders.types.ts`. When `CUSTOM_ODOO_URL` is empty, it serves fixtures from `lib/custom-orders.mock.ts` with the same shapes as above, so the page works with no Odoo.

| Route | Calls Odoo | Cache / limits |
|---|---|---|
| `GET /api/order/catalog` | `/catalog` | `s-maxage=300, swr=3600` |
| `GET /api/order/image/[id]/[size]` | `/image/…` | 1 day; `size` must be 256, 512 or 1024 |
| `GET /api/order/pincode/[pin]` | `/pincode/…` | `^[1-9]\d{5}$` only |
| `POST /api/order/email` | `/email` | |
| `POST /api/order` | `/order` | zod validation, Turnstile when configured, 5 orders/hour per IP |
| `GET /api/order/status/[token]` | `/order/<token>` | no cache |
| `POST /api/order/chat` | Claude, plus the routes above | 30 messages per 10 minutes per IP |

**Validation (zod, server-side):**
- the phone, after stripping `+91`, spaces and dashes, matches `^[6-9]\d{9}$`;
- the pincode is 6 digits;
- names are at most 120 characters, the address at most 500 and notes at most 2000;
- quantity is from 1 to 10000;
- the date is today or later.

Log the order number and error kind only, never personal data. Rate limiting can be in memory for now; leave a TODO for Upstash or KV.

### Look and feel

- **Fonts:** Montserrat for headings, matching the Harley's app.
- **Colours:**
  | Name | Hex |
  |---|---|
  | sky | `#CBEBF2` |
  | sky-700 | `#2B8CA3` |
  | sky-900 | `#1B5B6A` |
  | blush | `#F5D1D8` |
  | rose | `#D45770` |
  | gold | `#D4AF37` |
  | ink | `#0A0A0A` |

  Use them on white with soft blush and sky washes.
- **Shape:** 16 px corners, large photography and soft sheet or drawer motion.
- **Mobile first,** because the link opens from WhatsApp. Aim for an LCP under 2.5 s on 4G and lazy-load the chat.
- **Accessibility:** labelled inputs, visible focus, keyboard operable, and colour contrast at AA.

## Local testing (do this before calling it done)

### 1. Odoo, done by the user

The session asks the user to do these and doesn't run them itself:

- Install the module on the dev database: `-i harleys_custom` on `odoo-e`, then restart the dev server on 8069.
- In Odoo → Settings → Technical → System Parameters, create `harleys_custom.portal_token`. Put the same value in `.env.local` as `CUSTOM_PORTAL_TOKEN`.
- On a few outlets (Inventory → Configuration → Warehouses), tick **Takes Customer Pickups**.
- Optional: give a few cake products images, so the grid isn't all placeholders.

### 2. Check that Odoo answers, before writing UI

```bash
set -a; . ./.env.local; set +a
H=(-H "X-Portal-Token: $CUSTOM_PORTAL_TOKEN" -H "X-Odoo-Database: $CUSTOM_ODOO_DB")
B=$CUSTOM_ODOO_URL/harleys/custom/v1/web
curl -s "${H[@]}" $B/catalog | head -c 600; echo
curl -s -o /dev/null -w '%{http_code} (want 403)\n' -H 'X-Portal-Token: wrong' $B/catalog
curl -s "${H[@]}" $B/pincode/560034; echo
curl -s "${H[@]}" -H 'Content-Type: application/json' -d '{"email":"test@mailinator.com"}' $B/email; echo   # want disposable
```

### 3. Run the site and test end to end

```bash
npm run build && npm run dev   # http://localhost:3000/order
P=http://localhost:3000/api/order
curl -s $P/catalog | head -c 300; echo
curl -s $P/pincode/560034; echo
curl -s -o /dev/null -w '%{http_code} (want 400)\n' $P/pincode/12ab
UUID=$(openssl rand -hex 16)
ORDER='{"client_uuid":"'$UUID'","order_type":"custom","customer":{"name":"Test Customer","phone":"9876543210","pincode":"560034"},"expected_date":"'$(date -d '+3 days' +%F)'","lines":[{"custom_name":"Test cake","qty":1,"options":{"message":"Hello"}}]}'
R=$(curl -s -H 'Content-Type: application/json' -d "$ORDER" $P); echo "$R"
curl -s -H 'Content-Type: application/json' -d "$ORDER" $P   # same name again: resend-safe
TOKEN=$(echo "$R" | sed -n 's/.*"access_token": *"\([^"]*\)".*/\1/p'); curl -s $P/status/$TOKEN; echo
curl -s -o /dev/null -w '%{http_code} (want 400)\n' -H 'Content-Type: application/json' -d '{"customer":{"name":""},"lines":[]}' $P
```

Then, in a browser at phone width:
- place one catalogue cake with options and two photos, and one "something else" bulk order;
- check that both show in Odoo → **Harley's Custom → Orders** as Awaiting Approval, from Website, with the pickup outlet set from the pincode and the photos on the items;
- approve one in Odoo and reload its status page: the timeline moves.

Also check:
- `grep -r "CUSTOM_PORTAL_TOKEN\|ANTHROPIC_API_KEY" .next/static` finds nothing;
- `/order` isn't linked from anything in `public/`;
- view the page source and confirm `noindex`;
- Lighthouse mobile on `/order` scores at least 90 for performance and accessibility;
- `npm run build` is clean;
- with `CUSTOM_ODOO_URL` unset, the page still works on mock data.

Delete the test orders afterwards, or ask the user to cancel them in Odoo.

## Done when

The form flow works against local Odoo end to end, the resend is safe, the status page tracks Odoo, it works on the mock with no Odoo, it has no secrets in the client, it's unlinked and noindex, and the build is clean. Commit only when the user asks; they push. Don't commit `.env.local` or this `.md` file.
