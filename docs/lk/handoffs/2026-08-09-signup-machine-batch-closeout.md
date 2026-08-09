# 2026-08-09 — SIGNUP MACHINE BATCH CLOSEOUT

## SHIPPED (commit `4d5ecb3` on Tony's Mac, 23 files, deployed + verified)
The whole self-serve ladder M1–M4 went to prod in one batch:
- **M1 server**: trial_ends_at (+14d Detroit tz) stamped at signup; MILO
  creds optional (both-or-neither `mlcc_credentials_incomplete`);
  onboarding_state.
- **M2 wizard**: "14 days free, no card" on the form; Step 2 teaches the
  REAL MILO sub-user path (invite-based — from Tony's screenshots);
  "Connect MILO later — start scanning now" credless path.
- **M3 nudge**: connect-MILO banner on scanner home (only for confirmed
  credless stores; Colony never sees it); Settings PUT/verify closes the
  connect loop.
- **M4 billing scaffold**: zero-dep Stripe (bare REST + node-crypto
  webhook verify). SAFETY LAWS pinned (13 tests): FAIL-OPEN until
  STRIPE_* env exists · GRANDFATHER trial_ends_at NULL (Colony) ·
  past_due grace · only from-cart runs gate (403 `billing_required`).
- Docs: SIGNUP-MACHINE blueprint, MLCC outreach letter, bible sync.

## VERIFIED
- Bars (Tony's Mac, the only ones that count): **API 805/805 · scanner
  181/181 · tsc clean** — new high-water marks (was 762/151 in bible §2;
  fix that line next batch).
- Migrations applied in prod SQL editor: signup_trial_onboarding +
  billing_columns — "Success. No rows returned."
- Deploy (pinned flyctl 0.4.74 path) → probes from Tony's Terminal:
  `GET /billing/status` → **401** (route live, auth-locked) ·
  `POST /billing/webhook` → **`billing_not_configured` [503]** (mounted,
  money OFF — fail-open proven against live prod).

## MONEY STATE
OFF and inert. Turns on only when Tony pastes STRIPE_SECRET_KEY /
STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET into Fly (+ optional
LK_PUBLIC_ORIGIN). Do this when the first stranger nears trial day 14 —
5-minute Stripe signup + one $149/mo price; hand Tony exact taps then.
Colony can never be gated (grandfather law, pinned).

## SHIP-RITUAL LEARNINGS (bake into every future batch)
1. **NEVER run git via device_bash on the repo mount — not even
   `git status`.** The mount cannot unlink, so git leaves a stale
   `.git/index.lock` it can't clean; Tony's next git command would
   fail. (Happened this batch; his step 1 cleared it with `rm -f`.)
   Drift-check with `shasum` only, exactly as Law 2 says.
2. Overlay with `tar --overwrite -xzf` — plain tar unlinks first and
   dies on the no-delete mount.
3. The device VM has NO network: prod probes go in Tony's own Terminal
   (or his phone), never device_bash curl. Sandbox egress is
   allowlisted too.
4. Tarball + manifest into the repo → `mv` to `_to_delete/` (now
   gitignored) since the bridge can't rm.

## MILO SUB-USER TRUTH (from Tony's 8/8 screenshots — bible §13 canon)
Invite-based: Administration → Group Management → license → Invite →
claim link by email (~3-day expiry) → invitee makes own sign-in.
OPEN: role options / whether a member can order — learn on Colony's
first real invite (also the eventual replacement for main-login creds).

## NEXT (in order)
1. **Settings billing panel** (trial days + add-card button; client of
   /billing/status + /billing/checkout-session).
2. **M5**: landing-page "Start free" CTA → /scanner/#signup + public
   switch decision moment.
3. MLCC letter: Tony fills license #, city, phone → send to
   mlccinfo2@michigan.gov (cc Licensing).
4. Colony sub-user invite (learns roles; rotate creds after).
5. Later roadmap: voice AI support line (honest-AI, never fake-human);
   bible §2 bars line correction rides next batch.

## STANDING ASKS (unchanged, no pressure)
Letter blanks (license #, city, phone) · thermal printer photo (#38).
MILO screenshots: DELIVERED 8/8 ✓ (they rewrote the wizard).
