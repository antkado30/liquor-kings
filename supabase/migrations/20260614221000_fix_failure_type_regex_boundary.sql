-- P0 (2026-06-14, Sweep 1 of full reliability sweep): same constraint-drift
-- bug class as 20260614220000 (LK_RUN_REAPED), but on the PRIMARY failure
-- path, not just the reaper.
--
-- classifyFailureType() in execution-failure.service.js implements an
-- explicit "boundary contract" (added 2026-06-12, doctrine #1): any
-- well-formed SCREAMING_SNAKE error code thrown by an RPA stage
-- (stageNError?.code) crosses the boundary VERBATIM as failure_type,
-- via the regex /^[A-Z][A-Z0-9_]{3,64}$/. This was done on purpose so
-- typed codes like MILO_LOGIN_INVALID_CREDENTIALS survive into the UI
-- instead of flattening to UNKNOWN.
--
-- But execution_runs_failure_type_check (2026-03-30) and
-- execution_run_attempts_failure_type_check (2026-03-31) still only allow
-- the original 6-7 legacy enum values. Every one of the following real,
-- currently-thrown codes fails BOTH constraints on write:
--   LK_DECRYPT_FAILED, LK_NO_CREDENTIALS, LK_INVALID_RPA_ITEMS,
--   LK_MISSING_LICENSE_NUMBER, MLCC_POSSIBLE_DUPLICATE_SUBMIT,
--   MLCC_CART_MISMATCH_BEFORE_SUBMIT, MILO_STAGE4_BELOW_9L_MINIMUM,
--   MILO_STAGE4_INVALID_SPLIT_QUANTITIES, MILO_STAGE5_INVALID_SESSION,
--   MILO_STAGE5_CHECKOUT_BUTTON_DISABLED, MILO_STAGE5_CHECKOUT_BUTTON_NOT_FOUND,
--   MILO_STAGE5_CHECKOUT_BUTTON_AMBIGUOUS, MILO_STAGE5_SAFETY_GATE_VIOLATION,
--   MILO_STAGE5_TIMEOUT, and any future MILO_LOGIN_*/MILO_STAGE*_* code.
--
-- Effect when this happens: applyExecutionRunPatch's update to
-- execution_runs throws a CHECK violation that is NOT a missing-column
-- error, so updateExecutionRunStatus returns serverError() and the run
-- NEVER transitions to "failed". It sits at status="running" with a stale
-- heartbeat until reapStaleExecutionRuns kills it ~15 minutes later as
-- LK_RUN_REAPED — losing the real, actionable failure_type/details in the
-- process, AND starving the store's entire execution queue for up to 15
-- minutes (busyStores), for ANY of the typed failures above. This is the
-- exact same "stuck running row blocks the queue" symptom as the
-- LK_RUN_REAPED incident, just triggered by normal RPA failures instead of
-- worker crashes.
--
-- Fix: replace the closed enum with a regex CHECK that matches
-- classifyFailureType's own accepted pattern exactly. All legacy enum
-- values (CODE_MISMATCH, OUT_OF_STOCK, ..., LK_RUN_REAPED) already match
-- this pattern, so this is purely additive — aligns the DB with the
-- application's documented boundary contract instead of re-enumerating an
-- open-ended, ever-growing list of typed codes by hand (which is exactly
-- how we got here twice).

ALTER TABLE public.execution_runs
  DROP CONSTRAINT IF EXISTS execution_runs_failure_type_check;

ALTER TABLE public.execution_runs
  ADD CONSTRAINT execution_runs_failure_type_check
  CHECK (failure_type IS NULL OR failure_type ~ '^[A-Z][A-Z0-9_]{3,64}$');

ALTER TABLE public.execution_run_attempts
  DROP CONSTRAINT IF EXISTS execution_run_attempts_failure_type_check;

ALTER TABLE public.execution_run_attempts
  ADD CONSTRAINT execution_run_attempts_failure_type_check
  CHECK (failure_type IS NULL OR failure_type ~ '^[A-Z][A-Z0-9_]{3,64}$');
