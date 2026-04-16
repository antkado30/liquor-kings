# Liquor Kings Blueprint

Canonical product and system blueprint for Liquor Kings MLCC/RPA architecture and current status.

## 0) Who I am / how I work

I am Antonios, building Liquor Kings: an AI-assisted liquor store OS focused on:

- MLCC ordering automation for Michigan
- inventory management
- labeling
- RPA against Michigan Liquor Control Commission (MLCC) web properties

Tech stack:

- Supabase (Postgres + RLS)
- Node/Express API
- background workers for MLCC browser automation (RPA)
- monorepo with SQL, scripts, services, tests, and docs

Preferred working style:

- concrete, copy-pasteable commands
- medium-sized feature slices
- one chosen next move (no option spread)
- heavy Cursor AI usage is fine, but this blueprint remains in-repo for AI context

## 1) Product vision

Liquor Kings is an OS for liquor stores, starting with Michigan.

Core operator outcomes:

- manage inventory and bottle metadata
- map store bottles to authoritative MLCC catalog items
- build/store carts and orders
- have a robot place orders on MLCC safely and observably

Execution sequence:

1. make data layer safe + observable (RLS, mapping)
2. enforce MLCC mapping/readiness so robot never runs on bad data
3. enforce Gate 1-3 maturity controls
4. layer operator tooling (dashboard, backlog, admin UI)

## 2) Gates / milestones (RPA subsystem)

Gates are tracked in `docs/RPA_SUBSYSTEM_DONE.md`.

| Gate | Status | Notes |
|---|---|---|
| Gate 1 - RLS snapshot/security | DONE (staging) | Snapshot in `docs/RLS_AUDIT.md`. Core user-facing tables GREEN; some internal/log tables RED but out of immediate RPA safety scope. |
| Gate 2 - MLCC mapping visibility | DONE (visibility/design) | Snapshot in `docs/MLCC_MAPPING.md`. Backfill flow exists; real staging apply still pending from laptop run. |
| Gate 3 - MLCC Execution Readiness & Coverage | Split: API DONE / human pilot TODO | Acceptance + verification documented. API-level enforcement implemented. Human pilot still open. |

Snapshot metrics captured for Gate 2 visibility (at capture time in staging):

- `total_mlcc_items = 12828`
- `total_bottles = 23`
- `bottles_with_mlcc_item_id = 1`
- `bottles_code_only_no_fk = 22`
- `bottles_with_valid_join = 1`
- `bottles_code_not_in_catalog = 0`
- `pct_bottles_with_mlcc_item_id ~= 4.35`
- `pct_bottles_valid_join_to_mlcc_items ~= 4.35`

## 3) Data + backfill: MLCC catalog and bottles

Catalog side:

- `mlcc_items` is the authoritative MLCC catalog table.
- Staging snapshot is about 12.8k items.
- Typical fields include code, name/brand, size, ABV/proof, and mapping-relevant attributes.

Store bottle side:

- `bottles` includes store bottle metadata with:
  - internal bottle id
  - store association
  - name/description
  - `mlcc_code` (free text, can be messy)
  - nullable `mlcc_item_id` FK

Backfill assets:

- SQL: `sql/mlcc_backfill_preview_and_apply.sql`
- Doctor script: `scripts/lk-verify/doctor-mlcc-backfill.mjs`
- Unit tests: `services/api/tests/lk-verify/doctor-mlcc-backfill.unit.test.js`

Backfill behavior:

- PREVIEW classifies candidate bottles (`mlcc_item_id IS NULL` and non-empty `mlcc_code`) into:
  - `can_backfill` (exact unique match in `mlcc_items`)
  - `ambiguous` (multiple matches)
  - `no_match` (no match)
- APPLY updates only unique exact matches, never overwrites existing non-null FK, runs in one transaction, then preview is rerun.

Doctor safeguards:

- default mode is preview only
- APPLY requires `APPLY_BACKFILL=1` and exact token `MLCC_BACKFILL_STAGING`
- tests enforce dry-run/apply separation and update-location constraints

Current environment note:

