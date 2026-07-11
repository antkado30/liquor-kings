-- Run-dedupe atomic backstop (2026-07-11).
--
-- WHY: two triggers with identical cart lines for the same store are the
-- SAME check. Order day 7/9 showed the background pre-validate and the
-- foreground "Check Order" tap racing into duplicate validate_only runs
-- (4 in 66 seconds) → duplicate MILO work + double push banners. The
-- old one-active-per-cart index can't catch this because every trigger
-- flips its cart active→submitted, so each duplicate rides a fresh
-- cart_id.
--
-- The API now stamps payload_snapshot.metadata.cart_lines_hash (a
-- canonical, versioned "v1:code:qty|..." content hash) at run creation
-- and read-checks for an identical in-flight validate_only before
-- inserting. This index is the ATOMIC layer under that read-check: two
-- truly simultaneous inserts can both pass the read, but only one can
-- win here; the loser's insert raises 23505 and the API returns the
-- winner (execution-run.service.js handles the violation by name).
--
-- SAFETY / DEPLOY ORDER (additive + partial — safe in either order):
--   * Index without new code: nothing writes cart_lines_hash → the
--     partial predicate matches no rows → zero effect.
--   * New code without index: the read-check dedupe still works; only
--     the milliseconds-wide simultaneous-insert window stays open.
--   * Historic rows have no cart_lines_hash key → excluded by the
--     IS NOT NULL predicate → the index cannot conflict with them.
--   * Scoped to validate_only ONLY. rpa_run / submit runs are never
--     constrained — a submit is a deliberate act every time and keeps
--     its own worker-side armor (one-running-run lock, duplicate-submit
--     tripwire).

CREATE UNIQUE INDEX IF NOT EXISTS execution_runs_validate_dedupe_idx
  ON public.execution_runs (
    store_id,
    ((payload_snapshot -> 'metadata' ->> 'cart_lines_hash'))
  )
  WHERE status IN ('queued', 'running')
    AND (payload_snapshot -> 'metadata' ->> 'run_type') = 'validate_only'
    AND (payload_snapshot -> 'metadata' ->> 'cart_lines_hash') IS NOT NULL;
