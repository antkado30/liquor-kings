# Competitive Research — Michigan Liquor Ordering Tools

**Date:** 2026-05-17
**Trigger:** Tony surfaced concern that competitors already exist for Liquor Kings' wedge (Austin's uncle "already has an app", Buscemi's "has an app").
**Goal:** Identify and characterize actual MI-focused competitors, find pricing, identify feature gaps.

---

## Executive summary

1. **Saxon Inc. "Liquor Orderer"** (Ferndale, MI — saxoninc.com) is the most direct competitor. Established 30+ years, MI-based, same wedge: scan-and-order MLCC. **HIGH THREAT.** Their weakness: depends on Saxon's physical pre-printed barcoded shelf tags, refreshed quarterly. Pricing not public — likely $500-$1,500/year/store with hardware included.

2. **Michigan Liquor Orderer** (solo developer Mathew Yaldo) — iOS-only OCR app. Medium threat. May only build order lists rather than actually submit to MLCC OLO — needs verification.

3. **CoreVue** (corevue.com) — $249/site/month. Full back-office c-store platform with direct MLCC LARA submission. Targets gas stations + c-stores specifically. Liquor Kings at $129 cleanly undercuts.

4. **No ADA-built retailer app for spirits exists.** MLCC monopoly prevents it. (eRNDC, Imperial Beverage portals are for beer/wine three-tier only.)

5. **NRS has zero MLCC integration.** Liquor Kings' NRS-plus-MLCC wedge is real and unfilled across every tool surveyed.

6. **Buscemi's "app" is almost certainly the customer-facing order-online site or loyalty card app**, NOT a back-office ordering tool. No public tech-stack info for back-office. Probably a misread by Tony's GF's dad.

7. **Austin's uncle's app is most likely Saxon Liquor Orderer.** Five-minute test: does his uncle have Saxon-printed barcoded price tags on his shelves?

---

## Threat ranking

| Competitor | Wedge overlap | Threat | Where they're weak |
|---|---|---|---|
| Saxon Liquor Orderer | DIRECT (scanner → MLCC) | HIGH | Physical tag dependency, no NRS integration, no real-shelf-inventory connection |
| CoreVue | DIRECT (MLCC ordering) | MEDIUM-HIGH at $249 | Upmarket only (c-stores/gas), expensive, gas-station-heavy features bloat |
| Michigan Liquor Orderer (Yaldo) | OVERLAPS (scanner UX) | MEDIUM | Solo-dev, iOS only, may not actually submit (list-builder only) |
| NRS POS (native) | NONE on MLCC | LOW | They're not in this game — they're the platform we integrate WITH |
| Bottle POS / mPower / LiquorPOS / Lightspeed | NONE on MLCC | LOW | General liquor POS — don't automate MLCC ordering |
| eRNDC / Imperial Beverage | NONE on spirits | LOW | Beer/wine three-tier only |

---

## Liquor Kings' actual differentiation

Based on what no one else surfaced doing:

1. **NRS POS integration** — UNIQUE. Every competitor uses their own POS or is POS-agnostic. Nobody pulls real shelf inventory data from NRS scans to drive reorder lists.

2. **Real-shelf-inventory → MLCC reorder workflow** — Saxon needs you to scan THEIR physical tag, not the bottle. Yaldo OCR's MLCC shelf tags from the wall. Liquor Kings scans the actual bottle you just sold via NRS POS.

3. **Per-ADA 9L pre-validation + MLCC rules pre-check** — UNIQUE. No competitor surfaced enforces MLCC rules client-side BEFORE submit. They all let the operator hit MLCC's banner errors and reverse-engineer them. Liquor Kings' mlcc_rules table + scanner pre-validation = no surprise rejections.

4. **Modern web/mobile UX** — Saxon is a printing company side-product, Yaldo is a solo iOS dev, CoreVue is c-store enterprise SaaS. None of these have product-led growth or modern web app polish.

