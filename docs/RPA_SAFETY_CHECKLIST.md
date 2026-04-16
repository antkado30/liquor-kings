# RPA safety checklist — before work & after changes

One-page workflow for anyone touching **MLCC browser RPA**, **SAFE MODE**, **quantity/mapping guards**, **evidence**, or **verify/CI** wiring. Full invariant index: [`SAFETY_INVARIANTS.md`](./SAFETY_INVARIANTS.md). Product rules: [`lk/architecture/rpa-safety-rules.md`](./lk/architecture/rpa-safety-rules.md).

---

## Before you touch RPA code or tests

- [ ] **Read** [`lk/architecture/rpa-safety-rules.md`](./lk/architecture/rpa-safety-rules.md) for what must never ship without an approved phase.
- [ ] **Confirm** you are not being asked to enable real MLCC **submit / checkout / finalize** or weaken `MLCC_BROWSER_DRY_RUN_SAFE_MODE`.
- [ ] **Locate** the right layer: worker (`mlcc-browser-worker.js`), probe (`mlcc-browser-add-by-code-probe.js`), guards (`mlcc-guards.js`), evidence (`mlcc-browser-evidence.js`), quantity rules (`quantity-rules/index.js`), or verify (`scripts/lk-verify/verify-rpa-safety.mjs`).
- [ ] **Run** (from repo root) at minimum:
  ```bash
  npm run verify:lk:rpa-safety
  ```
- [ ] **Run** targeted API unit tests for the area you edit (example):
  ```bash
  cd services/api && npm test -- tests/mlcc-browser-add-by-code-probe.unit.test.js
  ```
- [ ] **Do not** set `MLCC_SUBMISSION_ARMED=true` or point automation at **production** MLCC URLs unless that is an explicitly separate, approved task (not this checklist).

---

## After an RPA *safety* change (code, tests, or CI docs that affect safety)

Run these in order from the **repo root** (same order as CI’s safe job, where applicable):

1. [ ] **Install & unit tests (CI-shaped, no smoke stack):**
   ```bash
   npm ci
   npm run test:ci
   ```
2. [ ] **RPA static gate + SAFE MODE invariant test:**
   ```bash
   npm run verify:lk:rpa-safety
   ```
3. [ ] If you changed **quantity rules** or **mapping guard**:
   ```bash
   cd services/api && npm test -- tests/quantity-rules.unit.test.js tests/mlcc-browser-worker.unit.test.js
   ```
4. [ ] If you changed **network guards**:
   ```bash
   cd services/api && npm test -- tests/mlcc-browser-add-by-code-probe.unit.test.js tests/mlcc-browser-worker.unit.test.js
   ```
5. [ ] If you changed **validate locator** behavior:
   ```bash
   cd services/api && npm test -- tests/mlcc-browser-add-by-code-probe.unit.test.js
   ```
6. [ ] If you changed **evidence / run summary** helpers:
   ```bash
   cd services/api && npm test -- tests/mlcc-browser-evidence.unit.test.js
   ```
7. [ ] **Optional** (no browser in verify; config sanity only):
   ```bash
   npm run doctor:lk:mlcc-dry-run
   ```

Then:

- [ ] **Open a PR** and confirm GitHub Actions **“Liquor Kings CI (SAFE MODE — tests & RPA safety)”** is green.
- [ ] **Update** [`SAFETY_INVARIANTS.md`](./SAFETY_INVARIANTS.md) if you added a new invariant or a new verification command.

---

## Quick “never do this” reminders

- Do **not** add CI steps that run the full MLCC browser worker against **production** credentials.
- Do **not** merge changes that make `verify:lk:rpa-safety` fail or remove `tests/rpa/safe-mode-invariant.test.js` without a replacement invariant.
- Do **not** instruct operators to set `SAFEMODE=false` or disable network guards to “get the run unstuck.”

---

## Where to look in GitHub

1. **Actions** → workflow **“Liquor Kings CI (SAFE MODE — tests & RPA safety)”**  
2. Confirm steps: `npm ci` → `npm run test:ci` → `npm run verify:lk:rpa-safety`  
3. Logs should show Vitest passing (smoke tests excluded) and `[verify:lk:rpa-safety] OK`.