- In this agent shell, DB env is unavailable; preview/audits fail due to missing DB configuration.
- Therefore, no real bucket counts are produced in-agent, and APPLY is skipped by rule.

Laptop staging commands (repo root):

```bash
mkdir -p tmp
( cd services/api && npx vitest run tests/lk-verify/doctor-mlcc-backfill.unit.test.js ) | tee tmp/doctor-mlcc-backfill.unit.txt
node scripts/lk-verify/doctor-mlcc-backfill.mjs | tee tmp/mlcc-backfill-preview.txt
psql -v ON_ERROR_STOP=1 -f sql/mlcc_mapping_audit.sql | tee tmp/mlcc-mapping-audit-before.txt
psql -v ON_ERROR_STOP=1 -f sql/mlcc_post_backfill_exception_audit.sql | tee tmp/mlcc-post-backfill-exceptions-before.txt
```

APPLY gate:

- Run apply only if `tmp/mlcc-backfill-preview.txt` shows `ambiguous = 0` and `no_match = 0`.

```bash
APPLY_BACKFILL=1 node scripts/lk-verify/doctor-mlcc-backfill.mjs
```

Then rerun audits and update `docs/MLCC_MAPPING.md` with real post-apply counts.

## 4) MLCC execution readiness pipeline

Purpose: prevent RPA from running on mapping-bad carts.

Concepts:

- readiness: can this submitted cart execute safely in MLCC RPA?
- blocking lines: which lines lack resolved `mlcc_item_id` (or equivalent readiness blockers)?
- summary: stable status code/count abstraction for operators/UI

Core modules:

- `services/api/src/services/cart-execution-payload.service.js`
  - `evaluateMlccExecutionReadinessForSubmittedCart`
  - builds same execution payload path used by enqueue route
- `services/api/src/utils/mlcc-execution-item-guard.js`
  - `collectMissingMlccItemIdLines`
- `services/api/src/mlcc/mlcc-execution-readiness-serialize.js`
  - `serializeMlccExecutionReadiness(evalResult)`
  - `readinessDedicatedHttpPayload(evalResult)`
- `services/api/src/mlcc/mlcc-execution-readiness-summary.js`
  - `deriveMlccExecutionSummaryFromReadiness(readiness)`
  - key status codes: `ready`, `blocked_missing_mlcc_item_id`, `not_mlcc_ready`

Readiness surfaces:

- `GET /cart/:storeId/history/:cartId/mlcc-execution-readiness`
- `GET /cart/:storeId/history/:cartId` (embedded `mlcc_execution_readiness`)
- `GET /cart/:storeId/history` (embedded readiness + summary per row)

## 5) Gate 3 enforcement at execution boundary

Goal: no `execution_run` is created from a not-ready cart.

Core enforcement module:

- `services/api/src/mlcc/assert-mlcc-execution-readiness-for-cart.js`
  - `assertMlccExecutionReadinessForEnqueue(evalResult)`
  - uses canonical readiness serialization
  - returns:
    - 400 + `{ error, message, blocking_lines }` when not ready
    - 404 + `{ error }` for not found
    - non-200 propagation for other failures

Execution creation flow:

- `services/api/src/services/execution-run.service.js` (`createExecutionRunFromCart`)
  1. `buildExecutionPayloadForSubmittedCart`
  2. `verifyCartItemsBeforeExecution`
  3. `evaluateMlccExecutionReadinessForSubmittedCart`
  4. `assertMlccExecutionReadinessForEnqueue`
  5. only then insert into `execution_runs`

Contract behavior:

- `POST /execution-runs/from-cart/:storeId/:cartId`
  - not ready: 400 + MLCC contract payload + no run inserted
  - ready: 201 + run inserted

Gate 3 doc section exists in `docs/RPA_SUBSYSTEM_DONE.md`.

## 6) Operator-facing MLCC tooling

### 6.1 Readiness dashboard (cart-centric)

Endpoint: `GET /cart/:storeId/mlcc-readiness-dashboard`

Returns:

- `ok`, `store_id`
- `counts`: `total_carts`, `blocked_carts`, `ready_carts`, `by_status_code`
- `carts` rows with metadata + `mlcc_execution_summary` + `blocking_preview`

