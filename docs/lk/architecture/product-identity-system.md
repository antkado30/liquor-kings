# Liquor Kings — Product Identity System (Architecture Vision)

**Owner:** Tony Kado
**Last updated:** 2026-05-09
**Status:** Vision committed. Build is phased. Each phase advances toward this end-state.

---

## Why this doc exists

Liquor Kings is not a search feature with a database. **It is a permanent product identity system** for Michigan liquor stores. Bottles get scanned, customers add to cart, RPA places real MLCC orders, money moves. Every link in that chain has to be reliable, auditable, and resilient.

This document is the canonical architecture vision. Every implementation decision should serve it. Every phase ships toward it.

---

## Core principles (non-negotiable)

1. **MLCC catalog is the source of truth** for official liquor code, official product identity, brand name, and bottle size. We mirror it locally; we never override it.

2. **UPCs are real-world observed bottle identifiers.** Each is permanent evidence — once seen, never deleted. Mappings can be superseded, but history is retained.

3. **A bottle row is store-internal product identity** — the bridge between the global MLCC catalog and a store's per-store inventory state (shelf price, on-hand quantity, etc.).

4. **Every UPC↔MLCC mapping must be explicit, versioned, auditable, and reviewable.** Verified mappings have a confidence source. Operator decisions are logged with who, when, and why.

5. **Verified mappings are NEVER overwritten silently.** A re-import or new evidence may suggest a change, but only operator approval (or explicit policy) replaces a verified mapping.

6. **Low-confidence matches NEVER silently become truth.** They live in a candidate / review state until human approval.

7. **Every failure, ambiguity, conflict, and unresolved UPC surfaces as a visible issue** in an operator review queue. No silent black-box behavior.

8. **The system improves over time.** Approved decisions, observed scans, and verified imports all flow back into the matching engine to raise future confidence scores.

9. **Multi-tenant by design.** Hundreds of stores, store-scoped scans/bottles/overrides, but a single global MLCC catalog. RLS enforced at the DB layer.

10. **Fail safely.** No silent bad links, no hidden corruption, no fragile one-shot scripts, no AI deciding the critical path. Deterministic rules first, fuzzy ranking second, AI as advisor not authority.

---

## End-state architecture (where we're going)

### Identity entities

| Entity | What it is | Source |
|---|---|---|
| **mlcc_items** | Canonical Michigan liquor catalog (~13,800 SKUs). MLCC code, name, ada, size_ml, prices. | MLCC official price book ingest, periodic refresh |
| **bottles** | Per-store product identity. Bridges (store_id, mlcc_code) → store-specific inventory metadata (shelf_price, on_hand). | Auto-created on first scan via `findOrCreateBottleByMlccCode`. Operator-editable. |
| **upc_mappings** | Authoritative, evidence-backed UPC ↔ MLCC code links. **Permanent.** Versioned. Has confidence_source + confirmed_by. | Bulk imports (NRS, etc.), customer scan confirmations, UPCitemdb confident matches |
| **upc_candidates** *(future)* | Unverified suggestions awaiting operator review. Source, suggested mlcc_code, scores, reasons. Survives until promoted to upc_mappings or rejected. | Fuzzy match output, low-confidence import rows, ambiguous scan results |
| **upc_evidence** *(future)* | Permanent log of every UPC observation: source (scan/import), context (store_id, scanner_user_id, run_id), timestamp, raw payload (UPCitemdb response, NRS row, etc.). | Every scan, every import, every API call. Never deleted. |
| **brand_aliases** | Token-level aliases (Stoli ↔ Stolichnaya, Vanilla ↔ Vanil, Fifth ↔ 750ml). Bidirectional. | Codified from MLCC truncation patterns + retail slang + observation |
| **review_issues** *(future)* | Operator backlog: unresolved UPCs, conflicting mappings, low-confidence candidates, audit flags. Each issue has status, assignee, resolution log. | Auto-emitted by matching pipeline whenever it punts a decision. |

### Mapping pipeline (deterministic-first)

For every UPC observed (scan or import):

