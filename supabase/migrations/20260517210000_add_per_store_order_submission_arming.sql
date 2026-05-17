-- Per-store order-submission arming
--
-- Adds `allow_order_submission` to public.stores so Stage 5 (real MILO
-- order submission) is gated PER STORE in addition to the existing
-- global LK_ALLOW_ORDER_SUBMISSION env flag.
--
-- Before this migration, Stage 5 arming was global only:
--   LK_ALLOW_ORDER_SUBMISSION=yes  →  EVERY store's RPA run can submit
--
-- After this migration, Stage 5 arming requires BOTH:
--   1. LK_ALLOW_ORDER_SUBMISSION=yes  (process-level kill-switch)
--   2. stores.allow_order_submission=true  (this column, per row)
--
-- The default (false) preserves current safety posture. Existing rows
-- start with allow_order_submission=false. Operators must explicitly
-- flip a store row to true via Supabase Studio or an admin endpoint
-- BEFORE that store can place real orders.
--
-- This is defense-in-depth: even if LK_ALLOW_ORDER_SUBMISSION is
-- accidentally flipped to yes (e.g. dev sets it in fly.toml and
-- redeploys), no orders submit unless a specific store row was also
-- explicitly armed.
--
-- Audit metadata columns let us track WHEN and WHO armed a store, so
-- post-incident review can answer "why did this store submit?"

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS allow_order_submission boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_submission_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS order_submission_armed_by uuid;

COMMENT ON COLUMN public.stores.allow_order_submission IS
  'Per-store gate for Stage 5 real submission. Stage 5 runs in dry_run mode unless BOTH this column AND env LK_ALLOW_ORDER_SUBMISSION=yes are true. Default false. Flip via admin tool only.';

COMMENT ON COLUMN public.stores.order_submission_armed_at IS
  'When allow_order_submission was last set to true. NULL if never armed. Set by admin tool, not by app code.';

COMMENT ON COLUMN public.stores.order_submission_armed_by IS
  'Operator/admin user ID who last set allow_order_submission=true. NULL if never armed or system-armed.';
