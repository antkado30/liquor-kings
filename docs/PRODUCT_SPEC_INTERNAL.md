# Liquor Kings — Internal Product Spec

**Version 1.0**
**Last updated:** April 25, 2026
**Status:** Pre-launch (MVP development)
**Audience:** Tony Kado (founder) + future cofounders/lawyer/CPA only
**Confidentiality:** Do NOT share with potential customers, competitors, or external parties

This document is the unfiltered version of PRODUCT_SPEC.md. It includes equity strategy, financial projections, weaknesses, risks, and personal context that shouldn't appear in customer-facing materials.

---

## 1. The Founder Story

Tony Kado, age 19. Lifelong work in family liquor store in Michigan. No college, by choice — building businesses instead. Holds a life insurance license, studying for real estate license. Multiple income streams strategy: liquor store (family obligation + income), life insurance (passive), real estate (in progress), Liquor Kings (primary growth bet).

Liquor Kings was conceived in late 2025 while Tony was placing the family store's weekly liquor order alongside his cousin Jacob. The current MLCC ordering process — handwriting codes from a phone-scrolled price book, typing them line by line into MILO — is the lived problem. Tony has done this hundreds of times. The product is autobiographical.

Originally a 5-way founder split was verbally agreed to (Tony, Jacob, Adol, Julian, Ildit) under the assumption a contractor would build the app for ~$50K. That premise dissolved when Tony took on building it himself. As of April 2026, Tony has built the entire platform solo over 6 months: UPC matching infrastructure, MLCC compliance rules, Playwright RPA against the live MILO portal (Stages 1-4 verified end-to-end), scanner PWA, admin tooling, ~370 passing tests.

Tony's stated philosophy:
- "I'm a hustler"
- "Building a future, not just a business"
- "If I just stick to it, I'm going to be the best"
- "Why would I fuck around with my friends and not be making money?"

This document treats him as a sole founder with discretion to allocate equity to original collaborators based on actual go-forward contribution.

---

## 2. Equity Strategy (CRITICAL)

### Decision (locked in by Tony April 25, 2026)

**Tony retains 50% controlling stake.**

The remaining 50% is offered to Jacob, Adol, Julian, and Ildit collectively, **for them to allocate among themselves** based on their own assessment of contribution and commitment. Tony will not dictate sub-allocation.

All cofounder shares vest over 4 years with a 1-year cliff, contingent on active contribution to the business (sales, ops, customer support, marketing, etc.). Unvested shares return to the company.

### Why this structure works

- Tony has built 100% of the technical product and is running the business. 50% reflects this contribution while preserving relationships
- Putting allocation decisions on the four cofounders forces them to have honest conversations among themselves about who actually contributes
- Vesting protects against dead-weight ownership in years 3-5 when the business is generating real revenue
- The structure is investor-friendly if Tony eventually wants to raise capital (controlling founder + vesting cofounders is a clean cap table)

### Conversation script (to be had with Jacob first)

Date target: this week (week of April 27, 2026). In person. Just Tony and Jacob.

Opening: "Bro, I want to talk to you about Liquor Kings. I love you, you're my brother, this conversation doesn't change that."

Setup: "Six months ago we said five-way split. That made sense when we thought we'd hire someone for $50K. That didn't happen. I built the whole thing myself. Hundreds of hours. I'm still building."

The ask: "I'm taking 50%. The other 50% is for you four to figure out among yourselves. I trust you to be fair. Everyone vests over 4 years. If anyone doesn't contribute, their unvested shares come back."

Then shut up. Let Jacob respond.

If Jacob agrees → loop in Adol next, then group conversation with Julian and Ildit.

If Jacob pushes back → "Take time to think on it. Let me know by [one week from today]."

If Jacob walks away from the deal → that's his choice. Tony retains 100% and proceeds without him.

### Failure modes to avoid

- DO NOT cave on the 50%. The number reflects reality.
- DO NOT have the conversation in a group setting — Jacob first, then sequential.
- DO NOT have it over text or phone.
- DO NOT delay this conversation past 30 days from today. Equity disputes get harder, not easier, as the business gets more valuable.
- DO NOT formalize equity without a Michigan startup lawyer drafting the operating agreement ($1,500-3,000 budget).

---

## 3. Financial Projections

### Cost structure (recurring monthly)

| Item | Monthly Cost |
|------|--------------|
| Supabase Pro | $25 |
| Vercel Pro | $20 |
| Anthropic API | $50-200 (scales with usage) |
| Sentry Pro | $26 |
| Status page (Better Stack) | $30 |
| Domain + email (Google Workspace) | $15 |
| Stripe fees | 2.9% + $0.30/txn |
| Insurance (annualized) | $200 |
| Legal retainer (annualized) | $300 |
| **Total fixed monthly** | **~$700-900** |

