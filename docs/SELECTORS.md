# MLCC SAFE MODE RPA — selector audit

Inventory of **selector touchpoints** on the current dry-run / probe path, with **GREEN** = multi-strategy resolution (or intentional no-op) plus failure forensics where applicable, **RED** = single-strategy / heuristic-only / not yet hardened.

Implementation references: `services/api/src/workers/mlcc-browser-add-by-code-probe.js` (resolvers + phases), `services/api/src/workers/mlcc-browser-worker.js` (MILO login bootstrap), `services/api/src/workers/mlcc-browser-evidence.js` (`collectSafeModeFailureEvidencePack` — bounded page text + body HTML excerpt + optional PNG).

---

## Classification

| Status | Meaning |
|--------|---------|
| **GREEN** | **Order-critical** or **upgraded non–order-critical** control: **primary tenant selector** (where applicable) plus **scoped fallback chain** (different strategy than primary alone). On hard failure after strategies are exhausted (or ambiguous), **`collectSafeModeFailureEvidencePack`** is attached to probe evidence or `MlccLoginFailure` diagnostics **before** throw where the phase performs a click or locator commitment. |
| **RED** | No fallback chain yet, advisory/heuristic-only, or read-only discovery — acceptable follow-up. |

**SAFE MODE:** No phase in this repo performs **submit order**, **place order**, or **confirm order** clicks. Those controls are intentionally **out of scope** of executable phases; they are **GREEN (policy)** — not a selector gap.

---

## Order-critical selectors (must be GREEN; unchanged)

| Control | Purpose | Primary | Fallback / resolution strategy | Evidence on failure |
|---------|---------|---------|----------------------------------|----------------------|
| **Validate (Phase 2q)** | Single bounded validate click after add-line | `MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS` JSON list (first eligible control) | `resolveMlccProbeValidateClickLocatorWithFallbackChain`: **main → dialogs (≤6) → optional `MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR` → global** (`MLCC_PROBE_VALIDATE_LOCATOR_FALLBACK_STRATEGY_ORDER`) | `collectSafeModeFailureEvidencePack` on ambiguous validate, click error, **no eligible candidate**, **locator resolution failure** (`!resolved.ok` non-ambiguous), plus existing step snapshots |
| **Validate (Phase 2v MILO)** | Same-run MILO successor validate | `MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_SELECTORS` | Same resolver as 2q | Same forensics pattern as 2q for **no eligible**, **resolution failure**, ambiguous, click error |
| **Quantity input (Phase 2j / 2l / MILO manual parity / Tab-from-qty)** | Typed quantity rehearsal and MILO gestures | `MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR` (tenant CSS) | **`resolveMlccProbeQuantityFillLocatorWithFallbackChain`**: per scope try **tenant CSS → `getByRole('spinbutton')` → first eligible `input[type=number]`** (with Phase 2j surface allowlist); scopes **main → dialogs → mutation boundary → `html` document** (`MLCC_PROBE_QUANTITY_LOCATOR_FALLBACK_STRATEGY_ORDER`) | `collectSafeModeFailureEvidencePack` when resolution fails or quantity ambiguity; strategy echoed as `quantity_locator_strategy` in evidence |
| **Submit / confirm order** | N/A in SAFE MODE executable path | — | **No worker phase clicks checkout/submit/confirm** (network guards + phase policy) | N/A |

---

## Non–order-critical selectors (SAFE MODE path)

