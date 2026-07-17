-- submitted_unconfirmed status (Order Day 2026-07-16 postmortem, fix P0-1).
--
-- WHY: Stage 5 clicked MILO's real submit, MLCC emailed a confirmation —
-- and the run still finalized status='failed' ("Stage 5 exceeded timeout
-- budget of 240000ms") because the receipt scrape outlived the stage
-- budget. The client told the operator "Order didn't go through" on a
-- PLACED $5,338 order, and the evidence carried a FALSE no-submit
-- attestation. Internal run state must never present "failed" for a run
-- whose submit click was dispatched but whose confirmation was not
-- observed. New terminal status: 'submitted_unconfirmed'.
--
-- Semantics:
--   * Terminal. Never re-queued, never auto-retried (a retry could place
--     a SECOND real order).
--   * Means exactly: "the Checkout click was dispatched in submit mode,
--     and no terminal confirmation OR rejection signal was captured
--     before the run ended." External truth (MLCC email / MILO Orders
--     page) outranks it; the orders-history backstop upgrades runs out
--     of this state when it can.

-- execution_runs: widen the CHECK constraint.
ALTER TABLE public.execution_runs
  DROP CONSTRAINT IF EXISTS execution_runs_status_check;
ALTER TABLE public.execution_runs
  ADD CONSTRAINT execution_runs_status_check CHECK (
    status = ANY (
      ARRAY[
        'queued'::text,
        'running'::text,
        'succeeded'::text,
        'failed'::text,
        'canceled'::text,
        'submitted_unconfirmed'::text
      ]
    )
  );

-- execution_run_attempts: same widening (attempt rows mirror run terminals).
ALTER TABLE public.execution_run_attempts
  DROP CONSTRAINT IF EXISTS execution_run_attempts_status_check;
ALTER TABLE public.execution_run_attempts
  ADD CONSTRAINT execution_run_attempts_status_check CHECK (
    status IN ('running', 'succeeded', 'failed', 'canceled', 'submitted_unconfirmed')
  );
