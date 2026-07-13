-- mlcc_price_book_runs.kind — distinguish FULL price-book ingests from
-- between-book NEW ITEM Price List ingests (2026-07-12, Option A decision:
-- MLCC publishes new SKUs in "New Item Price Lists" between full books;
-- the ingestor deliberately skipped them, so a June release stayed
-- invisible to scan/search/AI until the next full book — a month+ hole in
-- the "instant-scan coverage day one" promise).
--
-- Why a column and not a new table: the run history IS the audit trail —
-- one table, one timeline, one place to look. But two readers must never
-- confuse the kinds:
--   1. the scheduler's change-detection compares the live FULL-book URL
--      against the latest COMPLETE run's source_url;
--   2. the home staleness card reads the latest complete run's
--      completed_at as "how fresh is the catalog".
-- A 40-row new-item ingest is neither of those things. Both readers (and
-- getLatestPriceBookRun) now filter kind='full'.
--
-- Deploy-order safe: additive with a default — existing rows and the
-- currently deployed code both mean kind='full'. RUN THIS BEFORE deploying
-- the code that writes 'new_item_list'.
alter table public.mlcc_price_book_runs
  add column if not exists kind text not null default 'full';

comment on column public.mlcc_price_book_runs.kind is
  'full = complete MLCC price book ingest; new_item_list = between-book New Item Price List ingest (additive only, never deactivates)';

-- Keeps the "latest full complete run" lookups index-friendly.
create index if not exists mlcc_price_book_runs_kind_status_completed_idx
  on public.mlcc_price_book_runs (kind, status, completed_at desc);
