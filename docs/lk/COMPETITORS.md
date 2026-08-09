# LK COMPETITIVE FIELD — permanent intel + battle doctrine

Born 2026-08-07 from Tony's standing order (verbatim): "we need to be
strong where they are weak and mediocre... we have to excel in every
single aspect... always going to be getting better always. and we
have to especially beat every competitor in each of their
strongsuits. save all of this down permanently, we need to
strategize."

**THE ALWAYS-BETTER LAW.** This doc is living intel. Every new
sighting gets recorded here. Re-sweep every competitor's site
quarterly (board #42). We match every strongsuit, then beat it; we
attack every weakness with something they can't copy fast.

Facts below are marked: **CLAIM** = their marketing's words.
**SEEN** = visible in captured screenshots. **UNKNOWN** = needs
recon. Marketing claims are not verified product behavior.

---

## 1. THE FIELD

1. **The status quo** (biggest competitor): owner types orders into
   MILO by hand at 11pm. Free, familiar, error-prone. Most Michigan
   stores live here today.
2. **Saxon Inc / "Liquor Orderer"™** (saxoninc.com, Ferndale MI) —
   #1 known player. FULL DOSSIER below (swept 2026-08-09): a 40-year
   label-PRINTING company whose ordering app is a side product tied
   to a paper-tag subscription.
3. **CoreVue** (corevue.com) — #2, discovered 2026-08-07. Full
   dossier below. Established, polished, Michigan-aware.
4. **"Michigan Liquor Orderer"** (iOS, free, dev Mathew Yaldo) —
   indie app: OCR shelf-tag scan → order list. 2 ratings, 3.0★.
   **UPGRADED THREAT-WATCH 8/9: Tony reports it "just got a huge
   update" — he USED it before LK and still has it installed.
   Standing recon asset: Tony can screenshot anything on demand.**
   A store kid is building; the idea is in the air; speed matters.
5. **"minimum."** (mobile app, v2.2.1, SEEN 8/9 — Tony's
   screenshots): consumer-grade MLCC minimum-shelf-price catalog.
   Dark polished UI, 11,337 Michigan listings, search, per-size
   price chips (7 Tito's sizes), Favorites, About page showing
   price book Aug 2 / published Aug 9 and michigan.gov LARA as
   source — someone ELSE automates the same price-book ingest we
   do, with a 7-day publish lag (we ingest day-of). No ordering, no
   store accounts, "basic features only" (Tony). NOT a direct
   competitor — but proof the niche is attracting builders and the
   UI bar is rising. Watch quarterly.
6. Generic back-office/inventory SaaS (not Michigan-native) — noise
   for now.

Nobody in the field claims official MLCC recognition. First mover to
get it wins a trust moat nobody can market around. Our outreach
letter is in flight — that lane matters double now.

## 2. COREVUE DOSSIER (captured 2026-08-07, 20 site screenshots)

Source pages seen: `/lara-ordering-for-michigan-c-stores-and-gas-
stations`, `/plans` (pricing), FAQ, Security, and Services feature
pages. Tony has more screenshots beyond the 20-image chat limit —
intake continues.

### Identity & positioning

- **CLAIM (their FAQ, verbatim):** "CoreVue is an all-in-one
  back-office platform built for convenience stores and gas
  stations, combining live sales, inventory, pricing and compliance
  into a single cloud-based system."
- Liquor stores are not in that sentence. Their LARA page headline
  targets "Michigan Gas Stations and Convenience Stores." Fuel is a
  flagship module. **Their DNA is the gas station; alcohol is a
  compliance chore they handle. LK's DNA is the liquor store; the
  order IS the product.**
- Ideal customer, CLAIM: "Owner-operators and small chains running
  1–20 locations that need enterprise-grade tools without the
  complexity."

### Pricing (SEEN, /plans)

- "One platform. Every store. One simple price."
- **$249/site/month** monthly, or **$2,490/site/year** annual (two
  months free). All features included, "No feature gating or hidden
  fees," free updates, free trial included, cancel anytime,
  month-to-month or annual — no long-term contracts.
- 14-day free trial, "Create Your Free Account" self-serve signup.
- Read: transparent flat pricing is table stakes in this market —
  matches the flat-monthly decision Tony already made. $249/mo is
  real money for a single party store; there is room under their
  umbrella, and room to out-VALUE at parity price.

### Feature set (CLAIM unless noted)

- **LARA/MLCC pricebook automation**: "automatic LARA pricebook
  imports, product change detection, product assignment and
  management, flexible pricing source selection, automated price
  adjustments (e.g., state tax rules), zone-level pricing
  overrides." Also "Real-time MLCC Price book Updates... Complete
  Audit Trails" of price changes.
- **LARA order submission**: "Direct LARA Integration: Seamlessly
  submit orders directly into the LOO system from within CoreVue."
  Order creation, tracking, history, mobile access. "Skip the
  outdated LARA portal."
- **Automated order generation from sales**: "Generate precise
  orders based on your historical sales data" + seasonal/promo
  adjustments. (Powered by their POS integration.)
- **Mobile app** (SEEN app screenshots): per-vendor "Lara Orders"
  with ADA numbers, license numbers, statuses Open/Closed, per-order
  totals, **Out Of Stock counts per order**, PLU/UPC scan box,
  per-line Cost / Retail / Min. Shelf / Total, QoH (quantity on
  hand). Inventory reconciliation, PO generation, invoice scanning.
- **AI invoice recognition**: "processes invoices in under 30
  seconds on average — what used to take 20–30 minutes manually."
- **POS integrations**: "imports sales and item data from Verifone®
  and Gilbarco® Passport POS out of the box, with additional
  integrations on our roadmap." Custom POS = "happy to discuss."
- **Fuel**: real-time tank levels from Gilbarco TLS-350/450 gauges,
  fuel pricing control, blend support.
- **Label printing**: "Design label templates visually in desktop
  and print them instantly using mobile or Bluetooth printers via
  mobile app. No technical setup, no rigid formats." Visual label
  designer, mobile printing support, **"Zebra printer
  compatibility"**, customizable templates.
- **Michigan bottle-deposit tracking**: SKUs with deposits rolled
  into shift/day/month-end reports (Michigan Bottle Deposit Law).
- **Multi-store central price book**: "update a product once and
  CoreVue syncs the new price or promo to every designated store in
  seconds."
- **QuickBooks Online export**: daily books, account transactions.
- **EDI imports.**
- FAQ list of what comes standard: "Multi-store price book, AI
  invoice recognition, POS integration, fuel-level monitoring, EDI
  imports, shelf-label printing, and QuickBooks® export are all
  included."

### Security (CLAIM)

- Hosted on Microsoft Azure; leans entirely on **Azure's** ISO 27001
  / SOC 2 certifications. "Data stays encrypted in transit and at
  rest... with additional custom encryption layers" (unspecified).
  MFA + role-based access control. Mobile app "follows the same
  security protocols."
- **What's absent**: no CoreVue-own audit/cert claimed, and — the
  big one — **no story anywhere about how they store the store's
  LARA credentials**, which is the single most sensitive thing this
  category holds.

### Ops & support (CLAIM)

- Support = email (support@corevue.com), "most tickets within a few
  hours," Google Meet demos on request, or "a short video with
  example."
- Onboarding: "stores typically go live in just a few days" (because
  of pre-built Verifone/Gilbarco import routines).

### Their pitch against the status quo (CLAIM)

Manual/LARA-native methods lack: mobile app, all-vendor order
management, on-the-go ordering → "errors and inaccuracies...
delays... compliance risks and potential fines... difficulty
maintaining accurate, real-time price information." (Note: this is
also OUR pitch. The market education is shared.)

## 3. WHERE COREVUE IS STRONG → MATCH, THEN BEAT

1. **POS sales data → suggested orders** (their best structural
   edge). *Beat:* (a) our store memory already learns real order
   patterns with ZERO hardware dependency — works day one at any
   store; (b) board #40: integrate the POS party stores actually
   run — **NRS first** (Colony runs it; we already touch NRS data;
   CoreVue lists only Verifone/Gilbarco = fuel-station registers).
   Their POS list is a gas-station list. Ours will be a liquor-store
   list.
2. **AI invoice OCR (<30s)**. *Beat with something better than OCR:*
   board #39 invoice-VERIFY — we already hold the order AND MILO's
   confirmations, so scanning the delivery invoice lets us reconcile
   line-by-line, to the penny, against what was actually ordered and
   confirmed. Theirs reads invoices; ours PROVES them. Flag
   shorts/price drift automatically. Penny doctrine extended to the
   loading dock.
3. **Shelf-label printing** (visual designer, Bluetooth, "Zebra
   compatibility"). *Beat:* #38 universal print doctrine (§6) — ANY
   printer, no compatibility list, no app-mediated pairing. Their
   universality is one brand deep; ours is the OS print layer.
4. **LARA pricebook automation + audit trail**. *Already matched or
   ahead:* full-book auto-detect + between-book lists (new items /
   retail price changes / ADA changes) + TXT UPC watch + price
   memory with "was $X" on the shelf UI. *Their edge to absorb
   later:* retail-side pricing helpers (tax rules, zone overrides)
   when we build retail pricing.
5. **Direct LOO submission**. *We're ahead where it counts:* 25s
   live submit with screenshot evidence, OOS detection + one-tap
   remove, confirmation persistence, edit round-trip (#36 in
   flight). Their claim is bare submission; no evidence trail, no
   OOS intelligence, no confirmation receipts claimed anywhere.
6. **Bottle-deposit compliance**. Retail/POS-side feature — goes on
   the roadmap for when LK does retail/inventory (notes in scale
   plan). Don't concede it forever; it matters to Michigan owners.
7. **Multi-store price book**. Scale plan already carries multi-store
   as a first-class design goal (100s of stores). Keep it.
8. **QuickBooks/exports**. Board #41 (later lane): order + spend
   export (CSV/QuickBooks) — cheap to build, closes a checklist gap.
9. **Transparent pricing, month-to-month, free trial, self-serve
   signup**. Matched and undercut — LOCKED 2026-08-08 (Tony,
   tap-confirmed): **$149/store/month flat, 14-day free trial** (two
   Wednesday orders of proof) vs their $249 + 14 days. Same
   no-contract cleanliness, $100/mo cheaper, liquor-native.
10. **"Few days" onboarding**. *Beat:* self-serve SAME-DAY is the
    standing goal — scan a bottle in the first ten minutes.
11. **Support in a few hours by email**. *Beat:* AI partner inside
    the app 24/7 + founder-grade texts early. A gas-station platform
    answers email; we answer in the aisle.

## 4. WHERE COREVUE IS WEAK → ATTACK LANES

1. **Wrong DNA for our customer.** Their own FAQ defines them as
   built for c-stores and gas stations; fuel tanks are a flagship.
   The Michigan party/liquor store is a side market to them and THE
   market to us. Every LK surface speaks liquor-store native:
   ADAs, fifths, the Wednesday order, the book drop.
2. **No AI partner.** Their "AI" is an invoice OCR module. LK ships
   a full assistant that knows the store's history, prices, memory.
3. **No memory moat.** Nothing learned per store: no resolver
   memory, no learned matches, no price memory chips, no "you
   usually order 6."
4. **No honesty rails.** No evidence receipts, no accuracy doctrine,
   no penny doctrine. Their own marketing screenshot shows
   **QoH: -18** (negative on-hand inventory) left on display — data
   quality nobody read. We put exactness on the surface; they put a
   negative stock count in their brochure.
5. **Credential trust vacuum.** No public story on LARA credential
   handling. Our fortress plan + MLCC-recognition pursuit turns
   "how is my login stored?" into a weapon.
6. **Polish cracks.** FAQ grammar ("Our LARA integration
   automatically allow you...", "CoreVue allow you to manage...").
   Small, but it reads offshore/rushed next to a native voice.
7. **Desktop-designer, app-mediated flows.** Label designer lives in
   desktop; printing routed through their app + Bluetooth pairing.
   LK is phone-first PWA — the aisle is the office.
8. **Price umbrella.** $249/mo/site × small stores = real friction.
   Flat monthly under that number (Tony's call) buys the wedge.
9. **No recognition either.** They claim no MLCC/state approval. The
   lane is open — we're already moving (outreach letter).


## 5. SAXON DOSSIER (captured 2026-08-09 — public-web sweep: saxoninc.com/liquor-orderer, both app stores, company homepage)

### Identity — a printer, not a software company
Saxon Inc, Ferndale MI, "Celebrating over 40 Years of Printing
Innovation & Excellence." Core business is pressure-sensitive LABEL
PRINTING (beer/beverage labels, RFID, pharma, cannabis, keg
collars). The **"Liquor Orderer"™** app exists since Dec 2017
(iOS v9.6.1, Nov 2025, actively maintained; Android too;
"designed primarily for iPad") — and on their own homepage it is a
small nav link under the label business. **Their DNA is the print
shop; ours is the store.**

### The model (CLAIM, their product page)
Annual subscription, price NOT published ("cost and registration
required" — call 1-800-727-1976, M–F 8:30–5). The sub bundles
**physical consumables**: "one complete set of barcode peel-off
shelf price tags" + "four quarterly updated tag sets per MLCC Price
Book changes," free shipping, multi-store discounts. Workflow: scan
THEIR shelf tag (or bottle) with camera or "scanner equipment
provided by Saxon" → build order → state. Features: sort by
size/ADA, Speed Keys (quick quantities), My Tag database, order
history + duplicate-order, "Error Graphics" for submitted-order
errors, MLCC search. Testimonial CLAIM: "reduces ordering time by
two-thirds with no typos."

### Strongsuits → match, then beat
1. **40 years of Michigan store relationships** (the real moat —
   they've shipped tags to these stores for decades). *Beat:* we ARE
   the stores — the family story + counter demos + MLCC recognition
   lane (they claim none). A printer sells TO stores; we're FROM one.
2. **The physical tag ecosystem** (they print the thing you scan —
   consumable lock-in + a second revenue line). *Beat:* structural
   counter, already ours: LK scans the bottle's OWN UPC — zero
   proprietary consumables, works minute one. And #38 universal
   print doctrine makes tags self-serve TODAY on any printer instead
   of quarterly by mail.
3. **Longevity + active maintenance** (8-year-old app, updated
   Nov 2025; 5.0★ on 5 ratings). *Beat:* ship weekly, publicly,
   with the "improving every day" brand promise.
4. **Human phone support** (real people, M–F business hours).
   *Beat:* in-app AI 24/7 + founder texts — the aisle doesn't close
   at 5pm Friday, and neither do we.

### Weaknesses → attack lanes
1. **Paper catalog physics.** Their accuracy depends on tag sets
   mailed QUARTERLY; MLCC changes prices monthly and mid-month. Any
   scan against a stale paper tag is a wrong price on the shelf and
   a wrong assumption at order time. Our book is live (full-book +
   between-book auto-ingest, "was $X" memory). The accuracy
   doctrine eats this lane whole.
2. **No self-serve.** Phone-call sales + shipped consumables =
   onboarding measured in days/weeks. Ours is scan-in-ten-minutes,
   signed up alone at 11pm.
3. **Opaque annual pricing** vs our published $149/mo flat,
   cancel-anytime. Annual + "call us" reads like 1995 next to a
   price on the page.
4. **iPad-primary, tag-first UX.** The aisle is phone-first; ours is
   a phone PWA.
5. **No modern layer at all**: no AI, no per-store memory, no
   vision, no evidence receipts, no credential story, no
   confirmation/sync intelligence claimed anywhere.
6. **Stale-copy signals**: "MIRA Inquiries Welcome" (agency name
   retired years ago) — the site isn't watched closely.
7. **Tiny public footprint** for an 8-year app (5 iOS ratings):
   either a small active base or a phone-sold base that never
   touches the store listing — both mean the self-serve internet
   lane is UNCONTESTED.

### Standing recon offer (Tony, 8/9)
Tony has "Michigan Liquor Orderer" installed post-update and will
screenshot on request. Wanted when convenient: the update's
what's-new screen · the main order-building flow end to end · any
screen that touches MILO/submission (does it SUBMIT or just build a
list?) · any pricing/subscription/monetization screen · the About/
version screen.

### Saxon recon still open (UNKNOWN)
Real subscription price (quote requires a call — Tony's call
whether to make it) · does the app SUBMIT into MILO or prep the
order for hand-entry ("Error Graphics for submitted order errors"
suggests some submission loop — unverified) · active store count ·
whether the state's 2-sub-user system is used or main logins.

## 6. STANDING RECON LIST (UNKNOWNS to verify)

- Does CoreVue truly robot-submit into LOO, or prep orders for a
  human to submit? (Their words say submit; no evidence shown.)
- How do they store/handle LARA logins? Sub-user support (MLCC's
  2-per-license system)?
- Do they capture MILO confirmations / handle OOS at submit time /
  sync post-submit edits? (Our #36 territory.)
- Real onboarding flow: what does "few days" actually involve?
- Do they have Michigan liquor-store customers at scale, or mostly
  fuel c-stores?
- Optional: 14-day trial recon account — **Tony's call, not mine.**

## 7. UNIVERSAL PRINT DOCTRINE (#38) — the "TV remote" answer

Tony's ask (verbatim): "so many different brands... some stores
already have printers, some dont, so i want liquor kings to be able
to universally accept each printer, yk how there were those
universal tv app remotes where u can use it on any tv."

The universal remote already exists and every store already owns it:
**the print button.** Every printer sold in ~the last decade —
Zebra, Dymo, Rollo, Munbyn, Brother, or a plain office laser —
registers itself with the phone/computer's print system (AirPrint on
iPhone/iPad, drivers on Mac/Windows, Android print services). A web
app reaches ALL of them through one door: the system print dialog,
with CSS `@page` controlling exact label sizes. We never talk to
printers; we talk to the print system, and the print system talks to
every printer on earth. Same trick as the universal remote: one
standard layer in the middle.

- **Tier 1 (day one, 100% of brands):** "Print tags" → pixel-perfect
  print view → system print dialog → whatever printer the store
  owns. Regular printer = letter sheet of cut-out shelf tags. Label
  printer = one-label-per-page at preset sizes (2.25×1.25", 2×1",
  4×6...). Penny-exact prices, UPC barcode, deposit line.
- **Tier 2:** per-store printing profile (store memory doctrine):
  one-time 60-second wizard — pick printer type, label size, test
  print — remembered forever.
- **Tier 3 (later, optional):** direct silent printing for stores
  that want zero-dialog taps: Zebra ZPL / Browser Print, ESC/POS
  receipt-class. An upgrade, never a requirement.

CoreVue needs a compatibility list ("Zebra printer compatibility")
and their own app in the middle. Our Tier 1 has no list — that's the
beat. Honest caveat: ancient serial-only thermal units (pre-driver
era) would need Tier 3; everything modern walks through Tier 1.
First concrete step: **photo of Colony's label printer** → first
presets tuned to real hardware.

## 8. BOARD ITEMS BORN HERE

- **#38** label printing = universal print doctrine (Tier 1 first).
- **#39** invoice-verify: scan delivery invoice → reconcile vs order
  + MILO confirmations to the penny → flag shorts/drift.
- **#40** POS lane: NRS first (Colony recon: what can its back
  office export?), then the liquor-store POS list — never the fuel
  list.
- **#41** exports lane: CSV/QuickBooks order + spend export (cheap
  checklist win, later).
- **#42** quarterly competitor re-sweep (CoreVue, Saxon, new
  entrants) + finish Saxon dossier + ingest Tony's remaining
  CoreVue screenshots.

## 9. THE ONE-LINE DOCTRINE

CoreVue sells a gas-station back office that also does liquor.
Saxon sells paper tags with an app on the side. LK is the liquor
store's own robot: it scans, remembers, orders, proves, and never
rounds a penny. Match every box they check, then win on the things
a print shop and a fuel platform can't fake: a live book, memory,
honesty, evidence, and being FROM the aisle it serves.
