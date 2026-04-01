# Developer guide — Anti-Drift (Liquor Kings v1)

## Source of truth

1. **Canonical specs:** `docs/lk/architecture/` (execution model, RPA phases, safety, auth, API truth).
2. **Code:** `services/api`, `apps/admin`, workers under `services/api/src/workers/`.

If you change behavior, **update the matching spec** in the same PR. If you add a contract route or worker safety invariant, **extend verification** when practical.

## Verification (run locally / CI)

From **repo root**:

```bash
npm run verify:lk:contracts
npm run verify:lk:rpa-safety
npm run verify:lk:architecture
```

`verify:lk:architecture` runs contracts + rpa-safety together.

## Tests and builds

After substantive API or worker changes:

```bash
cd services/api && npm test -- --run
cd /path/to/repo && npm run build:admin
```

## Cursor / review expectations

- PRs and agent output should list **exact files changed** and **test/build/verify results**.
- **Drift** (docs vs code vs tests) is a **merge blocker** once team adopts these checks — not something to track in chat memory.

## RPA rebuild reminder

No MLCC order submission, checkout, **runtime** validate, or add-to-cart in the rebuild path until a **dedicated approved phase**. Validate **planning** lives in `services/api/src/workers/mlcc-phase-2p-policy.js` (Phase **2p**; not imported by worker/probe until an execution phase). See `docs/lk/architecture/rpa-safety-rules.md`.