Query params:

- `blocked_only`
- `status_code`
- `limit` (default 20, clamp 1-100)

Implementation notes:

- source: `cart-submitted-mlcc-feed.service.js`
- evaluated cart scope uses `DASHBOARD_CANDIDATE_FETCH_LIMIT = 100`
- triage sort: blocked first, then newest

### 6.2 Blocking hints + proposed fixes (cart-level)

Endpoint: `GET /cart/:storeId/history/:cartId/mlcc-blocking-hints`

For blocked carts returns per-line hints including:

- normalized code diagnostics (`blank`, `bad`, `no_match`, `exact`, `multiple`)
- candidates (capped)
- `proposed_fix`:
  - action (`manual_review_required`, `operator_must_choose_candidate`, `confirm_single_candidate`)
  - reason code
  - suggested id (if applicable)
  - candidate options (<= 5)
  - `auto_selectable`

Implementation:

- `services/api/src/mlcc/mlcc-blocking-hints.service.js`
- `services/api/src/mlcc/mlcc-blocking-hint-proposed-fix.js`

### 6.3 Bottle-centric mapping backlog

Endpoint: `GET /cart/:storeId/mlcc-mapping-backlog`

Aggregates blocking hints by `bottle_id`.

Returns:

- `counts`: `backlog_bottles`, `total_blocking_hints` (+ scanned cart count in implementation)
- `backlog_summary`:
  - total backlog/blocked counts
  - effort buckets (`auto_selectable`, `operator_choice`, `manual_review`)
  - urgency bucket
- `items`: per-bottle rows (default limit 50, max 100) including:
  - bottle identifiers and code fields
  - `blocking_hint_count`, `affected_cart_count`, `latest_seen_at`
  - `recent_cart_ids`
  - `sample_candidates` (<= 3)
  - `dominant_proposed_fix_action` (tie order operator > manual > confirm)

### 6.4 MLCC operator overview

Endpoint: `GET /cart/:storeId/mlcc-operator-overview`

Purpose: one-call summary payload for operator home panel.

Query params:

- `cart_limit`, `backlog_limit` (default 5, max 20)

Returns:

- `ok`, `store_id`, `generated_at`
- `limits`
- `readiness_dashboard` (counts + neutral filters + load scope)
- `backlog_summary`
- `top_blocked_carts` (compact)
- `top_backlog_bottles` (compact)

Error behavior:

- 500 response keeps stable key shape with empty/zero sections plus `error`.

## 7) High-level roadmap from here

### A) Immediate laptop execution steps (not this agent shell)

1. run staging MLCC backfill preview + audits
2. if `ambiguous = 0` and `no_match = 0`, run guarded apply
3. rerun audits and update `docs/MLCC_MAPPING.md`
4. run live Supabase-dependent route/smoke tests

### B) Gate 3 pilot (human)

1. choose staging store + test carts
2. validate boundary behavior:
   - blocked cart -> 400 on `POST /execution-runs/from-cart` with MLCC payload
   - ready cart -> 201 + run inserted
3. run worker in staging; log selected MLCC items and error handling behavior

### C) Minimal operator UI

Build admin page against:

- `/cart/:storeId/mlcc-operator-overview`
- `/cart/:storeId/mlcc-readiness-dashboard`
- `/cart/:storeId/mlcc-mapping-backlog`
- `/cart/:storeId/history/:cartId/mlcc-blocking-hints`

Render:

- readiness counts
- top blocked carts
- top backlog bottles
- per-cart hints/proposed fixes

### D) Later scaling

- add operator actions (`reviewed`, `do_not_auto_map`)
- expand RPA flow coverage
- add run logs/monitoring dashboards

## 8) Cursor AI usage contract

If Cursor AI reads this file:

- treat this file as the single source of truth for Liquor Kings MLCC/RPA architecture and current state
- reuse modules/patterns named here
- keep MLCC readiness + Gate 3 enforcement semantics consistent
- use operator overview/backlog contracts instead of inventing new API shapes
- propose one concrete next step at a time, with file paths and test updates