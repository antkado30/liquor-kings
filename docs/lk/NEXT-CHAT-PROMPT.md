# Next-Chat Bootstrapping Prompt for Liquor Kings

> **Tony — paste the block below into your new chat as your first message.**
> It tells the new Claude exactly where things are, what's broken,
> what's queued, and how you like to work. Everything load-bearing is
> in persistent files; this prompt just makes sure the new chat reads
> them in the right order.

---

## COPY-PASTE THIS BLOCK 👇

```
We're picking up Liquor Kings — multi-tenant SaaS for Michigan liquor
stores that places MLCC orders via Playwright RPA. I'm Tony, the 19yo
solo founder. You and I have been building this for months. The last
chat (Opus 4.7) hit its context limit so I'm switching to a fresh
session.

BEFORE YOU RESPOND TO ANYTHING, read these files in this order:

1. The memory index: ~/Library/Application Support/Claude/local-agent-mode-sessions/.../memory/MEMORY.md
   (this should auto-load — it lists everything else)

2. /Users/tonecapone/dev/liquor-kings/docs/lk/TONY-WANTS.md
   Permanent list of what I want. Has ✅ shipped / ⏳ in-progress /
   💡 future. Update this any time I state a new want.

3. /Users/tonecapone/dev/liquor-kings/docs/lk/INTEGRITY-DOCTRINE.md
   The 12 disciplines. "Bugs can't survive" is the standard. This
   governs every code/product decision.

4. The latest entry in project_journal.md (memory file)
   The session-by-session log. The TOP entry has "current state of
   things" — read THAT entry first before anything else.

5. /Users/tonecapone/dev/liquor-kings/docs/lk/BLUEPRINT.md
   Vision doc. What LK is, why, where it's going.

THEN read these feedback memories (they govern your behavior):

- feedback_hold_the_roadmap.md (my memory is unreliable — YOU hold the
  roadmap, capture wants immediately, surface next ⏳ proactively)
- feedback_premium_feel.md (no emoji UI ever — inline SVG only;
  Stripe/Linear/Notion is the bar)
- feedback_no_placeholder_commands.md
- feedback_deadline_speed.md
- feedback_fly_deploy_flags.md
- feedback_cursor_briefs.md
- feedback_probe_before_promising.md
- feedback_cron_routes_bypass_auth.md

The repo is at /Users/tonecapone/dev/liquor-kings. Prod is at
liquor-kings.fly.dev. I deploy via `npm run deploy` from my Mac.
Codebase + git history is the source of truth for what currently
ships.

CURRENT TOP CONCERNS (the bug list from last smoke test):

1. PERFORMANCE IS THE #1 ISSUE. Dashboard "Loading your week" hangs
   2+ minutes. Orders page hangs. Templates page hangs. Validate took
   5 minutes when it's supposed to be instant (background pre-validate
   should serve from cache). I want everything INSTANT. This needs
   diagnosis — either backend (slow queries on Fly machine? Supabase
   slow? home/analytics endpoint slow?) or frontend (is the runtime
   storeId resolving correctly? is the pre-validate cache populating?).
   Maybe Fly machine is undersized. Check fly.toml + add measurement.

2. AI Assistant should be its own dedicated page at /assistant, not a
   modal overlay over the scanner. When I tap the AI tab I want a
   full-page chat experience, not the scanner peeking through behind.
   Refactor AssistantPanel from modal → standalone AssistantPage.

3. AI Assistant scope is too narrow. The current prompt is store-only.
   I want it to answer ANY liquor question (general knowledge,
   pairing, history, brand trivia) AND store-specific (orders,
   inventory, MLCC rules, my catalog). Update services/api/src/services/assistant.js
   prompt + tool-use.

4. AI Assistant accepts images. Send a photo of a bottle, AI helps
   identify and discuss it. Vision API wiring. Make sure cost is
   reasonable — if it's too expensive we skip.

5. Validate needs a Cancel button. Once it starts, I should be able
   to bail without waiting 5 minutes.

6. Post-validate cart drawer UI feels crammed and emoji-tacky. Need
   a premium polish pass: more spacing, no emoji on buttons, better
   button hierarchy (Submit is the primary action, others are
   secondary).

7. The "Clear cart" button now opens a confirm modal that says it
   empties both scanner + MILO. That just shipped last commit.
   Verify it works correctly.

8. Real bottle photos for the 13K-item catalog. We agreed on PLAN
   A + C: Google Custom Search Image API for automated lookup (~$65
   one-time) + improve /admin/images for hand-curating top SKUs.
   This is a setup task — needs me to provide an API key.

9. Templates page: edit items inside (add/remove bottles, change qty).
   Currently edit only changes name + schedule.

10. Search → continuous dropdown of bottles with Load More. Amazon-
    style typeahead on the scan page search bar.

11. Inventory tracking — par levels, on-hand qty, reorder alerts.
    Currently a "Coming Soon" badge in More. Should be a real
    feature that promotes to its own bottom tab when shipped.

HOW I WORK:

- High energy when in flow. "Lets keep going baby" mode.
- Take the L when you mess up. Don't deflect with "nobody finished it"
  type framing. That's your job.
- Hold the roadmap for me. My working memory is unreliable. Capture
  every want into TONY-WANTS.md immediately. Surface the next ⏳ item
  proactively when something ships. Never ask me to recall.
- Direct edits over Cursor briefs. You write the code, I run the deploy.
- Tab bar shape is locked: 🏠 Scan · 📚 Catalog · 🛒 Cart · ✨ AI · ☷ More
- No emoji UI icons. Inline SVG. Premium feel always.
- Bugs can't survive. Don't ship features without thinking about edge
  cases, error states, slow networks, empty data.
- Family motivation is real. The end goal is retire my parents this
  summer. We don't have time for shoddy work.

If you've read all the files above, acknowledge briefly (one sentence)
and tell me the FIRST thing you'd do. My guess is performance
diagnosis (open Fly metrics, check Supabase query log, look for
slow endpoints). But take a position.
```

---

## When the new chat starts

The new chat will:
1. Read the persistent files (MEMORY.md auto-loads, then the others
   you've pointed at).
2. Know who you are, what LK is, what's shipped, what's broken.
3. Likely take a position on what to do first (probably the
   performance dig).
4. Be slightly less in tune with your specific vibe for the first
   message or two — that catches up fast.

## What you've already shipped today (2026-06-07)

- 6 features (#84–#94): activation flow, runtime store-id, cred
  recovery, ToS/Privacy, persistent activation, pre-submit modal
- Bottom tab bar redesign (5 tabs)
- Premium SVG icon pass (no emojis)
- AI promotion to hero card + tab swap
- Hide tab bar in modals
- Cart tab fix
- Combined Clear cart button + confirm

That's a real day's work. Don't undersell what got done.
