# MLCC mapping — catalog audit & dry-run confidence

This page ties together **(A)** database-side catalog / bottle linkage (SQL) and **(B)** runtime **`mappingconfidence`** on dry-run payloads (application code). There is **no** `mappingconfidence` column on `public.mlcc_items` today; the mapping audit SQL does **not** `GROUP BY` that enum at the database layer.

**SQL posture:** `sql/mlcc_mapping_audit.sql` is **SELECT-only** (two sequential `SELECT` statements; no DDL or DML).

---

## Audit metadata

*(Update every refresh.)*

| Field | Value |
|--------|--------|
| **Environment** | **staging** (Supabase session pooler) |
| **Timestamp (UTC)** | **2026-04-11T05:40:00Z** |
| **Connection** | Same `psql` session as [`RLSAUDIT.md`](./RLSAUDIT.md) audit (pooler `aws-0-us-west-2.pooler.supabase.com:5432`, database `postgres` — credentials from dashboard only). |

**Exact command used (terminal):**

```bash
psql -h aws-0-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.vgilembychlcldhzqqeq -d postgres \
  -f sql/mlcc_mapping_audit.sql
```

**Optional CSV export (both result sets in one file — split by blank line or re-run per query if you prefer):**

```bash
psql -h aws-0-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.vgilembychlcldhzqqeq -d postgres \
  -f sql/mlcc_mapping_audit.sql --csv > mlcc_mapping_snapshot.csv
```

For prod-read-only, substitute your approved connection variable and credentials.

---

## What `mappingconfidence` means (runtime / dry-run)

On **cart execution payloads** passed into the MLCC browser **dry-run** worker, each line may carry mapping metadata (field names are normalized case-insensitively):

| Value | Meaning |
|--------|--------|
| **`confirmed`** | Mapping treated as authoritative for dry-run. |
| **`inferred`** | Allowed through; worker surfaces these lines for **human review** (evidence). |
| **`unknown`** | **Fail closed** for dry-run: run stops with a clear error before browser work proceeds on those lines. |
| *(missing / empty)* | Treated as **`confirmed`** for backward compatibility with legacy payloads. |

**RLS-style plain language (runtime, not SQL):** treat **`unknown`** as **RED** (blocked), **`inferred`** as **ORANGE** (allowed, review), **`confirmed`** as **GREEN** (proceed as configured).

**Dry-run guard (already implemented):** `evaluateDryRunMappingConfidenceGuard` in `services/api/src/quantity-rules/index.js` implements the above. It is invoked from the SAFE MODE dry-run path in `services/api/src/workers/mlcc-browser-worker.js` (evidence kind `mlcc_dry_run_mapping_confidence`, stage `validate_mapping_confidence`).

---

## SQL audit: catalog & bottle linkage

File: [`sql/mlcc_mapping_audit.sql`](../sql/mlcc_mapping_audit.sql)

**First result set (single summary row)** — columns in query order:

| Column | Meaning |
|--------|---------|
| `total_mlcc_items` | Rows in `public.mlcc_items`. |
| `total_bottles` | Rows in `public.bottles`. |
| `bottles_with_mlcc_item_id` | `bottles.mlcc_item_id IS NOT NULL`. |
| `bottles_code_only_no_fk` | `mlcc_item_id` null but `mlcc_code` non-empty. |
| `bottles_with_valid_join` | Bottles whose `mlcc_item_id` joins to an existing `mlcc_items` row. |
| `bottles_code_not_in_catalog` | No FK, code set, and no matching `mlcc_items.code`. |
| `pct_bottles_with_mlcc_item_id` | % of bottles with non-null `mlcc_item_id`. |
| `pct_bottles_valid_join_to_mlcc_items` | % of bottles with a valid join row to `mlcc_items`. |

**Second result set:** `bucket` | `cnt` — fixed bucket labels for DB-side “mapping readiness”.

---

## How to refresh (Gate 1 / Gate 2)

