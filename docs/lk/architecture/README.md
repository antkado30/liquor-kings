# Liquor Kings — canonical architecture specs (Anti-Drift v1)

These documents are **repo source of truth** for contracts, safety, execution behavior, and **product systems direction** (execution lanes, reconciliation, partner resilience).  
If code changes behavior, **update the matching doc** and **run verification** (see `docs/lk/DEVELOPER_ANTI_DRIFT.md`).

| Document | Scope |
|----------|--------|
| [strategic-architecture.md](./strategic-architecture.md) | MILO as current lane; LK as control/reconciliation; durable truth vs browser-only; reconciliation vocabulary; partner drift |
| [execution-state-machine.md](./execution-state-machine.md) | Run statuses, retries, attempts, operator actions |
| [rpa-rebuild-phases.md](./rpa-rebuild-phases.md) | MLCC browser RPA phases 2a–2d and boundaries |
| [rpa-safety-rules.md](./rpa-safety-rules.md) | Non-submission rebuild rules, three-layer guards |
| [auth-and-store-scoping-invariants.md](./auth-and-store-scoping-invariants.md) | Store isolation, operator session, service role |
| [api-contract-truth.md](./api-contract-truth.md) | API routes and payloads that exist today |

Verification: `npm run verify:lk:architecture` (from repo root).
