# RPA subsystem — definition of DONE & status (canonical)

**Purpose:** One place to answer: **Is the Liquor Kings MLCC RPA subsystem DONE?** against the agreed definition, with **Gate 1 / Gate 2 / Gate 3** mapping and **weighted gap tracking**. Other docs remain authoritative for detail; this file is the **rollup**.

**Last status review:** 2026-04-11 — **subsystem is not fully DONE**; G1 and G2 **live SQL snapshots** are now captured for **staging**; residual blockers are listed in §6.

**Related:** [`SAFETY_INVARIANTS.md`](./SAFETY_INVARIANTS.md), [`RPA_SAFETY_CHECKLIST.md`](./RPA_SAFETY_CHECKLIST.md), [`SELECTORS.md`](./SELECTORS.md), [`MLCC_MAPPING.md`](./MLCC_MAPPING.md), [`RLS_AUDIT.md`](./RLS_AUDIT.md), [`MLCC_PRE_RUN_CHECKLIST.md`](./MLCC_PRE_RUN_CHECKLIST.md), [`MLCC_ROLLBACK_PLAN.md`](./MLCC_ROLLBACK_PLAN.md), [`RPA_MONITORING_SPEC.md`](./RPA_MONITORING_SPEC.md), [`contracts/rpa-run-summary.md`](./contracts/rpa-run-summary.md), [`SESSIONLOG.md`](./SESSIONLOG.md).

---

## 1. Definition of DONE (RPA) — summary

| Criterion | Evidence in repo |
|-----------|------------------|
| **SAFE MODE default** | `MLCC_BROWSER_DRY_RUN_SAFE_MODE === true`; `verify-rpa-safety.mjs` + `tests/rpa/safe-mode-invariant.test.js`; `npm run safety:lk:rpa-local` |
| **Invariants explicit + tested** | [`SAFETY_INVARIANTS.md`](./SAFETY_INVARIANTS.md), worker/probe unit tests, CI workflow |
| **Order-critical selectors GREEN** | [`SELECTORS.md`](./SELECTORS.md) |
| **Non–order-critical RED disposition** | [`SELECTORS.md`](./SELECTORS.md) § Pilot disposition |
| **`mappingconfidence`** | `unknown` blocks, `inferred` surfaced, `confirmed` proceeds — [`MLCC_MAPPING.md`](./MLCC_MAPPING.md) + `evaluateDryRunMappingConfidenceGuard` |
| **RLS / store isolation** | Migrations + contract tests + **live** staging snapshot in [`RLS_AUDIT.md`](./RLS_AUDIT.md) (2026-04-11) |
| **Evidence baseline** | `MLCC_SAFE_FLOW_SCREENSHOT_DIR` → `mlcc_run_summary.json` + milestone PNGs; `finalizeRun` evidence on `execution_runs` (see [`RPA_MONITORING_SPEC.md`](./RPA_MONITORING_SPEC.md)) |
| **Pilot / monitoring docs** | Pre-run, rollback, monitoring spec, run-summary contract — **reality-checked** against code references in those docs |
| **Gates** | §3–§5 below |

**Not claimed:** unattended real-mode readiness, production MLCC order automation, or outbound webhooks.

---

## 2. Gate definitions (RPA-relevant)

| Gate | Meaning (for this rollup) | Primary docs / artifacts |
|------|----------------------------|---------------------------|
| **Gate 1** | **RLS & store-scoped data posture** for RPA-adjacent tables: policies exist where required; contract tests match migration intent; **live** `psql` snapshot pasted in [`RLS_AUDIT.md`](./RLS_AUDIT.md). | [`RLS_AUDIT.md`](./RLS_AUDIT.md), `sql/rls_audit_query.sql`, `services/api/tests/unit/rls/` |
| **Gate 2** | **Catalog / bottle linkage** + **runtime mapping guard**: SQL audit pasted in [`MLCC_MAPPING.md`](./MLCC_MAPPING.md); dry-run guard behavior verified. | [`MLCC_MAPPING.md`](./MLCC_MAPPING.md), `sql/mlcc_mapping_audit.sql`, quantity-rules + worker tests |
| **Gate 3** | **MLCC execution readiness (API)** — blocked carts cannot enqueue `execution_runs`; readiness uses shared evaluator with GET readiness routes. **Supervised pilot** (human dry-run + sign-off) remains tracked separately in §4 gaps **G3–G5**. | This file § *Gate 3 – MLCC Execution Readiness & Coverage*; [`MLCC_PRE_RUN_CHECKLIST.md`](./MLCC_PRE_RUN_CHECKLIST.md), [`RPA_MONITORING_SPEC.md`](./RPA_MONITORING_SPEC.md) |

