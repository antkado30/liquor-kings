# Handoff — 2026-07-25 evening (PHASE B PROVEN: the store you teach by talking + chat that remembers itself)

Paste this whole file into a new chat to pick up exactly where we left off.
Supersedes `2026-07-24-moat-day-closeout.md` (incl. both addenda). Fresh
chat: read the Phase-0 list in `2026-07-19-BOOT-PROMPT.md`, then this, then
[[START-HERE]].

**Tests: 694 API / 85 scanner, 0 failed. Prod healthy at `667a11c`.**
Everything below is committed + pushed + deployed.

---

## What shipped (in order)

### 1. MOAT Phase B — chat teaching, SHIPPED (`1513a30`) and PROVEN ON THE FLOOR
Three tools in `lib/assistant.js`: `teach_bottle_memory` (verifies the MLCC
code EXISTS via mlcc_items before saving — no teaching phantom bottles),
`list_bottle_memory` (joins real names), `forget_bottle_memory` (honest
`deleted:false` when nothing matched). `lib/store-memory.js` gained
`listMemory` / `forgetMemory` (delete keys on NORMALIZED phrase + size —
apostrophe-proof, same key law as learn/lookup). Prompt law: teaching is
EXPLICIT-INTENT ONLY ("remember/my usual/we call it") — never inferred from
casual mentions; ambiguous teach must resolve + confirm first.

**Floor test at Colony, 5/5 (screenshots on file):**
1. *"Remember that my usual limoncello is the Lucina"* → "Saved — from now
   on 'limoncello' means your Lucina (code 19366) every time. ★"
2. *"Add limoncello fifth"* → **★ REMEMBERED**, "That's your usual."
3. *"What have you learned about my store?"* → listed the mapping, noted it
   saved BOTH with-size and size-less variants (model did that unprompted —
   smarter than specced), and "that's the one that fired just now."
4. Ambiguous teach (*"Stoli vanilla = Stolichnaya"*) → resolved STOLICHNAYA
   VANIL 95996, ASKED the size-scope question (750-only or any size?) —
   exactly the confirm-before-save law.
5. *"Forget the limoncello thing"* → cleared BOTH variants; re-ask returned
   the honest contested card AND the model proactively offered to re-learn
   ("once you confirm I can save it"). Full lifecycle: teach → fire → audit
   → forget → offer. The moat breathes.

### 2. Chat persistence + simple history (`667a11c`)
Tony at Colony: "every time I click out of the AI tab the whole chat gets
restarted… make it simple but work very well." Built
`lib/assistant-chat-store.ts`: conversations persist per-store in
localStorage — survive tab switches AND app restarts. **History** button
(reopen/delete past chats, title = first user message), **+ New chat**
archives the old one. Photos stripped to "📷 N photos (from history)" chips
(storage budget); resolve cards persist fully. Caps: 15 chats × 60 msgs.
Corrupt storage / quota fails SOFT to empty — persistence can never crash
chat. 5 new tests (scanner 80→85); one caught a real bug before it shipped:
two chats created in the same millisecond shared a `Date.now()` id →
open/delete hit the wrong chat. Ids now collision-proof.
KNOWN V1 BOUNDS (deliberate): per-device only (no cross-device sync — queued
as a backend upgrade); chats from BEFORE this deploy are gone (they predate
persistence — the last conversation that will ever vanish).

### 3. Prompt caching — Tony's unit-economics question answered with engineering (`667a11c`)
His worry: "if people use the AI a lot are we really making money?" Math:
a heavy interaction ≈ 5–15¢; a power user at 30/day ≈ $60–120/mo — thin
under likely pricing. The fix shipped same-commit: `cache_control:
ephemeral` on the system block in the main loop → Anthropic caches the
entire static prefix (TOOLS + SYSTEM_PROMPT, the biggest input slice) at
~90% discount on every hit (~5-min window = virtually the whole tool loop +
every rapid-fire store conversation). The AI gets CHEAPER per call the more
a store uses it — the exact usage pattern he feared. Later levers (not
built): Haiku for the parse-only endpoint; usage tiers in pricing (business
decision, post-launch).

### 4. Housekeeping
npm CLI updated 11.12.1 → 12.0.1 (global tool only — project untouched).
**DECISION PINNED: no dependency upgrades before Thursday's first live
order.** Green board days before go-live is not when you bump majors.
Backlog gains "dependency refresh day" scheduled AFTER the first order
lands green.

---

## NOT proven yet (no code — just eyes)
- Chat persistence on DEVICE: switch tab → return → still there; History
  open/delete; + New chat. (Deployed after Tony left the app; first thing
  to try next session — 60 seconds.)
- Size-flip TAP: the "Switch size (3 carried)" chip RENDERED on the Stoli
  card (screenshot) but an actual flip + memory-not-corrupted re-ask is
  still unverified on device.
- Prompt-cache hit rate: worth one glance at Anthropic console usage after
  a few days (expect cache_read_input_tokens dominating input).

## NEXT MISSION — THURSDAY ~7/30 GO-LIVE (mandate 2/3, THE priority)
1. `fly secrets unset LK_ALLOW_ORDER_SUBMISSION` on **BOTH apps** (API +
   worker — worker app name is in `fly.worker.toml`; remember
   `npm run deploy` = API ONLY, `npm run deploy:worker` = worker, RULEBOOK
   §2.5b). Worker's own logs PROVED it currently runs `envKilled=true` —
   break-glass is ENGAGED and must be lifted or Thursday submits nothing.
   Verify API side via `fly ssh console` + printenv.
2. Colony `stores.allow_order_submission = true` (SQL, Tony runs, verify by
   read-back; prod `eamoozfhqolshdztbrez`).
3. First real order WATCHED end-to-end: fly logs live + MLCC confirmation
   email cross-check. Check-never-submits guard + confirm flow are the
   rails; truth rule: submitted_unconfirmed is NEVER retried.
4. Engine submit (`LK_SUBMIT_ENGINE=api` already set) shadows the same
   order per the 2026-07-22 closeout Part 2 structure (minus retired
   env-arming steps — `submit-arming-model.md` is the law).

## Queued after that (unchanged + new)
- Moat: memory management UI in Settings; seed from order history.
- Chat: server-side conversation sync (cross-device); streaming replies
  (kills the ~60s wait-feel).
- Worker→API internal-address hardening (the 7/25 incident's real fix).
- Always-show Submit as preview; phone toggle for the store flag; model
  bump eval; **dependency refresh day (post-first-order)**.
- Backlog unchanged: speculative pre-validate; cart_reset via node; browser
  pipeline retirement after 3 green orders; rpa_run_summary contract test;
  "Ordered before" typed-search filter; Royal Canadian photos; KMS (S4);
  autoscale (S1).

## RULES THAT CARRY OVER
One-writer (Tony runs ALL git/deploys/SQL; sandbox git reads use
`--no-optional-locks`; zsh: no `#` on command lines, single-quote commit
msgs, no `!`). Money path: read code, never recall; check never submits
(guard `LK_CHECK_NEVER_SUBMITS_VIOLATION`); supervised first fire. RINSE
(#26) + no-drift (#27). DB law: RULEBOOK §1.6. Prod Supabase
`eamoozfhqolshdztbrez` (verify by ID, never name); Colony
`e594fc3a-17b7-45d0-9dde-943ebbfa5391`; `samkado@gmail.com` = MILO
credential, NOT app login. vitest runs on Tony's Mac only (sandbox can't).
**Bars: API 694/0 · scanner 85/0 · stress HIGH-WRONG 0.0% · family audit
all-zeros. Re-run both audits after any resolver/family change.**
