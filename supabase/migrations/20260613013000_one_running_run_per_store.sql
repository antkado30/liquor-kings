-- AUDIT #21 (P0, 2026-06-12 night): one running execution run per store —
-- enforced at the database level.
--
-- The claim is an atomic compare-and-swap PER RUN, so two workers can never
-- claim the SAME run — but nothing stopped two workers from claiming two
-- DIFFERENT queued runs for the SAME store. MILO carts are account-scoped:
-- two concurrent runs on one store means two browsers fighting over one
-- cart (Stage-3 auto-clear wiping the other run's items, crossed validates,
-- and in the worst case interleaved submits). Harmless with one worker
-- machine; live risk the moment the worker app scaled to two.
--
-- The worker-side claim also prefilters busy stores, but only this index
-- makes the guarantee race-proof: the second worker's UPDATE → unique
-- violation (23505) → treated as "claim lost", moves to the next candidate.
--
-- NOTE: if this CREATE fails with a duplicate-key error, two runs for one
-- store are running RIGHT NOW (or are stale-running awaiting the reaper).
-- Wait for the reaper (≤15 min) or resolve them in the Command Deck, then
-- re-run this migration.

create unique index if not exists one_running_run_per_store
  on public.execution_runs (store_id)
  where status = 'running';
