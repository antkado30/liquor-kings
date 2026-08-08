-- The missing bolt from first-order night (2026-08-05).
--
-- persistMiloOrderConfirmations upserts with
--   onConflict: "execution_run_id,ada_number"
-- and its comment references a unique index that NO migration ever
-- created. Result: every worker-side confirmation save since that code
-- shipped failed with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" — logged, fail-soft, invisible
-- until the FIRST REAL ORDER (run 65c541d0, 2026-08-05) never appeared
-- in the app's Orders page while MILO happily held the truth.
--
-- Full (non-partial) unique index on purpose: supabase-js upsert cannot
-- express a partial-index conflict target. Both columns are nullable by
-- design (backfilled history rows have no run id); Postgres treats NULLs
-- as distinct in unique indexes, so backfill rows are unaffected while
-- worker rows (both columns present) dedupe exactly as the code intends.
--
-- Safe on live data: July's two rows are distinct on (run, ada); tonight's
-- rows never inserted. `if not exists` keeps it idempotent.

create unique index if not exists milo_order_confirmations_run_ada_key
  on public.milo_order_confirmations (execution_run_id, ada_number);

comment on index public.milo_order_confirmations_run_ada_key is
  'Conflict target for the worker confirmation upsert (onConflict execution_run_id,ada_number). Added 2026-08-06 after first-order night exposed that the code referenced an index that was never migrated.';
