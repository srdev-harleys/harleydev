# Batch/Lot Tracking on the Operations Grid — Current State (2026-07-27)

This is a state document, not a changelog: it describes how the Batch /
Batch Qty / Expiry Date feature on the Inventory Operations grid works *as
of now*, across every screen it touches. Nothing below has a corresponding
write-up in `docs/` yet — this is the source material for that.

Module: `odoo_harleys-main/harleys_customization/`. No new Python model was
added for this feature — it's view + JS/SCSS only, layered on top of
Odoo's core `stock.picking` / `stock.move` / `stock.lot`.

---

## 1. One screen, four business flows

Indent, Inventory, Purchase and Sales don't have four separate Operations
screens — they all render through the *same* Odoo form,
`stock.view_picking_form`, extended once by
`harleys_customization/views/stock_picking_views.xml`
(`view_picking_form_custom`). That inherited view isn't scoped to any
specific action or menu, so every picking gets the same Operations-tab
extensions regardless of how it was created. The four flows only diverge
at the *field* level, via `picking_type_code` (on `stock.picking`) /
`picking_code` (the same thing, related onto `stock.move`):

| Business flow | picking_type_code | Entry point |
|---|---|---|
| Indent Request → Internal Transfer | `internal` | Indent Request form → "Internal Transfer" |
| Inventory → Internal Transfer | `internal` | Inventory app → Internal Transfers |
| Purchase → Receipt (GRN) | `incoming` | Purchase Order → Receipt |
| Sales → Delivery | `outgoing` | Sales Order → Delivery |

Indent and Inventory are literally indistinguishable by `picking_type_code`
— both are `internal`. The only way to tell them apart in the data is
whether a `stock.picking` is linked from an `indent.request` record or not;
the Operations grid itself treats them identically. Purchase and Sales are
also the same underlying screen as each other and as the two `internal`
flows — they just carry a different `picking_type_code` (`incoming` /
`outgoing`), which is what our widgets branch on.

