-- Scheduled order templates (task #75, 2026-06-04 evening).
--
-- Extends order_templates with a day-of-week + time-of-day schedule
-- so the daily cron can mark templates "ready to review" on their
-- scheduled day. Dad's scanner home shows a banner when something's
-- ready; he taps it to load the template into his cart and proceeds
-- through the usual validate/submit flow.
--
-- We do NOT auto-submit. The order pipeline is triple-gated by design
-- (per-store arming + env flag + run metadata) and we keep that
-- discipline. The "magic" is in pre-preparation — the cart is ready
-- when dad walks in, he just confirms.
--
-- The two timestamps track the cron + the user separately so we can
-- show "ready to review" badges without losing data on a missed week.

ALTER TABLE public.order_templates
  ADD COLUMN IF NOT EXISTS schedule_dow smallint
    CHECK (schedule_dow IS NULL OR (schedule_dow >= 0 AND schedule_dow <= 6));

ALTER TABLE public.order_templates
  ADD COLUMN IF NOT EXISTS schedule_time_local time;

-- Last time the daily cron marked this template "ready for the user."
-- NULL means it was never scheduled, or it just hasn't fired today yet.
ALTER TABLE public.order_templates
  ADD COLUMN IF NOT EXISTS last_scheduled_run_at timestamptz;

-- Last time the user consumed the scheduled load — i.e. tapped the
-- "load my Thursday order" banner. If this is older than
-- last_scheduled_run_at, the template has an unconsumed scheduled run
-- (banner shows). If newer, the user already handled it.
ALTER TABLE public.order_templates
  ADD COLUMN IF NOT EXISTS last_scheduled_load_consumed_at timestamptz;

-- Index for the cron query: find templates scheduled for a given dow
-- that haven't fired today yet.
CREATE INDEX IF NOT EXISTS idx_order_templates_schedule
  ON public.order_templates (schedule_dow, is_archived)
  WHERE schedule_dow IS NOT NULL AND is_archived = false;

COMMENT ON COLUMN public.order_templates.schedule_dow IS
  'Day of week (0=Sunday, 6=Saturday) the template should auto-prepare for review. NULL means template is loaded manually only.';
COMMENT ON COLUMN public.order_templates.schedule_time_local IS
  'Time of day (local Eastern) the template should be marked ready. Default if NULL: 06:00. Used as a sort hint; the cron itself fires once per day.';
COMMENT ON COLUMN public.order_templates.last_scheduled_run_at IS
  'Last time the daily cron marked this template as ready for the user. Banner is shown when this is newer than last_scheduled_load_consumed_at.';
COMMENT ON COLUMN public.order_templates.last_scheduled_load_consumed_at IS
  'Last time the user tapped the "ready to review" banner and loaded the template into their cart. Banner is hidden when this is >= last_scheduled_run_at.';