---

## Gate 3 – MLCC Execution Readiness & Coverage

**Goal:** MLCC RPA execution is allowed only for carts that are already **MLCC-ready** under the same rules as the readiness endpoints; mapping debt is visible before anyone hits the execution boundary.

**Staging acceptance (testable):**

- MLCC execution starts only from carts whose readiness evaluates to **`ready === true`** using the shared readiness / guard rules (`evaluateMlccExecutionReadinessForSubmittedCart` + serializer).
- No new **`execution_run`** is created from a cart that still has any line blocked for MLCC execution (for example missing **`mlcc_item_id`** on the payload snapshot).
- Operators can see **blocked vs ready** carts and **bottle-level** mapping debt via store-scoped APIs and SQL audits before attempting execution; unresolved debt is not hidden only as opaque execution failures.
- **Manual staging verification:** a cart left not MLCC-ready remains **blocked at `POST /execution-runs/from-cart/...`** (structured error, no run row); after resolving IDs / mapping, a ready cart still **returns 201** and creates a queued run as before.

### Observability / verification surfaces

- `GET /cart/:storeId/history/:cartId/mlcc-execution-readiness` — dedicated readiness JSON.
- `GET /cart/:storeId/history/:cartId` — submitted cart detail with embedded `mlcc_execution_readiness`.
- `GET /cart/:storeId/history` — per-row readiness + `mlcc_execution_summary`.
- `GET /cart/:storeId/mlcc-readiness-dashboard` — store triage: counts, filters, `blocking_preview`.
- `GET /cart/:storeId/mlcc-mapping-backlog` — bottle-centric backlog + `backlog_summary`.

**Execution boundary (enforced in API):** `POST /execution-runs/from-cart/:storeId/:cartId` calls **`assertMlccExecutionReadinessForEnqueue`** (Gate 3 helper) **before** any `execution_runs` insert.

### How to verify in staging

1. **Visibility:** Use the GET routes above (and `sql/mlcc_mapping_audit.sql` / backlog responses) to confirm blocked carts and bottles appear where expected.
2. **Blocked path:** On a validated submitted cart with a missing line `mlcc_item_id`, `POST /execution-runs/from-cart/:storeId/:cartId` must return **400** with `error: "MLCC_ITEM_ID_REQUIRED"` (and `blocking_lines` / `message` per contract) and **must not** insert a new `execution_run` for that cart.
3. **Ready path:** After catalog alignment (e.g. backfill + `ensure` patterns in tests), the same POST must still return **201** and create a run when readiness is ready.
4. **Mapping debt:** Combine mapping audit outputs with dashboard / backlog JSON to show explainable debt, not only post-failure investigation.

---

## 3. Gate satisfaction matrix (as of last doc update)

| Gate | Satisfied in repo? | Notes |
|------|--------------------|--------|
| **Gate 1** | **Yes (live snapshot)** | Migrations + contract tests: **yes**. **Live** RLS snapshot for **staging** (56 tables, **2026-04-11T05:40:00Z**): see [`RLS_AUDIT.md`](./RLS_AUDIT.md). *Follow-up:* several tables remain **RED** in that snapshot (RLS disabled) — policy work is **out of scope** for this rollup but is visible in the audit table. |
| **Gate 2** | **Yes (SQL snapshot + runtime guard)** | Runtime `mappingconfidence` guard + tests: **yes**. **Live** mapping summary + buckets for **staging** (same timestamp): see [`MLCC_MAPPING.md`](./MLCC_MAPPING.md). |
| **Gate 3** | **Partial** | **API execution gate:** **yes** — `createExecutionRunFromCart` enforces shared readiness before insert (Gate 3 helper). **Human** supervised dry-run + pilot sign-off (**G3–G5**): **open** until owners sign off. |

---

## 4. Weighted “remaining gaps” list (fixed until DONE spec changes)

