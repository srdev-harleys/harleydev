# Hyperpure Vendor Integration — Current State (2026-09-23)

This is a state document, not a changelog: it describes how the whole
feature works *as of now*, including two open blockers and one bug fixed
today. The companion `developer-guide.html` / `user-guide.html` cover the
stable parts (architecture, E-Transfer flow, webhook flow) in full; this
file is the fast-moving supplement — price sync, the `search_products`
investigation, and open items.

Modules: `harleys_connect` (generic engine) with Hyperpure-specific logic
isolated under `harleys_connect/application/purchase/`. Rista/Posist is
the other vendor plugged into the same generic engine, but as a separate
module (`harleys_pos_registry`) — not covered here.

---

## 1. Architecture recap

`connect.partner` (one vendor account) / `connect.endpoint` (one HTTP
operation, config-driven: path template, params, auth) / `connect.manager`
(the one `requests.request()` call site, logging, retries) /
`processors.py` (`BaseProcessor`, `ProcessorRegistry`, `ProcessorResult` —
vendor-agnostic response handling). Nothing Hyperpure-specific belongs in
`harleys_connect/models/`; it all lives in `application/purchase/`.

Hyperpure is one `connect.partner` (id 5) shared across **four** `res.partner`
vendor records, one per GST entity (§3).

## 2. Confirmed working (tested live, this session and prior)

- Multi-order batch E-Transfer (`action_send_to_vendor` →
  `connect.order.confirm.wizard`, mode `transfer`) — price review,
  mismatch detection, `_humanize_error()` surfacing Hyperpure's real
  entity-level error instead of a raw HTTP 400.
- `place_order` / `cancel_order` — real sandbox orders placed successfully
  (e.g. PO P02373), confirmed visually against Hyperpure's own buyer
  portal (`dev.hyperpure.com`).
- Generic webhook receiver (`controllers/webhook.py` →
  `connect.manager.receive_webhook` → `PurchaseOrderUpdateProcessor`) —
  status-rank state machine (PLACED/COMPLETED/DISPATCHED/DELIVERED/
  CANCELLED), DELIVERED/CANCELLED terminal-locked, multi-suborder
  `PARTIAL` aggregation, a chatter note per webhook delivery (not just the
  overwritten status field). Verified with real external HTTP calls
  (curl, Postman collection + collection runner) against an ngrok tunnel
  in front of the admin dev server, and against a second, independently
  re-provisioned server from scratch (auth, outlet dataset, endpoint
  bindings) — not just the original dev machine.
- `connect_delivery_slot` field on `purchase.order`, wired into
  `_build_hyperpure_payload()`.
- `mail.thread` price-change tracking on `product.supplierinfo` (chatter
  history on price/product_code edits).

## 3. GST multi-entity vendor structure

Four `res.partner` vendor records, one `connect.partner` (id 5, one API
account):

| Entity | id | GSTIN | Outlet dataset | Product codes mapped |
|---|---|---|---|---|
| HYD / Telangana | 31 | 36AAACZ8867B1Z1 | `outlets` (2 real outlets) | **5** of 134 supplierinfo rows |
| BLR / Karnataka | 82 | 29AAACZ8867B1ZW | `outlets_blr` (25 outlets, `SANDBOX-DUMMY` placeholder ids 900001+) | 0 of 156 |
| MH / Maharashtra | 83 | 27AAACZ8867B1Z0 | `outlets_mh` (22 outlets, placeholder ids) | 0 of 246 |
| NCR / Haryana | 5387 | 06AAACZ8867B1Z4 | `outlets_ncr` (7 outlets, placeholder ids) | 0 of 86 |

`product.supplierinfo` is already correctly segmented per vendor record —
no separate product catalogue needed per GST, prices/codes just live on
each vendor's own supplierinfo rows for the shared product list.

