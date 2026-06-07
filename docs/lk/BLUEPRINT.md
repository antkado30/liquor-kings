# Liquor Kings — The Blueprint

> The professional behind-the-scenes document. What Liquor Kings is, what it
> does, why it exists, who built it, where it's going, and why any company in
> the alcohol-retail-tech adjacency should eventually want to buy it.
>
> **Audience:** future hires, investors, potential acquirers, partners, and
> future Tony catching up after time away. Read top-to-bottom and you have the
> full picture.

---

## 1. The Vision (one paragraph)

**Liquor Kings makes running a state-regulated liquor retail business
something a normal person can do from their phone.** State liquor portals
(MLCC in Michigan, similar agencies in 17 other monopoly states) were built
in the early 2000s for clerks at desktops. Modern store owners are running
70-hour weeks, often with English as a second language, and the existing
tooling actively works against them — clunky validators, opaque error
messages, no order history, no analytics, no automation. A weekly MLCC
order on the state portal eats **1.5 to 2 hours** of an owner's time;
with Liquor Kings + a saved template it's **5 to 10 minutes**. We replace
that entire surface with a phone-first product: scan a bottle, validate
live against the state, submit, see what's selling. The MLCC integration
is the beachhead; the long game is becoming the operating system for
independent liquor retail.

---

## 2. The Product (today, June 2026)

### What it is

Liquor Kings is a **mobile-first SaaS** that sits between an independent
liquor store and the state ordering portal (MLCC in Michigan). Built as a
PWA so it installs on iOS/Android without an App Store review cycle, with a
React frontend, Node.js + Express backend, Supabase (Postgres + Auth) for
data, and Playwright-powered RPA on Fly.io that drives the state portal in
the background.

### Four Pillars (V1 scope)

1. **Pillar 1 — RPA Ordering.** Replace the state portal entirely. User
   scans bottles or loads a template. We log into the state's MILO system
   (or equivalent) via persistent Playwright sessions, add items, validate,
   surface real-time out-of-stock detection, and submit on user confirm.
   30-minute MLCC orders compressed to 5 minutes.
2. **Pillar 2 — Scanner.** Phone camera + UPC barcode reading + AI vision
   fallback for damaged labels. Identifies 13,800+ MLCC SKUs in milliseconds.
   Trigram fuzzy matching for partial scans.
3. **Pillar 3 — Tag Printing.** Direct integration with Brother QL-810W
   shelf-tag printer. Scan a bottle → print a clean tag with current state
   price, barcode, and date. Universal: works with die-cut OR continuous
   tape via Web Share API to any installed printer app.
4. **Pillar 4 — AI Assistant.** Anthropic-backed chat that answers MLCC
   compliance questions ("can I order 8 of a 750ml?"), state rules
   ("what's the 9 liter rule?"), and pulls real data from the user's own
   order history. Context-aware suggestions based on cart state, time of
   day, and recent activity.

### Beyond the pillars (shipped during the June '26 sprint)

- **Browse** — Amazon-style catalog of all state SKUs with filters
  (category, distributor, size, price, proof).
- **Order Templates** — save recurring carts. "Thursday order" reloads
  next week with one tap.
- **Scheduled Templates** — daily cron marks templates "ready to review"
  on their scheduled day-of-week. Banner appears on user's home.
- **Smart Cards** — price-change notices, reorder suggestions based on
  day-of-week history, stale-price-book nudges.
- **Real-time Analytics** — this week's spend, top SKUs by units and
  dollars, biggest movers vs trailing 4-week average, ADA distributor
  breakdown.
- **Order History** — persistent record of every confirmation number,
  gross total, delivery date scraped from MILO and stored in Supabase.
- **Persistent Sessions** — RPA keeps a warm MILO browser session alive
  across requests. Validate cycles 2 minutes → 45 seconds.
- **Per-Store Multi-Tenancy** — RLS, encrypted MLCC credentials per store,
  store_users → auth.users mapping. Real SaaS data isolation.
