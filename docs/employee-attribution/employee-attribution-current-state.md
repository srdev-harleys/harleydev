# Shared Login & Employee Attribution — Current State (2026-07-23)

This is a state document, not a changelog: it describes how the whole
feature works *as of now*. The existing `docs/user-guide.html` /
`docs/developer-guide.html` already cover the login-time identity
verification piece in full (their sections 1–7, "The problem" through
"Admin guide: marking an account as shared") — that part is unchanged and
not repeated here. Everything below is new material to fold in, covering
message-level attribution's second layer, its admin configuration, and one
new table.

Module: `odoo_harleys-main/hr_shared_login_binding/`.

---

## 1. Recap: the two layers (for context)

Every chatter-enabled model (anything using `mail.thread` or a variant) is
extended once, in `models/message_attribution.py`, via `_inherit =
'mail.thread'`. Because Odoo composes that mixin into every model that
uses it, this applies automatically to every current *and future* model —
no per-model registration file, no manifest dependency on the owning
module.

- **Layer 1 — always on.** Overrides `_message_create()`, the one method
  every message-posting path (`message_post()`, and `_message_log()` for
  plain field-tracking messages with no matching subtype) converges on
  before a `mail.message` row is written. Adds `employee_id` to the
  message and appends an inline "— Logged by `<employee>`" note. Free,
  automatic, no configuration.
- **Layer 2 — opt-in per model.** Overrides `create()`/`write()`/`unlink()`
  on the same class, for the cases Layer 1 structurally cannot reach:
  fields with no `tracking=True` configured, and line items (whose own
  chatter panel isn't shown anywhere in the UI). Gated by three fields on
  `ir.model`, described below.

## 2. Admin configuration — `ir.model` (`models/attribution_config.py`)

Reuses Settings → Technical → Models (`ir.model`) rather than a new screen
— already searchable by name/module, already technical-user-only. A new
"Employee Attribution" tab (restricted to `base.group_system`) adds:

| Field | Type | Meaning |
|---|---|---|
| `employee_attribution_log_changes` | Boolean | Post an explicit "Created/Updated" note on every create/write for this model, regardless of field tracking. Off by default. |
| `employee_attribution_log_deletions` | Boolean | Post a "Deleted" note when a record is removed. Off by default. |
| `employee_attribution_parent_field_id` | Many2one → `ir.model.fields` | The Many2one field on *this* model pointing to its parent document (e.g. "Indent Request" on Indent Request Line). Dropdown, domain-filtered to Many2one fields belonging to the model being configured — not a technical name typed by hand. |

A constraint (`_check_employee_attribution_config`) blocks enabling either
boolean on:
- Technical/infrastructure models (`mail.*`, `bus.*`, `ir.*`,
  `base_automation`, `iap.*`, `studio.*`, `res.users`) — hard-excluded
  regardless of admin intent, to avoid recursion/noise in the mail/system
  internals.
- Any model without a chatter to log to (`hasattr(model, 'message_post')`
  check).
- A `parent_field_id` that doesn't actually belong to the model or isn't a
  Many2one.

**What "empty parent field" means, precisely — this differs by action:**
- Create/Update with no parent field → note posts on the record's **own**
  chatter. Correct default for top-level documents.
- Delete with no parent field → does **not** post on the record (it would
  be wiped by `mail.thread.unlink()`'s own message cleanup moments later)
  — falls back to the standalone log table (§4) instead.

## 3. Auto-detecting the parent field + bulk "Enable Employee Attribution"

Two methods on the `ir.model` extension:

- **`_auto_detect_attribution_parent_field()`** — heuristic: the Many2one
  field with `ondelete='cascade'` is the standard Odoo convention for a
  line item's relation to its owning document (`sale.order.line.order_id`,
  `account.move.line.move_id`, `stock.move.line.picking_id`, this repo's
  own `indent.request.line.request_id` all use it). Returns that field
  when there's exactly one candidate; returns nothing (left for manual
  review) when there are zero or multiple candidates — correctly finds
  nothing for genuine top-level documents, which don't have one.
- **`action_enable_employee_attribution()`** — bulk operation, exposed as
  a contextual "Enable Employee Attribution" action in the Settings →
  Technical → Models list view (select any rows, including all of them,
  and run it). For each selected row: skips it (logs which ones, doesn't
  error) if it's technical/incompatible; otherwise turns both booleans on
  and auto-fills the parent field if one isn't already set and the
  heuristic finds exactly one candidate.

