# Row Level Security (RLS) audit — `public` schema

Read-only audit package for Liquor Kings Postgres (Supabase). This file **does not** execute SQL for you; it records audit results. **RLS policy changes** are applied only via versioned Supabase migrations (see [Policy migration notes](#policy-migration-notes-stores--store_users--bottles)).

**SQL posture:** `sql/rls_audit_query.sql` is **SELECT-only** (single `SELECT` over catalogs / `pg_policies`; no DDL or DML).

---

## Audit metadata

*(Update every refresh.)*

| Field | Value |
|--------|--------|
| **Environment** | **staging** (Supabase session pooler) |
| **Timestamp (UTC)** | **2026-04-11T05:40:00Z** |
| **Connection** | `psql` to Supabase **pooler** host `aws-0-us-west-2.pooler.supabase.com`, port **5432**, database **postgres** — use the **Database password** from the project dashboard (never commit secrets). |

**Exact command used (terminal):**

```bash
psql -h aws-0-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.vgilembychlcldhzqqeq -d postgres \
  -f sql/rls_audit_query.sql
```

**Optional CSV export (same run, for copy/paste):**

```bash
psql -h aws-0-us-west-2.pooler.supabase.com -p 5432 \
  -U postgres.vgilembychlcldhzqqeq -d postgres \
  -f sql/rls_audit_query.sql --csv > rls_audit_snapshot.csv
```

For prod-read-only, substitute your approved connection variable and credentials.

---

## Policy migration notes (stores / store_users / bottles)

- **File:** `supabase/migrations/20260410180000_enable_rls_stores_store_users_bottles.sql`
- **Intent:** Move RED audit tables **`stores`**, **`store_users`**, and **`bottles`** to **GREEN** (`rls_enabled` + ≥1 policy) using the same **`public.store_users` membership + `auth.uid()`** pattern as `carts` / `inventory` / `execution_*` policies in `20260328092000_store_scoped_auth_rls.sql`.
- **`store_users` SELECT:** `user_id = auth.uid()` **or** same-store membership (avoids a pure self-`EXISTS` that can fail for the viewer’s own row).
- **`public.mlcc_items`:** **not** altered by that migration (global catalog; no per-store row key — design TBD if RLS is ever required).
- **Contract tests (no live DB):** `services/api/tests/unit/rls/red-tables-store-isolation.test.js` asserts the migration file contents.
- **After apply:** re-run `sql/rls_audit_query.sql` and paste rows into [Latest audit snapshot](#latest-audit-snapshot); expect **GREEN** for `stores`, `store_users`, `bottles` when policies are present.

---

## Source of truth

1. Run the command above against the named environment.
2. Treat the query result as authoritative for `schema_name`, `table_name`, `rls_enabled`, `rls_forced`, `policy_count`, `policy_summary`, and `risk_band`.
3. Replace the [Latest audit snapshot](#latest-audit-snapshot) table so it **exactly** matches the latest `psql` output (same columns, same row order as returned unless you intentionally sort).

---

## Assumptions

- Schema audited: **`public`** only.
- Objects included: **ordinary tables** (`pg_class.relkind = 'r'`). Partitions, views, and foreign tables are not listed.
- **Grants** (`GRANT … TO anon` / `authenticated`) are not inspected here; pair this audit with a grants review for Supabase exposure.
- `risk_band` in the query uses the same conservative rules as this doc ([Classification](#classification)).

---

## Classification (text labels only)

| Label | Rule |
|--------|------|
| **RED** | Row Level Security is **disabled** (`rls_enabled = false`) on the table. Treat as highest priority for follow-up when the table may be reached by `anon` or `authenticated` (confirm grants). |
| **ORANGE** | RLS is **enabled** but **`policy_count = 0`** in `pg_policies` (no policy rows). Unusual for app tables; often means only superuser / `service_role` access until policies exist — verify intent. |
| **GREEN** | RLS is **enabled** and **at least one** policy exists (`policy_count ≥ 1`). Still review policy bodies for over-broad `USING (true)` etc.; this label is **not** a guarantee of least privilege. |

After pasting results, **re-check** that each row’s `risk_band` matches these rules (the SQL computes `risk_band`; if you hand-edit, keep rules consistent).

---

## How to refresh (Gate 1 / Gate 2)

1. Run the **Exact command** in [Audit metadata](#audit-metadata).
2. Copy **all data rows** from the terminal (skip header lines if you prefer, but keep column alignment) **or** open the CSV and copy the body rows.
3. Paste into the [Latest audit snapshot](#latest-audit-snapshot) table: **one markdown row per query row**, same columns as below.
4. Update **Environment**, **Timestamp**, and the **command block** if anything differed from the last run.

---

## Snapshot completion status (RPA Gate 1)

| Status | Meaning |
|--------|--------|
| **INCOMPLETE** | Snapshot tables below still contain `[PASTE]` — **Gate 1 is not satisfied** for live-environment sign-off. |
| **COMPLETE** | Real `psql` rows pasted; Environment + UTC timestamp updated. |

**Current:** **COMPLETE** — staging snapshot below (**56** data rows). Tracked in [`RPA_SUBSYSTEM_DONE.md`](./RPA_SUBSYSTEM_DONE.md) gap **G1** (see DONE doc for `% done`).

---

## Latest audit snapshot

**Banner:** **staging (Supabase session pooler)** · RLS audit · **2026-04-11T05:40:00Z**

Column order matches `sql/rls_audit_query.sql` output:

| `schema_name` | `table_name` | `rls_enabled` | `rls_forced` | `policy_count` | `policy_summary` | `risk_band` |
|---|---|:-:|:-:|:-:|---|---|
| `public` | `activity_logs` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `ai_anomalies` | t | f | 2 | ai_anomalies_select [SELECT], ai_anomalies_update [UPDATE] | GREEN |
| `public` | `ai_chat_sessions` | t | f | 4 | ai_chat_sessions_delete [DELETE], ai_chat_sessions_insert [INSERT], ai_chat_sessions_select [SELECT], ai_chat_sessions_update [UPDATE] | GREEN |
| `public` | `ai_messages` | t | f | 2 | ai_messages_insert [INSERT], ai_messages_select [SELECT] | GREEN |
| `public` | `ai_predictions` | t | f | 1 | ai_predictions_select [SELECT] | GREEN |
| `public` | `ai_recommendations` | t | f | 2 | ai_recommendations_select [SELECT], ai_recommendations_update [UPDATE] | GREEN |
| `public` | `ai_usage_logs` | t | f | 2 | ai_usage_logs_insert [INSERT], ai_usage_logs_select [SELECT] | GREEN |
| `public` | `app_settings` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `bottle_aliases` | t | f | 1 | bottle_aliases_read [SELECT] | GREEN |
| `public` | `bottles` | t | f | 1 | bottles_select_all_authenticated [SELECT] | GREEN |
| `public` | `cart_items` | t | f | 8 | cart_items_delete_authenticated [DELETE], cart_items_delete_by_store_membership [DELETE], cart_items_insert_authenticated [INSERT], cart_items_insert_by_store_membership [INSERT], cart_items_select_authenticated [SELECT], cart_items_select_by_store_membership [SELECT], cart_items_update_authenticated [UPDATE], cart_items_update_by_store_membership [UPDATE] | GREEN |
| `public` | `carts` | t | f | 7 | carts_delete_by_store_membership [DELETE], carts_insert_authenticated [INSERT], carts_insert_by_store_membership [INSERT], carts_select_authenticated [SELECT], carts_select_by_store_membership [SELECT], carts_update_authenticated [UPDATE], carts_update_by_store_membership [UPDATE] | GREEN |
| `public` | `device_sessions` | t | f | 3 | device_sessions_insert [INSERT], device_sessions_select [SELECT], device_sessions_update [UPDATE] | GREEN |
| `public` | `error_logs` | t | f | 2 | error_logs_insert [INSERT], error_logs_select [SELECT] | GREEN |
| `public` | `execution_run_attempts` | t | f | 3 | execution_run_attempts_insert_by_store_membership [INSERT], execution_run_attempts_select_by_store_membership [SELECT], execution_run_attempts_update_by_store_membership [UPDATE] | GREEN |
| `public` | `execution_run_operator_actions` | t | f | 2 | execution_run_operator_actions_insert_by_store_membership [INSERT], execution_run_operator_actions_select_by_store_membership [SELECT] | GREEN |
| `public` | `execution_runs` | t | f | 3 | execution_runs_insert_by_store_membership [INSERT], execution_runs_select_by_store_membership [SELECT], execution_runs_update_by_store_membership [UPDATE] | GREEN |
| `public` | `inventory` | t | f | 4 | inventory_delete_by_store_membership [DELETE], inventory_insert_by_store_membership [INSERT], inventory_select_by_store_membership [SELECT], inventory_update_by_store_membership [UPDATE] | GREEN |
| `public` | `lk_chat_messages` | t | f | 1 | lk_chat_messages_rw [ALL] | GREEN |
| `public` | `lk_chat_threads` | t | f | 1 | lk_chat_threads_rw [ALL] | GREEN |
| `public` | `lk_order_events` | t | f | 1 | lk_no_client_events [ALL] | GREEN |
| `public` | `lk_order_intents` | t | f | 1 | lk_no_client_intents [ALL] | GREEN |
| `public` | `lk_order_proofs` | t | f | 1 | lk_no_client_proofs [ALL] | GREEN |
| `public` | `lk_order_runs` | t | f | 1 | lk_no_client_runs [ALL] | GREEN |
| `public` | `lk_seed_mlcc_codes` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `lk_system_diagnostics` | t | f | 1 | no_client_access [ALL] | GREEN |
| `public` | `login_events` | t | f | 2 | login_events_insert [INSERT], login_events_select [SELECT] | GREEN |
| `public` | `mlcc_change_rows` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `mlcc_code_map` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `mlcc_item_codes` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `mlcc_items` | t | f | 1 | mlcc_items_select_all_authenticated [SELECT] | GREEN |
| `public` | `mlcc_price_snapshots` | t | f | 1 | mlcc_price_snapshots_select_all_authenticated [SELECT] | GREEN |
| `public` | `mlcc_pricebook_rows` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `mlcc_pricebook_snapshots` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `mlcc_qty_rules` | t | f | 1 | mlcc_qty_rules_read [SELECT] | GREEN |
| `public` | `notification_preferences` | t | f | 3 | notification_preferences_insert [INSERT], notification_preferences_select [SELECT], notification_preferences_update [UPDATE] | GREEN |
| `public` | `notifications` | t | f | 3 | notifications_insert [INSERT], notifications_select [SELECT], notifications_update [UPDATE] | GREEN |
| `public` | `order_items` | t | f | 3 | order_items_insert_by_store_membership [INSERT], order_items_select_by_store_membership [SELECT], order_items_update_by_store_membership [UPDATE] | GREEN |
| `public` | `order_templates` | t | f | 4 | order_templates_delete [DELETE], order_templates_insert [INSERT], order_templates_select [SELECT], order_templates_update [UPDATE] | GREEN |
| `public` | `orders` | t | f | 3 | orders_insert_by_store_membership [INSERT], orders_select_by_store_membership [SELECT], orders_update_by_store_membership [UPDATE] | GREEN |
| `public` | `price_alerts` | t | f | 1 | price_alerts_select_all_authenticated [SELECT] | GREEN |
| `public` | `push_subscriptions` | t | f | 3 | push_subscriptions_insert [INSERT], push_subscriptions_select [SELECT], push_subscriptions_update [UPDATE] | GREEN |
| `public` | `rpa_events` | t | f | 2 | rpa_events_no_write [ALL], rpa_events_select_auth [SELECT] | GREEN |
| `public` | `rpa_job_events` | t | f | 1 | owners_managers_can_view_events_for_their_jobs [SELECT] | GREEN |
| `public` | `rpa_job_items` | t | f | 1 | deny_all_items [ALL] | GREEN |
| `public` | `rpa_jobs` | t | f | 2 | deny_all_jobs [ALL], owners_managers_can_view_rpa_jobs_for_their_store [SELECT] | GREEN |
| `public` | `rpa_runs` | t | f | 2 | rpa_runs_no_write [ALL], rpa_runs_select_auth [SELECT] | GREEN |
| `public` | `scan_logs` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `scheduled_jobs` | f | f | 0 | (no policies in pg_policies) | RED |
| `public` | `store_bottle_notes` | t | f | 1 | store_bottle_notes_rw [ALL] | GREEN |
| `public` | `store_mlcc_credentials` | t | f | 3 | deny_all_modify [ALL], deny_all_select [SELECT], owners_managers_can_view_mlcc_credentials [SELECT] | GREEN |
| `public` | `store_security` | t | f | 3 | store_security_insert [INSERT], store_security_select [SELECT], store_security_update [UPDATE] | GREEN |
| `public` | `store_users` | t | f | 2 | insert_own_membership [INSERT], select_own_membership [SELECT] | GREEN |
| `public` | `stores` | t | f | 1 | stores_select_by_membership [SELECT] | GREEN |
| `public` | `submission_intents` | t | f | 2 | submission_intents_insert [INSERT], submission_intents_select [SELECT] | GREEN |
| `public` | `users` | t | f | 2 | select_own_profile [SELECT], update_own_profile [UPDATE] | GREEN |
*56 rows from `psql` output (header row excluded). Several tables remain **RED** (RLS disabled); review grants and migration backlog — this snapshot does not change policy.*

---

## SQL file

See [`sql/rls_audit_query.sql`](../sql/rls_audit_query.sql) for the full **SELECT-only** statement (includes `risk_band`).

---

## Appendix — non-authoritative repo baseline *(optional reference only)*

The following rows were inferred from **older repository migrations only** (not from a live DB) and are **not** a substitute for a real snapshot.

| `table_name` | Expected `risk_band` (historical guess before `20260410180000_*`) |
|--------------|-----------------------------------------------|
| `bottles`, `mlcc_items`, `stores`, `store_users` | Were **RED** in baseline audits (no RLS in foundational migrations). **After** `20260410180000_enable_rls_stores_store_users_bottles.sql`, expect **GREEN** for `stores` / `store_users` / `bottles` once applied; **`mlcc_items`** may still be **RED** until a separate catalog policy ships. |
| `carts`, `cart_items`, `inventory`, `execution_runs`, `execution_run_attempts`, `execution_run_operator_actions` | **GREEN** if policies + RLS applied as in `20260328092000_*` |

---

## Changelog

| Date | Notes |
|------|--------|
| 2026-04-10 | Initial RLS audit doc + SQL; docs-only refresh scaffold (audit metadata, snapshot placeholders, appendix). |
| 2026-04-10 | RLS enablement migration for `stores` / `store_users` / `bottles` + contract tests; appendix + policy notes updated. |
| 2026-04-10 | SPEC-RPA-FINALIZATION: Gate 1 **snapshot completion status** block (live paste still required). |
| 2026-04-11 | **Staging live snapshot pasted** (56 rows); Gate 1 snapshot **COMPLETE**; metadata + `psql` command recorded. |

## Open Gaps

### mlcc_items — NO RLS POLICIES (RED)
- Table exists: `public.mlcc_items`
- `ENABLE ROW LEVEL SECURITY`: NOT present in any migration
- `CREATE POLICY`: NOT present for this table in any migration
- Risk: Any authenticated user can read all MLCC product data. Service role writes are unrestricted from API layer.
- Mitigation required: Add migration with ENABLE ROW LEVEL SECURITY + read policy for authenticated users + write restricted to service role only.
- Status: OPEN — mitigation task created, pending implementation brief from Claude.

### order_submitted — CONSTRAINT MISSING (RED)
- Referenced in master context as Layer 3 of SAFE MODE enforcement.
- Was never implemented in any migration.
- Mitigation: Migration 20260415130000 adds the column with CHECK (order_submitted = false) constraint.
- Status: CLOSED by migration 20260415130000_add_order_submitted_constraint.sql.
