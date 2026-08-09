# SIGNUP MACHINE — blueprint (locked 2026-08-08)

The store-count lever. A Michigan store owner finds the site, signs
up, connects MILO, and scans their first bottle THE SAME DAY — no
human in the loop. Beats CoreVue's "few days" onboarding cold.

## LOCKED DECISIONS (Tony, tap-confirmed 8/8)

1. **Sub-user first.** The connect step walks the owner through
   creating an MLCC sub-user for LK inside MILO (MLCC allows 2 per
   license; owner-created, owner-revocable — the sanctioned path our
   MLCC letter describes). Direct main-login entry stays as the
   fallback for owners who get stuck. Either way creds are encrypted
   with the existing fortress (`store-mlcc-credentials` service) and
   live-verified before the store proceeds.
2. **No card until the trial ends.** Email + store info only at
   signup; 14-day trial (two Wednesdays); $149/mo starts after.
3. **PUBLIC from day one.** Signup is linked from the landing page
   the day it ships. (Quiet-launch was recommended; Tony chose bold.
   Consequence: the machine must be bulletproof + observable —
   Sentry on the signup funnel, loud failures, no silent dead ends.)
4. **Support:** in-app AI partner 24/7 + support email + Tony's
   number for the first ~10 stores.

## THE FLOW (owner's eyes)

1. Landing page → "Start free — first two order days on us."
2. Create account (email + password; Supabase auth — exists).
3. Store setup: store name, city, license number, timezone
   (America/Detroit default).
4. Connect MILO: choose path —
   a. "Create a helper login (recommended)" → walkthrough with real
      MILO screenshots → owner enters the sub-user creds they made;
   b. "Use my MILO login" → direct entry.
   Either → live verify against MILO (existing verify endpoint) →
   green check. Retries + plain-words errors (wrong password vs MILO
   down — the login classifier already distinguishes these).
5. Straight into the scanner. Catalog is the shared MLCC book —
   ZERO per-store setup. First scan inside minute one.
6. Trial banner: "Trial — X days left" → after day 14, orders pause
   until payment (Stripe build, M4).

## WHAT ALREADY EXISTS (this is why it's buildable fast)

- Creds save + live verify + encryption: `store-mlcc-credentials`
  routes/service + login classifier.
- Per-store isolation: RLS on every table, store_users membership,
  resolve-store middleware.
- Shared MLCC catalog + resolver + price memory: works for any store
  instantly; store memory starts learning from their first scan.
- Terms/privacy pages: `lib/terms-page.js`, `lib/privacy-page.js`.
- Landing page: root URL (marketing) — needs the CTA wired.
- Worker + engine: store-scoped already (one_running_run_per_store).

## BUILD ORDER (sandbox milestones)

- **M1 — accounts + store creation**: migration
  (`stores.trial_ends_at timestamptz`, `stores.onboarding_state
  text`), POST /signup service (create store + store_users link +
  trial stamp + Detroit timezone), pins.
- **M2 — connect step**: onboarding wizard UI (scanner app):
  account → store → MILO connect (both paths) → verify → done.
  Reuses existing creds endpoints. Pins on the state machine.
- **M3 — first-scan handoff + trial banner**: post-connect landing
  into scanner with a "you're live" moment; trial countdown chip.
- **M4 — billing**: Stripe subscription ($149/mo, trial-aware),
  order-pause-on-lapse (validate stays free? decide then). MUST land
  before the first stranger-store's day 14.
- **M5 — landing CTA + public switch**: wire "Start free" on the
  root page; Sentry funnel events on every step.
- **Arming policy**: new stores get `allow_order_submission=true`
  once creds VERIFY (ordering IS the product). The env kill switch
  stays the global brake. Flagged here so it's a conscious choice.

## OPEN NEEDS (blockers to the walkthrough being real)

- **MILO sub-user screenshots** (Tony, next time he's in MILO):
  the Users/sub-user management screen(s) — the wizard's
  walkthrough copy must match MILO's real UI word for word.
  Accuracy doctrine applies to onboarding copy too.
- Sub-user capability check: confirm a sub-user can place orders
  (not read-only) — verify with the ADA/OLO line (800-701-0513) or
  first sub-user test on Colony's license.
- Stripe account setup (Tony creates when M4 starts).

## RISKS, NAMED

Public-day-one + stranger stores = real credentials from people who
never met us. The fortress is non-negotiable: encrypted at rest
(existing), never logged (existing doctrine), sub-user preferred so
owners can revoke us in one click. A signup that half-fails must
NEVER strand a store silently — every step emits a Sentry event and
shows a plain-words next move. And the first support promise is the
founder's number — which only scales to ~10 stores; the AI partner
has to carry the routine load from store #1.