### Year-by-year revenue projections

| Year | Customers | Avg ARPU | Revenue | Costs | Net Profit | Personal Take |
|------|-----------|----------|---------|-------|------------|---------------|
| Year 1 | 80 | $49/mo | $47K | $15K | $32K | Side income, still part-time |
| Year 2 | 300 | $52/mo | $187K | $40K | $147K | Quit life insurance + store |
| Year 3 | 700 | $55/mo | $462K | $120K | $342K | Hire team of 3-4 |
| Year 5 | 2,500 | $60/mo | $1.8M | $700K | $1.1M | 8-10 person team, multi-state |
| Year 7 | 5,000 | $65/mo | $3.9M | $1.5M | $2.4M | Optional sale point |

### Exit scenarios

Realistic acquisition multiples for vertical SaaS in regulated industries: **4-7x ARR**.

| Year | ARR | Multiple | Sale Price | Tony's 50% | Tax (~30%) | Net to Tony |
|------|-----|----------|------------|------------|-------------|-------------|
| Year 5 | $1.8M | 5x | $9M | $4.5M | $1.35M | $3.15M |
| Year 7 | $3.9M | 6x | $23.4M | $11.7M | $3.5M | $8.2M |
| Year 10 | $8M+ | 7x | $56M+ | $28M+ | $8.4M | $19.6M |

**Realistic ceiling:** $10-25M personal payout if sold in years 5-10. This is life-changing money.

