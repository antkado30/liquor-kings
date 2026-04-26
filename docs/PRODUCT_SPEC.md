# Liquor Kings — Product Specification

**Version 1.0**
**Last updated:** April 25, 2026
**Status:** Pre-launch (MVP development)

---

## 1. Executive Summary

Liquor Kings is a Michigan-first SaaS platform that automates the weekly spirits ordering process for licensees of the Michigan Liquor Control Commission (MLCC). It transforms the current 2-hour manual process — walking the store, looking up codes in the price book, and typing each line into the MILO portal — into a 10-minute automated workflow: scan bottles, review cart, submit. Liquor Kings handles MLCC validation, split-case rules, ADA selection, and order submission via headless browser automation.

**Mission:** Give Michigan licensees their time back so they can focus on running their businesses.

**Vision:** Become the default ordering and inventory platform for state-controlled alcohol licensees across the United States.

---

## 2. The Problem

Every Michigan business with a spirits license — liquor stores, restaurants, bars, hotels, country clubs, casinos, gas stations — must order their inventory through MLCC. The state runs a wholesale-only system; there is no alternative supplier.

The current process is broken:

1. Owner or manager walks the store identifying out-of-stock bottles
2. They handwrite each bottle on paper
3. They open the MLCC liquor price book on their phone and scroll to find each item's 4-5 digit MLCC code
4. They write down each code with desired quantity
5. They sit at a laptop and type each code into MILO one at a time
6. They set quantity per item, abide by split-case rules per bottle size
7. They click validate, hope nothing is out of stock or below the 9-liter ADA minimum, then check out

This takes about 2 hours per week per store. Multiplied across 23,000+ Michigan licensees, that's an aggregate ~46,000 hours per week wasted on manual data entry.

---

## 3. The Solution

Liquor Kings replaces the manual process with three steps:

1. **Scan** — Owner or manager walks the store with their phone, scanning UPC barcodes on out-of-stock bottles. Liquor Kings instantly maps each UPC to the corresponding MLCC code.
2. **Review** — A persistent cart shows what's being ordered, validates split-case rules and 9-liter minimums in real time, and shows estimated totals before submission.
3. **Submit** — One tap submits the order through Liquor Kings' RPA engine, which logs into MILO, populates the cart, validates with MLCC's stock-check, and confirms the order — returning the MLCC confirmation number to the customer.

The customer never types a single MLCC code.

---

## 4. Target Customer

Any Michigan business with an active MLCC liquor license, including:

- Liquor stores
- Restaurants with spirits licenses
- Bars
- Hotels with mini-bar programs
- Casinos
- Country clubs
- Gas stations and convenience stores selling spirits
- Event venues and catering operations