- **Self-Serve Sign-Up** — any MI liquor store owner can sign themselves
  up in 2 minutes without ops touching anything.

---

## 3. The Problem We're Solving

### For whom

- **Primary user:** independent liquor store owner in a state with a
  monopoly ABC (Michigan, Pennsylvania, Virginia, Utah, etc.). 
  3,800+ such stores in Michigan alone.
- **Daily user:** often a family member or long-tenure clerk. Runs the
  weekly state order, sets shelf prices, manages inventory.
- **Pain profile:** state portal is the worst part of their week.
  Built for clerks at desktops in 2005. No mobile UI, no order history
  view, no error explanations, no automation. They're losing 5-10
  hours a week to bad tooling.

### The competitive landscape

- **State portals themselves (MILO, etc.):** technically free, but cost
  the user 5-10 hr/week. We're the workaround.
- **Saxon Inc. (reclassified 2026-06-06):** NOT a real software competitor.
  They're a 40-year **label manufacturing company** (beer/wine/RFID/specialty
  pressure-sensitive labels). Their "Liquor Orderer" page is a customer
  acquisition funnel for their label business — a free-or-cheap tool to
  pull liquor stores into their label sales pipeline. They have ZERO
  incentive to compete on product because labels are their cash cow. We
  win on focus. **Potential partner:** their label printing service is
  way better than Brother QL output; LK could integrate with Saxon for
  premium tag printing as an upsell.
- **CoreVue:** $249/mo. Modern UI but still desktop-anchored. Limited
  Michigan presence.
- **Yaldo POS:** iPad register system, expanding into ordering. Closest
  product overlap but they're a POS company first, ordering second.
- **The unfilled wedge:** nobody serves the "phone-first, scan-driven,
  MLCC-integrated, AI-powered" segment. That's our moat.

### Why a phone-first product wins

Store owners don't sit at desktops anymore. They're on the floor stocking,
behind the counter ringing customers, in the back unpacking deliveries.
The phone is always with them; the desktop is in the office they visit
once a day. Every existing competitor solves the wrong form factor.

---

## 4. Who Built This

**Tony Kado.** 19-year-old founder, son of immigrant liquor-store owners
in Michigan. Started writing Liquor Kings in spring 2026 after watching
his dad spend Thursday afternoons fighting MILO instead of running his
business. Family motivation: retire his parents on the back of LK by
summer 2026 by selling the family store at a modernization premium, then
scale LK as a SaaS to other MI stores, then to the broader monopoly-state
market.

Self-taught. Built every pillar himself with Claude as pair-programming
partner. Closed real-money $200 life-insurance sales the same week he
shipped four V1 tasks. Made the conscious choice to ship product over
chasing seed funding — the bet is that real users and real revenue
beat pitch decks.

Day 4 post-wisdom-teeth surgery he shipped the multi-store sign-up flow.
That's the energy.

---

## 5. Technical Architecture

### Stack

- **Frontend (scanner):** React 18 + Vite + TypeScript, served from
  Express. PWA via Web App Manifest + Cache-Control headers. Runs on iOS
  Safari (primary), Android Chrome (secondary), any modern browser.
- **Frontend (admin):** React 18 + Vite + TypeScript. Internal operator
  tooling (NRS review queue, image curation, diagnostics).
- **Backend:** Node.js 22 + Express 5 + Supabase JS SDK. Single API
  process on Fly.io, with a separate worker process for RPA execution.
- **Database:** Supabase (Postgres + Auth + RLS). Production project
  `eamoozfhqolshdztbrez`.
- **RPA:** Playwright + Chromium driving https://www.lara.michigan.gov/milo.
  Persistent session manager keeps warm sessions across requests.
- **Hosting:** Fly.io (single app, two processes — `app` + `worker`).
  Rolling deploys, ~5s downtime per release.
- **Email/comms:** none yet (Supabase Auth email service is the only
  outbound channel right now).
- **Payments:** not yet wired (Stripe is the planned target).
- **External APIs:** Anthropic Claude (assistant + vision), bwip-js
  (barcode rendering), PDFKit (tag PDFs).