**Unrealistic upside (don't plan around this):** $50M+ personal payout would require expansion to 10+ states with dominant share. Possible but not the base case.

---

## 4. Risks and Mitigations

### Risk 1: MLCC changes their portal and breaks our RPA
**Likelihood:** Medium-high. They just launched SIPS+ in November 2025; further changes likely.
**Impact:** Service down for all customers until fixed.
**Mitigation:**
- Phase 2 selector telemetry detects breaks within minutes
- Automated alerts to founder
- 1-hour response SLA for P0
- Status page communicates transparently
- Eventually: AI-powered selector adaptation that auto-recovers

### Risk 2: MLCC issues cease-and-desist
**Likelihood:** Low. Saxon and CoreVue have operated for years without issue.
**Impact:** Catastrophic — could shut down the business.
**Mitigation:**
- Lawyer reviews automation legality before launch
- Operate respectfully (don't violate rate limits, don't help customers commit fraud)
- Don't proactively notify MLCC until after lawyer review
- Maintain clean corporate practices

### Risk 3: Customer credentials breached
**Likelihood:** Low if security is implemented properly. Higher as customer base grows.
**Impact:** Legal exposure, customer trust loss, potential MLCC investigation.
**Mitigation:**
- AES-256 encryption with key in secrets manager
- Never log credentials
- Cyber liability insurance ($1-2M coverage minimum)
- Pen-testing before scaling past 100 customers
- Eventually: SOC 2 Type II certification

### Risk 4: Tony burns out
**Likelihood:** High at current pace (5 days store + 2 days life insurance + Liquor Kings nights).
**Impact:** Stalled product development, missed customer support, business stagnates.
**Mitigation:**
- Quit active life insurance sales at $2K MRR (~40 customers)
- Reduce store hours at $5K MRR (~100 customers)
- Hire first part-time helper at $7-10K MRR
- Real estate license: get it but don't actively practice until Liquor Kings is sold or stable

### Risk 5: Cofounder dispute torpedoes the company
**Likelihood:** Medium without proper agreement. Low with operating agreement + vesting.
**Impact:** Legal blocking power on sale/raise, friendship loss, business paralysis.
**Mitigation:**
- Have the Jacob conversation NOW
- Form LLC with Tony as 100% owner first, amend later when cofounder allocations are settled
- Operating agreement with vesting drafted by Michigan startup lawyer
- All equity grants in writing only

### Risk 6: Saxon or CoreVue copies Liquor Kings' features
**Likelihood:** High eventually.
**Impact:** Reduced moat, pricing pressure.
**Mitigation:**
- Move fast. Ship features faster than they can copy.
- Build network effects (cross-customer UPC mappings improve everyone's experience)
- AI features (V2) are hard to replicate quickly
- Brand and customer relationships built through Tony's personal network are not easily copyable

### Risk 7: Apple/Google rejects the PWA or scanner permissions
**Likelihood:** Low. PWAs are standard.
**Impact:** Customer can't scan with phone camera.
**Mitigation:**
- PWA approach intentionally avoids app store dependencies
- Scanner uses standard web camera APIs (universally supported)
- If absolutely necessary, native apps as Phase 3 backup (but adds Apple's 30% fee complexity)

---

## 5. Strategic Insights from Q&A Session (April 25, 2026)

### Insight 1: "Mimic MILO" is the product philosophy
Customer cognitive load is the enemy. The ordering UX should match what they already know from MLCC: scan → validate → review → checkout. Don't reinvent the workflow, just make it faster.

### Insight 2: Two error categories
- **Our errors** (RPA failures, selectors break): MUST not happen. Engineering bar is "literally never."
- **Their errors** (out of stock, expired creds, MLCC fees overdue, 9L minimum): show transparently, just like MLCC does.

### Insight 3: Tony's TAM is bigger than "liquor stores"
ANY MLCC licensee — restaurants, bars, hotels, casinos, country clubs, gas stations. ~23,000 retailers in Michigan. Unlocks 3x the originally-imagined TAM.

### Insight 4: Network is the competitive moat for customer acquisition
Tony has 100-200 warm leads in Michigan via family, cousins, friends, dad's industry connections, and Austin Frieda's credit card processing referrals. No paid ads needed for first year. Conservative estimate: 50 conversions to paying customers in year 1 from warm network alone.

### Insight 5: Saxon's moat is shelf tags, not the app
Their value prop isn't the scanner. It's pre-printed barcoded tags that bypass UPC matching entirely. To beat Saxon, Liquor Kings must offer label printing — at minimum PDF generation for self-print, ideally Pro thermal printer integration, eventually ESL displays.

### Insight 6: SIPS+ is the long-term play
MLCC launched SIPS+ (Sales, Inventory, Purchasing System) in November 2025. Currently used for backend operations and supplier registrations, not retailer ordering. Likely to absorb retailer ordering (MILO replacement) within 1-3 years. **Whoever has SIPS+ integration first wins the next platform shift.** Saxon and CoreVue haven't built this. Liquor Kings should pursue Phase 2 SIPS+ exploration.

### Insight 7: There's a separate vendor-side product opportunity
Suppliers (vodka brands, whiskey brands, importers) use SIPS+ to register products with MLCC. This is a totally different customer (corporations, not retailers) and price point ($500-2000/mo). "Liquor Kings Vendor" is a Phase 4 product with different go-to-market.

### Insight 8: Multi-license discount drives loyalty
$49 first license + $29 each additional creates incentive for multi-store owners to consolidate accounts in Liquor Kings rather than fragment across competitors.

### Insight 9: AI assistant is V2, not V1
Tony's vision: "Bring up Jack Daniels, add to cart" via natural language. Possible but 4-6 weeks of focused work. Build as Pro tier feature ($99/mo) when Liquor Kings has 100+ customers and infrastructure is mature. Don't let it distract from MVP.

### Insight 10: Founders' Tier ($25/mo legacy) for first 25 customers
Tony's network deserves first-customer pricing. Locks them in for life, builds loyalty, generates testimonials. After customer 25, full pricing applies.

---

## 6. Action Items (Next 6-12 Weeks)

### This week (April 28 - May 4, 2026)
- [ ] Buy domain liquorkings.com and 2-3 variants (~$60)
- [ ] Have Jacob conversation
- [ ] Use Thursday's family liquor order as Stage 5 RPA test (dry_run mode first)
- [ ] Call Deja Vu POS support, ask about inventory CSV export

### Next 2 weeks (May 5 - 18)
- [ ] File Michigan LLC (Northwest Registered Agent or similar, ~$200 total)
- [ ] Set up business bank account (Mercury or Bluevine, free)
- [ ] Get business EIN (free, IRS website)
- [ ] Hire Michigan startup lawyer (interview 3, pick one, $5-8K total budget)
- [ ] Have Adol conversation (post-Jacob)
- [ ] Continue MVP build: scanner quantity rules, validator UI, execution tracking

### Weeks 3-4 (May 19 - June 1)
- [ ] Lawyer drafts operating agreement
- [ ] Lawyer reviews MLCC compliance + credential storage liability
- [ ] Group conversation with Julian and Ildit on cofounder equity
- [ ] Buy ToS + Privacy Policy template (Termly, ~$30/mo)
- [ ] Build customer-facing cart UI
- [ ] Build encrypted credential storage architecture

### Weeks 5-8 (June - early July)
- [ ] Customer onboarding flow (signup, license, MILO connect, verify)
- [ ] Multi-tenant isolation
- [ ] API endpoint for RPA (so PWA can trigger, not just terminal)
- [ ] Stripe billing integration
- [ ] Status page (status.liquorkings.com)
- [ ] Business insurance (general + E&O + cyber, ~$2K/year)
- [ ] First 5 founders' tier customers onboarded (dad's store + cousins)

### Weeks 9-12 (July - August)
- [ ] Marketing landing page at liquorkings.com
- [ ] First public launch announcement to warm network
- [ ] Onboard customers 6-25 (founders' tier $25/mo legacy)
- [ ] Adopt rolling release process
- [ ] Begin Phase 2 work: tag printing, SIPS+ exploration, AI chatbot

---

## 7. Personal Strategy Notes

### Income stream prioritization (Tony)

| Stream | Status | When to scale down |
|--------|--------|-------------------|
| **Liquor Kings** | Primary growth bet | NEVER. This is the goal. |
| **Family liquor store** | Family obligation + income | Reduce hours at $5K MRR |
| **Life insurance (active sales)** | Active 2 days/week | Stop active sales at $2K MRR. Keep license. |
| **Life insurance (passive)** | Keep license forever | Renew annually |
| **Real estate (license + active)** | Studying for exam | Get license, but DON'T actively sell. Refer deals. Until Liquor Kings is sold or stable. |

### Mentor recommendation

Tony has been operating without a human mentor — only AI tools and self-learning. This is unusual and won't scale to the management challenges of a 100+ customer business.

**Action item:** Find one human mentor who has built and sold a SaaS company. Pay them if necessary. $200/hr for monthly 1-hour calls = $2,400/year. Cheapest insurance Tony will ever buy. Look for:
- Michigan tech founder who exited
- SaaS founder in a vertical/regulated industry
- Someone with pattern recognition on early-stage equity disputes (relevant to current situation)

Sources to find: Detroit Startup Community, Ann Arbor SPARK, MichBio, LinkedIn, possibly Austin Frieda's network.

### Reading list (build over next 6 months)

- "The Manager's Path" by Camille Fournier (when first hire approaches)
- "The Mom Test" by Rob Fitzpatrick (customer interviewing during MVP)
- "Trillion Dollar Coach" (managing relationships in business)
- "Working in Public" by Nadia Eghbal (open source / community thinking)
- First Round Review (free SaaS founder content, weekly reading)

---

## 8. What "Building a Future" Looks Like

Tony's stated goal: build multiple income streams + build a future, not just a business.

Realistic 10-year trajectory IF Liquor Kings executes:

- **Age 19-21:** Liquor Kings MVP → 100-300 customers → $50-150K personal income
- **Age 22-24:** Multi-state expansion → $300K-1M personal income, hire team
- **Age 25-27:** Sell Liquor Kings ($10-25M personal payout) OR keep growing
- **Age 28-32:** With exit money: invest in real estate, buy out family stores, start a fund, mentor founders
- **Age 33-40:** Multiple businesses, real estate portfolio, possibly $50-100M net worth

This trajectory requires:
1. Execute MVP and ship within 90 days
2. Don't blow up cofounder equity (Jacob conversation handled cleanly)
3. Avoid burnout (ramp plan on other jobs)
4. Find a human mentor
5. Don't get distracted by 5 other ideas at once

The biggest single risk is internal — Tony's pattern of taking on too many things simultaneously could dilute Liquor Kings' execution. The biggest single accelerant is Tony's network — the warm-lead advantage is unusual and significant.

---

## 9. Repository & Continuity

Repo: `github.com/antkado30/liquor-kings`
Local: `/Users/tonecapone/dev/liquor-kings`

Key files:
- `services/api/src/rpa/stages/` — RPA stages 1-4 verified, Stage 5 deferred to Thursday's first real order test
- `services/api/src/mlcc/milo-ordering-rules.js` — MLCC compliance logic
- `docs/PRODUCT_SPEC.md` — external spec
- `docs/PRODUCT_SPEC_INTERNAL.md` — this document
- `docs/milo-reference/` — captured MLCC documentation

Conversation history with Claude is in `/mnt/transcripts/` (compacted summaries kept across sessions).

---

## 10. Closing Note (for future Tony)

If you're reading this in 6 months, 2 years, or 5 years and Liquor Kings has grown — remember:
- You started this at 19 working out of a liquor store
- You taught yourself to code by talking to AI
- You built it solo for 6 months
- You had the hard conversation with your cousins instead of avoiding it
- You stayed focused on Michigan first instead of chasing every state at once
- You treated customers like family because they ARE family for the first 25
- You didn't quit when MILO's HTML changed for the third time
- You read this document and stayed on the plan

If you're reading this and Liquor Kings DIDN'T work out — read it again. The plan was right. Figure out which step you skipped. Then build the next thing with what you learned.

Either way: you're not your job. You're not your business. You're a hustler with a future. The future you're building isn't measured by exit valuation. It's measured by the freedom you create for yourself and the people you love.

— April 25, 2026