Only HYD has real Hyperpure-issued outlet ids (802249 `HYD-CS`, 802297
`HYD-KMP`, both prefixed `EX-HP-HARLEYS-TEST*` in Hyperpure's own portal).
BLR/MH/NCR's outlet ids are internal placeholders pending real values from
Hyperpure. **VIJ (7 warehouses) and `WH` (1 warehouse) remain unmapped to
any GST entity** — unresolved, needs user/Hyperpure input.

## 4. Price sync — "Sync Vendor Prices"

`action_sync_vendor_prices` on the vendor → `connect.order.confirm.wizard`
in mode `prices`. Preview (`_preview_price_sync`) calls Hyperpure's
`search_products` live per mapped product, shows synced price next to the
current native-pricelist price. Apply (`action_apply_price_sync`) writes
the synced price directly onto `product.supplierinfo` in place (update, or
create if the product had no vendor pricing row yet) — no history row, no
separate reference-dataset/CSV mechanism (that mechanism was fully removed
in favour of this one, per an earlier design decision — see
`developer-guide.html` §6 for the removed fields).

**Bug fixed today**: `price_check_done` (gates the "Apply" button) required
*every* previewed product to have synced successfully
(`all(line_ids.mapped('price_available'))`). Since only 5 of HYD's 134
mapped products currently have a vendor product code, the Apply button
never appeared at all for a real sync run. Fixed to require only *some*
line to have synced (`bool(available_count)`) — Apply now writes whatever
succeeded and leaves the rest at zero, exactly matching how
`action_apply_price_sync` itself already tolerated partial coverage
line-by-line. Verified live (stubbed `_price()` live call, real
`_preview_price_sync()`/`action_apply_price_sync()` otherwise, transaction
rolled back, no data touched) — 5 of 115 products synced, `price_check_done`
correctly `True`, unmapped 110 stayed at 0.0.

**Current real coverage**: 5 products total, all under HYD (OVEN GLOVES
`20021159`, TOOTH PICKS `20021161`, LEMON `20021160`, RE PAPER STRAWS 6MM
`20021162`, CLASSIC BUTTER CROISSANT `20021163`). BLR/MH/NCR have zero
vendor product codes mapped — `_item()` fails with "Set one unambiguous
Vendor Product Code" for every one of their 488 combined supplierinfo
rows before a live call is even attempted.

**Open design question, unresolved**: `_build_hyperpure_payload()` sends
the PO line's stored `price_unit` as `reference_price`, not a fresh pull
of the synced vendor price — these can drift apart between a PO's
creation and a later re-sync. Not yet decided whether E-Transfer should
substitute the live synced price instead.

## 5. `search_products` — root-caused against Hyperpure's own documentation

100% failure rate: all 110+ logged calls since 2026-09-16 return the same
generic error, for every query tried (our own internal product names,
generic terms like "milk", and — critically — **real confirmed catalogue
names pulled from an actual completed sandbox order**, "Dotpe QA Testing"
and "Hyperpure - Butter Croissant, Handrolled (75 gm/pc) (Frozen)"). Two
repeats of the identical real-name query returned different status codes
(400 then 500) across runs — the endpoint itself is unstable, not cleanly
gated by whether the search term matches their catalogue.

Checked field-by-field against Hyperpure's own "HP↔External POS
integration" API document:

- Path, method (GET), headers (`ApiAccessKey`/`ClientSecret`/`X-AccountId`),
  and both query params (`outlet_id`, `search_query`) match the doc's
  field table exactly. One real gap found and fixed: `search_query` was
  configured `required=False`; the doc marks it mandatory.
- The error body we get back — `{"error": {"code": "BAD_REQUEST_ERROR",
  "data": null, "message": "Something went wrong"}}` — matches the doc's
  own **"Generic system errors"** example verbatim (§4.8.8 of the doc):
  schema-level rejection before field validation, `data` stays null, "may
  ask the user to retry after some time."
- The doc's **Test Credentials** section confirms `account_id 194841` is
  genuinely Hyperpure's designated test account (exact match to ours) —
  but states outlet/product catalogue mappings for test outlets must be
  **manually provisioned by Hyperpure's own tech team** on request.

**Conclusion**: request construction is clean against the documented
contract; nothing left to fix on our side for this endpoint. Likeliest
cause is outlet `802249` ("EX-HP-HARLEYS-TEST") is active enough to accept
real orders but was never fully provisioned with a searchable product
catalogue on Hyperpure's backend. **Action needed (not yet sent)**: email
`integrations@hyperpure.com` with account 194841 + outlet 802249, noting
the request matches their own documented contract, and asking them to
verify/complete catalogue provisioning for search specifically.

## 6. Two historical type-mismatch bugs in `place_order`'s JSON body (context for future debugging)

Both already fixed; kept here since they're a recurring category worth
knowing about — Hyperpure's own doc self-contradicts on types in places,
and the working answer is "match their sample payloads, not their schema
table":

- `product_number`: schema table says integer; **all their sample bodies
  show it quoted as a string**. We send it as a string
  (`_build_hyperpure_payload`, `str(int(code_number))`) — matches the
  samples, which turned out authoritative.
- `external_order_id`: their sample sends a bare integer; we were sending
  our PO's display name (`"P02364"`, a string with a letter prefix).
  Corrected to send Odoo's own integer PK (`self.id`) instead.

Neither bug class can apply to `search_products` — it's a GET request
with query-string parameters, and a URL query string has no int/string
distinction at the wire level (confirmed, not assumed, when this was
raised as a hypothesis for the current outage).

## 7. Webhook — security model, as it stands today

Route: `/harleys_connect/webhook/<partner_code>/<token>/<operation>`,
`auth="public"` (necessarily — Hyperpure has no Odoo user identity).

- **Primary and, right now, only active gate**: the URL-embedded
  `webhook_token` (128-bit random). Without it, partner lookup fails
  before anything else runs.
- **Secondary gate (`webhook_header_name`/`hyperpure_webhook_secret`)
  exists in code but is deliberately not yet configured** — pending
  Hyperpure's real header-secret value. Until it is, anyone holding the
  URL can call it with no further authentication.
- Blast radius even on a fully "successful" forged call is narrow: the
  processor only touches a PO already `vendor_order_sent` with a real
  pending vendor submission, and outlet/order matching is re-validated
  server-side; it cannot create/approve/delete a PO or touch stock/
  accounting.
- Chatter always attributes the note to "Public user," regardless of
  whether the real caller is Hyperpure or a test — this is inherent to
  `auth="public"` (`message_post()`'s default author is `self.env.user`,
  which resolves to Odoo's generic public user under this route). Not
  fixable without explicitly overriding `author_id` on the post, which is
  a cosmetic change if wanted, not a security one.
- `action_regenerate_webhook_token()` exists as a rotation safety valve if
  a URL is ever suspected leaked (e.g. shared into a third-party tool's
  workspace, as the Postman collection built for testing this now holds
  the live token/credentials — treat that collection as sensitive).

**odoo.sh production feasibility, confirmed**: receiving the webhook
(inbound) is unaffected by odoo.sh having no static egress IP — any
reverse-proxy-fronted HTTPS endpoint works, which is exactly what was
proven with ngrok + nginx standing in for odoo.sh's own front proxy. The
real blocker is **outbound** calls (place_order, search_products, etc.) —
Hyperpure mandates IP whitelisting, and odoo.sh's IP rotates (per Odoo's
own `/_odoo.sh/ip-change` mechanism). Escalated to the Odoo.sh team by the
user directly; unresolved as of this writing. Fallback if odoo.sh can't
provide a static IP: route outbound Hyperpure calls through a fixed-IP
proxy — a one-line `proxies=` change at `connect_manager.py`'s single
`requests.request()` call site.

## 8. Other open items

- `share_external_order_reference_details` must be explicitly requested
  from Hyperpure during webhook setup, or `external_order_id` won't be in
  their payload — would break `PurchaseOrderUpdateProcessor` correlation.
- QBP (quantity-based pricing slabs) exists in Hyperpure's own pricing
  model; `search_products`'s `MarketPrice` is pre-QBP. Not slab-adjusted
  anywhere in this code — flagged as a possible secondary contributor to
  past price-mismatch rejections, not confirmed.
- `validate_order_placement` pre-flight step deliberately skipped in
  favour of relying on `place_order` alone — settled, no action needed.

## 9. Base URLs / auth, for reference

Auth: `otp_token_exchange` (phone/OTP exchanged for the header-based
credential set below — not, as an earlier note assumed, a rotating JWT
Bearer token; verified directly against live `connect.endpoint.param`
config this session). Per-request headers: `ApiAccessKey`, `ClientSecret`,
`X-AccountId`, all sourced from `connect.partner.variable` values scoped
to this partner. Base URLs: prod `https://api.hyperpure.com`, dev
`https://devapi.hyperpure.com`. An earlier abandoned Hyperpure-only
scaffold exists at `odoo_harleys-main/hp_integration/` (main branch) —
incomplete/superseded, not worth referencing.
