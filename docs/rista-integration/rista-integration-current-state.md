# Rista POS Integration — Current State (2026-09-23)

This is a state document, not a changelog: it describes how the whole
integration works *as of now*. The `docs/user-guide.html` /
`docs/developer-guide.html` in this same folder cover the walkthrough and
the architecture narrative in full — this document is the dense technical
reference underneath them: full schema, exact mechanics, and every open
item worth knowing before touching the code.

Module: `odoo_harleys-dev/harleys_pos_repository/` (technical name
`harleys_pos_repository`, renamed from `harleys_pos_registry` this cycle —
see §8). Depends on `harleys_connect`, the generic external-partner API
engine this integration is built on top of.

---

## 1. What this is, in one paragraph

Harley's retail POS runs on **Rista**, an external vendor — not Odoo's own
Point of Sale app (which is installed but unused; see §9). This module
pulls Rista's sales, sold-out, and outlet-status reports into Odoo on a
schedule, purely for reporting and reconciliation. It never writes back to
Rista and never touches Odoo's own POS/sale/stock flows. Everything it
owns lives under six tables, all prefixed `pos_repository_rista_*`.

## 2. Architecture: two independent pieces

| Part | Answers | Where it lives |
|---|---|---|
| **Connect** (`harleys_connect`) | "How do I authenticate to a partner, paginate a request, run it on a schedule, and log what happened?" — generic, reusable for any external API (also used for Hyperpure). | `connect.partner`, `connect.endpoint`, `connect.manager`, `connect.job`, `connect.log` |
| **POS Repository** (`harleys_pos_repository`) | "What does a Rista response mean, and where does it land?" — Rista-specific typed storage and processors. | `models/pos_rista_*.py`, `models/processors.py` |

The dependency is one-way: POS Repository registers its processors with
Connect; Connect has no knowledge of POS Repository's models. The same
pattern used for Hyperpure's own domain module.

## 3. The pull pipeline

1. `connect.job` (one row per Rista endpoint: Sales Page, Sold-Out History,
   Outlet Status) fires on a 24h interval, fanning out over all 73
   branches, `pull_offset_days=2`.
2. `connect.manager.run_job()` → `execute()` makes the one HTTP call
   (signed-JWT auth, pagination), then resolves the response processor via
   `_get_response_processor(endpoint)`.
3. That resolver checks the endpoint's own `pos_capture` +
   `pos_*_projection` flags. **As of `19.0.3.17.0`, an endpoint with
   `pos_capture=True` and no typed projection flag set is a hard error** —
   the old fallback (a generic, schema-less capture table) was removed
   entirely. Every endpoint this integration touches must resolve to one
   of three typed processors below.
4. The matched processor (`RistaSalesPageProcessor` /
   `RistaSoldOutHistoryProcessor` / `RistaOutletStatusProcessor`,
   `models/processors.py`) extracts rows and calls that table's own
   `upsert()`.
5. `upsert()` calls out to `pos.repository.rista.outlet.master` and
   `pos.repository.rista.item`'s `_sync()` classmethods as a **side
   effect** — this is the only place new branch/brand/source/item rows
   are ever created. There is no separate "sync items" or "sync branches"
   pull.
6. Rows land in the typed table; the Rista Reports screens read from
   there directly (no separate report/aggregation layer).

## 4. Full schema

All six tables share `partner_id → connect.partner` (one Rista connection
today, id 13); omitted below since it's identical everywhere.

### `pos_repository_rista_outlet_master` — Outlet Mapping / Brand List / Source List

One shared table for three enumerable dimensions, discriminated by
`lookup_type` — this is deliberate, matching the vendor's own mapping
sheet, not three separate tables:

| Field | Type | Notes |
|---|---|---|
| `lookup_type` | Selection | `branch` / `brand` / `source` |
| `code`, `name` | Char | Auto-grown from real captured data only, never hand-entered |
| `description` | Char | Optional note; no sync path populates it |
| `warehouse_id` | Many2one → `stock.warehouse` | Branch rows only |
| `warehouse_code` | Char, computed/inverse | Type a code directly, or Excel-import it, instead of picking `warehouse_id` from a dropdown |

`unique(partner_id, lookup_type, code)`. 79 rows live today: 73 branch, 3
brand, 3 source. `Auto-Map` button does an exact code-or-name pass against
every warehouse.

