# RPA safety rules — rebuild (canonical)

**Non-negotiable:** Until an **explicitly approved later phase**, the MLCC browser dry-run / rebuild path must **not** perform:

- Real order **submission**
- **Checkout** or final confirmation flows
- Cart **validate** (MLCC “validate order” style actions)
- **Add-to-cart** or other **cart/order mutation**
- **Quantity** field entry / quantity typing (Phase **2h** still does **not** touch quantity)

Violations are a **product incident**, not a documentation gap.

## Three-layer blocking (current implementation)

1. **Code paths** — Worker does not implement submit/checkout/validate/add-to-cart; success notes explicitly state no mutations. `assertMlccSubmissionAllowed` exists for **future** submit code and **throws** unless `MLCC_SUBMISSION_ARMED=true` (currently unused in the happy path).
2. **Network** — `installMlccSafetyNetworkGuards` + `shouldBlockHttpRequest` in `mlcc-browser-add-by-code-probe.js` aborts matching mutation-like URLs (methods/patterns as coded).
3. **UI** — `MLCC_PROBE_UNSAFE_UI_TEXT` / `isProbeUiTextUnsafe` block labels on **allowed** probe clicks; Phase 2d/2e classify controls (2e may scope to a root selector) but **do not click**. Phase **2f** may perform **at most one** click on a tenant-listed candidate only after the same Layer 3 + mutation-boundary eligibility checks. Phase **2g** adds field policy + extended DOM risk readout; optional **focus/blur** or **synthetic sentinel** fill/clear only when env-gated — **no** real product codes or quantities. Phase **2h** may **fill** a single tenant **code** field only when **both** `MLCC_ADD_BY_CODE_PHASE_2H` and `MLCC_ADD_BY_CODE_PHASE_2H_APPROVED` are true and a valid test code is configured — **no** Enter, **no** quantity field, **no** submit/add/validate/checkout clicks; **hard-fail** if Layer 2 abort count increases during the type step.

`MLCC_BROWSER_DRY_RUN_SAFE_MODE` is exported as `true` from `mlcc-browser-worker.js`.

## Hard-fail behavior

- Worker failures finalize runs with `failure_type` / `failure_details` / `evidence` as implemented.
- Phase 2c/2d/2e/2f/2g/2h errors are wrapped with identifiable messages (`MLCC add-by-code phase 2c failed`, `… phase 2h failed`, etc.) for operator diagnostics.

## Truthfulness

- Evidence and diagnostics must not claim precision beyond stored fields (`failure_details`, attempts, evidence attributes). MLCC signals may be explicit or inferred per `mlcc-operator-context.service.js`.

## Future quantity and post-quantity ladder (Phase 2i)

Phase **2i** is **planning-only**: the worker and probe **do not** execute it and **do not** type quantity, add to cart, validate, checkout, or submit.

- **Canonical criteria** for any **future** quantity phase live in [`services/api/src/workers/mlcc-phase-2i-policy.js`](../../../services/api/src/workers/mlcc-phase-2i-policy.js) (`buildPhase2iQuantityFutureGateManifest`, `buildPhase2iBroaderInteractionLadder`). Summaries appear in [rpa-rebuild-phases.md](./rpa-rebuild-phases.md).
- **Ladder:** quantity rehearsal → quantity clear/revert → add/apply-style step → validate → checkout/submit — each step **`out_of_scope_until_separate_approval`** until explicitly documented and verified.
- **Non-negotiables unchanged:** quantity entry, add-to-cart, validate, checkout, and submission stay forbidden in the current implementation path.

## Drift enforcement

- Run `npm run verify:lk:rpa-safety` from repo root (includes Phase **2i** policy file and phases-doc markers).
- See [DEVELOPER_ANTI_DRIFT.md](../DEVELOPER_ANTI_DRIFT.md).