### Architecture diagram (text)

```
                                 ┌──────────────────────┐
                                 │   cron-job.org       │
                                 │   (daily 5am ET)     │
                                 └──────────┬───────────┘
                                            │ POST + X-Cron-Token
                                            ▼
┌──────────────┐   HTTPS    ┌──────────────────────────────────┐
│  iOS scanner ├────────────┤   Fly.io app process (API)        │
│  PWA         │            │   - Express, Supabase client      │
└──────────────┘            │   - Auth via Supabase JWT          │
                            │   - Per-store data isolation       │
                            │   - PDF tag rendering              │
                            └──────────┬──────────┬─────────────┘
                                       │          │
                                       ▼          ▼
                          ┌────────────────┐  ┌──────────────────┐
                          │   Supabase      │  │   Anthropic       │
                          │   (Postgres,    │  │   (Claude         │
                          │   Auth, RLS)    │  │   assistant +     │
                          └────────┬───────┘  │   vision)         │
                                   │           └──────────────────┘
                                   │ poll queue
                                   ▼
                          ┌────────────────────────────────┐
                          │  Fly.io worker process (RPA)   │
                          │  - Persistent Playwright       │
                          │  - Chromium driving MILO       │
                          │  - validate_only / rpa_run /    │
                          │    cart_reset_only run types    │
                          └──────────┬─────────────────────┘
                                     │ HTTPS
                                     ▼
                          ┌────────────────────────────────┐
                          │  lara.michigan.gov/milo        │
                          │  (the actual MLCC portal)       │
                          └────────────────────────────────┘
```

### Key technical decisions

- **PWA over native app.** Distribution speed matters more than
  feature parity. iOS PWAs ship in hours, not weeks. App Store review
  cycle would have killed iteration speed.
- **Express SPA serving over CDN.** One Fly.io process serves both the
  React scanner and the API. Simpler ops, fewer moving parts.
- **Persistent RPA sessions.** Cold MILO logins take 30-50s. Warm
  reuse cuts validate-to-result to 15s.
- **Triple-gated submission.** Submit is gated by (1) per-store
  `allow_order_submission` flag in DB, (2) `LK_ALLOW_ORDER_SUBMISSION`
  env at the worker, (3) run metadata mode. All three must align or
  the run silently downgrades to dry-run. Engineered for the
  founder-fear case: "what if my code accidentally places a real $5k
  order on a stranger's account."
- **Scrape, never simulate.** Stage 5 (submit verification) reads
  MILO's actual order-history page to confirm orders landed. No
  trust in optimistic UI signals.

### Data model (high level)

