-- Make execution_runs.cart_id nullable (task #57, 2026-06-04).
--
-- Reason: the new "cart_reset_only" run type does not operate on a cart
-- at all — it just logs in to MILO and clicks Clear Cart. There's no
-- meaningful cart_id to associate with such a run. Rather than synthesize
-- a stub cart row each reset, we allow cart_id to be NULL when the run's
-- metadata.run_type is "cart_reset_only".
--
-- Existing rpa_run / validate_only runs still set cart_id (the worker
-- still requires it for those modes). The application enforces the
-- invariant that cart_id IS NULL <=> metadata.run_type = 'cart_reset_only'.

ALTER TABLE public.execution_runs
  ALTER COLUMN cart_id DROP NOT NULL;

COMMENT ON COLUMN public.execution_runs.cart_id IS
  'Cart this run operates against. NULL when metadata.run_type = ''cart_reset_only'' (the run resets MILO cart with no local cart payload).';
