# Liquor Kings — V1 Scope Lock + AI Assistant Design

**Date:** 2026-05-17
**Status:** V1 scope definition. This document is the locked target — build against it.
**Supersedes:** the phased roadmap in `docs/PRODUCT_SPEC.md` §Phases for the V1 line specifically.

---

## Why this document exists

V1 is the version Connor pitches to his uncle (an experienced independent
liquor store owner). The demo has to be airtight. The failure mode that
loses that demo is NOT "too few features" — it's "a feature was buggy" or
"it added the wrong item." An experienced operator is unimpressed by
feature count and very impressed by "this works and saves me real time."

So V1 is **four pillars, each excellent.** Nothing else ships in V1.
Everything else is explicitly descoped to V1.5+ (see Non-Goals).

---

## V1 = Four Pillars

### Pillar 1 — MLCC Ordering (RPA)

**What it is:** The headless-browser automation that logs into MILO,
navigates to products, adds items to the cart, validates, and submits the
order — returning the MLCC confirmation number.

**Status as of 2026-05-17:** Stages 1-4 LOCKED DOWN in production.
Self-healing (auto-clear), self-diagnosing (typed errors w/ banner
extraction), self-verifying (v2 cart-state check), resilient to slow-MILO
days (90s/240s timeouts). Stage 5 (checkout submission) code exists,
triple-gated, never run live — first real run is Thursday 2026-05-20.

**Remaining V1 work:**
- Thursday: first real Stage 5 submission against family store.
- Stage 1 NETWORK_ERROR retry (Playwright cold-start flakiness).
- Stage 4 `validated:false` timing-race robustness.

**P0.** This is the core. Without it there is no product.

### Pillar 2 — Scanner

**What it is:** The phone/tablet app the operator walks the store with.
Scan a UPC, it maps to the MLCC code, builds a cart with real-time
validation, submits to the RPA engine.

**Status:** Scanner SPA exists (`apps/scanner/`). Cart is currently FLAT —
no per-ADA grouping, no client-side rules validation, not deployed to a
stable URL.

**Remaining V1 work (the bulk of upcoming effort):**
- ADA-grouped cart with live per-ADA liter totals + 9L warnings
- Quantity input with split-case validation + valid-quantity suggestions
- Submit button gated by a `/cart/validate` API response
- Deploy to a stable URL (Vercel/Netlify) so it can be demoed by link

**P0.** This is the customer-facing product and the demo surface.

### Pillar 3 — Shelf Tag Printing

**What it is:** Print MLCC shelf tags / price labels for Brother, Star,
or Zebra label printers.

**Status:** Not built. (Saxon has this — it's table stakes / parity, not
differentiation.)

**Remaining V1 work:** Build the tag-generation + print flow.

**P1.** Table stakes — needed for parity with Saxon, but the ordering +
scanner + AI pillars are what win the demo. If V1 has to ship a few days
early, this is the pillar that could slip to a fast-follow. Do not let it
expand in scope.

### Pillar 4 — AI Assistant (the moat — NEW for V1)

See full design below. This is the differentiated wow-factor feature.

**P0.** Promoted into V1 from the old Phase 2/3 roadmap on 2026-05-17.

---

## AI Assistant — Technical Design

### The principle

There are two AI products we could build. Only one is worth shipping.

**The commodity version** — a chatbot that answers generic liquor
questions ("how is bourbon made", "what's a good margarita mix"). An LLM
does this out of the box. So does ChatGPT. So could Saxon in a weekend.
**Zero moat. Not worth V1 as a headline feature.**

**The moat version** — an assistant grounded in *this store's own data*.
It answers questions no generic chatbot and no competitor can:

- "What did I order from General Wine last week?"
- "What's my best-selling whiskey this month?"
- "Is Tito's in stock at MLCC right now?"
- "What am I low on that I should reorder before Thursday?"
- "How much would 3 cases of Jack cost me at licensee price?"
- "Why won't my cart validate?"
- "What's the 9L situation on my current cart?"

These require the store's order history + live MLCC catalog + the
`mlcc_rules` table + NRS inventory — data **only Liquor Kings has**.
That is the "up to the minute" claim made real: not magic, just our
existing data pipelines (MLCC pricebook ingest, NRS sync) feeding the
model as live context.

**V1 builds the moat version.** The generic-liquor-knowledge capability
comes free with the underlying LLM and can answer off-topic questions as
a fallback — but it is not the headline and not where engineering effort
goes.

### Architecture

