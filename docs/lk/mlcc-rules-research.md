# MLCC Public Ordering Rules — Research Findings

**Researched:** 2026-05-14
**Trigger:** Stage 4 RPA test hit `MILO_STAGE4_VALIDATE_BUTTON_DISABLED` on a 4-bottle / 3L cart against real MILO in production. Decision: stop hitting MLCC gates blindly; encode their rules so we can pre-validate.

**Sources reviewed:**
1. **OLO FAQ PDF** (verbatim): https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf
2. **Retailer ordering info page** (partial — content reconstructed via web search snippets, needs live-page reverify): https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees
3. **MLCC Code & Rule Book PDF** (failed to extract — single-line blob too large to parse; relevant statute content sourced via Mich. Admin. Code citations): https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Michigan-Liquor-Control-Commission-Code-and-Rule-Book.pdf

---

## Critical findings (mental-model corrections)

### 1. The 9-liter minimum is per-ADA, not per-cart

Source 1 (OLO FAQ) phrases it as cart-level. Source 2 makes the model explicit:

> "If you order a minimum of one standard case of in stock items totaling at least 9000ml (9 liters) with each ADA, you will receive free delivery, and that case can contain split items."

Source 1 also notes that the cart "sorts all products within orders by ADA." Combined, the only model that explains Tony's 4-bottle / 3L cart disabling Validate is: **MILO enforces 9L on each ADA sub-order independently. ANY sub-order under 9L disables the cart-level Validate button.**

This is the single biggest correction to our mental model. Our scanner needs to track liter totals per ADA and warn before submit, not per cart.

### 2. "221" and "321" are ADA IDs, not delivery types

Per the MLCC price book:
- **ADA 221** = General Wine & Liquor Company
- **ADA 321** = NWS Michigan, LLC
- (RNDC of Michigan is a third ADA with a separate code — confirm)

Our `deliveryDates` map keyed by `"221"` / `"321"` is actually **delivery dates per ADA**. The Stage 2 output Tony's been seeing — `delivery 221: 2026-05-19, delivery 321: 2026-05-19` — is the next delivery date from each of those two ADAs.

Action: rename across the codebase from "delivery type" → "ADA" wherever this nomenclature appears.

---

## Rule catalog (7 categories)

These map cleanly to where each rule type lives in our pre-validation pipeline.

### `order_minimum`
- **9L per-ADA threshold** — cart must total ≥9000mL per ADA appearing in cart; ANY ADA below threshold disables Validate.
  - Source: OLO FAQ ("9-liter minimum") + retailer-info page ("at least 9000ml… with each ADA")
  - Re-check trigger: any cart edit (including OOS items moving) forces revalidation.

### `size_quantity`
- **Split-case eligibility is per-product** — MLCC flags products as split-case-eligible. Non-flagged products must be ordered in full case quantities only.
  - Source: OLO FAQ ("Products that can be ordered with split cases are identified using the split case icon")
- **Quantity step varies by pack size** — for split-case products, the up/down arrows compute legal quantities based on the product's pack structure. We don't know per-product pack sizes without querying MILO; they may be in the MLCC price book TXT.
- **Value-added bonus item ≤ one 50mL bottle** (Admin Order 2020-01)
- **One multipack per brand per size** (Admin Order 2020-02)
- **All multipack components must already be state-listed** (Admin Order 2020-02)

