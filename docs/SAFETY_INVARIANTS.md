# MLCC RPA — safety invariants (current posture)

This page is the **human-oriented index** of what must stay true for Liquor Kings MLCC browser RPA in **SAFE MODE / dry-run**. Canonical product rules and phase detail live in [`lk/architecture/rpa-safety-rules.md`](./lk/architecture/rpa-safety-rules.md); use that doc for “what may never ship without approval.”

**RPA DONE rollup (Gates + open gaps):** [`RPA_SUBSYSTEM_DONE.md`](./RPA_SUBSYSTEM_DONE.md).

**Scope:** Invariants below are **as implemented today** (code + tests + CI). Re-verify after any RPA safety change using the commands in each row.

---

## 1. Dry-run is explicit (no silent “real order” mode)

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Browser worker exports dry-run SAFE MODE as a compile-time constant | `export const MLCC_BROWSER_DRY_RUN_SAFE_MODE = true` in `services/api/src/workers/mlcc-browser-worker.js` | `grep -n MLCC_BROWSER_DRY_RUN_SAFE_MODE services/api/src/workers/mlcc-browser-worker.js` |
| Submission guard exists for future submit paths; dry-run path does not arm ordering | `assertMlccSubmissionAllowed` not called from `processOneMlccBrowserDryRun` body (static verify) | `npm run verify:lk:rpa-safety` (must exit 0) |

**Commands:** `npm run verify:lk:rpa-safety` (repo root).

---

## 2. Layer 2 — network guards (SAFE MODE traffic shaping)

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Same URL policy for route abort and tests | `shouldBlockHttpRequest` + `installMlccSafetyNetworkGuards` in `services/api/src/workers/mlcc-guards.js`; installed on Playwright context in worker | `services/api/tests/mlcc-browser-add-by-code-probe.unit.test.js` (`shouldBlockHttpRequest`), `services/api/tests/mlcc-browser-worker.unit.test.js` (network policy describe) |
| Phase 2n / 2q allowlisted mutation URLs stay allowed | Explicit allowlist for `/order/apply-line` and `/order/validate` POST in guards | Same unit tests + guard source |

**Commands:**

```bash
cd services/api && npm test -- tests/mlcc-browser-add-by-code-probe.unit.test.js tests/mlcc-browser-worker.unit.test.js
```

---

## 3. SAFE MODE network invariant (automated + wired into verify)

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Blocked “order-risk” requests never complete as successful HTTP on realistic hosts when guards are installed | `tests/rpa/safe-mode-invariant.test.js` uses `installMlccSafetyNetworkGuards` + same module as production | `node --test tests/rpa/safe-mode-invariant.test.js` (repo root) |
| Verify script runs that test on every verify | `scripts/lk-verify/verify-rpa-safety.mjs` spawns `node --test tests/rpa/safe-mode-invariant.test.js` | `npm run verify:lk:rpa-safety` |

**Commands:**

```bash
node --test tests/rpa/safe-mode-invariant.test.js
npm run verify:lk:rpa-safety
```

---

## 4. Validate click — selector fallback and ambiguity safety

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Resolve validate clicks via ordered scopes (main → dialogs → mutation boundary → global), not a single blind global first() | `resolveMlccProbeValidateClickLocatorWithFallbackChain` in `services/api/src/workers/mlcc-browser-add-by-code-probe.js` | `services/api/tests/mlcc-browser-add-by-code-probe.unit.test.js` (Playwright-backed describe for primary / fallback / ambiguity) |
| Multiple visible ambiguous targets → no click | Returns `ok: false` with documented reasons | Same tests |

**Commands:**

```bash
cd services/api && npm test -- tests/mlcc-browser-add-by-code-probe.unit.test.js
```

---

