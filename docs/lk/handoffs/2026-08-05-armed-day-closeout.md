# 2026-08-05 Closeout — ARMED DAY (THIS FILE IS THE CURRENT STATE)

Session span: 2026-08-01 (Sat) → 2026-08-04 late night (Tue, ET).
Supersedes `2026-07-28-freeze-eve-closeout.md`. Next session boot
ritual: `2026-07-19-BOOT-PROMPT.md` → THIS file → `RULEBOOK.md`
(rule 28, the Operator Split, governs every message to Tony).

## HARD LAWS (all 7/27–7/28 laws stand; deltas below)

One-writer (Tony runs all git/deploy/SQL; zsh no `#`/no `!`/
single-quote commit msgs, NO apostrophes). File-ship law (fresh
outputs dir + shasum verify both sides + drift-check before overlay).
Prod Supabase `eamoozfhqolshdztbrez` by ID only (connected Supabase
MCP = Tony's OTHER account, never contains LK prod). Colony
`e594fc3a-17b7-45d0-9dde-943ebbfa5391`. vitest on Tony's Mac = the
bars. Check NEVER submits (structural: mode="validate" at birth;
submit engine refuses non-submit runs). Truth rule. Sandbox clone
commits LOCAL-ONLY (ignore stop-hook push nag).

**NEW LAWS (2026-08-04/05):**
- **THE SYSTEM IS FULLY ARMED, PERMANENTLY, AT TONY'S REQUEST.**
  Worker secret `LK_ALLOW_ORDER_SUBMISSION=yes`, API app secret
  `LK_ALLOW_ORDER_SUBMISSION=yes` (explicit), Colony
  `allow_order_submission=true` (his SQL, read-back verified).
  Tony holds the keys. NEVER instruct a re-lock; the old W1/W2/W3
  arming ceremony and Phase-S shadow plan are DEAD. Place → confirm
  = real money, any time he chooses. Check stays practice forever.
- **The scanner app lives at `/scanner/` — the root URL is the
  marketing landing page.** Any deploy probe, bundle check, or
  fetch of "the app" targets `/scanner/`. (An hour was lost to a
  probe aimed at root. See DEPLOY TOOLING.)
- **Deploy tooling state (post-war):** flyctl self-update destroyed
  the brew binary mid-day 8/4; brew now has 0.4.78 (Depot path,
  classic-builder BROKEN by a daemon-host parse bug) and a PINNED
  0.4.74 lives at `~/.fly/bin/flyctl`. The KNOWN-HONEST deploy:
  `~/.fly/bin/flyctl deploy -a liquor-kings --strategy rolling
  --wait-timeout 900 --depot=false --build-arg GIT_SHA=$(git
  rev-parse --short HEAD)` — full context upload, real layer
  execution, verified tonight. `npm run deploy` (Depot) is probably
  fine (its all-CACHED 1.8s builds were likely legitimate dedup) but
  UNPROVEN-when-suspicious until task #30 (GIT_SHA stamp + verify
  script) ships. Worker deploys unchanged (`npm run deploy:worker`).
- The mid-rolling fly WARNING "app is not listening on the expected
  address" is a benign timing artifact — appears every deploy,
  machines always clear.

## PROD STATE

- API app: **`7564175`** (today's chain: `3f8f62e` price memory →
  `52eeb63` OOS-remove + footer seam + between-book auto-ingest →
  `7564175` footer gap + armed-status retry). Verified live by
  string-probe against `/scanner/` assets (1/1) + Tony's eyes.
- Worker app: `e38387c` code + `API_BASE_URL=http://liquor-kings.internal:8080`
  (c71bff2 config) + secret yes. Untouched today after the secret.
- DB: migration `20260801201457_add_previous_licensee_price_to_mlcc_items`
  APPLIED by Tony in prod SQL editor (column live; ingestor writes it
  from the next book/change-file onward).
- Bars: **API 762/762 (65 files) · scanner 151/151 (20 files) · tsc
  clean** — all run on Tony's Mac tonight, exact on prediction.
- Phone-proven tonight: **Place Order visible + locked-until-Check**
  (armed state working), footer gap closed, seam gone. 8.4s Check
  earlier in the week over the private-network path.

## SHIPPED THIS SESSION

1. `3f8f62e` **Price memory**: `previous_licensee_price` captured on
   licensee-price moves (pure `nextPreviousLicenseePrice`, 8 pins),
   client chip "▲ was $X" red/green ≥1¢ within ~14 days
   (`lib/price-change.ts`, 9 pins), ProductCard render, mapRow +
   types. First chips light when the next book/change-file lands.
   Also: `memory_note` added to ResolvedOrderLine (wire always sent it).