1. **Lookup `upc_mappings`** — if a verified mapping exists, return it instantly. Skip everything else. (This is the "scanner cold-start fixed" path.)

2. **Lookup `mlcc_items.upc`** — direct UPC catalog match. If found, write `upc_mappings` row with `confidence_source='auto_high_score'` (already implemented).

3. **Deterministic name + size + brand match** — for import flows. Tokenize, drop stop words, expand via aliases + auto-prefix shortening, AND-search MLCC catalog at the exact size. If exactly one strong candidate (score >= threshold AND lead >= threshold) → write `upc_mappings` with `confidence_source='nrs_import_name_size_match'` or similar deterministic source.

4. **Fuzzy fallback** — only when deterministic produces nothing AND query is from a search/UI context (NEVER for imports). Returns ranked candidates with scores + reasons. **Never auto-confirms.**

5. **Operator review** — anything that didn't auto-confirm via #1-#3 surfaces in the review queue with full reasoning. Operator approves, rejects, or edits, and the decision becomes a verified mapping going forward.

### Search architecture

Search has TWO modes:

**Verified mode** (default): Searches `upc_mappings`-backed bottles + canonical `mlcc_items` data. Returns only items with established identity. Fast, deterministic, predictable.

**Fuzzy / discovery mode** (operator triggered): Falls into trigram + Levenshtein fuzzy search across `mlcc_items`. Used when verified search yields nothing. Always shows confidence + matching reasons.

Token handling:
- **Brand tokens** (e.g., "stolichnaya") — required, AND'd
- **Variant/flavor tokens** (e.g., "vanilla") — required, AND'd, alias-expanded
- **Size tokens** (e.g., "fifth", "750ml") — used as a separate filter (size_ml exact), not as a name-match token
- **Type tokens** (e.g., "vodka", "rum", "whiskey") — stop words, dropped from name match (MLCC names rarely include the type word)
- **Article/junk tokens** (e.g., "the", "of") — stop words

Aliases are a first-class entity. New aliases learned from operator decisions feed back into the alias map.

### Confidence scoring (deterministic, not ML)

Every match decision produces a transparent score:

- **+50** brand exact match
- **+30** size_ml exact match (REQUIRED for auto-confirm)
- **+25** per token brand-overlap
- **+20** "all tokens present" bonus
- **−60** gift pack / promo / limited-edition penalty (W/, GIFT, PROMO, etc.)
- **−35** flavor variant when query has no flavor token
- **−25** brand mismatch (different brand uniquely identifies)
- **Auto-confirm threshold:** score ≥ 60 AND lead over 2nd ≥ 20

Anything below auto-confirm → review queue.

Every mapping records:
- `confidence_source` — which path created it
- `confirmed_by` — user/system identifier
- Timestamps (`first_seen_at`, `last_seen_at`, `confirmed_at`)
- Audit trail of changes (supersede / deprecate, never delete)

### Multi-tenant model

- **Global**: `mlcc_items`, `upc_mappings`, `brand_aliases`, MLCC ingest job
- **Store-scoped (RLS)**: `bottles`, `cart_items`, `inventory`, `execution_runs`, store-level overrides
- Service role bypasses RLS only for admin/worker contexts; customer auth uses Supabase JWT + store_users membership.
- All store-scoped writes verified via `enforceParamStoreMatches` middleware.

### Observability + reliability

- **Sentry** for all uncaught errors, with breadcrumbs across stages
- **`lk_system_diagnostics`** table for structured business-event logging (already implemented)
- **`upc_evidence` future** — every UPC observation logged
- **Worker heartbeats** on long-running RPA execution
- **Stale-mapping detection** (future) — periodic job flags mappings that haven't been re-verified in N days
- **Conflict detection** — when import suggests a different mapping for an already-verified UPC, surface as review issue

---

## Current state map (what we have vs what's missing)

### ✅ ALREADY BUILT (production-grade)

