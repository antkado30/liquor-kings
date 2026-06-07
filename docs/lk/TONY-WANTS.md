# Tony Wants — Permanent Wishlist & Directives

> **What this is:** A permanent, living list of everything Tony has asked
> Liquor Kings to be, do, or become. Updated as things land. Checkmarks
> mean shipped to prod. Read this AT THE START of every session before
> proposing what to work on. Last updated: 2026-06-06.
>
> **Discipline:** When Tony says he wants something — a feature, a vibe,
> a rule — add it here. Never let a stated want fall out of context.

---

## The North Star (the why behind all of it)

- **Retire my parents this summer (summer 2026).** Family-first. The
  family liquor store gets modernized with LK tech, sold by end of
  summer 2026, parents step back. This is non-negotiable motivation.
- **Sell the family store, then scale the SaaS.** LK isn't just a tool
  for dad — it's the proof point + launchpad for a Michigan-wide,
  then national B2B SaaS. Public launch target: **Nov 21, 2026**.
- **Acquisition narrative.** Build LK with eventual acquirers in mind
  (POS companies, distributors, fintech, accounting platforms). The
  BLUEPRINT.md vision doc spells this out.
- **19-year-old founder energy.** Move fast. Don't ask for permission
  on small things. Ship real impactful features, not micro-iterations.

---

## How Tony wants me to work with him (permanent operating rules)

- ✅ **"Keep pushing" mode is default.** Don't ask permission for next
  steps. Ship the next obvious thing. He'll redirect if I'm off.
- ✅ **Real features, not micro-iterations.** "U can do a lot of things
  at one time I believe in u." Batch related work.
- ✅ **Bedrock-then-billing.** Billing is DEAD LAST. Security, RLS,
  reliability come first. He wants "unbreakable" status before charging.
- ✅ **Direct edits over Cursor briefs** when feasible. Briefs only for
  genuinely big multi-file UI work he wants to do himself.
- ✅ **Fastest path first under deadline.** Ship the usable output;
  deep fixes become follow-ups, not blockers.
- ✅ **Never give placeholder commands** he might run literally
  (`<placeholder>` text is a footgun).
- ✅ **Always use `npm run deploy`** or `fly deploy --strategy immediate
  --wait-timeout 600`. Default 120s timeout fails every deploy on this
  810 MB image.
- ✅ **Cron routes register at app level BEFORE the auth-gated mount.**
  Otherwise X-Cron-Token bypasses 401.

---

## Product & vision wants

### Shipped ✅
- ✅ **Phone-first SaaS for Michigan liquor stores** integrating MLCC's
  MILO ordering portal via RPA.
- ✅ **Multi-store sign-up flow.** Landing page → signup form →
  auto-sign-in → activation modal → scanner.
- ✅ **Public landing page** at liquor-kings.fly.dev.
- ✅ **Privacy-conscious placeholders.** No real Colony or other-store
  data in public-facing forms ("Your store name" / "1234567").
- ✅ **$119/month pricing** on the landing page (not $49).
- ✅ **Order time copy: "1.5-to-2-hour MLCC order → 5-to-10 minutes."**
  Not "30 min → 5 min."
- ✅ **Founder Console / Owner view / Data center.** Admin dashboard at
  /admin/founder-console — total stores, signups, MRR, recent runs,
  recent failures, 60s auto-refresh.
- ✅ **RLS bedrock confirmed.** 11/11 attack vectors blocked, real
  recursion bug found and patched.
- ✅ **Onboarding activation flow.** New signups verify MLCC creds via
  real RPA probe before touching the scanner.
- ✅ **Runtime store-id resolution.** Scanner correctly identifies the
  signed-in user's store at runtime (no more "Not a member of
  specified store" for new signups).
- ✅ **AI Assistant.** Data-grounded answers using actual store data —
  the defensible moat.
- ✅ **Universal tag printing.** Web Share API bypasses Brother QL-810W
  / iOS AirPrint die-cut-only limitation.
- ✅ **Dad's analytics dashboard.** Spend, biggest movers, top SKUs.
- ✅ **Order Templates.** Save + recall recurring carts. Auto-prepare
  on schedule (e.g. dad's Thursday weekly order).
- ✅ **Scanner Validate → Submit two-step.** Real cart state from MILO
  before checkout, never silent failures.
- ✅ **Vision document at docs/lk/BLUEPRINT.md.** The canonical "what
  LK is, why, who built it, where it's going, acquisition narrative"
  professional behind-the-scenes doc.
- ✅ **Saxon Inc reclassified.** Label company, not a software
  competitor — potential partner.

### In progress / next up
- ⏳ **Edit MLCC credentials post-signup.** If activation fails because
  of a wrong MLCC password, user is currently stuck. Need settings
  page or inline retry-with-new-creds UI. **This is the next priority.**
- ⏳ **ToS + Privacy policy pages.** V1 launch-blocker. Generic
  templates or hand-rolled for LK.
- ⏳ **Custom domain liquorkings.com** pointed at Fly.
- ⏳ **Persistent activation state** (`stores.mlcc_credentials_last_verified_at`)
  so refresh-mid-activation doesn't drop user into a broken state.
- ⏳ **Real Sentry DSN setup** (replace placeholder).
- ⏳ **cron-job.org setup** for daily price-book freshness ping.

### Future / V2 / post-launch
- 💡 **POS register integrations.** Tony explicitly called this out as
  a future direction.
- 💡 **Prepare the acquisition narrative.** Who could buy LK, why they
  would, what they'd want to see in due diligence. Already in
  BLUEPRINT.md but stays a live consideration.
- 💡 **Scale to other states** beyond Michigan after MI proves the
  model.
- 💡 **Multi-staff teammate visibility** (currently RLS is own-row only
  for V1 single-owner stores).
- 💡 **Store-chooser UI** for users belonging to multiple stores
  (V1 picks first active membership).

---

## Hard preferences / never-forget vibes

- ✅ **Dark UI.** Premium feel. No bright/light themes by default.
- ✅ **Mobile-first.** Dad uses an iPhone in the store. iOS Safari
  is the primary target.
- ✅ **No real customer data in public spaces.** Generic placeholders
  always.
- ✅ **Billing comes AFTER unbreakable.** Stripe is the last thing,
  not the first.
- ✅ **Saxon is a partner candidate**, not a competitor. They make
  labels; we make ordering software.
- ✅ **The data-grounded AI assistant is the moat.** Don't make it
  generic ChatGPT — make it know YOUR store's data.

---

## How this file gets updated

- When Tony states a new "want" — feature, rule, vibe — add it to the
  appropriate section.
- When a wanted thing ships to prod, mark it ✅ and move to "Shipped."
- When a "want" is invalidated or changes, update it in place (don't
  silently delete; cross out and note why if it's a notable reversal).
- This file is permanent and version-controlled. The journal in memory
  references it. Both should stay in sync.
