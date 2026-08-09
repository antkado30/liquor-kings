-- M4 billing scaffold (2026-08-08). Stripe subscription state per store.
-- Pricing locked 8/8: $149/store/month flat, 14-day free trial, no card
-- until the trial ends. These columns hold the Stripe linkage + the
-- coarse billing state the money-path guard reads.
--
-- SAFETY LAW (mirrored in services/api/src/lib/billing.js):
--   * Stores with trial_ends_at NULL are GRANDFATHERED (Colony/pilot
--     era) — never billing-gated.
--   * Enforcement is fail-open until Stripe env keys exist on Fly.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'trial';

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_billing_status_check;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_billing_status_check
  CHECK (billing_status IN ('trial', 'active', 'past_due', 'canceled'));

COMMENT ON COLUMN public.stores.stripe_customer_id IS
  'Stripe Customer id (cus_...). Set lazily on first checkout session.';
COMMENT ON COLUMN public.stores.stripe_subscription_id IS
  'Stripe Subscription id (sub_...). Set by the checkout.session.completed webhook.';
COMMENT ON COLUMN public.stores.billing_status IS
  'Coarse billing state: trial (default; trial_ends_at NULL = grandfathered pilot-era store, never gated) / active / past_due (grace — not gated) / canceled (gated). Written ONLY by the Stripe webhook handler.';

-- Webhook lookups arrive keyed by subscription id.
CREATE INDEX IF NOT EXISTS idx_stores_stripe_subscription_id
  ON public.stores (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
