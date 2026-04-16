-- Migration: add order_submitted to execution_runs
-- Layer 3 of SAFE MODE enforcement.
-- This column must always be false. The CHECK constraint enforces this at the DB level.
-- No application code may set this to true. This is an architectural invariant.

ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS order_submitted BOOLEAN NOT NULL DEFAULT FALSE
  CONSTRAINT execution_runs_order_submitted_always_false CHECK (order_submitted = FALSE);

COMMENT ON COLUMN public.execution_runs.order_submitted IS
  'SAFE MODE Layer 3 invariant — always false. CHECK constraint enforces this at DB level. No code path may set this to true.';
