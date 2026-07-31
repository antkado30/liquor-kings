# 2026-07-28 Closeout — Watchdog Day (THIS FILE IS THE CURRENT STATE)

Session span: 2026-07-27 morning → 2026-07-28 afternoon. Supersedes
`2026-07-27-warday-closeout.md`. Next session boot ritual:
`2026-07-19-BOOT-PROMPT.md` → THIS file → `RULEBOOK.md` (rule 28, the
Operator Split, governs every message to Tony).

## HARD LAWS (unchanged — see the 7/27 closeout for the full verbatim
## block; every law there still stands)

One-writer (Tony runs all git/deploy/SQL; zsh no `#`/no `!`/single-quote
commit msgs with NO apostrophes). File-ship law (fresh outputs path +
shasum verify both sides + drift-check before overlay). Prod Supabase
`eamoozfhqolshdztbrez` by ID only (the connected Supabase MCP account
does NOT contain prod — verified 7/28; never touch the two projects it
does show). Colony `e594fc3a-17b7-45d0-9dde-943ebbfa5391`. vitest on
Tony's Mac = the bars. Check NEVER submits; truth rule; triple gate;
break-glass ABSENT on both apps. Worker deploys ~10 min, never ctrl-C.
Sandbox clone commits LOCAL-ONLY (ignore the stop hook's push nag).

## PROD STATE

- API app: **`a51da3c`** (chain today: `6d582f5` live-pill + assistant
  polish → `a51da3c` saved-matches memory UI).
- Worker app: **`e38387c`** (loop watchdog) — first worker deploy since
  7/25.
- Bars: **API 743/0 expected (738 last full run + 5 new memory-route
  tests unrun-on-Mac as of closeout) · scanner 130/0 (17 files) · tsc
  clean.** NOTE: Tony deployed the memory-UI batch WITHOUT running the
  suites that time — first action next session: run both suites once.

## THE WORKER WEDGE INCIDENT (found live, killed, hardened, proven)

Tony's practice Check sat at "Starting up" 2:21+ with zero stages.
Diagnosis chain: pill live sheet (new that morning) showed the truth →
Sentry clean → `fly status` machine started-for-2-days → `fly logs`:
intermittent 20s claim-next timeouts every few minutes all night AND
last log line 12 HOURS old → the daemon loop was silently wedged (a
hang class the Stage-1 dead-man can't see). Graceful
`fly machine restart` 408'd — the shutdown handler politely waits
forever for a hung run. Unblocked via the worker deploy (machine
replaced). HARDENED: `workers/loop-watchdog.js` — if the main loop
completes no iteration in 20 min, the worker exits 1 and Fly restarts
it clean (dead-man generalized from "runs that fail" to "anything that
hangs"); 6 tests. PROVEN: fresh Check ran **5.5 seconds** end-to-end,
green result sheet, real MLCC totals.

Open follow-ups from the incident (post-Thursday unless it recurs):
- Intermittent claim-next 20s timeouts (worker→API over the PUBLIC
  edge) — real fix is Fly private networking (API_BASE_URL internal).
  Survivable now: 8s fast retry + watchdog.
- Root cause of WHAT hung the loop was never pinned (logs predate the
  wedge window) — the watchdog makes the class survivable regardless.

## SHIPPED THIS SESSION

1. **`6d582f5`** — (a) Pill tap mid-run opens the FULL live panel:
   stage checklist + elapsed + honest slow-MILO copy, extracted to
   shared `components/RpaProgress.tsx` (one truth drawer+pill; Tony's
   7/5 want finished — PROVEN live during the incident, screenshots).
   (b) Every assistant ask streams progress (heavy-gate retired).
   (c) `lib/label-pacer.ts`: progress labels hold ≥1.2s (his
   "couldn't catch it" complaint), bursts collapse to latest.
2. **`e38387c`** — worker loop watchdog (above).
3. **`a51da3c`** — Saved matches in Settings (THE MOAT audit door):
   GET /store-memory + POST /store-memory/forget over the existing lib
   (list/forget only — the UI can never invent memory), SettingsPage
   section with two-tap forget, delisted bottles render by code.
   10 new tests. AWAITING TONY'S PROOF (Settings → Saved matches).
4. Doc-status honesty sweep: 7/16 wants #1 (OOS names) and #3 (MLCC-net
   reconcile) were ALREADY BUILT (docs stale) — `lib/oos-display.ts`,
   `lib/cart-total.ts`. MLCC-net + result sheet seen live in the 5.5s
   proof.

## BOARD

- #19 Tony proof batch STILL OPEN: cart page feels (42e9fe1), chat
  restore at bottom, size-flip tap, admin sign-in, saved-matches
  section, camera-permission iOS Settings glance.
- #23 memory UI: shipped, proof pending. #20 pill: PROVEN. #22 polish:
  shipped (stream-all + pacer unproven, low risk).
- **WEDNESDAY 7/29 (tomorrow): DEPLOY FREEZE at night. Evening = arming
  steps** from `docs/lk/runbooks/order-day-2026-07-30-go-live.md`, fed
  just-in-time: W1 worker break-glass block FIRST
  (`fly secrets set LK_ALLOW_ORDER_SUBMISSION=no -a liquor-kings-worker`),
  W2 Colony `allow_order_submission=true` SQL + read-back, W3 phone
  reload → Check+Place visible. A scheduled task pokes this session
  Wednesday ~5pm ET to run that play.
- THURSDAY 7/30: Phase S shadow (verify the two log lines: worker Stage
  5 arming envKilled=true finalMode=dry_run + node-submit dry-run
  shadow complete) → lift worker block → fresh Check → Place →
  confirmations vs MLCC email (`originalNetTotalAmt`). Colony cutoff
  8pm ET. Also Thursday: capture the real order's resolver miss-list
  (the 7/9 rule) for the post-launch accuracy pass.
- Post-Thursday queue: worker→API private networking, harness adoption
  (#13), bottle photos (Serper), price-book archive, model bump eval,
  Capacitor wrap.

## SESSION MECHANICS

- Sandbox clone `/home/claude/lk` at local `69c1366` (+1 pending docs) —
  mirrors prod + 3 Playwright harnesses (overflow, decode-floor, cart).
  NEVER pushed.
- Tony worked from a second Mac today ("Antonioss-MacBook-Pro") — fly
  CLI works there; its clock prints odd local times in vitest (ignore).
- Cart badge shows a 423-item practice cart — his stress cart, harmless.
- Rule 28 rhythm: one purpose per message; when I slipped a 4-item
  message he said "wait what do u want me to do" — the reset to ONE
  concrete action worked immediately. Keep it ONE thing.