1. Run the **Exact command** in [Audit metadata](#audit-metadata).
2. **First result set:** copy the single summary row into [Summary snapshot](#summary-snapshot-first-result-set).
3. **Second result set:** copy all `bucket` / `cnt` rows into [Bucket snapshot](#bucket-snapshot-second-result-set).
4. Update the [Coverage one-liner](#coverage-one-liner) using pasted percentages (no invented numbers).
5. Update **Environment**, **Timestamp**, and command text if anything differed.

---

## Snapshot completion status (RPA Gate 2 — SQL half)

| Status | Meaning |
|--------|--------|
| **INCOMPLETE** | Summary / bucket tables still `[PASTE]` — **Gate 2** SQL snapshot not satisfied for live-environment sign-off. |
| **COMPLETE** | Real `psql` output pasted; coverage one-liner updated. |

**Current:** **COMPLETE** — staging summary + bucket rows below. Runtime `mappingconfidence` guard remains as documented in [Manual checks](#manual-checks-dry-run-guard-existing-code). Tracked in [`RPA_SUBSYSTEM_DONE.md`](./RPA_SUBSYSTEM_DONE.md) gap **G2** (see DONE doc for `% done`).

---

## Latest audit snapshot

**Banner:** **staging (Supabase session pooler)** · MLCC catalog / bottle linkage audit · **2026-04-11T05:40:00Z**

### Summary snapshot (first result set)

| `total_mlcc_items` | `total_bottles` | `bottles_with_mlcc_item_id` | `bottles_code_only_no_fk` | `bottles_with_valid_join` | `bottles_code_not_in_catalog` | `pct_bottles_with_mlcc_item_id` | `pct_bottles_valid_join_to_mlcc_items` |
|--------------------|-----------------|-----------------------------|----------------------------|----------------------------|-------------------------------|----------------------------------|----------------------------------------|
| 12828 | 23 | 1 | 22 | 1 | 0 | 4.35 | 4.35 |

### Bucket snapshot (second result set)

| `bucket` | `cnt` |
|----------|-------|
| bottle_code_only_no_fk | 22 |
| bottle_linked_mlcc_item_id | 1 |
| bottle_no_code_and_no_fk | 0 |
| mlcc_items_catalog_rows | 12828 |

### Coverage one-liner

In **staging (Supabase session pooler)**, **4.35%** of bottles had a valid join to `mlcc_items`, with **0** bottles showing a code not present in the catalog (**2026-04-11T05:40:00Z** UTC).

---

## Relating SQL results to runtime `mappingconfidence`

- **Higher** `pct_bottles_with_mlcc_item_id` / `pct_bottles_valid_join_to_mlcc_items` supports healthier catalog-backed operations; they do **not** set `mappingconfidence` on payloads.
- **`unknown` / `inferred` / `confirmed`** are enforced on the dry-run worker input via `evaluateDryRunMappingConfidenceGuard`, not via Postgres triggers.

---

## Manual checks: dry-run guard (existing code)

1. From repo root: `npm run safety:lk:rpa-local` (or your usual SAFE MODE test stack) when you have touched anything outside docs.
2. **Unknown / inferred / confirmed** payload behavior: see prior section in this file and worker tests.

Unit coverage: `services/api/tests/quantity-rules.unit.test.js`, `services/api/tests/mlcc-browser-worker.unit.test.js`.

---

## Changelog

| Date | Notes |
|------|--------|
| 2026-04-10 | Initial SQL + doc; documented existing dry-run guard. |
| 2026-04-10 | Docs-only refresh scaffold: audit metadata, dual snapshot tables, coverage one-liner placeholder. |
| 2026-04-10 | SPEC-RPA-FINALIZATION: Gate 2 **snapshot completion status** block (live paste still required). |
| 2026-04-11 | **Staging live snapshot pasted** (summary + buckets); Gate 2 SQL half **COMPLETE**; metadata + `psql` command aligned with RLS audit run. |
