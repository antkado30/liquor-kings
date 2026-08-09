-- SIGNUP MACHINE M1 (2026-08-08, blueprint: docs/lk/SIGNUP-MACHINE.md)
--
-- Locked decisions this serves: 14-day free trial, no card until the
-- trial ends, sub-user-first MILO connect as a wizard step AFTER
-- account creation (so creds become optional at signup and the store
-- row tracks where the owner is in onboarding).

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_state text;

COMMENT ON COLUMN public.stores.trial_ends_at IS
  'End of the 14-day free trial (two Wednesday orders of proof). Stamped at self-serve signup; NULL for founder-era stores (Colony) which never expire. Billing (M4) reads this.';
COMMENT ON COLUMN public.stores.onboarding_state IS
  'Self-serve wizard progress: store_created -> milo_connected -> live. NULL for founder-era stores. The scanner uses this to route a returning owner back to the step they left.';