- `mlcc_items` table + price book ingester (13,828 rows, hits michigan.gov canonical source)
- `bottles` table + auto-creation via `findOrCreateBottleByMlccCode` (per-store identity)
- `upc_mappings` table with `confidence_source` field (4,170 rows live as of 2026-05-09)
- AES-256-GCM encrypted MLCC credentials (Tier 1 security)
- `cart` + `cart_items` + execution_runs pipeline
- RPA Stages 1-5 with four-gate live submission safety (verified May 7 with first production order)
- `brand_aliases` map with retail slang + MLCC truncation aliases (vanilla↔vanil etc.)
- Token-AND search with auto-prefix matching
- Diagnostics logging on identity events
- Multi-tenant RLS enforcement on store-scoped tables
- Deterministic NRS import → name+size+brand matching → ~4,169 auto-confirmed mappings

### ⚠️ PARTIAL (works but needs hardening)

- **Operator review queue** — 1,284 ambiguous mappings sitting in import report, no UI yet to one-click approve/reject
- **Versioning / supersede semantics on upc_mappings** — currently upsert-on-conflict. Should track history when a mapping changes.
- **Stop-word handling in scoring engine** — search has it, scoring engine doesn't fully (gift-pack penalty is in, type-word handling is not)
- **`upc_evidence` log** — diagnostic events fire, but no dedicated immutable evidence table

### ❌ NOT BUILT YET (next priorities)