**Weights (per tracking guidance):** pre–Gate-2 critical = **3**, pre-pilot critical = **2**, nice-to-have = **1**.

| ID | Gap | Weight | Status | Owner / verification |
|----|-----|--------|--------|-------------------------|
| G1 | Paste **live** RLS audit rows into [`RLS_AUDIT.md`](./RLS_AUDIT.md) (environment + UTC timestamp) | 3 | **DONE** (2026-04-11) | Staging `psql` snapshot pasted |
| G2 | Paste **live** MLCC mapping audit into [`MLCC_MAPPING.md`](./MLCC_MAPPING.md) (environment + UTC timestamp) | 3 | **DONE** (2026-04-11) | Staging `psql` snapshot pasted |
| G3 | **Human** reality-check: one dry-run with `MLCC_SAFE_FLOW_SCREENSHOT_DIR` set; confirm disk summary + `execution_runs` fields match [`RPA_MONITORING_SPEC.md`](./RPA_MONITORING_SPEC.md) / [`contracts/rpa-run-summary.md`](./contracts/rpa-run-summary.md) | 2 | **Open** | Operator + engineer |
| G4 | Supervised **pilot readiness sign-off** (business + ops) | 2 | **Open** | Business |
| G5 | Reduce operator-memory burden: runbook always links here + pre-run checklist for every session | 1 | **Open** | Docs habit / SESSIONLOG |

**Total weight:** \(3+3+2+2+1 = 11\).

**Completed weight:** \(3 + 3 = 6\) for **G1** and **G2** (both **DONE**).

**% done:** \(6 \div 11 \approx 0.545\) → **54.5%** (rounded to one decimal).  
*Interpretation:* two of five gap line-items are closed; three weighted items (**G3**, **G4**, **G5**) remain, representing **5** of **11** weight units outstanding.

*Note:* If G1 and G2 were each counted as **weight 2** instead of **3**, completed weight would be **4** and **% done ≈ 36.4%**. This rollup keeps the **original** weights (**3** + **3** for G1 + G2) → **6** completed of **11**.

**Formula:** `% done = completed_gap_weight_sum / 11` (adjust denominator only if the gap list changes in a spec revision).

---

## 5. Verdict

| Question | Answer |
|----------|--------|
| **Is RPA DONE?** | **No** — Gate 3 and pilot sign-off (**G3–G5**) remain **open**. |
| **Are Gate 1 & Gate 2 “snapshot DONE”?** | **Yes** for **staging** as of **2026-04-11** — see [`RLS_AUDIT.md`](./RLS_AUDIT.md) and [`MLCC_MAPPING.md`](./MLCC_MAPPING.md). |
| **Is SAFE MODE / hardening “repo ready”?** | **Yes** for code + static gates + documented contracts; local gate: `npm run safety:lk:rpa-local` in root `package.json`. |

---

## 6. Residual blockers (copy into tickets)

1. ~~**[G1]** [`RLS_AUDIT.md`](./RLS_AUDIT.md) — replace placeholder snapshot~~ **Done** (staging 2026-04-11).
2. ~~**[G2]** [`MLCC_MAPPING.md`](./MLCC_MAPPING.md) — replace placeholder snapshot~~ **Done** (staging 2026-04-11).
3. **[G3–G5]** Operator-led dry-run + pilot approval + session habit — cannot be closed by automation alone.

### Staging observation (not a new weighted gap)

[`RLS_AUDIT.md`](./RLS_AUDIT.md) lists **11** `public` tables with **`risk_band` = RED** (RLS disabled, `policy_count` 0) in the 2026-04-11 snapshot — e.g. `activity_logs`, `app_settings`, `mlcc_change_rows`, `scan_logs`, etc. Track migration / grants work in normal engineering backlog; **denominator stays 11** unless the DONE spec adds a new weighted item.

---

## Changelog

| Date | Notes |
|------|--------|
| 2026-04-10 | Initial canonical DONE rollup + weighted gap list (SPEC-RPA-FINALIZATION doc pass). |
| 2026-04-11 | **G1/G2 DONE** (staging snapshots); **% done** recomputed to **~54.5%** (6/11); Gate matrix + residual list updated. |
| 2026-04-10 | **Gate 3 (MLCC execution readiness)** — documented acceptance + `POST /execution-runs/from-cart` enforces shared readiness before `execution_runs` insert. |
