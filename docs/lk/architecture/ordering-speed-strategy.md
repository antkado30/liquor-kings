# Ordering Speed Strategy — 2hr → 5min (2026-06-27)

**Goal:** complete ordering (scan → submitted) in ~5 minutes, down from ~2 hours. Must scale to ANY store: ours is ~500 bottles/week, but a Kroger/Meijer/Art&Jake's could order tens of thousands of bottles. Architecture must handle that. Solve it right — stop patching, test multiple routes.

**The reframe (the crux):** The bottleneck is NOT MLCC's validate — MILO validates in ~5s once the cart is built. The slowness is that our RPA REBUILDS the whole cart inside MILO every run by puppeteering the site (login + Add-By-Code one item at a time). MLCC is fast natively because the cart's already in their system; validate is one backend call. We're slow because we shove the cart through the browser like a human typing. LK is strong where MLCC hurts (fast input: scan/photo/search); weak where MLCC is strong (native validate+submit).

**Confirmed facts (Tony, 2026-06-27):**
- MILO validate: ~5s once cart built.
- MILO login: username + password + accept-terms checkbox. NO 2FA, NO captcha.
- MILO has only Add-By-Code + Products(search). NO bulk import/upload.
- No official MLCC electronic ordering known — website by hand only.
- Each store has a weekly mandatory cutoff (Colony = Thu 8pm).

**Routes (✅ tried / ⬜ untested):**
- ✅ R1 Browser RPA (current) — slow+flaky, re-types whole cart. All we've tested.
- ⬜ R2 MILO backend API direct (BIG BET) — capture the HTTP calls MILO's own site makes (add/validate/submit), replay them over the network, no browser typing → native speed + scales. Auth is simple so feasible.
- ⬜ R3 Hybrid — browser login once, then direct backend calls for bulk ops.
- ⬜ R4 Live cart sync — push each scanned item into MILO in the background as you scan; validate-time the cart's already there.
- ⬜ R5 Bulk import — DEAD (MILO has none).
- ⬜ R6 Official MLCC EDI/API — likely none; low-priority check.
- ⬜ R7 Smooth manual fallback — dump cart as MILO-ready lines to hand-key on deadline.

**Decisive experiment:** instrument the existing RPA to RECORD every HTTP request MILO makes during add+validate, then replay them directly (no browser). If their backend answers us like it answers their site → 5-second path found.

**Honest caveat:** R2 is still automating MLCC (same "is this sanctioned" question as R1). Testing is safe; going live is the same judgment call.

**Scale mandate:** per-item browser typing can't scale to tens of thousands of bottles. This alone argues R2 over R1.
