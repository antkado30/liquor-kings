# Handoff — 2026-07-26 (OPERATOR SPLIT locked + streaming proven + honest fails on device)

Paste this whole file into a new chat to pick up exactly where we left off.
Supersedes `2026-07-25-phase-b-evening-closeout.md`. Fresh chat: read the
Phase-0 list in `2026-07-19-BOOT-PROMPT.md`, then this, then RULEBOOK
(**rule 28 is new and governs HOW you talk to Tony — read it first**).

**Tests: 708 API (61 files) / 91 scanner (11 files), 0 failed. Prod healthy
at `74a1759`.** Worker untouched this session (no worker deploys — by
design, Thursday week). Everything below committed + pushed; prod deploys
at `e1dac67` then `74a1759`.

---

## RULE 28 — THE OPERATOR SPLIT (read RULEBOOK #28 verbatim, it is law)

Tony's own words 7/26: info-drops get skimmed, "none of that information
stays in my head"; planning/decisions are where he needs backup; terminal/
consoles are where he's strong. Locked by interrogation (his answers:
one-thing-at-a-time + decide-with-one-line-why + show-me-don't-tell-me):
Fable is the brain, Tony is the hands. ONE purpose per message. The task
board is the anti-loss machine — every step and every dropped want gets a
card + one-line receipt THE MOMENT it's said (his named fear: "shit piles
up and never gets done"). Tony never reads docs/runbooks — Fable feeds
them as just-in-time steps. Ships are proven by a 30-second phone action.

## What shipped 2026-07-26 (in order)

1. **Break-glass LIFTED on BOTH apps** (`fly secrets unset
   LK_ALLOW_ORDER_SUBMISSION` on liquor-kings + liquor-kings-worker;
   verified gone via `fly secrets list`, machines cycled clean). Code truth
   re-verified: only the literal `"no"` kills; absence permits. Colony
   `stores.allow_order_submission` is still **false** → app is Check-only.
   The ONLY closed gate is now the store flag (Wednesday step).
2. **Thursday runbook written**: `runbooks/order-day-2026-07-30-go-live.md`
   — the 7/22 Part-2 script translated to the break-glass arming model,
   every line re-verified against code (stage-5 arming ~1151, shadow log
   1829, tripwire 721/1686 — a green shadow CANNOT trip it; it only
   matches FAILED runs at rpa_checkout and only on live submits). Shadow
   mechanism: worker-only `=no` + store flag true = armed client, blocked
   worker, "never unsafe". Browser fallback preserved (2 commands).
   **Tony does NOT read it — Fable feeds W1→W3 Wednesday evening, then
   Thursday phases step by step.** Cutoff Thu 8pm ET; orders Thursdays only.
3. **Live progress streaming — SHIPPED + PROVEN on the floor** (`e1dac67`).
   Heavy asks (photos / ≥200-char pastes) stream NDJSON: per-tool labels
   ("Matching 87 lines to MLCC bottles…"), resolver wave counts, 15s
   heartbeat that kills the ~60s silent-response timeout class for good.
   Fail-soft by law (a broken callback can never break an answer; pinned).
   Server: `lib/assistant.js` (onProgress + progressLabelForTool),
   `routes/assistant.routes.js` (stream:true → NDJSON; old clients
   byte-identical). Client: `lib/ndjson.ts` incremental parser,
   `api/assistant.ts` (heavy gate, inactivity watchdog 45s, hard cap
   240s), bubble label swap. +14 API tests (progress + stream route),
   +6 scanner (ndjson). **Tony saw "Reading your photo…" live — proven.**
4. **Chat persistence PROVEN on device** (screenshots): survived
   tab-switch, History listed the chat, photos-from-history chip correct.
5. **TONY-WANTS de-staled**: 7/16 #0 one-tap "Remove these N and check
   again" + pinned OOS strip were BUILT long ago (CartDrawer) — doc said ⏳.
   If OOS hits Thursday, that button is the night-saver.

## ⚠️ SHIPPED BUT FAILED DEVICE PROOF (1:52am — NOT fixed, top of Monday)