### `workflow`
- **Validate → Checkout sequencing** — Validate must succeed before Checkout becomes available.
- **Re-validate after any post-validate edit** — adjusting quantities after Validate forces another Validate before Checkout re-opens.
- **Out-of-stock segregation** — OOS items move to a separate cart section; they are NOT auto-removed and require manual re-add when restocked.
- **Edit-until-cutoff** — submitted+confirmed orders are editable until the ADA's cutoff date (exact time not in extracted sources).
- **Removing a confirmed line = set qty=0, revalidate, checkout** (it's a re-submit pattern, not a delete).
- **Order day / delivery day spec, max 6-day gap** — each retailer has a fixed order day and a fixed delivery day, with delivery within 6 days of order.
- **12 emergency orders/year, 18hr SLA, ≤$20 delivery fee** — every retailer entitled to 12 emergency orders annually.
- **Channel allowlist** — orders can be placed via OLO, salesperson, or ADA-direct; OLO order history only shows OLO-placed orders.

### `account`
- **Active spirits-authorized Michigan liquor license required** to use OLO.
- **Email required per OLO user**.
- **Owner can create at most 2 sub-users per license** (so 3 total users max per store).
- **Credit hold blocks all future orders** — unpaid balance prevents new spirit orders.
- **On-premises SDD purchase cap = 120L/year collective** (for Class C, B-Hotel, Club, G-1, CCRC, Aircraft, Train, Watercraft licenses) — likely tracked via monthly report, not real-time in MILO. Not enforced for our typical SDD/SDM retailer customer.

### `stock`
- **OOS handling** — segregate (don't remove), allow manual re-add when restocked, no backorders, no auto-substitution.
- **OOS triggers re-evaluation of the 9L-per-ADA rule** — if OOS reduces an ADA sub-order below 9L, the cart blocks until the user adds more or removes everything from that ADA.

### `return`
- **Returnable for credit:** damaged bottles, deteriorated products, leaking containers, label damage, short-fill, delivery errors.
- **Not returnable:** licensee-caused damage.
- **48-hour window** to report licensee ordering errors to ADA.
- **Voluntary full-inventory return:** ADA refuses unsaleable items at time of return.

### `pricing`
- **Minimum retail = MLCC cost + 65% markup + specific taxes** (governs shelf pricing, NOT cart submission).
- **Licensee discount = 17% off base price**.
- **Specific taxes = 4% + 4% + 4%** on base price.
- **SDD floor:** SDDs can't sell below the MLCC minimum retail except by commission-approved inventory disposal.
- **Retailer ceiling: none** — stores may sell ABOVE the minimum (since 2004).
- **Value-added multi-item discount cap eliminated** (Admin Order 2020-01).
- **Cash handling fees vary by ADA + location**.

> Pricing rules govern the shelf, not the cart. Our scanner-side pricing layer needs these eventually; MILO doesn't gate cart submission on them.

---

## Open questions (worth asking MLCC directly)

- Exact daily/weekly ADA cutoff times.
- Whether the 9L threshold also has a per-cart-total floor in addition to per-ADA.
- Per-bottle-size case-pack sizes; which sizes are split-case-eligible by default (vs. flagged per-product).
- Whether the on-premises 120L/year SDD cap is enforced inside MILO or via monthly reporting only.
- Whether ADA-direct and salesperson orders post any state back into MILO (for credit/balance purposes).
- Maximum order size or single-order ceiling (not found).
- Whether emergency-order count (12/yr) is surfaced in MILO to the licensee.

---

## Additional MLCC sources to ingest later

First-party michigan.gov docs that came up during research:

- OLO User Manual (Placing & Editing Orders): https://www.michigan.gov/-/media/Project/Websites/lara/lcc/MILO/Licensee_User_Manual_-_Placing_and_Editing_Orders.pdf
- OLO Quick Reference: https://www.michigan.gov/-/media/Project/Websites/lara/Folder10/Licensee_Quick_Guide-_Navigating_and__Placing_Orders.pdf
- OLO Quick Add reference: https://www.michigan.gov/-/media/Project/Websites/lara/lcc/MILO/quickadd.pdf
- ADA Information Book Part 1: https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MLCC-FAQs/ADA-Book-Part-1.pdf
- ADA Information Book Part 2: https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MLCC-FAQs/ADA-Book-Part-2.pdf
- Admin Order 2022-07: https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Administrative-Orders/2022/2022-07.pdf
- Vendor of Spirits FAQ: https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MLCC-FAQs/MW-FAQ/Vendor-of-Spirits-FAQ.pdf
- How To Read The Price Book: https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/how-to-read-the-price-book
- 2023 Licensee Spirit Purchase Data: https://www.michigan.gov/lara/bureau-list/lcc/financial-management-division-reports/2023-licensee-spirit-purchase-data
- File a Complaint About Spirits Delivery Problems: https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/file-a-complaint-about-spirits-delivery-problems
- MCL 436.1229 (minimum retail selling price): https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-436-1229
- MCL 436.1205 (SDD purchase caps for on-premises)

These should be ingested in a future research pass to fill in gaps around cutoff times, per-size case-pack rules, and the formal ADA delivery policy.