Columns unrelated to Batch (all of core Odoo's own Operations grid) don't
change; only the extensions below are picking-type-aware.

## 2. The three Batch columns

| Column | Field | Widget | Editable? |
|---|---|---|---|
| Batch | `lot_ids` | `stock_move_line_batch` | Add/select/delete |
| Batch Qty | `move_line_ids` (`quantity`) | `stock_move_line_row_field`, `options="{'row_field': 'quantity', 'editable': True}"` | Yes, numeric input |
| Expiry Date | `move_line_ids` (`expiration_date`) | `stock_move_line_row_field`, `options="{'row_field': 'expiration_date', 'date_format': 'dd/MM/yy'}"` | Read-only, `dd/MM/yy` |

All three are `column_invisible` unless `picking_type_code` is one of
`internal` / `incoming` / `outgoing` — so they're specific to these four
flows and don't appear on any other picking type Harleys might use.

All three read from one shared row list —
`getMoveLineRows()` in `static/src/js/stock_move_line_rows.js` — built
primarily off `lot_ids.records`, with a fallback for Receipt lines whose
quantity is still 0 (Harleys forces new GRN lines to `quantity = 0`, which
would otherwise make core's own `_compute_lot_ids` hide the row before the
user can type a quantity). Because all three columns share this one
function, adding or deleting a batch in one column is reflected in the
other two with no separate bookkeeping.

## 3. Where batches can be *created* vs only *selected*

This is the key difference between the four flows:

- **Purchase GRN (`incoming`) only** — clicking "Add" opens a dedicated
  popover (`StockMoveLineBatchQuickCreate`): live search against existing
  `stock.lot` records for the current product, and the ability to type a
  brand-new batch number. If the product tracks expiry, a expiry date is
  mandatory, entered via Odoo's own calendar widget locked to `dd/MM/yy`
  and unable to be backdated. **This is the only place in the system a new
  batch/lot record is minted through this grid.**
- **Indent/Inventory internal transfer and Sales delivery (`internal`,
  `outgoing`)** — clicking "Add" opens a plain inline autocomplete
  (`Many2XAutocomplete`), domain-filtered to the line's own product
  (`domain="[('product_id','=',product_id)]"`). This is select-only in
  practice: there's no dedicated "new batch" UI here the way the Receipt
  popover has one. (The underlying widget still technically supports
  create-by-typing if `use_create_lots` is on for that picking type and the
  view's `options="{'create': [...]}"` allows it — that's bare Odoo
  default behavior inherited from `Many2XAutocomplete`, not a designed
  create flow, and isn't how these three flows are meant to be used.)

This matches how the business actually works: batches physically originate
at goods receipt, so GRN is the only point that should mint new ones — the
other three flows just draw down against what already exists.

## 4. Universality — a batch created once is visible everywhere

`stock.lot` is master data, not scoped to the picking that created it. The
moment a batch is created on a GRN receipt, it's a normal `stock.lot` row
(scoped only by `product_id` / `company_id`) and is immediately selectable
from the same product-filtered dropdown on any other picking — internal
transfer or delivery — for that product, company-wide. No extra work was
needed for this; it falls directly out of `stock.lot` already being one
shared model. There is currently **no warehouse/location scoping** on the
lot record itself — availability *by location* is a separate concern,
tracked on `stock.quant`, not gated on the lot.

## 5. Line-item batch add/delete — currently unrestricted

On all four flows, any user who can see the picking and has Odoo's own
`stock.group_production_lot` (the base "Lots & Serial Numbers" feature
toggle — a feature switch, not a rank/hierarchy group) can freely add or
delete Batch rows on any line item (`deleteLot()` / `deleteLine()` in
`stock_move_line_batch_field.js`). The only other gate is the standard
`is_locked` / `state` check already on the whole Operations tab — batch
add/delete disappears once a picking is done and locked, same as the rest
of the grid. There is no separate, tighter permission for this action.

## 6. Not yet built: "only a higher official can change batch details"

This is a stated requirement, **not current behavior** — flagging clearly
so it isn't documented as already-shipped. Checked directly against the
code (`security/ir.model.access.csv`, `security/security_group.xml`): there
is no ACL or `ir.rule` on `stock.lot` in this module at all. Concretely,
today:

- Editing an *existing* batch's own fields (name, expiration date, etc.) —
  via core's "Details" popup (`action_show_details` on `stock.move`, core
  Odoo) or the standalone Inventory → Products → Lots/Serial Numbers list —
  is open to anyone who can see the picking or that menu. No extra
  permission check exists beyond ordinary `stock.lot` access.
- There's already a precedent pattern in this same module for exactly this
  kind of split, just not wired to batches: `group_indent_admin` /
  `group_indent_user` (`res.groups.privilege` "Indent Request",
  `security/security_group.xml`), paired with `ir.rule` domain
  restrictions (e.g. `indent_request_rule` scoping non-admins to
  `requested_by = user.id`, `indent_request_manager_rule` giving the admin
  group unrestricted access). That's the established "user can touch their
  own records, admin/manager can touch everything" template in this
  codebase — the natural one to extend for batch-detail editing, as an
  alternative to reusing core's existing `stock.group_stock_manager` if
  "higher official" is meant to map to Inventory Manager specifically
  rather than a new bespoke group.
- Before this can be built, needs a decision on: which group/role counts as
  the "higher official" (existing `stock.group_stock_manager`? a new
  group? something per picking type / department?), and exactly what
  "change batch details" covers — editing the `stock.lot` record's own
  fields after creation, versus something else like reassigning which lot
  a saved move line points to. Line-item add/select/delete (§5) is
  explicitly *not* meant to be restricted by this — only editing a batch's
  own details after it exists.

## 7. Files (this feature only, for reference)

| File | Purpose |
|---|---|
| `views/stock_picking_views.xml` | Adds the three columns to `stock.view_picking_form`'s Operations tab; all `picking_type_code`-gated |
| `static/src/js/stock_move_line_rows.js` | Shared row list (`getMoveLineRows`) all three columns read from |
| `static/src/js/stock_move_line_batch_field.js` / `.xml` | Batch column: tags, delete, dispatches to inline dropdown (internal/outgoing) or popover (incoming) |
| `static/src/js/stock_move_line_batch_quickcreate.js` / `.xml` | Receipt-only "Add Batch" popover: live search + new-batch + expiry entry |
| `static/src/js/stock_move_line_row_field.js` / `.xml` | Shared, parametrized widget powering both Batch Qty and Expiry Date columns |
| `static/src/js/searchable_x2many.js` | Operations grid list renderer; also where the new-line auto-save (§8) lives |
| `static/src/scss/stock_picking_operations.scss` | All styling for the above |

## 8. Known trade-offs / open items

- **Demand quantity (Initial Demand) goes read-only shortly after a new
  line is added.** Side effect of auto-saving the picking as soon as a
  product is selected (needed so Batch/Batch Qty/Expiry become usable on
  that row at all) combined with core Odoo's own `_autoconfirm_picking()` /
  `is_initial_demand_editable` logic, which locks Demand once a move
  leaves `draft` state on an `is_locked` picking. Root-caused but not yet
  resolved; the options on the table are (a) scope an override to
  just-added (`additional = True`) lines specifically, (b) move the
  auto-save trigger back to "leaving the row" instead of "product
  selected," or (c) unlock the whole picking (not recommended — that also
  reopens Scheduled Date editing picking-wide, wider than intended).
- **No warehouse/location scoping on batches** (§4) — a batch created on
  one GRN is selectable everywhere, company-wide, today. Unbuilt if the
  business actually wants batches scoped per warehouse/store.
- **"Higher official" governance (§6) is unbuilt** — line-item add/select/
  delete works for anyone today; editing an existing batch's own details
  has no extra gate yet.
