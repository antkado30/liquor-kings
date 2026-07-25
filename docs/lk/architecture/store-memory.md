# Store memory — the moat (Phase A shipped 2026-07-24)

Tony's design calls (2026-07-24, RINSE'd): **every swap teaches silently**
(no confirm tap), and a remembered phrase **pins green with "★ remembered"**
(alternates still one tap away). This is RULEBOOK #27 pillar 3 made real —
the per-store vocabulary the AI reads AND writes; FLAGSHIP_ALIASES /
BRAND_SYNONYMS graduate here over time instead of living in code.

## How it works

**Learn (write path):** on the resolve card, choosing a DIFFERENT bottle
than the resolver's pick and adding to cart = a correction. The card
fire-and-forgets `POST /assistant/memory` (add-to-cart never waits).
Choosing the default teaches nothing (no false learnings). Server upserts
`store_resolver_memory` (newest word wins) with provenance + usage counters
— every learning is auditable and deletable.

**Recall (read path):** `resolve_bottles` normalizes each line's phrase and
looks it up in the store's memory BEFORE any searching (one query for the
whole list). A hit pins the store's own recorded bottle: `remembered: true`,
confidence high, `memory_note` tells the model to present it as their usual.
The card renders "★ remembered" instead of a confidence badge.

**Key symmetry (the correctness hinge):**
`phrase = tokenizeName(name-with-apostrophes-stripped).join(" ")` +
`size_ml` derived size→raw→name IDENTICALLY at learn time (route) and
resolve time (tool). "stoli vanilla" @750 and @1750 are separate memories.
Pinned by `tests/store-memory.unit.test.js` + the round-trip smoke.

## Boundaries (deliberate)

- Memory can only replay the store's OWN explicit choice — never invents.
- Everything not remembered runs the deterministic resolver unchanged.
- Memory informs matching only; it NEVER touches the cart.
- Fails SOFT everywhere: memory outage (or unapplied migration) = normal
  resolving, zero breakage. Safe to deploy before the migration runs.
- Auth posture matches /assistant/ask (storeId trusted, V1) — the same
  tracked V1.5 hardening item covers both.

## Pieces

`supabase/migrations/20260725010000_create_store_resolver_memory.sql`
(table + RLS, order_templates pattern) · `src/lib/store-memory.js`
(normalizePhrase / memoryKey / fetchMemoryIndex / recordCorrections /
markMemoryUsed) · `assistant.js` toolResolveBottles (prefetch + pin) ·
`assistant.routes.js` POST /assistant/memory · scanner
`api/assistant.ts` (`recordAssistantMemory`, `remembered` field) ·
`ResolvedOrderCard.tsx` (learn-on-swap + ★ badge).

## Phase B (queued)

Chat teaching ("remember we call X Y" → a `remember_store_fact` tool,
source='chat'); memory management UI (list/delete learnings in Settings);
store facts beyond aliases (par levels, usuals) feeding the assistant
prompt; seed-import from order history.