Total addressable market in Michigan: approximately 23,000 retail licensees (per MLCC's published numbers).

---

## 5. Product Workflow

### 5.1 Onboarding

1. Customer visits liquorkings.com, signs up with email and password
2. Provides business name and MLCC license number(s)
3. Connects MILO credentials (email + password) via secure encrypted form
4. Liquor Kings runs an immediate test login to verify credentials. Successful → "✓ Connected." Failed → instructions to retry.
5. Customer is shown a quickstart guide for using the scanner

### 5.2 Weekly Ordering Workflow

The workflow mimics MILO's familiar pattern to minimize cognitive load:

- **Scan** — open the app, walk the store, scan barcodes
- **Build cart** — quantities default to common splits per bottle size (1, 3, 6, 12)
- **Validate** — tap Validate. Liquor Kings runs MLCC's real-time stock check via RPA
- **Review** — see what's in stock, what's out, total cost, delivery dates per ADA, any 9L minimum issues
- **Checkout** — one tap submits the order and returns MLCC's confirmation number

### 5.3 Order Confirmation & History

After successful submission, customer sees:
- MLCC confirmation number
- "Order placed!" success screen
- Email confirmation
- Order added to history

Order history supports:
- View any past order
- "Add all to cart" — re-order any past order with one tap
- Filter by date, ADA, or product
- Export to CSV

### 5.4 Multi-License Support

Customers with multiple MLCC licenses (e.g., owner of multiple stores) can manage all licenses from one account. Each license has its own independent cart, inventory, and order history. A store-switcher dropdown lets the user navigate between licenses.

---

## 6. Pricing

| Plan | Price | What's Included |
|------|-------|----------------|
| **Standard** | $49/mo per license | Scanner, RPA, cart, order history, validation, support |
| **Additional licenses** | $29/mo each | Same features, second-or-more license under one account |
| **Annual** | $490/year | 2 months free vs monthly, locked-in pricing |
| **Founders' Tier** | $25/mo (legacy) | First 25 customers, grandfathered for life |

**Free trial:** 14 days, full access, card required at signup, charged on day 15.

**Service guarantee:** If our RPA fails to submit an order due to our error and the customer misses their delivery window, that month's subscription is refunded.

**Payment:** Stripe credit/debit only at launch. ACH and invoicing in V2.

---

## 7. Hardware & Label Printing

A core part of the customer experience is barcode-based scanning. Liquor Kings supports two operating modes:

### 7.1 UPC Scanning (default)
Customers scan the manufacturer's UPC barcode on each bottle. Liquor Kings maps the UPC to MLCC code via:
- Authoritative `upc_mappings` table (deterministic, instant)
- Open Food Facts (free, ~30% coverage of liquor UPCs)
- Manual search fallback for unmapped UPCs (one-time confirmation, then cached forever)

### 7.2 Liquor Kings Shelf Tags (optional)
For stores that prefer Saxon-style shelf tagging:
- Customer marks which bottles their store carries (My Inventory)
- Liquor Kings generates a PDF sheet of barcoded shelf tags
- Customer prints on standard label paper (Avery 5160 or similar)
- Tags are stuck under each bottle on the shelf
- Auto-generates new tags when MLCC pricing changes (in app, no shipping wait)

### 7.3 Liquor Kings Pro Printer (premium add-on)
- Zebra ZD421 thermal printer, pre-configured
- One-time hardware sale: $349, OR rental: $25/mo
- Print tags directly from the app
- Automatic reprint when prices change

### 7.4 Future: Electronic Shelf Labels (ESL)
- E-ink wireless price displays that update in real time
- Premium hardware tier for high-end stores
- Eliminates physical reprinting entirely

---

## 8. Technical Architecture (Summary)

- **Frontend:** Vite + React PWA (mobile-first, no native iOS app to avoid Apple's 30% fee)
- **Backend:** Express.js API + Supabase (PostgreSQL + RLS)
- **RPA:** Playwright headless browser automation against MILO portal at lara.michigan.gov
- **Scanner:** Camera-based UPC scanning via PWA, no native app required
- **Storage:** AES-256 encrypted MILO credentials, key in secrets manager, never logged
- **Monitoring:** Sentry for errors, custom RPA telemetry for selector adaptation
- **Payments:** Stripe (subscription billing, credit/debit only)

Customer data is multi-tenant isolated via Supabase Row-Level Security. Each customer's cart, history, credentials, and configurations are accessible only to that customer.

---

## 9. Compliance & Security

- **MLCC operations:** Liquor Kings is a third-party automation tool. No partnership, formal certification, or special license is required from MLCC to operate. The system is used as a customer's agent to perform actions the customer is authorized to perform.
- **Credential storage:** Customer MILO credentials are encrypted at rest with AES-256, never logged, never exposed to frontend after entry, never transmitted in plaintext.
- **Service Level:** Customer is notified within 5 minutes of any RPA failure via email and push notification. Manual workaround instructions are provided so customer can place order before delivery cutoff if needed.
- **Customer agreements:** Terms of Service and Privacy Policy displayed at signup. Sub-user agreements signed separately when a customer adds a manager.
- **Insurance:** General liability, errors and omissions, and cyber liability insurance carried at appropriate levels for SaaS at our scale.

---

## 10. Future Roadmap

### Phase 1 (MVP — Months 0-6)
- Core scanner + cart + RPA + order history
- Single-license support
- Tag printing PDF generation
- 14-day trial + Stripe billing

### Phase 2 (Months 6-12)
- Multi-license support with switcher UI
- Pro thermal printer integration
- AI-powered customer support chatbot for routine questions
- Status page (status.liquorkings.com)
- Self-healing RPA (selector telemetry + adaptive recovery)

### Phase 3 (Year 2)
- AI Pro Assistant — conversational catalog browsing, "show me last week's order," voice-driven cart building
- Pricing and price-change tracking with alerts
- Reporting dashboard (purchases by category, by month, year-over-year)
- Pro tier ($99/mo)

### Phase 4 (Year 3+)
- Multi-state expansion: Pennsylvania, Ohio, Utah, and other state-controlled alcohol systems
- Vendor-side product (Liquor Kings Vendor) for alcohol brands managing MLCC registrations
- POS integration as upsell
- Electronic shelf labels (ESL) hardware

---

## 11. Operations

### Customer Support
- Tier 1: AI chatbot for FAQ (~60-70% of tickets)
- Tier 2: Human support via email and in-app chat (business hours: 9am-6pm ET, Mon-Fri)
- Tier 3: Founder/owner direct line for critical issues

### Reliability
- Status page at status.liquorkings.com (Better Stack or similar)
- Automated alerting on RPA failures across customer base
- Manual intervention SLA: 1 hour response for P0 issues
- Public incident reports after major outages

### Data & Analytics
- Per-customer execution log with stage outcomes
- Selector telemetry to detect MLCC portal changes
- Adoption and engagement metrics for product improvement

---

## 12. Competitive Positioning

Two existing Michigan competitors solve adjacent problems:

| Competitor | What They Do | Our Advantage |
|-----------|--------------|---------------|
| **Saxon Liquor Orderer** | Tablet bundle + Bluetooth scanner + pre-printed shelf tags. Subscription required. Ferndale, MI. | Mobile-first PWA (any device), software-only, AI features in roadmap, lower price, broader licensee target market |
| **CoreVue (LARA Order Management)** | Software-only, targets gas stations and c-stores. 30-day trial. | Broader licensee market (all MLCC license types), modern UX, AI features, label printing options |

Neither competitor has built integration with SIPS+ (MLCC's new backend system, launched November 2025). Liquor Kings will pursue this as a differentiator in Phase 2.

---

## 13. Founding Team

**Tony Kado** — Founder and Lead Developer. Lifelong liquor industry insider (Michigan family liquor store), self-taught full-stack engineer, primary builder of the platform.

Additional team members and equity structure to be formalized at LLC formation.

---

## 14. Contact

- Website: liquorkings.com (coming soon)
- Email: hello@liquorkings.com
- Repository: github.com/antkado30/liquor-kings (private)