# 2026-07-27 Closeout — Scanner War Won + Cart Page (THIS FILE IS THE CURRENT STATE)

Session span: 2026-07-26 afternoon → 2026-07-27 ~1:30am ET. Supersedes
`2026-07-26-operator-split-closeout.md`. Next session boot ritual: read
`2026-07-19-BOOT-PROMPT.md`, then THIS file, then `RULEBOOK.md` (rule 28
— the Operator Split — governs every message to Tony).

---

## HARD LAWS (verbatim, non-negotiable)

- **ONE-WRITER**: Tony runs ALL git/deploys/SQL. I write files to his disk
  via the bridge and hand him labeled commands (zsh: no `#` on command
  lines, single-quote commit messages — NO apostrophes inside them, no `!`).
- **File-ship law**: stage to a FRESH `/mnt/user-data/outputs/<dir>/` name →
  SendUserFile → device_commit_files → **shasum -a 256 verify on device**
  (both sides) before telling Tony to ship. Drift-check target files
  against clone HEAD BEFORE overlaying edits.
- Prod Supabase `eamoozfhqolshdztbrez` (verify by ID, never name;
  `vgilembychlcldhzqqeq` is NOT prod). Colony store
  `e594fc3a-17b7-45d0-9dde-943ebbfa5391`. `samkado@gmail.com` is a MILO
  credential, NOT an app login.
- `npm run deploy` = API app only; `npm run deploy:worker` = worker
  (two Fly apps: `liquor-kings`, `liquor-kings-worker`; worker deploy
  ~10 min by design — never ctrl-C).
- vitest runs on Tony's Mac only — his runs are the bars. Sandbox clone
  (`/home/claude/lk`) is for pre-testing + Playwright measurement; its
  commits are LOCAL-ONLY (author noreply@anthropic.com), NEVER pushed.
  Ignore the stop hook's "unpushed commits" nag — that is by design.
- Check NEVER submits (submit-guard fail-closed). `submitted_unconfirmed`
  is never auto-retried. Triple gate: `metadata.mode==="submit"` +
  `stores.allow_order_submission===true`; env `LK_ALLOW_ORDER_SUBMISSION`
  is break-glass kill ONLY (only literal `"no"` kills; absence permits) —
  currently ABSENT on BOTH apps (lifted 7/26).
- DB discipline: ad-hoc reads count-only/≤1000 rows; writes via script or
  migration only, run by Tony. No dependency upgrades before Thursday.
- **Deploy freeze Wednesday night (7/29).**

## PROD STATE (as of this closeout)

- Current prod: **`42e9fe1`** (API app; worker unchanged this session).
  Chain this session: `1292424` (floors + brand ladder) → `c5fc348`
  (scanner war phase 1) → `9289822` (vision one-matcher) → `42e9fe1`
  (cart page).
- Bars: **API 732/0 (63 files) · scanner 112/0 (14 files) · tsc clean.**
- Build stamp: More tab bottom shows the short sha (`VITE_GIT_SHA`).

## WHAT SHIPPED + PROOF STATE

1. **Scanner war Phase 1 — PROVEN on the floor** (`c5fc348`). The 5/10
   dead bottles were mathematically unscannable: at 720p a 22mm barcode
   only has ≥1.4 px/module inside the lens's minimum focus distance.
   Fix (all numbers measured, 145 harness rows): 4K capture request
   (graceful degrade, granted res shown in the muted line under the
   camera + Sentry breadcrumb), re-entrancy-guarded tick loop, "live"
   ZXing hints (6 formats, NO TRY_HARDER/inverted — identical catch
   rate, 18–38ms per miss vs 586–944ms), per-tick center-crop decode at
   native res, ≤1024px full-frame rotation sweep every 3rd tick,
   TRY_HARDER reserved for one-shot photo stills, green aim-rect flash
   at decode moment. `lib/scanner-decode.ts` + 13 tests pin the design.
   Tony re-scanned the same bottles: **"everything looks good."**