Both at `74a1759`, Tony still saw both bugs minutes after deploy:
- **iOS input-zoom jank** (his screenshots: page zooms on composer tap,
  stays zoomed + panned; "readjust everything… I hate it"). Fix shipped:
  16px floor on ALL 7 sub-16px text controls + `max(16px,1em)` element
  floor + body `overflow-x: hidden` (the "iOS zoom law" comment block at
  the end of index.css). STILL REPRODUCED after deploy.
- **AI tab restore lands mid-chat** (composer off-screen, must scroll
  down). Fix shipped: endRef sentinel + scrollIntoView (page-vs-drawer
  scroller). STILL landed mid-card after deploy.

**PRIME SUSPECT for both: the phone may be serving a STALE BUNDLE** —
force-close might not bust the PWA asset cache. FIRST MOVES next session:
(1) find how the installed app caches/updates assets (service worker?
index.html cache headers?) and how to verify the running build sha on
device; (2) only then re-diagnose the two fixes. If the bundle WAS fresh:
scroll likely fires before the giant resolve card finishes layout (needs
post-layout/second-frame scroll), and the zoom needs PWA-specific
handling beyond font-size. Prove-before-trust: neither closes until
Tony's eyes say so.

## NEW from Tony 1:52am (captured verbatim, on the board + TONY-WANTS)

- **Bottom-bar taps trigger an Apple gesture** — sometimes triple-press
  to land a button. The tab bar likely sits in the iOS home-indicator
  gesture zone → needs `env(safe-area-inset-bottom)` clearance +
  touch-action review, app-wide bottom-edge audit.
- **Cart tab must be a FULL cart PAGE** — "not half cart with a
  background of the scanner." Product change to bottom-nav Cart.
- App-wide quality-feel hunt continues — he says the jank is everywhere.

## NEXT MISSION — THURSDAY 7/30 GO-LIVE (mandate 2/3, THE priority)

Mon–Tue (all client-only, safe lane): fix + device-prove the two failed
fixes → bottom-bar gesture fix → cart full page if time. **Deploy freeze
Wednesday night.** Wednesday evening: Fable feeds runbook W1→W3 (block
worker first, then Colony flag SQL + read-back, then reload check).
Thursday: shadow → verify the two log lines → lift worker block → fresh
Check → Place → confirmations vs MLCC email to the penny
(originalNetTotalAmt). Truth rule: submitted_unconfirmed NEVER re-placed.
NOTHING touches worker/money path before Thursday.

## Still queued (unchanged)

Phone verifies: size-flip tap, post-check price reconcile (7/16 #3),
admin sign-in, prompt-cache hit-rate glance. Polish: progress-label
linger. Then the 7/25 queue: memory UI in Settings, streaming for all
asks + token streaming, worker→API internal-address hardening (POST-
Thursday), speculative pre-validate, always-show Submit preview, phone
store-flag toggle, model bump eval, dependency refresh day (post-first-
order, pinned), typed-search filter gap, cross-device chat sync, browser
retirement after 3 green engine orders.

## RULES THAT CARRY OVER

One-writer (Tony runs ALL git/deploys/SQL; sandbox git reads
`--no-optional-locks`; zsh: no `#` on command lines, single-quote commit
msgs, no `!`). **Rule 28: one thing at a time, board receipts, no walls,
decide + one-line why, show-don't-tell.** Money path: read code never
recall; check NEVER submits (guard); triple gate = mode==="submit" +
store flag (env = break-glass kill only, currently absent both apps).
RINSE (#26) + no-drift (#27). DB law RULEBOOK §1.6. Prod Supabase
`eamoozfhqolshdztbrez` (ID, never name); Colony
`e594fc3a-17b7-45d0-9dde-943ebbfa5391`; `samkado@gmail.com` = MILO cred
NOT app login. `npm run deploy` = API only; worker deploys separate,
~10 min, never ctrl-C. vitest on Tony's Mac only. No dependency upgrades
before Thursday's order (pinned). **Bars: API 708/0 · scanner 91/0 ·
stress HIGH-WRONG 0.0% · family audit all-zeros. Re-run both audits after
any resolver/family change.**
