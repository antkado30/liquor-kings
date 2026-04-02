# Strategic architecture — execution lanes, partner resilience, reconciliation (canonical)

**Status:** Product and systems direction locked for repo truth. This document does **not** change phase-gated RPA behavior; [rpa-safety-rules.md](./rpa-safety-rules.md) and [rpa-rebuild-phases.md](./rpa-rebuild-phases.md) remain authoritative for what the MLCC browser worker may do today.

## Execution lanes

- **MILO** is the **current production execution lane** for Liquor Kings: the path operators and systems rely on for live ordering workflows unless and until a separate decision moves volume elsewhere.
- **MLCC browser automation** (dry-run / phased rebuild under `services/api/src/workers/mlcc-browser-worker.js` and related modules) is an **explicit, guarded** execution mechanism. It does **not** replace MILO by default; it is built so LK can **add or shift** automation surfaces without treating any single partner UI as permanent truth.
- **Future partner changes** (MLCC evolution, SIPS+ or successor stacks, portal redesigns) are **expected**. LK architecture should assume UIs and APIs **will** drift; the product should absorb that through **configuration, adapters, evidence, and reconciliation** — not by assuming one frozen click path defines reality.

## Control system, not “only a click bot”

Liquor Kings should behave as a **control and reconciliation** layer:

- **Intent** — what the business decided to order (cart, run payload, operator-approved actions) lives in **LK-owned** records and APIs.
- **Execution** — MILO, browser workers, or future connectors **attempt** to realize that intent against partner systems. Outcomes are **observations**, not automatic proof of correctness.
- **Governance** — phases, safety rules, store scoping, and verify scripts constrain **how** automation may act; they do not remove the need to **compare** intent to downstream facts.

Browser automation is **one** way to drive partner surfaces. It must not be confused with the **whole product** or the **authoritative ledger** of what was ordered, accepted, or billed.

## Durable internal truth

**LK’s durable truth** should live primarily in **LK’s data model** (runs, attempts, evidence artifacts, operator actions, and future reconciliation records) — not only in ephemeral browser session state.

- Session-local DOM or screenshots prove **what was visible or clicked in that session**; they do not alone define **commercial or inventory truth** at the partner.
- Long-lived facts (identifiers usable for support, accounting, and audits) should be **stored, linked, and queryable** in LK storage, with clear provenance (which run, which source, which time).

This aligns with **anti-drift** practice: code, docs, and verification evolve together; partner HTML/CSS will not.

## Reconciliation model (concepts)

These terms describe how LK should reason about orders over time. They are **architectural vocabulary** for future schema and workflows; this file does not mandate a particular table layout today.

| Concept | Meaning |
|--------|---------|
| **Intended order truth** | What LK believes should be ordered: cart lines, quantities, store context, and operator/run **intent** before or during execution (payload + internal order/cart records as implemented). |
| **Observed browser/session truth** | What automation **saw or did** in a controlled session: step evidence, DOM snapshots, network guard deltas, phase outcomes. **Heuristic** or **inferred** labels (e.g. visible “checkout” text) stay explicitly non-authoritative for backend order state. |
| **Validated result truth** | When an **approved** phase explicitly performs a bounded partner action (e.g. env-gated validate under [rpa-rebuild-phases.md](./rpa-rebuild-phases.md)), the **declared** outcome of that action plus stored evidence — still distinct from “order definitely placed” unless a future phase and partner contract say otherwise. |
| **Post-order / order-history truth** | Facts available **after** the partner has processed an order: confirmation pages, order numbers, status APIs, **invoice** identifiers, emails, or EDI — as ingested into LK with source metadata. This layer is critical when partner UIs change but **history feeds** remain stable. |
| **Invoice / order-number / evidence linkage** | Stable **correlation keys** tying intent → execution attempts → partner references (PO, order #, invoice #). LK should preserve **bidirectional** or traceable links so operators can answer “which run produced which partner artifact?” |
| **Exception / mismatch classification** | When intended and post-order (or observed) facts **disagree**, LK should classify gaps (e.g. partial fill, price mismatch, missing confirmation, timeout) for **operator queueing** and **retry policy** — not silently conflate observation with success. |

## Partner-system resilience

- Prefer **adapters** (configurable selectors, URLs, policies) and **versioned** manifests (as in phase policy files) over hard-coded one-off scripts.
- Treat **industry news** (e.g. broader MLCC/SIPS+ modernization) as a signal to **invest in reconciliation and evidence**, not as a reason to abandon the current execution lane overnight.
- **Do not weaken** [rpa-safety-rules.md](./rpa-safety-rules.md) or `verify:lk:rpa-safety` to “move faster”; adaptability comes from **clear boundaries** and **internal truth**, not from skipping guards.

## Related canonical docs

- [execution-state-machine.md](./execution-state-machine.md) — run lifecycle and attempt history today  
- [api-contract-truth.md](./api-contract-truth.md) — HTTP surfaces that exist now  
- [auth-and-store-scoping-invariants.md](./auth-and-store-scoping-invariants.md) — isolation and session rules  
- [rpa-rebuild-phases.md](./rpa-rebuild-phases.md) / [rpa-safety-rules.md](./rpa-safety-rules.md) — MLCC browser phase and safety truth  
- [mlcc-dry-run-repeatability.md](./mlcc-dry-run-repeatability.md) — operator readiness for safe phases  

Verification: `npm run verify:lk:architecture` (includes contract path checks). See [DEVELOPER_ANTI_DRIFT.md](../DEVELOPER_ANTI_DRIFT.md).
