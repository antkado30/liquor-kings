-- Backfill mlcc_credentials_last_verified_at for stores that already
-- have proof their creds work (task #88, 2026-06-06).
--
-- Rationale: when we start stamping last_verified_at on every
-- successful execution_run, brand-new signups will get it set during
-- onboarding activation. But existing stores (dad's, my own, any
-- backfilled at provisioning time) need the field initialized OR
-- they'll see a misleading "verify your MLCC connection" banner on
-- the scanner home tomorrow morning when they shouldn't.
--
-- "Proof creds work" = at least one successful execution_run exists
-- for the store. Stamp last_verified_at to the most recent successful
-- run's finished_at. If no successful runs exist (truly brand new
-- with no activity), leave the field NULL — the banner is correct in
-- that case.

UPDATE public.stores s
SET mlcc_credentials_last_verified_at = (
  SELECT MAX(er.finished_at)
  FROM public.execution_runs er
  WHERE er.store_id = s.id
    AND er.status = 'succeeded'
)
WHERE s.mlcc_credentials_last_verified_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.execution_runs er
    WHERE er.store_id = s.id
      AND er.status = 'succeeded'
  );

COMMENT ON COLUMN public.stores.mlcc_credentials_last_verified_at IS
  'Timestamp of the most recent successful execution_run for this store. Stamped automatically by the run finalizer (services/api/src/services/execution-run.service.js). Used by the scanner home banner to decide whether to nudge the user to verify their MLCC connection. NULL = never verified.';