2. **Scanner war Phase 2 — PROVEN** (`9289822`). ONE MATCHER LAW: vision
   route's private token ranker deleted; photo results now rank through
   `resolveOrderLine` (flavor penalty, flagship aliases, brand synonyms,
   proof-line demotion, size honesty). "root beer" added to
   FLAVOR_WORDS (compound, safe). Response gained a `resolve` verdict
   {confidence, sizeMismatch, leadMissing}. Tony's plain-Smirnoff
   screenshot pinned in `tests/catalog-vision-resolver.unit.test.js`
   (7 tests). Tap-through already existed — the right bottle was just
   never in the list; now it is, recommended, high-confidence.
3. **Cart tab = REAL PAGE — shipped, AWAITING TONY'S PROOF** (`42e9fe1`).
   CartDrawer (money machine untouched) learned `layout="page"`:
   /cart renders it full-bleed — no backdrop/grab/X, tab bar VISIBLE,
   page scroll, sticky Check/Place footer offset above the tab bar
   (nav height MEASURED 69px → 72px offset + safe-area). CartPage
   carries its own preValidate hook, smart-cards store meta (fail-soft),
   ProductCard host (line-tap + More-from-brand). Scanner top-right
   icon keeps the classic drawer peek. Hooks gained `active` param
   (4 tests). Playwright cart harness: all four layout checks PASS.
4. **Earlier 7/26 ships all PROVEN**: bottom-clearance floors, Jim Beam
   brand ladder ("MORE FROM JIM BEAM"), more-from-brand everywhere,
   iOS zoom kill, gesture-zone fix, streaming progress, chat true-bottom.

## BOARD (task list state)

- #4 **Wednesday 7/29 evening — arming steps** (I feed just-in-time from
  `docs/lk/runbooks/order-day-2026-07-30-go-live.md`): W1 worker block
  FIRST (`fly secrets set LK_ALLOW_ORDER_SUBMISSION=no -a liquor-kings-worker`),
  W2 Colony flag SQL + read-back, W3 reload → Check+Place visible.
- Thursday 7/30: Phase S shadow (must see the two log lines: worker
  Stage 5 arming envKilled=true finalMode=dry_run + node-submit dry-run
  shadow complete), then lift block → fresh Check → Place → confirmations
  vs MLCC email (`originalNetTotalAmt`). Colony cutoff 8pm ET.
- #8 Tony 5-min verify batch (size-flip tap, post-check price reconcile,
  admin sign-in, prompt-cache glance) — fold into morning check-over.
- #9 chat restore lands at bottom — shipped `766733d`, verify in morning.
- #12 cart page — awaiting morning proof.
- #13 adopt harnesses into repo post-Thursday (measure.mjs,
  measure-decode.mjs, measure-cart.mjs + 3 harness html/tsx pairs live
  in the sandbox clone only, branch history local).
- Backlog: label-linger polish, streaming for ALL asks (drop heavy-ask
  gate), memory UI in Settings, worker→API hardening (post-Thursday),
  Capacitor native wrap (post-launch).

## MORNING CHECK-OVER (Tony asked to be reminded — scheduled task set
## for ~10:00am ET Mon 7/27 poking this session to deliver it)

1. Cart tab: full page, tabs stay, bottom reachable, line-tap opens card.
2. AI tab: background the app, reopen — chat restored AT the bottom.
3. Resolve card: size-flip tap works; post-check price reconcile glance.
4. Admin sign-in still works; prompt-cache hit-rate glance in logs.
Then: Monday/Tuesday is the last build window (freeze Wed night) —
pick from backlog or polish, Tony's call after the check-over.

## SESSION MECHANICS

- Sandbox clone `/home/claude/lk` at local commit `9638426` (+1 for docs
  pending) — mirrors prod + harnesses. NEVER pushed.
- Vite dev server for harnesses: `cd apps/scanner && npx vite --port
  5199 --strictPort`; measure scripts at repo root run with node.
- Reminder mechanism: claude-code-remote `send_later` (a one-shot
  scheduled task delivering into THIS session as a user turn).
- Rule 28 rhythm held all session: one purpose per message, labeled
  batches, 30-second phone proofs, board as the anti-loss machine.