| Area | Purpose | Primary | Fallback chain (GREEN) or notes | Status |
|------|---------|---------|----------------------------------|--------|
| **Login — username / email** (`prepareMlccLoginPage`) | Session bootstrap | `fillMlccLoginIdentifier`: `getByPlaceholder` (auth), `getByLabel`, `getByRole('textbox')`, `input[type=email]`, `USERNAME_SELECTORS` | **GREEN**: semantic order then attribute list (distinct strategies). On failure: **`collectSafeModeFailureEvidencePack`** → `MlccLoginFailure` (`SELECTOR_MISMATCH`) with human-readable detail | **GREEN** |
| **Login — password** | Session bootstrap | `fillMlccLoginPassword`: `getByLabel(/password/)`, `PASSWORD_SELECTORS` | **GREEN**: label then type/name CSS list. On failure: **`collectSafeModeFailureEvidencePack`** in diagnostics | **GREEN** |
| **Login — submit** (`commitMlccLogin`) | Post-credential submit | `clickMiloLoginButton` → `form.requestSubmit` → `clickMlccLoginSubmitFallback` (`button[type=submit]`, `input[type=submit]`, `getByRole('button', { name: /sign in|log in|login|continue/i })`) | **GREEN**: multi-step submit path (no new navigation). On total miss: **`collectSafeModeFailureEvidencePack`** → `MlccLoginFailure` | **GREEN** |
| **Login — agreement checkbox** | Consent when present | `tryCheckMlccAgreementIfPresent`: MILO terms `getByRole('checkbox')`, generic role, scan `input[type=checkbox]` + label text | Heuristic scan (last resort). No `collectSafeModeFailureEvidencePack` on success path only | **RED** (heuristic tail; non-blocking when absent) |
| **License / store (Phase 2a)** | Optional store pick | `MLCC_LICENSE_STORE_SELECT_SELECTOR`, `MLCC_LICENSE_STORE_CONTINUE_SELECTOR` | Env-only | **RED** |
| **Add-by-code entry (2b / 2f)** | Open by-code surface | `MLCC_ADD_BY_CODE_ENTRY_SELECTOR` / `MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS` | Text allowlist extensions | **RED** |
| **By-code nav URL (2c)** | Navigate to dedicated by-code page | `MLCC_ADD_BY_CODE_PHASE_2C_NAV_BYCODE_URL` + `page.goto` | URL-driven; not a DOM selector chain | **RED** (documented as non-selector) |
| **Code field — Phase 2c read-only** | Inspect / advisory | `resolveCodeFieldLocatorPhase2c`: tenant env → `getByPlaceholder('Search by code')` → hint heuristics | Read-only; advisory hints | **RED** (advisory lane; distinct from typing phases) |
| **Code field — Phase 2h / 2l combined / MILO manual parity** | Typed code rehearsal | Tenant `MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR` | **GREEN**: **`resolveMlccProbeCodeFieldFillLocatorWithFallbackChain`** — per scope **tenant CSS → placeholder regex → `getByRole('combobox')` → `getByRole('textbox')`** with `phase2lCodeFieldDomSnapshotAllowed`; scopes **`MLCC_PROBE_CODE_FIELD_LOCATOR_FALLBACK_STRATEGY_ORDER`** (same as quantity). Resolution / ambiguity: **`collectSafeModeFailureEvidencePack`** before throw | **GREEN** |
| **Add / apply line (2n)** | Single add-line click | `MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS` JSON | Policy + eligibility; no DOM scope fallback chain | **RED** |
| **MILO bulk (2u)** | Single bulk click | `MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS` | Text allowlist | **RED** |
| **Read-only cart / validate discovery** | Observation only | URLs + DOM heuristics | — | **RED** |

---

## Pilot disposition — remaining **RED** (final)

For **supervised SAFE MODE / dry-run pilot scope**, each remaining **RED** row has an explicit disposition. **GREEN** rows need no disposition row here.

| Area | Technical status | **Pilot disposition** | Rationale |
|------|------------------|----------------------|-----------|
| **Login — agreement checkbox** | RED (heuristic tail) | **ACCEPTED_NON_BLOCKING** | Only runs when a labeled checkbox is visible; does not submit orders; failure to match leaves checkbox untouched — operator can complete manually. |
| **License / store (Phase 2a)** | RED | **ACCEPTED_NON_BLOCKING** for pilots that **skip** 2a or pre-resolve store manually | Single-strategy env selectors; mis-click risk bounded by phase policy but not multi-scope hardened. |
| **Add-by-code entry (2b / 2f)** | RED | **ACCEPTED_NON_BLOCKING** when probe entry phases are **off** or operator performs **one** guarded open | Tenant + allowlist; no full resolver chain like validate/qty/code typing. |
| **By-code nav URL (2c)** | RED (non-selector) | **ACCEPTED_NON_BLOCKING** | URL-driven `goto`; operator verifies URL env before run. |
| **Code field — Phase 2c read-only** | RED (advisory) | **ACCEPTED_NON_BLOCKING** | Read-only inspection lane; **typed** code paths use **GREEN** resolver (2h / 2l / manual parity). |
| **Add / apply line (2n)** | RED | **ACCEPTED_NON_BLOCKING** only if pilot plan **excludes** Phase 2n **or** operator accepts single-click tenant list risk | Order-adjacent but not “submit order”; still single-strategy family until a future hardening task. |
| **MILO bulk (2u)** | RED | **ACCEPTED_NON_BLOCKING** only if pilot plan **excludes** 2u **or** operator accepts tenant list + allowlist risk | Same pattern as 2n for bulk control. |
| **Read-only cart / validate discovery** | RED | **ACCEPTED_NON_BLOCKING** | Read-only observation; no cart mutation from this path. |

