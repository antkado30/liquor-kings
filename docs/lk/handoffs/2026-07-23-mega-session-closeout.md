# Handoff — 2026-07-23 EOD (the mega session)

Paste this whole file into a new chat to pick up exactly where we left off.
Supersedes `2026-07-22-engine-submit-closeout.md`. For a fresh chat, read the
Phase-0 list in `2026-07-19-BOOT-PROMPT.md` first, then this, then
[[START-HERE]] in Obsidian (vault = `docs/lk`).

**Tests: 661 passed / 0 / ~0.8s. That's the bar.** Prod API healthy at
`a13472f`. Everything below is committed + deployed unless noted.

---

## What shipped today (newest first)

### 1. Money-path arming retired to a break-glass kill (`a13472f`) — THE big one
Tony's call: env-var arming (`LK_ALLOW_ORDER_SUBMISSION`) is pre-launch
scaffolding that doesn't scale to a published product. Replaced, not removed:
- Every active gate site now treats the env as a KILL only (`"no"` blocks);
  its absence PERMITS. Sites: `resolve-run-mode.js`, `execution-run.service.js`,
  `execution-worker.js` (stage5Mode), `checkout.js` (+ dry-run reason),
  `home.routes.js` (armed state). `submitCartViaApi` inherits via
  `allowLiveSubmission`.
- The real gate is now: `stores.allow_order_submission === true` ("this is a
  real store") + the deliberate flow (green check → place-gate → confirm modal)
  + `run_type==="rpa_run"`.
- **DEPLOY IS INERT:** Colony's store flag is false → app unchanged (Check
  only). Nothing goes live until a store is deliberately enabled.
- Break-glass kept: `fly secrets set LK_ALLOW_ORDER_SUBMISSION=no -a liquor-kings`
  (+ `-a liquor-kings-worker`) hard-disables all submit fleet-wide, no deploy.
- Full model: [[submit-arming-model]]. Tests: `resolve-run-mode.unit.test.js`.

### 2. Fail-closed "check never submits" guard (`8516bba`)
`src/workers/submit-guard.js` — `assertSubmitMachineryAllowed({ runType })`
throws unless `run_type==="rpa_run"`, called immediately before BOTH submit
call sites. A check/preview can NEVER reach the submit machinery, even if a
future refactor rearranges the flow. Test: `tests/submit-guard.unit.test.js`.

### 3. The AI resolver: half-wrong → ~35/37 correct on Tony's REAL weekly list
Three surgery rounds, all evidence-driven from `scripts/audit-corpus-2026-07-23.mjs`
(run on Tony's Mac vs prod). Fixes, each pinned as a regression test:
- Flagship aliases (bare "Bacardi"=Superior, "Skrewball"=Peanut Butter,
  "Carolans"=Irish Cream, "Fireball"=Cinnamon).
- Brand synonyms (`stoli`→`stolichnaya`).
- **Possessive-'s false match** — the deep bug: "skrewball" read as present in
  "RAM'S", "stolichnaya" in "BURNETT'S" via the trailing 's. Fixed (lookbehind,
  lead-term-only).
- Size honesty (the Platinum 7X law): a requested size with no match never
  wears a confident badge — flags `sizeMismatch`.
- "double shot" = 100ml (Tony's register vocab); VANIL truncation prefix match;
  search cap 80→400 (Smirnoff 80 was truncated out of the pool before scoring).
- Corpus + verdicts: [[assistant-resolver-corpus-2026-07-23]].
- Deterministic-truth-over-model-parse: the tool re-derives size/plastic/case
  from the RAW line, not the model's paraphrase.

### 4. The AI "promise-and-ghost" lie killed
`assistant.js`: MAX_TOKENS 1024→4096 + one-shot escalation to 8192; a
`max_tokens`-truncated turn is NEVER shipped as an answer (it was shipping "I'll
resolve these — give me a second!" with the tool call silently discarded).
resolve_bottles cap 60→150 with loud truncation. Prompt law: never promise
future work / never "let me search" — act in-turn or state the limit. After a
resolve card, reply in ≤2-3 sentences (no essay).

### 5. AI UX: multi-photo + chips
Multi-photo bubble shows EVERY attached photo (was showing only #1 → looked
broken). Photo quick-chips appear on attach ("Add all to cart — no
duplicates", "Price-check these", "In stock?", "Read — don't add").

### 6. (from 7/22, already live) node-direct cold check ~3s; engine submit built
Cold check runs browserless at the MILO floor. Engine submit
(`LK_SUBMIT_ENGINE=api`) built + shadow-ready; first live fire deliberately
queued for a watched order day.

### 7. Obsidian knowledge base
Vault = `docs/lk`; [[START-HERE]] is the hub of all ~45 docs. `.obsidian/`
gitignored. RULEBOOK #26 (RINSE Tony) + #27 (no-drift) made permanent.

---

## NOT proven yet (do these — no code, just verification)
1. **Phone retest of the AI** — force-close app, reopen, attach the 3 order
   screenshots, tap the "Add all to cart — no duplicates" chip. Expect: all
   photos in the bubble, a 2-sentence reply, flagships winning on the card
   (Skrewball=PB, Stoli=Stolichnaya, Bacardi=Superior, Fireball=real).
2. **Node cold-check on the phone** feel (worker does ~3s; confirm the pill
   lands fast).

## NEXT MISSION (fresh session, daylight)
- **Go live for Colony under the new arming model** — the deliberate one-time
  step: set `stores.allow_order_submission=true` for
  `e594fc3a-17b7-45d0-9dde-943ebbfa5391`. Then Place appears with confirm steps,
  phone-armable, no laptop. **First real order under this model = SUPERVISED
  once** (fly logs open, numbers vs MLCC email). No deadline — next order day
  ~a week out. This is also mandate 2/3.
- **Engine submit go-live** (`LK_SUBMIT_ENGINE=api`) can ride the same watched
  order — one POST instead of browser Stage 5. Shadow it first (runbook).
- Optional niceties: always-show Submit as "preview" for not-yet-enabled
  stores; a phone Settings toggle for the store flag; the store-learning memory
  (the moat — AI reads+writes your aliases/usuals/corrections; tonight's
  hardcoded flagship aliases graduate into it).
- Backlog unchanged: "Ordered before" typed-search filter; rpa_run_summary
  contract test; Royal Canadian photos; KMS (S4); autoscale (S1).

---

## RULES THAT CARRY OVER (unchanged)
- One-writer (#11): Tony runs ALL git/deploys/deletions. Sandbox reads use
  `--no-optional-locks`. Tony's zsh: no `#` on command lines, single-quote
  commit msgs, avoid `!`.
- Money path: read the code, never recall (#3). Real submit = supervised,
  never casual (#5). Big/money move = show the plan first (#19). Check never
  submits (the guard). Truth rule: dispatched-without-confirmation =
  `submitted_unconfirmed`, never retried.
- RINSE Tony before building (#26). No-drift: rules→RULEBOOK, wants→TONY-WANTS,
  evidence→dated docs, state→handoff; fix stale docs the same pass (#27).
- Prod Supabase `eamoozfhqolshdztbrez`; Colony `e594fc3a-17b7-45d0-9dde-943ebbfa5391`.
  `samkado@gmail.com` = MILO credential, NOT app login. Tests 661/0 ~0.8s.

Tony's words to close on: "yes lets wrap here thats it baby amazing day."
It was. Cold check at the floor, engine submit ready, the AI rebuilt from
half-wrong to near-perfect on his real order, the money-path arming modernized
and hardened, and the whole knowledge base standing up in Obsidian. Clean wrap.