This was run once already across the whole instance's model list.

## 4. New table: `hr.attribution.log` (`models/attribution_log.py`)

The one thing chatter genuinely cannot do: log a deletion for a record
with **no** parent to redirect to (a top-level document, or a specific
record whose parent field happens to be unset). Deliberately narrow in
scope — this is not a general duplicate log, it exists only for that one
gap. Not `mail.thread`-based (it *is* the log; logging to it would be
circular).

Columns: `employee_id` (FK `hr.employee`), `user_id` (FK `res.users`),
`company_id` (FK `res.company`), `res_model` (Char), `res_id` (Integer),
`record_name` (Char), `action` (Selection, currently only `'deleted'`),
`logged_at` (Datetime). `_log_access = False` — no
`create_uid`/`write_uid`/`create_date`/`write_date`, since `user_id` +
`logged_at` already cover that, deliberately.

Read-only in the UI (`perm_write`/`perm_create`/`perm_unlink` all `0`) for
`base.group_system` and `hr.group_hr_manager`; only ever written via
`sudo()` from the deletion fallback path in code. Browsable at
**Settings → Administration → Employee Attribution Log**.

## 5. Consolidation — batches log as one note, not one per record

`_log_attribution_change()` and `_log_attribution_deletion()` group
records by parent rather than looping and posting per record. Verified
against this repo's actual code (not assumed): both of the noisy cases
reported during testing —
- a template loading many `indent.request.line` records via `(0,0,vals)`
  One2many commands, and
- `indent_request.py`'s `request.line_ids.write({'state': 'sent'})` status
  change —

are each a single batched ORM call, so both are already fully consolidated
by this grouping (one summary note like "Created: 40 line(s)." per parent
per call, or the specific description when only one record is involved).

**Boundary worth knowing**: consolidation only works within a single ORM
call. Code that creates/updates line items one at a time in a Python loop
(none currently does, for the cases above) would still produce one message
per iteration, since each is a separate call from the ORM's point of view.

## 6. Known trade-offs / open items (in addition to whatever's already listed in the existing developer guide)

- Enabling `employee_attribution_log_changes` on a model that already has
  `tracking=True` fields (most real business documents) produces a second,
  redundant note alongside the native tracking message Layer 1 already
  tags. The bulk-enable action does not currently avoid this — it turns
  both flags on regardless of whether native tracking already covers a
  model. A more surgical default (only auto-enable on models with no
  tracked fields, or with a parent field) was discussed as an alternative
  but not built.
- The auto-detect heuristic is a best guess, not a guarantee — models with
  more than one `ondelete='cascade'` Many2one are left for manual review,
  and it cannot distinguish "genuine top-level document" from "child model
  that just doesn't use cascade delete."
- An earlier, fully static per-model implementation
  (`models/attribution_targets.py`, one `_inherit` class per model) exists
  in the codebase but is disabled (import commented out in
  `models/__init__.py`) — kept only as a fallback/reference, superseded by
  the two-layer `mail.thread` approach.
- `ir_model` may still carry one orphaned, unused text column
  (`employee_attribution_parent_field`, the pre-dropdown version of the
  parent-field setting) if `-u` was run while that version was briefly
  active — harmless, not yet cleaned up.

## 7. Full schema change list (all tables touched by this module, for reference)

| Table | Change |
|---|---|
| `res_users` | + `is_shared_login` (bool) |
| `res_users_authorized_employee_rel` | new — plain M2M junction for `authorized_employee_ids` (who may bind to a shared account), not a log |
| `mail_message` | + `employee_id` (FK `hr_employee`) — **this is where every attribution note actually lives** |
| `ir_model` | + `employee_attribution_log_changes` (bool), + `employee_attribution_log_deletions` (bool), + `employee_attribution_parent_field_id` (FK `ir_model_fields`) |
| `hr_attribution_log` | new table (§4) — fallback for parentless deletions only |

There is still no dedicated "all logs" table — querying "everything
employee X did, across every model and every account" is
`SELECT * FROM mail_message WHERE employee_id = X`, the same table Odoo's
own chatter has always used, plus `hr_attribution_log` specifically for
the deletion-with-no-parent case.