**Rule:** Any pilot that **enables** Phase **2n**, **2u**, or **2a** must explicitly accept residual selector risk or schedule a follow-up hardening task — do not treat this table as weakening SAFE MODE policy.

---

## Resolver exports (ordering reference)

| Constant | Order |
|----------|--------|
| `MLCC_PROBE_VALIDATE_LOCATOR_FALLBACK_STRATEGY_ORDER` | `main_scoped` → `dialog_scoped` → `mutation_boundary_scoped` → `global_scoped` |
| `MLCC_PROBE_QUANTITY_LOCATOR_FALLBACK_STRATEGY_ORDER` | `main_scoped` → `dialog_scoped` → `mutation_boundary_scoped` → `global_html_scoped` |
| `MLCC_PROBE_CODE_FIELD_LOCATOR_FALLBACK_STRATEGY_ORDER` | `main_scoped` → `dialog_scoped` → `mutation_boundary_scoped` → `global_html_scoped` |

---

## Manual verification notes

1. Run `npm run safety:lk:rpa-local` (or your usual SAFE MODE stack) from repo root.
2. **Break primary validate:** temporarily set the **first** entry in `MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS` to a non-matching selector while leaving a **second** valid selector for the same control, if your tenant config uses multiple entries — expect resolution to skip the bad entry via eligibility loop; to exercise **locator** fallback, use one eligible selector that matches **hidden** DOM in `main` but **visible** in the intended scope.
3. **Break primary quantity:** set `MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR` to a **hidden** matching node in `main` but keep a **visible** `input[type=number"]` in `main` — expect **`spinbutton_role_fallback`** or **`number_type_fallback`** in evidence (`quantity_locator_strategy`).
4. **Break primary code field (non–order-critical GREEN):** set `MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR` to a **non-matching** or **hidden** tenant node while a **visible** `input` with placeholder **Search by code** (or matching regex) exists in `main` — expect Phase **2h / 2l / MILO manual parity** to proceed with **`placeholder_regex_fallback`** (see evidence `code_field_locator_strategy`). If **all** strategies fail or are ambiguous, expect **`safe_mode_failure_forensics`** on the thrown path.
5. **Login selector mismatch:** force a bad username field state (e.g. temporarily sabotage primary strategies in a branch) and confirm `MlccLoginFailure` diagnostics include **`safe_mode_failure_forensics`** (screenshot / HTML excerpt fields from `collectSafeModeFailureEvidencePack`).
6. Revert local edits after inspection.

---

## Changelog (maintenance)

| Date | Change |
|------|--------|
| 2026-04-10 | Initial audit doc; quantity resolver + validate/2q/2v failure forensics aligned with order-critical policy |
| 2026-04-10 | SPEC-RPA-SELECTOR-AUDIT-NON-CRITICAL: expanded non–order-critical table; **GREEN** code-field resolver (`resolveMlccProbeCodeFieldFillLocatorWithFallbackChain`) for 2h / 2l / MILO manual parity; login prep/submit **`collectSafeModeFailureEvidencePack`** on selector mismatch; login identifier **`getByPlaceholder`** strategy |
| 2026-04-10 | SPEC-RPA-FINALIZATION: **Pilot disposition** subsection for each remaining RED (ACCEPTED_NON_BLOCKING vs scope exclusions) |