## 5. Evidence baseline (milestones + run summary)

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Predictable on-disk milestone filenames when safe-flow dir is set | `buildMlccSafeFlowMilestoneDiskFilename` + worker `safeFlowShot` wrapper in `services/api/src/workers/mlcc-browser-worker.js` | `services/api/tests/mlcc-browser-evidence.unit.test.js` |
| Run folder + `mlcc_run_summary.json` on success/failure when screenshot dir configured | `writeMlccSafeFlowRunSummaryJson`, `buildMlccSafeFlowRunSummaryPayload`, worker `persistMlccDryRunRunSummaryToDisk` | `services/api/tests/mlcc-browser-evidence.unit.test.js` |
| Failure packs may include text + bounded HTML excerpts | `collectSafeModeFailureEvidencePack` in `services/api/src/workers/mlcc-browser-evidence.js` | Evidence unit tests + probe tests that assert excerpt fields where applicable |

**Commands:**

```bash
cd services/api && npm test -- tests/mlcc-browser-evidence.unit.test.js
```

---

## 6. Quantity rules + dry-run mapping-confidence guard

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Documented SKU snap rules (regression anchors) | `snapQuantityForMlccSku` in `services/api/src/quantity-rules/index.js` (e.g. 7127 / 4101 / unknown identity) | `services/api/tests/quantity-rules.unit.test.js` |
| Payload items with `mappingconfidence` / `mappingConfidence` / `bottle.*` = **unknown** block dry-run **before** browser | `evaluateDryRunMappingConfidenceGuard` in `services/api/src/quantity-rules/index.js`; called from `processOneMlccBrowserDryRun` after deterministic payload checks | `services/api/tests/quantity-rules.unit.test.js`, `services/api/tests/mlcc-browser-worker.unit.test.js` (wiring + behavior) |
| **Inferred** lines allowed but surfaced for review | Worker pushes `mlcc_dry_run_mapping_confidence` evidence when inferred list non-empty | Worker tests + manual log review of evidence kind |

**Commands:**

```bash
cd services/api && npm test -- tests/quantity-rules.unit.test.js tests/mlcc-browser-worker.unit.test.js
```

---

## 7. SAFE-MODE-only CI (tests + verify, no deploy)

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Push / PR runs unit tests (no live smoke stack) + RPA verify | `.github/workflows/liquor-kings-ci.yml` | Open GitHub → Actions → “Liquor Kings CI (SAFE MODE — tests & RPA safety)” |
| Job env forces submission off and placeholder URLs only | Workflow `env`: `SAFEMODE=true`, `MLCC_SUBMISSION_ARMED=false`, `*.example.invalid`, dummy Supabase strings | Inspect workflow YAML |
| `test:ci` installs Playwright Chromium, runs Vitest from `services/api` with smoke tests excluded, dummy Supabase for import-time clients | Root `package.json` `test:ci` script | `npm run test:ci` then `npm run verify:lk:rpa-safety` from repo root |

**Commands (local mirror of CI):**

```bash
npm ci
npm run test:ci
npm run verify:lk:rpa-safety
```

**Not run in that CI job:** MLCC browser worker against real tenants, deploy, or any “submit order” script.

---

## 8. Static RPA safety gate (large set of repo checks)

| What must stay true | Enforcement today | How to verify |
|---------------------|---------------------|---------------|
| Phase imports, probe/worker boundaries, `.fill` policy, docs cross-links, etc. | `scripts/lk-verify/verify-rpa-safety.mjs` | `npm run verify:lk:rpa-safety` |

---

## Cross-links

- [RPA safety rules (canonical)](./lk/architecture/rpa-safety-rules.md)
- [MLCC dry-run repeatability / doctor](./lk/architecture/mlcc-dry-run-repeatability.md)
- [Developer anti-drift](./lk/DEVELOPER_ANTI_DRIFT.md)

## Assumptions / TODOs

- **SKU pack sizes** in `quantity-rules` are **regression anchors** in code; if MLCC pack rules change, update `services/api/src/quantity-rules/index.js` and `services/api/tests/quantity-rules.unit.test.js` together.
- **Smoke tests** (`**/*.smoke.test.js`) are intentionally **out** of default `test:ci` because they expect a live API + database.
- Do **not** document or run steps that set `MLCC_SUBMISSION_ARMED=true` in CI or disable `MLCC_BROWSER_DRY_RUN_SAFE_MODE` without explicit product approval.
