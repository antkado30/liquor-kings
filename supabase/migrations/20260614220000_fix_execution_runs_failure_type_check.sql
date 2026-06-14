-- P0 (2026-06-14): the 2026-06-12 reaper audit started writing
-- failure_type='LK_RUN_REAPED' for orphaned/stale "running" execution_runs
-- (see reapStaleExecutionRuns in execution-run.service.js), but the
-- execution_runs_failure_type_check CHECK constraint (added 2026-03-30) was
-- never updated to allow that value.
--
-- Result: EVERY reap attempt on EVERY /claim-next call has been throwing
--   new row for relation "execution_runs" violates check constraint
--   "execution_runs_failure_type_check"
-- silently (best-effort, logged but non-fatal) — so a stale status="running"
-- row can NEVER be marked "failed". Because claimNextQueuedExecutionRun
-- treats any "running" row's store_id as busy and skips ALL queued runs for
-- that store, a single stuck "running" row permanently starves that store's
-- entire queue. This is what caused validate runs to sit at zero stage
-- progress forever (worker never even claims them) — confirmed via
-- liquor-kings (API app) logs spamming this exact reap-failure line every
-- ~10s.
--
-- Fix: widen the allowed failure_type values to include LK_RUN_REAPED so the
-- reaper's UPDATE succeeds and stale rows actually flip to "failed",
-- unblocking busyStores for their store.
ALTER TABLE public.execution_runs
  DROP CONSTRAINT IF EXISTS execution_runs_failure_type_check;

ALTER TABLE public.execution_runs
  ADD CONSTRAINT execution_runs_failure_type_check
  CHECK (
    failure_type IS NULL OR failure_type = ANY (
      ARRAY[
        'CODE_MISMATCH'::text,
        'OUT_OF_STOCK'::text,
        'QUANTITY_RULE_VIOLATION'::text,
        'MLCC_UI_CHANGE'::text,
        'NETWORK_ERROR'::text,
        'UNKNOWN'::text,
        'LK_RUN_REAPED'::text
      ]
    )
  );