2. `52eeb63` **Remove-OOS-from-sheet** (Tony's screenshot ask): per-row
   Remove + "Remove all out-of-stock (N)", removed rows stay as
   struck-through receipts, re-check nudge (place-gate hash re-locks
   automatically), 6 pins incl. no-provider/submitted guards.
   **Footer seam slab** (::after paints the band under the sticky
   footer). **Between-book auto-ingest** (the "all aspects" mandate):
   retail-price-changes + ada-changes + new-item lists on the daily
   `/price-book/check-updates` tick — per-kind ledger compare,
   additive-only, ≤2000-row fail-closed fence, fail-soft per kind
   (matchers verified against the LIVE May-book hrefs; 11 pins).
3. `7564175` **Footer gap** (base safe-area padding double-counted on
   the page layout → flat 12px) + **armed-status fetch retry**
   (`lib/store-meta-retry.ts`, 3 tries/3s — the 4:14pm "Place button
   missing" scare was a one-shot silent fetch failure; 6 pins).
4. Journal entry #11. Rewrote BOTH scheduled reminders for the armed
   world (no re-lock instructions anywhere).

## THE DEPLOY WAR (2026-08-04 evening — full arc for the record)

flyctl self-update ate `/opt/homebrew/bin/fly` mid-command → brew
reinstall 0.4.78 → npm deploy produced a 1.8s all-CACHED Depot build
→ my probe for new strings returned 0 → BUT the probe hit the ROOT
(landing page), not `/scanner/` → false staleness panic → classic
builder attempts crashed on 0.4.78's daemon-host parse bug (twice,
agent-mismatch red herring in between) → Depot --no-cache rebuilt
fresh and probe still 0 (same blind probe) → local sandbox build gave
ground truth (string locations + asset naming, css `::after` minifies
to `:after`) → root-vs-/scanner/ discovered → pinned 0.4.74 classic
build (4.26MB full context) + corrected probe = 1/1 → final mini-batch
deploy verified honest (changed layers re-ran). Lessons instituted:
/scanner/ law above; task #30 makes verification a script.

## BOARD (open)

- **#24 Tony: the 7/30 parents' MILO order list** — STILL OUTSTANDING,
  asked 3×. Wanted for resolver corpus + the real Thursday cart.
  Wednesday readiness ping falls back to "build his usual order" if
  it never arrives.
- **#19/#8 Tony proof batch** (low-stakes eyeballs): saved-matches in
  Settings, chat-restore-at-bottom (#9 fix still UNBUILT), size-flip,
  admin sign-in, camera-permission glance. Post-Thursday is fine.
- **#9 Build**: AI tab restore lands at TOP of chat → should be bottom.
- **#28 Build**: save-for-later in cart (Amazon-style).
- **#29 Build**: duplicate-add guard ("you already have 3 fifths of
  Jack — add 3 more?"). Both are Tony wants from 8/4.
- **#30 Build**: GIT_SHA stamp in scanner index.html + verify-deploy
  script. FIRST BUILD after the freeze lifts.
- **#13** harness adoption, Serper photos, model bump eval, Capacitor:
  post-launch queue unchanged.

## THE WEEK

- **WEDNESDAY 8/5**: deploy freeze from tonight. 5pm ET scheduled ping
  (this session): readiness play — build the REAL cart (order list or
  usual order), one fresh Check green, glance Place. One action per
  message.
- **THURSDAY 8/6 = ORDER DAY**: 9am ET backstop ping. Fresh Check →
  Tony taps Place + confirms (REAL) → verify app result + MLCC email
  `originalNetTotalAmt` to the penny → capture resolver miss-list.
  Colony cutoff 8pm ET. NO unlock steps exist — never mention secrets
  or SQL.

## SESSION MECHANICS

- Sandbox clone `/home/claude/lk` mirrors prod through `7564175`
  (local mirror commits only, never pushed).
- Sandbox container clock froze at Aug 1 mid-session (real date ran to
  Aug 5); date-stamped filenames may lag a day — harmless, but check
  `date` against trigger-server timestamps when it matters.
- Device bridge: `/Users/tonecapone/dev/liquor-kings`; Chrome remote
  JS execution blocked by a Chrome setting (list/open tabs works).
- Cart badge shows a 99+ real-ish cart ($6.2k est) — HIS build, not
  the old 423 stress cart; treat as live inventory intent.