### `pos_repository_rista_item` — Item Mapping

| Field | Type | Notes |
|---|---|---|
| `code` | Char | Rista's `skuCode`. Unique per partner. |
| `name` | Char | `shortName`/`longName` from Sales Page, or `itemName` from Sold-Out History — **does not include size/variant**, see §7 |
| `product_id` | Many2one → `product.product` | See mapping mechanics below |
| `product_default_code` | Char, computed/inverse | Same pattern as `warehouse_code` above |

`_sync()` makes exactly one free mapping attempt, at row creation only: an
exact match on `product.default_code`. After that it never touches
`product_id` again, so it can never silently overwrite a mapping (or a
deliberate non-mapping) a person already made. From there, a person maps
the rest via the list view directly, the **Auto-Map** button (a broader
exact code-or-name pass against every active product), or Excel import.

327 items live today; 50 mapped (15%). See §7 for why many look like
duplicates.

### `pos_repository_rista_sale` — POS Orders (one row per invoice)

~60 fields, matching the vendor's own `POS_Order` mapping sheet
column-for-column (cross-checked key-for-key against real captured
payloads — zero name mismatches found). Notable ones:

- `source_id` / `brand_id` / `branch_id` → `pos_repository_rista_outlet_master.id`, one FK per `lookup_type`
- `invoice_number` — `unique(partner_id, invoice_number)`
- `discount_amount`, labeled **"Invoice Total Discount"** — reads
  `totalDiscountAmount` only, deliberately **no fallback** to the header's
  own separate raw `discountAmount` key (a genuinely distinct field in
  real payloads, confirmed via live sample; conflating them via `or` was
  the old, wrong behavior)
- `round_off_amount` — dropped in `19.0.3.18.0`, restored in
  `19.0.3.19.0`; see §6 for the historical-data caveat
- `missing_numbers` — see §7
- `status_reason` / `status_remarks` / `item_log_reason` /
  `item_log_updated_by` / `item_log_updated_time` — modeled per the
  vendor's own contract despite being confirmed absent from every one of
  134k+ real orders to date; kept as a deliberate bet on future use, not
  an oversight
- `line_ids` → `pos_repository_rista_sale_line`, 1:many

**Line upsert is match-by-`item_number`, update-in-place** (as of
`19.0.3.19.0`) — not delete-and-recreate. A repeated pull of the same
order keeps the same Odoo line ids; items no longer present in a refreshed
response are unlinked, new ones created, matched ones updated.

134,309 rows live today.

### `pos_repository_rista_sale_line` — POS Order Lines / Sales Detail (one row per item)

~40 fields: the item's own data (`sku_code`, `quantity`, tax breakdown,
KOT number/status/timestamp, `options` raw JSON, `variant`) plus ~15
related+stored header fields (`branch_id`, `channel`, `source`,
`payment_mode`, etc.) so this table can stand alone for reporting without
a join back to the header. 26,535 rows live today.

### `pos_repository_rista_soldout` — Sold Out History

Keyed by `event_key`, a sha256 hash of the endpoint's own configured
Identity Fields (branch, SKU, item type, status type, event type, event
date) — deliberately broader than the vendor sheet's own
`unique(Source,Branch,Item,EventDate)`, so e.g. an item going OUT then
back IN the same day/SKU is kept as two distinct events, not collapsed.
21,508 rows live today.

### `pos_repository_rista_outlet_status` — Outlet Status (live snapshot, not history)

Keyed by `(partner_id, branch_code, channel, order_source)` —
deliberately wider than the sheet's own `(Source, Branch, EventDate)`,
since a branch shows a different status per aggregator channel. One
current row per key, overwritten on every poll. 230 rows live today.
`status_value` reads `row.get("status") or row.get("statusValue")` — the
sheet calls the field `statusValue`, but Rista's real live response for
this account sends plain `status`.

## 5. Screens

| Screen | Grain | Purpose |
|---|---|---|
| POS Orders | one row per invoice | Order-level report, unchanged since first built |
| POS Order Lines | one row per item | Exactly the vendor sheet's 10 `POS_Order_Line` columns |
| Sales Detail | one row per item | The vendor sheet's full 60-column `POS_Order` row, all columns default-visible; its own search view with **no sidebar** (a 60-column table plus a persistent searchpanel produced a second, page-level horizontal scrollbar) |
| Sold Out History, Outlet Status | typed reports | Standard list/pivot/graph |
| Outlet Mapping, Item Mapping | maintenance | Branch↔warehouse and SKU↔product mapping, both natively Excel-importable |

