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

## The Integrity Doctrine (the bar)

**See [INTEGRITY-DOCTRINE.md](INTEGRITY-DOCTRINE.md) — the permanent
standard Tony set 2026-06-06:**

> **"No leaks, no breaks, no nothing. Bugs can't survive."**

This isn't a vibe — it's 12 named operational disciplines that govern
every code/product decision LK ships. "Perfect" = Predictable +
Trustworthy + Proud-of. The doctrine is the moat. Read the doc.

## Instant feel (the speed bar) — stated 2026-06-07

> **"Everything must feel INSTANT. Once you click a button, once you
> enter a new page / a new tab, everything is instant. Once you
> validate, once you submit, everything is instant. That's the goal."**

Perceived latency is a bug class under the Integrity Doctrine. Status:

- ✅ **Instant tab switches** (2026-06-07) — added a zero-dependency
  stale-while-revalidate cache (`apps/scanner/src/lib/swr.ts`). Catalog,
  Orders, Templates, Smart Cards, and price-book status now paint cached
  data instantly on reopen and refresh in the background. No more blank →
  spinner on every tab switch.
- ✅ **Sync auth token** (2026-06-07) — JWT read from an in-memory session
  mirror instead of awaiting `getSession()` before every API call.
- ✅ **Code-split the bundle** (2026-06-07) — the 7 non-home pages + the
  Assistant/Analytics overlays are now lazy-loaded into their own small
  chunks (Browse 15KB, Templates 10KB, etc.), prefetched on idle so first
  taps stay instant. ZXing was already its own dynamic chunk. Home bundle
  shrank; other screens no longer block first paint.
- ⏳ **Backend speed** — API in Fly ORD, DB in us-east-1; parallelize the
  sequential queries in `/browse` and `/home/smart-cards`, confirm indexes.
- 💡 Co-locate API + DB region (bigger move, later).

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

- ✅ **Pre-submit verification modal** (discipline #3 in action). Tap
  Submit → full line-by-line summary: store name, license #, every
  bottle with name + size + qty + unit price + line total, MLCC's
  authoritative subtotal/tax/total, "this can't be unsent" warning,
  Cancel / Confirm buttons. **No opt-out, ever.** Kills integrity
  surfaces #1 (UPC mapping), #4 (phantom cart), #5 (vision picker).
  (#89, 2026-06-07)
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

**🔥 Active queue (from 2026-06-07 design feedback after tab bar shipped):**

- ✅ **Premium-feel pass #1: emoji icons → inline SVG.** Tab bar,
  More page rows, Templates trash + empty state, Scan cart icon, Sign
  out all use stroke-based currentColor SVG. New `Icons.tsx` is the
  canonical source. (#91, 2026-06-07)
- ✅ **AI Assistant promoted — hero card on Scan + top of More.**
  Purple gradient hero card with Sparkles icon, eyebrow + headline,
  Tap = opens existing assistant overlay. Same hero treatment at the
  top of the More page. The moat is now front and center. (#92,
  2026-06-07)
- ✅ **Scan page camera resized.** Aspect ratio 5:6 (was 4:3),
  max-height 62vh (was 52vh). Camera fills the screen, dead zone
  below shrinks. (#93, 2026-06-07)
- ⏳ **Templates: edit items inside a template.** Currently edit only
  changes name + schedule. Need to add/remove bottles, adjust qty
  per-line. Effectively make the template editable like a cart.
- ⏳ **Search → continuous dropdown of bottles.** When user types in
  the scan-page search bar, show a scrollable result list with "Load
  more" at bottom. Amazon-style typeahead.
- ⏳ **AI Assistant broader scope.** Currently the prompt is store-
  centric. Tony wants it to answer ANY liquor question (general
  knowledge, pairing, history, regulations across states, brand
  trivia) AND anything store-specific (orders, inventory, MLCC).
  Backend prompt + tool-use update.
- ⏳ **AI Assistant accepts images.** Send the assistant a photo for
  deeper conversation about what's in the picture. Vision API wiring.
- ⏳ **AI Assistant becomes a real page route.** Currently overlay; long
  term should be its own destination, not a modal. Then the AI tab
  highlights properly when active.
- ⏳ **Real product photos for all 13,000+ bottles in catalog.** No
  more placeholder bottle silhouettes. Strategy options: Google
  Custom Search Image API (~$65 for full catalog), distributor
  website scraping, manual curation via /admin/images, or a
  combination. NEEDS STRATEGY DECISION before execution.

**Earlier items (still active):**

- ✅ **Edit MLCC credentials post-signup.** Settings page + inline
  "Update MLCC credentials" button inside the activation failure
  modal. PATCH /auth/me/mlcc-credentials re-encrypts with AES-256-GCM
  and stamps mlcc_credentials_updated_at. (#86, 2026-06-06)
- ✅ **ToS + Privacy policy pages.** Plain-English drafts tailored to
  LK + Michigan MLCC context. Served at /terms and /privacy with
  brand-matching styling. Footer links on landing page. **Get a
  lawyer to review before broad public launch.** (#87, 2026-06-06)
- ⏳ **Custom domain liquorkings.com** pointed at Fly. **Step-by-step
  runbook at [docs/lk/runbooks/CUSTOM-DOMAIN-LIQUORKINGS.md](runbooks/CUSTOM-DOMAIN-LIQUORKINGS.md).**
  Mostly DNS work — needs Tony to register/own the domain. ~5–15 min
  hands-on, then cert provisioning runs in background.
- ✅ **Persistent activation state.** Any successful RPA run now stamps
  `stores.mlcc_credentials_last_verified_at`. Backfilled for existing
  stores with prior orders (dad's, mine). Scanner home shows a soft
  amber "Verify your MLCC connection" banner when null — one-tap
  probe via `cart_reset_only` clears it. Survives refresh, device
  switch, account-skip-of-activation. (#88, 2026-06-06)
- ⏳ **Real Sentry DSN setup** (replace placeholder).
- ⏳ **cron-job.org setup** for daily price-book freshness ping.

### Future / V2 / post-launch
- 💡 **Inventory management.** Par levels, on-hand quantity, reorder
  points, low-stock alerts. Tony confirmed 2026-06-07 this is the
  NEXT real feature after the tab bar redesign. Promotes to its own
  bottom tab once built.
- 💡 **Quantity anomaly detection.** Warn the user before submit if
  any SKU quantity exceeds 3x the store's historical average. Cheap
  to build, doctrine-compliant trust-builder. Surfaced inside the
  pre-submit verification modal.
- 💡 **First-order pre-flight checklist.** For brand-new signups,
  one-time guided walkthrough before their first real MLCC order:
  "verify creds connected ✓, verify product mapping ✓, dry-run
  validate ✓, confirm store name ✓, then submit." Onboarding polish.
- 💡 **Per-store reporting expansion.** Order velocity, ADA spending
  breakdown, seasonal patterns, biggest-mover trends. Founder Console
  has this for Tony's view; customer-facing per-store version is its
  own feature for the dashboard tab.
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