- **Operator review UI** for ambiguous mappings (Phase 2C)
- **Glass vs plastic disambiguation** in scoring (would auto-resolve ~half the ambiguous → mappings)
- **Quantity stepper enforces MLCC split-case rules** in scanner (Bug #2 from May 8)
- **MLCC password change auto-detection** wired to customer notification
- **Continuous worker process** (currently fire-on-demand for testing)
- **KMS-backed encryption key** (Phase B Priority #1.5 — required before paying customers)
- **Credential access audit log** (Phase B Priority #1.6)
- **Customer signup / login flow** (Phase B Priority #4 — replaces VITE_SCANNER_DEV_BEARER)
- **`upc_candidates` table** for unverified suggestions awaiting review
- **`upc_evidence` permanent observation log**
- **Conflict detection on re-import**
- **Periodic catalog sync job** (currently manual `POST /price-book/ingest`)
- **External UPC enrichment** — UPCitemdb bulk lookup to populate `mlcc_items.upc` (paid tier $49/mo)
- **Stale mapping detection / re-verification job**

---

## Phased build order (toward end-state)

Phases match `WHATSNEXT.md`. Each phase ships independently and adds reliability.

**Phase B Priority #1.4 — RPA bug fixes** (PARTIAL)
- Stage 5 timing parser ✅ shipped
- Stage 3 batching ✅ shipped
- Quantity stepper rules ⚠️ pending

**Phase B Priority #1.5 — KMS migration** (CRITICAL before paying customers)
- Encryption key out of env, into managed KMS
- Per-store DEK with envelope encryption

**Phase B Priority #1.6 — Credential audit log** (paired with #1.5)
- Immutable `credential_access_log` table
- Anomaly detection alerts

**Phase B Priority #2A — NRS bulk import** ✅ SHIPPED 2026-05-08
- 4,169 auto-confirmed mappings live

**Phase B Priority #2B — Search hardening** ✅ SHIPPED 2026-05-09
- AND-token, auto-prefix, MLCC truncation aliases, type-word stop list

**Phase B Priority #2C — Operator review UI**
- Single page for the 1,284 ambiguous import results
- One-click approve / reject / edit
- Approval writes verified mapping; rejection logs reason
- Recovers ~600-800 more permanent mappings

**Phase B Priority #2D — Scoring polish**
- Glass vs plastic detection (PL marker)
- Stricter brand-mismatch penalty for cross-brand false positives
- Re-run import after each tightening

**Phase B Priority #3 — Customer-facing scanner submit** ✅ SHIPPED 2026-05-08
- Cart sync + Submit + progress polling

**Phase B Priority #3.5 — Scanner UX hardening**
- Quantity stepper enforces split-case rules (1.75L = 1 or 3, 200ml = 12 or 24)
- Empty-result UX ("MLCC doesn't currently carry this — try searching by name")
- Camera-scanned UPC fallback when no mapping exists

**Phase B Priority #4 — Customer signup / login**
- Real Supabase JWT replaces dev service-role bearer in scanner
- Store_users membership row creation on signup

**Phase B Priority #5 — Email + push notifications**
- Resend / Postmark integration
- RPA failure → 5-minute customer notification SLA

**Phase B Priority #6 — Order history + re-order**

**Phase D — Catalog enrichment campaign** (multi-week, post-MVP)
- UPCitemdb paid tier integration
- Bulk-enrich `mlcc_items.upc` for items lacking UPCs
- ADA partnership outreach for distributor UPC lists
- Crowd-source customer scans (every confirmed scan = permanent mapping)

**Phase D+ — Production hardening**
- Periodic MLCC catalog sync (weekly cron)
- Stale-mapping detection
- `upc_candidates` table + automated routing
- `upc_evidence` immutable log
- Conflict detection on re-imports
- SOC 2 audit prep (at 100+ customers)

---

## Decision log (opinions that are now binding)

- **Deterministic rules ALWAYS run before fuzzy.** Fuzzy is only a UI fallback, never an import path.
- **Verified mappings are immutable without operator action.** Re-imports `upsert` only when `confidence_source` matches or upgrades; otherwise creates a `review_issue`.
- **MLCC catalog is mirrored locally** but never edited locally. Re-ingest replaces, never patches.
- **Brand aliases are bidirectional + first-class.** Adding an alias is a code-reviewed change, not a config tweak.
- **No AI in the critical matching path.** AI may suggest aliases or generate review-queue prompts; AI never writes a `upc_mappings` row.
- **Store-scoped data is RLS-isolated** at the DB layer, not just at the API layer.
- **Every UPC observation is permanent evidence.** `upc_mappings` rows survive forever. `upc_evidence` (future) logs every sighting.

---

## Hidden risks Tony may be underestimating

1. **MLCC catalog mutations.** When MLCC discontinues / renames / retires a code (e.g., the "code 13049 → 17784" reactivation we saw), our local mirror and existing `upc_mappings` go stale. Need re-ingest cadence + reconciliation job.

2. **UPC reuse / rebranding.** Same UPC can move between products over years (rebrand, distributor change). `upc_evidence` history protects us — never assume current mapping is forever-correct.

3. **Customer credential rotation.** MLCC password expirations / account lockouts will silently break RPA runs. Need Stage 1 INVALID_CREDENTIALS detection wired to customer email/push notification ASAP.

4. **Scoring engine drift.** As we add tighter penalties / boosts, regressions are easy. **Need an integration test that re-runs a fixed sample import and asserts auto-confirm count stays within expected band.**

5. **Multi-tenant blast radius.** A bug in store-scoping middleware = cross-tenant data leak. Existing RLS catches most, but every new endpoint needs explicit verification.

6. **External API rate limits.** UPCitemdb paid tier has caps. Bulk-enrichment scripts need rate limiting + checkpointing — a hung run that resumes shouldn't re-pay for already-enriched items.

7. **Operator review queue burnout.** If review UI is slow or unintuitive, operators (Tony for now) won't keep up, and the backlog grows. **The review UX has to be one-click fast.**

---

## The first concrete next move

After tonight's search fix + NRS re-run, the highest-leverage build is **Phase B Priority #2C: Operator review UI**.

Why:
- 1,284 ambiguous mappings are sitting in the import report waiting to be approved or rejected.
- Each one approved = one more permanent UPC mapping. ~600-800 expected to be quick yes/no decisions.
- The UI also unlocks the broader pattern: any future ambiguity (new scans, new imports) routes through the same flow.
- Cost: ~3-4 hours of focused work.
- Output: 5,000+ permanent mappings instead of 4,170. Materially closer to the "every bottle in your store maps instantly" goal.

Everything else (KMS, audit log, UPCitemdb enrichment, conflict detection) builds on top of this foundation.

---

**This document is the canonical vision. When in doubt, return here. When making decisions, ask "does this serve the principles?" If yes, build it. If no, don't.**

🥃