Access: `harleys_connect.group_connect_manager` for full/config access,
or the narrower `group_pos_repository_reports` (view-only on the 4 typed
reports, no Connect access implied) for a business user who only needs to
look at sales data.

## 6. The `round_off_amount` historical gap

`round_off_amount` was dropped in `19.0.3.18.0`'s column-audit pass, then
restored in `19.0.3.19.0` once the sheet was re-checked more carefully.
The `18.0` drop was a plain `ALTER TABLE ... DROP COLUMN` with no data
preserved first — so every row synced before the `19.0.3.19.0` restore has
this value permanently gone, not just blank by coincidence. The restore
migration marks every such row's `missing_numbers` as `|round_off_amount|`
(see §7) rather than defaulting it to a fake `0`. It only clears once that
specific invoice is re-pulled from Rista with current code.

## 7. The missing-vs-zero problem — `missing_numbers`

Every numeric field extraction used to be `row.get("fieldName") or 0.0` —
this collapses "Rista didn't send this field" and "Rista sent exactly 0"
into the identical stored value, with no way to tell them apart later.

`missing_numbers` (Char, on both Sale and Sale Line) fixes this without
changing field types or losing the ability to `SUM()`/pivot: at upsert
time, **before** any zero-fallback, it records a pipe-delimited list of
which numeric field names were genuinely absent this pull
(`|round_off_amount|unit_price|`). The stored Float itself is always a
real number. The UI (`invisible="'|field|' in missing_numbers"`) and
CSV/XLSX export (`_export_rows` override, `models/sale_line_report.py`)
both blank the cell specifically where it's flagged — the number itself
never lies, but the display honestly shows "we don't know" instead of a
fake zero.

**Item Mapping's "looks like duplicates" issue is unrelated to this** —
see the next paragraph.

### Same-name items are a display gap, not stale data