```
Operator question (scanner UI or web)
        │
        ▼
  POST /assistant/ask  { storeId, question, conversationId? }
        │
        ▼
  Claude API (Anthropic) with tool-use enabled
        │
        ├─ tool: query_catalog(filters)      → mlcc_items
        ├─ tool: query_rules(type?)          → mlcc_rules (via lib/mlcc-rules.js)
        ├─ tool: query_order_history(storeId, range) → execution_runs + cart history
        ├─ tool: query_inventory(storeId)    → NRS-synced inventory / bottles
        ├─ tool: check_stock(mlccCode)       → live MLCC stock (RPA or cached)
        └─ tool: price_quote(mlccCode, qty)  → licensee price math
        │
        ▼
  Claude composes a grounded answer from tool results
        │
        ▼
  Response streamed back to the UI
```

**Why tool-use, not RAG embeddings:** the store's data is structured
(SQL tables), changes constantly, and is small per-store. Tool-use lets
Claude query the live tables on demand — always current, no stale index
to rebuild. RAG would add an embedding pipeline for no benefit here.

### Build components

1. **`services/api/src/lib/assistant.js`** — orchestrates the Claude API
   call with the tool definitions. Each tool maps to a Supabase query
   (most of which already exist as service functions).
2. **`services/api/src/routes/assistant.routes.js`** — `POST /assistant/ask`
   endpoint. Auth-scoped to the store. Streams the response.
3. **Tool implementations** — thin wrappers over existing data access:
   `mlcc-rules.js` (built), `mlcc_items` queries, order-history queries,
   NRS inventory queries. The only genuinely new data tool is
   `check_stock` (live MLCC stock) — V1 can use the last-known stock from
   recent RPA runs rather than a live check, to avoid a Playwright spin-up
   per question.
4. **Scanner UI — assistant panel** — a chat surface in the scanner app.
   Streaming responses. Suggested-question chips for the demo
   ("What should I reorder?", "Why won't my cart validate?").

### Scope guardrails for the AI in V1

- **In scope:** store-data-grounded Q&A (catalog, rules, order history,
  inventory, pricing, cart validation explanations).
- **In scope (free, low-effort):** generic liquor knowledge as fallback
  when a question isn't about store data.
- **Out of scope for V1:** voice input, conversational cart-building
  ("add 3 cases of Tito's" via chat), proactive notifications. These are
  V2 — do not let them creep in.

---

## Non-Goals (explicitly descoped from V1)

Resist adding these. Each is a real future feature; none belongs in V1.

- Voice-driven cart building
- Proactive reorder notifications / alerts
- Reporting dashboard (purchases by category, YoY, etc.)
- Price-change tracking + alerts
- SIPS+ backend integration
- Multi-state expansion (V1 is Michigan only)
- Customer-facing onboarding / self-serve signup (operator-onboarded in V1)
- Status page (status.liquorkings.com)
- A fifth pillar of any kind

If a feature idea appears mid-build, it goes on the V1.5+ list, not into
V1. The discipline of four-pillars-done-excellently is the strategy.

---

## Build Order (recommended)

1. **AI Assistant backend** — `lib/assistant.js` + `/assistant/ask` route
   + tools. Backend-only, additive, low-risk. First real consumer of the
   `mlcc-rules.js` module shipped 2026-05-17.
2. **`/cart/validate` endpoint** — wires `mlcc-rules.js` into a cart-level
   validator. Needed by both the scanner and the assistant's
   "why won't my cart validate" answer.
3. **Scanner cart UI overhaul** — ADA grouping, per-ADA liter bars,
   quantity validation, submit gate. (Big multi-file React work — this
   is the Cursor-brief workstream per the team's tooling agreement.)
4. **Scanner assistant panel** — chat UI consuming `/assistant/ask`.
5. **Shelf tag printing** — Pillar 3.
6. **Scanner deploy to stable URL.**
7. **V1 end-to-end demo rehearsal** — full run as Connor's uncle would
   see it, every pillar, looking for the buggy edge case before the
   uncle does.

---

## Definition of Done for V1

V1 ships when:
- A store can be onboarded (operator-driven is fine for V1).
- The operator scans bottles → cart validates per-ADA in real time →
  submit → RPA places the real MLCC order → confirmation number returned.
- The AI assistant answers store-data questions correctly and fast.
- Shelf tags print on at least one common printer.
- The full flow has been demo-rehearsed end to end with zero crashes on
  the happy path, and the top 5 edge cases each fail gracefully with a
  clear message.