- `auth.users` (Supabase Auth) — every store owner + staff member
- `stores` — store metadata + encrypted MLCC credentials
- `store_users` — many-to-many link, with role + is_active
- `bottles` — per-store inventory snapshot (what's on the shelf)
- `mlcc_items` — full state catalog (13,828 rows for MI)
- `upc_mappings` — UPC ↔ MLCC code (NRS imports + scanner confirmations)
- `carts` + `cart_items` — pre-submission cart state
- `execution_runs` — every validate / submit / cart-reset RPA run
- `milo_order_confirmations` — persisted post-submit results
- `order_templates` — saved recurring carts + scheduling
- `mlcc_price_book_runs` — daily price-book ingestion log
- `nrs_ambiguous_review` — operator triage queue for low-confidence UPCs

---

## 6. Roadmap

### V1 (target launch Nov 21, 2026)

Status: **80% shipped.** What's done:
- All four pillars
- Self-serve sign-up
- Landing page
- Per-store multi-tenancy
- Order templates + scheduling
- Real-time analytics

What's left:
- Stripe billing + trial enforcement
- RLS audit before public launch
- Real Sentry error tracking
- cron-job.org automation
- A real marketing site domain (currently `liquor-kings.fly.dev`)
- A real email address (not `tony@liquor-kings.com` placeholder)
- Pricing model validation with the first 10 customers

### V2 (2027)

- **POS register integrations.** Yaldo (iPad), Square, Clover, Toast.
  Two-way sync: LK pushes inventory updates, POS pushes daily sales.
  Closes the loop: "what we ordered" ↔ "what we sold" → automated
  reorder suggestions powered by real velocity.
- **Multi-state expansion.** PA, VA, UT, NC, AL, NH — every other
  ABC-controlled state. Each requires a new RPA implementation against
  that state's portal. The framework is portable.
- **Customer-facing storefront.** Optional per-store consumer site for
  online sales (DoorDash/Drizly-style delivery, BOPIS pickup). Uses
  the same catalog + pricing we already have.
- **Inventory management.** Real shelf-level inventory tracking with
  scanner-based stocktakes. Replaces the spreadsheet stores use today.
- **Daily auto-orders.** Cron submits the user's standing template if
  it passes pre-validation. User reviews via push notification before
  the cutoff window expires.

### V3 (2028+)

- **The operating system layer.** When LK touches ordering, inventory,
  shelf pricing, POS, customer storefront, and analytics — we ARE the
  store's operating system. Per-store customizations become a moat.
- **Distributor partnerships.** NWS Michigan, General Wine & Liquor,
  Imperial Beverage. Direct API connections instead of scraping MILO.
  Distributors pay us for catalog data + real-time demand signals.
- **AI-powered shelf optimization.** Use the order data + sales data
  to recommend shelf layout, pricing adjustments, SKU mix changes.
  Brand reps would pay to know "what's underrepresented in MI
  independent stores."
- **B2B marketplace.** LK becomes a discovery channel between brands
  and independent retailers. Brand pays for placement; store gets
  exclusive pricing.

---

## 7. The Acquisition Narrative

This product, in its V2 form, is acquisition-relevant to several
adjacencies. None of them are buying us today — they'll be buying us
in 2027-2028 once we have 200-500 stores on the platform.

### Who would want this and why

**1. POS companies (Square, Toast, Clover, Lightspeed, Yaldo).** They
already own the register. They don't own the state-portal ordering. LK
is the integration bridge between their POS and the state. Acquiring LK
gives them a defensible reason to be the POS of choice for liquor
retail in monopoly states. Bolt-on logic: 17 states × 500 stores per
state × $50/mo recurring = $5.1M ARR before they add their own product.

**2. Beverage distributor SaaS (SPS Commerce, GreatVines, Encompass).**
They sell software up the chain (distributor → retailer). LK closes
the loop downstream. Acquiring LK gives them a direct retailer
relationship and consumption telemetry. The catalog data alone is worth
tens of millions in clean training data for forecasting.

**3. Drizly's successor / DoorDash alcohol vertical.** Direct-to-consumer
alcohol delivery requires a store catalog + inventory. LK provides both
already + the integration to keep them current. An acquisition makes
DoorDash's MI alcohol business 10× cheaper to operate.

**4. Anheuser-Busch InBev / Constellation / Diageo's own commerce arms.**
Distributors and brand owners would pay for first-party demand signal.
A store-owner SaaS that includes weekly order data across hundreds of
independent retailers is uniquely valuable.

**5. Major bank's small-business tech arm (Chase, Wells, BofA, Square).**
The merchant-services + lending angle. Once we touch revenue + inventory,
we know which stores are healthy, which are growing, which can borrow.
That's a credit-decisioning gold mine.

**6. Vertical SaaS rollups (Constellation Software, Vista's portfolio).**
LK in 5 monopoly states with 1,000+ stores = a $5-10M ARR rollup
candidate. Strategic patience pays here.

### What makes LK acquirable rather than copyable

- **The MILO RPA layer is 18 months of edge-case hardening.** Stage
  3 OOS detection, validate timing, cart-reset semantics, Stage 5
  scrape vs simulate, persistent session management — none of this
  is documented anywhere. Every other state has a similar but
  different portal. We have the only working integration that scales.
- **Trust at the credential layer.** Encrypted MLCC credentials with
  a real key rotation story. Other founders won't credibly enter this
  market because store owners won't give credentials to a stranger.
  Tony's family is in the business — that's the trust unlock.
- **Catalog quality.** 13,828 MI SKUs with UPC mappings, brand
  hierarchy, ADA breakdown, ordering-rule metadata. Building this
  from scratch costs $50k+ of operator time. We did it via the NRS
  ambiguous-review queue + an operator-grade admin tooling.
- **Velocity.** 79 shipped tasks across 4 months from one self-taught
  19-year-old. The replication cost for a competitor is high not just
  because of code volume but because of the design judgment baked in.

---

## 8. The Long Bet

In 2028 there are 17 monopoly states, ~25,000 independent liquor stores
across them, an average of $50/month recurring per store. That's $15M
ARR at 100% adoption. Realistic at 30% capture: $4.5M ARR. At a 10×
multiple (vertical SaaS standard): $45M acquisition value.

That's the floor. Real upside is the operating system layer — POS
integrations, B2B marketplace, distributor revenue share, lending. At
that point the comps aren't vertical SaaS, they're Toast ($24B market
cap) and Shopify-for-a-niche.

Whether LK exits to one of the above or stays independent and
profitable — that's a decision for 2028 Tony to make. The 2026 work
is to be in a position where the decision is his to make.

---

## 9. Defensibility (the "why us")

Six layers, in order of how hard they are to copy:

1. **The MILO RPA itself** (~18 months of edge cases). Code is open
   for inspection but each state needs its own. Each state's portal
   changes quarterly.
2. **Trust + credentials.** Store owners gave us their MLCC creds
   because Tony's family is in the business. No outside founder has
   that.
3. **Catalog + UPC mapping data.** Built over 2,000+ operator triage
   hours via the NRS review queue.
4. **The phone-first product instinct.** Most competitors will keep
   building for desktops because their teams come from a desktop era.
5. **Velocity of iteration.** When we ship 8 V1 tasks in a single
   day, the competition can't match it. Speed compounds.
6. **Verified multi-tenant data isolation.** Most SaaS startups
   "have RLS" — we have an automated verifier
   (`services/api/scripts/rls-verification.mjs`) that creates two
   ephemeral stores + users on every run and proves no cross-store
   leak across 11 distinct attack vectors. First prod run found a
   real RLS recursion bug masked by service-role bypass; fix shipped
   2026-06-06 (migration `20260606220000_fix_store_users_rls_recursion`).
   Re-runnable in 8 seconds, so every future schema change can be
   re-verified before deploy. Insurance lawyers + acquirer
   diligence will both ask for this; we have the receipt.

---

## 10. The Origin Story (for the press kit later)

In April 2026, Tony Kado watched his father — a Michigan liquor-store
owner for 23 years — spend a Thursday afternoon retyping bottle codes
into MILO. The state's online ordering portal had silently rejected
two items, hidden the error in a yellow banner, and recommended he
"contact your distributor representative." His dad's English isn't
strong enough to fight with state portals. His dad's been losing 4-5
hours a week to this every week for two decades.

Tony started Liquor Kings that night. The first version was a
spreadsheet plus a Playwright script run from his bedroom. By
May he had a working product. By June he had his dad's entire
weekly Thursday order — $5,462.80 across two distributors —
submitted through Liquor Kings for the first time.

The next morning his dad asked "why didn't anyone make this 10 years
ago?" Tony's answer: "because the people who could build it didn't
work behind the counter."

---

## 11. Living Document Discipline

This blueprint should be updated:
- Every quarter (minimum) with current state of pillars + roadmap
- Whenever a major architecture decision changes (RPA migration, etc.)
- Whenever the acquisition narrative changes (new entrant, new exit
  comp, etc.)
- Whenever the team grows (add team section)

Keep it honest. If a pillar is degraded or behind, say so. If a market
assumption fails, document the new one. The value of this document is
proportional to how brutally accurate it stays.

**Last updated:** 2026-06-06 (Saturday afternoon session)
**Status of V1:** ~80% shipped, on track for Nov 21, 2026 public launch.