5. **Pricing position** — $129/mo sits below CoreVue's $249 and likely below Saxon's hardware-bundle annual cost. Above national-POS prices but those don't do MLCC at all so they're not direct competitors.

---

## Competitive positioning (suggested narrative)

**Against Saxon (the real threat):**
> "Saxon makes you stick their printed shelf tags on every bottle and replace them every quarter. We use the bottles you actually sold on your NRS POS — no tag refresh, no hardware shipped, no quarterly cycle. Scan it, we know what it is."

**Against CoreVue:**
> "CoreVue costs $249/month and is built for gas stations. We're $129/month and built for independent liquor stores who just want their MLCC ordering to not be miserable. We don't make you pay for fuel-pricing modules you'll never use."

**Against Yaldo's Michigan Liquor Orderer:**
> "Solo-developer iOS app that may or may not actually submit your order. We submit, we verify, we tell you when MLCC rejects something and why."

**Against "I already have an app":**
> "Most likely you have one of: a customer-facing online order app, a loyalty card app, an NRS inventory app that doesn't talk to MLCC, or a beer/wine distributor portal. None of those automate spirits ordering to MLCC. That's the gap."

---

## 5-minute diagnostics for Tony's leads

When Tony talks to Austin/his uncle/Buscemi's:

1. **"Does your store have barcoded price tags from Saxon Inc. on the shelves?"** — If yes, they use Saxon Liquor Orderer. Real competitor.
2. **"Does the app actually submit your MLCC order, or just build a list you re-type into MLCC?"** — Eliminates list-builder hobby tools.
3. **"What POS does the store use?"** — If NRS, we already integrate. If Lightspeed/Square/Clover, the existing POS does NOT order from MLCC.
4. **"How much do they pay per month?"** — Sets the price comparison frame.
5. **"What do they hate about it?"** — Surfaces our actual differentiation opportunity.

---

## Pricing comparison (verified where public)

| Tool | Monthly | Annual | Hardware | MLCC ordering | NRS integration |
|---|---|---|---|---|---|
| Liquor Kings (planned) | **$129** | **$1,548** | Uses existing NRS | YES (RPA) | YES |
| Saxon Liquor Orderer | Not public | Likely $500-$1,500/store | Included (tablet + scanner) | YES | NO |
| CoreVue | $249/site | $2,490/site | BYO | YES | NO |
| Michigan Liquor Orderer (Yaldo) | Not public | Not public | iOS device only | Unverified | NO |
| Bottle POS | from $59 | from $708 | Bundle | NO | NO |
| mPower Beverage | ~$120/register | ~$1,440/register | Bundle (+$1k setup) | NO | NO |
| NRS POS | $19.95-$49.95 | $239-$599 | $599-$699 with NRS Pay | NO | n/a — this IS NRS |
| Lightspeed Retail | "Most expensive" — unspecified | — | BYO | NO | NO |
| Clover Retail | $16-$240 + 2.5%+10c | $192-$2,880 + processing | $1,800-$6,000 lease | NO | NO |
| Square for Retail | Free / $89 Plus | varies | Square hardware | NO | NO |

---

## Sources

Verbatim list of URLs the research agent verified, preserved for re-check:

- michigan.gov/lara/bureau-list/lcc/online-spirits-ordering
- corevue.com/lara-ordering-for-michigan-c-stores-and-gas-stations
- corevue.com/plans
- saxoninc.com/liquor-orderer
- apps.apple.com/us/app/liquor-orderer/id1309741914
- apps.apple.com/us/app/michigan-liquor-orderer/id1554686433
- nrsplus.com/pricing
- bottlepos.com/pricing
- mpowerbeverage.com/liquor-store-pos-pricing
- synapsepayments.com/liquor-store-pos-systems (Lightspeed + NRS reviews)
- rndc-usa.com/erndc (eRNDC — beer/wine three-tier, not spirits)
- bcmicorp.com (Buscemi's parent — no back-office tech info surfaced)
- crainsdetroit.com — MLCC OLO history
- latechwatch.com — Bevz funding round 2023