Verified live (2026-09-23): every item currently in Item Mapping is either
actively selling or actively going in/out of stock within the last 2–3
days — nothing is genuinely stale or discontinued. What looks like
duplicate junk (e.g. two rows both named "Signature Belgium Chocolate
Medovik Cake") is really two distinct, actively-selling SKUs for two
different **sizes** (600 Gm vs 1 Kg) — Rista's `shortName`/`longName`
never include the size, that only lives in the separate `variant` field
captured on the Sale Line, never copied onto the Item Mapping row.
**Not yet fixed** — would need `_sync()` to also capture/update a
representative `variant` value on `pos.repository.rista.item`.

## 8. The registry → repository rename

Full technical rename this cycle: module folder, every model `_name`,
all 6 tables + 6 sequences, ~300 xmlids (security groups, views, menus,
config-parameter key), and `hr_shared_login_binding`'s one dependency
line. Done as hand-run, dry-run-verified SQL rather than a numbered
migration — this module is still in development with no external
environment to preserve an upgrade path for (confirmed: `main`'s checkout
doesn't have this module at all, isn't even in the current addons_path).

**Two real incidents during this rename, both since fixed:**
- A server restart between renaming the folder and running the DB-level
  rename left the module in a split state — `ir_module_module` had two
  rows (`harleys_pos_registry` orphaned, `harleys_pos_repository` freshly
  and separately installed with its own **empty** tables) while the real
  134k+ rows sat under the old table names. Fixed by dropping the empty
  shell tables and renaming the real ones into place.
- Deleting a module's `ir_model_data` rows removes the xmlid *pointer*,
  not the underlying `ir.ui.menu`/`ir.actions.act_window`/`ir.ui.view`
  *row* it labeled — an entire duplicate "POS Repository" app tree (12
  menus, 9 actions, 19 views, all on the dead `pos.registry.*` models)
  silently survived the rename, reachable by raw ID even with no xmlid
  left. Took two cleanup passes to find fully; anyone doing a similar
  rename elsewhere should sweep for this explicitly, not assume deleting
  `ir_model_data` was enough.

**Migrations for this module have since been deleted entirely** (all 12
version folders, `19.0.3.0.0` through `19.0.3.19.0`) — confirmed safe
because the only database that ever ran them (`odoo-e`) already has
`latest_version=19.0.3.19.0` recorded and won't re-run them, and no fresh
install anywhere ever executes migrations regardless. If this module is
ever promoted to `main` or a real production environment, that will be a
fresh install there too, so this has no upgrade-path consequence — but if
it ever does need a real release process, migrations will need to be
reintroduced from that point forward.

## 9. Adjacent, unrelated system: Odoo's own Point of Sale app

`point_of_sale` + `pos_hr` are installed but **completely unused** — 0
rows in `pos_config`/`pos_order`/`pos_session`/every POS-app table.
Confirmed unrelated to this integration; nothing here depends on them.
Not touched, not recommended to touch without a separate, deliberate
conversation about whether Harley's ever plans to pilot Odoo's native POS
terminal alongside Rista.

## 10. Removed along the way (for context, not because it's coming back)

- **`pos.registry.pulled.record`** (generic, schema-less capture table) +
  `GenericCaptureProcessor` + the "Response Repository"/"Build Report"
  screens built on it — removed `19.0.3.17.0`. Every endpoint needs a
  typed projection now; there's no more "capture first, type later" path
  for a future not-yet-typed endpoint.
- **A raw-JSON response layer** (`response_data` Json field + 60 computed
  display fields reading straight from it) — built as a first attempt at
  "show exactly what Rista sent, no calculation" for Sales Detail, then
  reverted in favor of `missing_numbers` on the existing typed fields
  before it was ever installed. Same guarantee, no duplicate storage.
- **"Repository Endpoints"** — a list screen that duplicated Connect's own
  Endpoints screen (same `connect.endpoint` rows, same
  `group_connect_manager` permission gate, same config tab) with zero
  unique data or capability. Removed; the one genuinely unique piece
  (`Prepare Rista Reporting Endpoints`, one-click provisioning of the 3
  standard GET endpoints + jobs for a new partner) is kept, reachable from
  Configuration directly and from a button on Connect's own endpoint form.
- **10 zombie tables** (`pos_registry_sale`, `_sale_line`, `_sale_payment`,
  `_sale_summary`, 4 old wizards, `live_api_wizard`) from a pre-Rista
  module design — no `ir_model` entry, no code reference anywhere, zero
  data of value. Dropped by hand.
- **Custom import wizards** — built, then removed once it was confirmed
  native Odoo list import (plus the `warehouse_code`/`product_default_code`
  smart-resolve columns) already covers the need.

## 11. Known open items

- **Sales Page job: intermittent, self-healing failure.** `Scheduled pull
  'Sales Page' has no registered response processor` fires roughly once
  per 30–90 successful runs (9 times across Sep 14–23 against hundreds of
  successes in the same window). Predates this cycle's work by over a
  week. Root cause not yet found — looks like a cron/registry timing race,
  not a config problem (endpoint flags checked live and correct). Not
  currently losing data: the next tick retries, and `pull_offset_days=2`
  naturally covers small gaps.
- **Real, live API fields captured but not modeled**: `totalCost` /
  `totalMaterialCost` / `totalSuppliesCost` (order- and item-level cost
  data — currently zero margin/profitability visibility from this
  integration) and `tipAmount`, plus smaller ones (`overallRefunds`,
  `reprintCount`/`reprintEvents`, `chargeTaxTotal`, `billRoundedAmount`,
  `accountingRoundOff`, `directChargeAmout` — Rista's own typo,
  `taxAmountIncluded`/`taxAmountExcluded`, `taxRoundOff`,
  `itemDiscountAmount`, a header-level `itemTotalAmount` distinct from the
  per-line field of the same name, `kdsOrderInProcess`, `label`, `url`,
  `dispatchOTP`). None of these are in the vendor's own mapping sheet.
  Deliberately not added — flagged, not built — pending a deliberate
  decision, especially on the cost fields given the margin-reporting
  implication.
- **`branchState`, `branchTIN`, `orderReadyTimestamp`** — real,
  consistently-present fields, confirmed via live sample, explicitly
  deferred ("skip for now") rather than added.
- **Item Mapping name collisions** — see §7; needs `variant` captured
  onto the item record to distinguish same-named different-sized SKUs.
- **277 of 327 items unmapped (85%)** — checked, none are stale/dead SKUs;
  they're either awaiting a manual/Auto-Map pass or don't have an obvious
  exact code/name match in the current product catalog.
