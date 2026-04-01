# RPA rebuild phases — MLCC browser worker (canonical)

**Primary implementation:** `services/api/src/workers/mlcc-browser-worker.js`  
**Add-by-code / guards:** `services/api/src/workers/mlcc-browser-add-by-code-probe.js`  
**Dry-run plan:** `services/api/src/workers/mlcc-dry-run.js`  
**Entry script:** `npm run worker:mlcc-browser-dry-run` in `services/api/package.json`

## Runtime through Phase 2j; planning through Phase 2k (as documented)

| Phase | Summary | Allowed | Forbidden |
|-------|---------|---------|-----------|
| **2a** | Login, optional license/store automation (env-gated), post-login navigation, step evidence | Bounded license/store **navigation** only when configured; heartbeats + evidence | Cart mutation, submit, validate |
| **2b** | Add-by-code **probe**: optional safe open click; field detection heuristics; **no typing** | `MLCC_ADD_BY_CODE_PROBE=true`; Layer 2 network + Layer 3 UI text guards | Typing codes/qty, dangerous clicks, cart mutation |
| **2c** | Tenant selectors for code/qty fields; read-only DOM inspection; optional `MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR` | Focus/blur only when risk check + env allow | Product/qty **typing**, cart mutation |
| **2d** | Full-page mutation-boundary map: read-only scan of visible controls; heuristic `safe` / `unsafe_mutation_likely` / `uncertain` | `MLCC_ADD_BY_CODE_PHASE_2D=true` (requires 2b probe). **Mutually exclusive with 2e.** | Any click in scan, typing, mutation |
| **2e** | **Scoped** mutation-boundary map: same heuristics as 2d but prefers controls under `MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR` when that root exists and is visible; otherwise **falls back** to the same broad scan as 2d and records that in evidence | `MLCC_ADD_BY_CODE_PHASE_2E=true` (requires 2b probe). Optional `MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS` (JSON) adds **advisory** labels on `uncertain` rows only — does not reclassify | Any click, typing, mutation, validate, checkout, submit |
| **2f** | **Safe open confirmation**: evaluates tenant-listed CSS candidates (priority order); **at most one** click on the first candidate that passes Layer 3 + mutation-boundary gates; verifies add-by-code UI signals (code-like field, tenant code selector, or scoped root visibility) and network guard delta | `MLCC_ADD_BY_CODE_PHASE_2F=true` + `MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS` (non-empty JSON array). Optional `MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS` for uncertain labels. Optional `MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV=true` to defer 2b entry clicks to 2f only | Second 2f click, typing, validate/checkout/submit/add-to-cart, any non-guarded mutation path |
| **2g** | **Pre-mutation typing policy + rehearsal**: documents future typing-phase gates; resolves code/qty fields like 2c; **extended mutation-risk** signals (form action, identifiers, submit controls, input type); **default read-only** — optional `MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL` or **double-gated** sentinel fill+clear (`MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING` + `MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE` matching `^__LK_[A-Z0-9_]{1,48}__$` only). No real product codes/qty | `MLCC_ADD_BY_CODE_PHASE_2G=true` (requires probe). Rehearsal env flags optional | Real SKU/qty entry, submit/validate/checkout/add-to-cart, silent escalation beyond declared rehearsal tier |
| **2h** | **Gated real code-field rehearsal** (tenant `MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR` only): `Playwright` **fill** of env test code, **no Enter**, **no quantity** interaction, **no blur**; same **extended mutation-risk** as 2g must pass first; **Layer 2** abort counter must not increase during type — otherwise **hard-fail** and **field not cleared**; if type is clean, **clear** via `fill("")` and re-check aborts | `MLCC_ADD_BY_CODE_PHASE_2H=true` + `MLCC_ADD_BY_CODE_PHASE_2H_APPROVED=true` + `MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE` (non-empty, ≤64 chars, no newlines) + tenant code selector | Quantity typing, Enter/submit, add-to-cart/validate/checkout, `type=number` target, heuristic-only code field |
| **2i** | **Planning repo truth** for quantity gates and post-quantity ladder (machine-readable checklist). **Not a standalone browser phase** — criteria are echoed and enforced when **2j** runs | Read [`mlcc-phase-2i-policy.js`](../../../services/api/src/workers/mlcc-phase-2i-policy.js); run `verify:lk:rpa-safety` | Claiming quantity or cart safety beyond evidence; skipping doc/verify when changing 2i/2j semantics |
| **2j** | **Gated quantity-field-only rehearsal** (tenant `MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR` only): `Playwright` **fill** of env test quantity, **no code field** interaction, **no Enter**, **no** add/validate/checkout/submit clicks; same **extended mutation-risk** as 2g must pass; **Layer 2** abort counter must not increase during type — otherwise **hard-fail** and **field not cleared**; if type is clean, **clear** via `fill("")` and re-check aborts. Optional **blur** only when `MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR=true` | `MLCC_ADD_BY_CODE_PHASE_2J=true` + `MLCC_ADD_BY_CODE_PHASE_2J_APPROVED=true` + `MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY` (strict positive integer string) + tenant **quantity** selector | Code field typing, code+quantity **combined** interaction in this phase, Enter/submit, add-to-cart/validate/checkout, `select` quantity control, heuristic-only qty field |
| **2k** | **Planning-only** — no browser execution, **no** worker/probe imports, **no** env flags. Codifies **future combined code+quantity** approval criteria and a **post-combined** interaction ladder (combined rehearsal → combined clear → add/apply → validate → checkout/submit) as repo truth | Read [`mlcc-phase-2k-policy.js`](../../../services/api/src/workers/mlcc-phase-2k-policy.js); run `verify:lk:rpa-safety` | Implementing combined fill in worker/probe without a new execution phase; add-to-cart, validate, checkout, submit; importing `mlcc-phase-2k-policy.js` into worker/probe before **2l** (or successor) is documented |

**Pre-browser:** deterministic payload validation (`assertDeterministicExecutionPayload`) before Playwright launch.

## Environment flags (non-exhaustive)

- `MLCC_ADD_BY_CODE_PROBE`, `MLCC_ADD_BY_CODE_PHASE_2C`, `MLCC_ADD_BY_CODE_PHASE_2D`, `MLCC_ADD_BY_CODE_PHASE_2E` (2D and 2E must not both be true), `MLCC_ADD_BY_CODE_PHASE_2F`, `MLCC_ADD_BY_CODE_PHASE_2G`, `MLCC_ADD_BY_CODE_PHASE_2H`, `MLCC_ADD_BY_CODE_PHASE_2H_APPROVED`, `MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE`, `MLCC_ADD_BY_CODE_PHASE_2J`, `MLCC_ADD_BY_CODE_PHASE_2J_APPROVED`, `MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY`, `MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR` (optional)
- `MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL`, `MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING`, `MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE` (Phase **2g** rehearsal; sentinel pattern enforced)
- `MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS` — JSON array of CSS selectors (Phase **2f**, required when 2F is on)
- `MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS` — optional JSON array for Phase **2f** uncertain open-intent matching
- `MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV` — optional; skips Phase **2b** entry navigation clicks so **2f** performs the bounded open
- `MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR` — optional CSS root for Phase **2e** scoped scan; reused in **2f** as a visibility signal when set
- `MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS` — optional JSON array `[{ "contains": "...", "advisory_label": "..." }]` for **uncertain** controls only (non-authoritative)
- `MLCC_ADD_BY_CODE_ENTRY_SELECTOR`, `MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR`, `MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR`
- `MLCC_SUBMISSION_ARMED` — must be `true` before any **future** submit path; **no submit path exists** in current worker
- License/store: `MLCC_LICENSE_STORE_AUTOMATION`, selectors, URL pattern

## Phase 2e evidence (worker / probe)

Evidence stage `mlcc_mutation_boundary_phase_2e_findings` includes: `scope_status`, `scoped_root_matched_visible`, `fallback_to_broad_scan`, scan counts, `safe_count` / `unsafe_count` / `uncertain_count`, full classified rows, `uncertain_review_examples` (capped), and per-row `uncertain_detail` where applicable.

## Phase 2f evidence (worker / probe)

Evidence stages: `mlcc_phase_2f_safe_open_findings` (and optional `mlcc_phase_2f_after_safe_open_click` snapshot). Attributes include per-candidate evaluation (reject reasons vs eligibility), `click_performed`, `selector_clicked`, `skip_click_reason`, UI open signals before/after, `scoped_root_reused_for_verification`, network guard before/delta, `tenant_safe_open_confirmed`, `recommend_tenant_safe_open_selector`, `recommendation_strength`.

## Phase 2g evidence (worker / probe)

Evidence stage `mlcc_phase_2g_typing_policy_findings` includes: `typing_policy_manifest` (versioned requirements/stop conditions), per-field `focusable_editable_summary`, `mutation_risk` (`block_reasons`, `advisory_signals`), `rehearsal_tier` (`none` | `focus_blur_only` | `sentinel_fill_clear`), rehearsal detail strings, `any_rehearsal_performed`, `run_remained_fully_non_mutating`.

## Phase 2h evidence (worker / probe)

Stages: `mlcc_phase_2h_pre_type_snapshot`, `mlcc_phase_2h_real_code_findings` (and `mlcc_phase_2h_real_code_blocked` on failure paths), optional `mlcc_phase_2h_post_clear_snapshot`. Attributes include `mutation_risk`, `mutation_risk_checks_used`, `network_guard_delta_during_type` / `_during_clear`, `field_cleared_after`, `quantity_field_touched` (always false), `run_remained_fully_non_mutating`, test code **length only** in evidence (not the value), and strict disclaimers.

## Phase 2i (planning-only execution — checklist echoed at Phase 2j runtime)

**Phase 2i has no standalone browser entry point** (planning-only relative to the worker: no `PHASE_2I` env flag). It is the versioned checklist (`buildPhase2iQuantityFutureGateManifest`, `buildPhase2iBroaderInteractionLadder`) that **Phase 2j** imports for evidence and alignment.

- **Canonical machine-readable gates:** [`services/api/src/workers/mlcc-phase-2i-policy.js`](../../../services/api/src/workers/mlcc-phase-2i-policy.js). Ladder steps stay tagged **`out_of_scope_until_separate_approval`** until a future phase implements them; the **quantity rehearsal** step notes the bounded **2j** implementation when env-gated.
- **Operator / developer clarity:** **Add-to-cart**, **validate**, **checkout**, and **submit** remain **forbidden** in **2j**. **2j** does **not** perform code+quantity combined interaction.
- **Anti-drift:** `npm run verify:lk:rpa-safety` asserts this doc and the policy file contain required Phase **2i** markers.

## Phase 2j evidence (worker / probe)

Stages: `mlcc_phase_2j_pre_type_snapshot`, `mlcc_phase_2j_pre_type_evidence`, `mlcc_phase_2j_quantity_findings` (and `mlcc_phase_2j_quantity_blocked` / `mlcc_phase_2j_post_clear_snapshot` as applicable). Attributes include `phase_2i_quantity_gate_manifest`, `mutation_risk`, `mutation_risk_checks_used`, Layer 2 deltas for type and clear, `code_field_parity_*` (when tenant code selector is configured and visible), `blur_used`, test quantity **length only** (not the value), and strict disclaimers.

## Phase 2k (planning-only — combined interaction model)

**Phase 2k does not run in the browser** and has **no** `MLCC_ADD_BY_CODE_PHASE_2K` env flag. The worker and probe **must not** import [`mlcc-phase-2k-policy.js`](../../../services/api/src/workers/mlcc-phase-2k-policy.js) until a separately approved **execution** phase (e.g. **2l**) exists in this doc and in verify/tests.

- **Canonical machine-readable gates:** `buildPhase2kCombinedInteractionFutureGateManifest()` — prerequisites from **2h**/**2j**, required tenant **code** and **quantity** selectors (non-heuristic), **tenant-documented field order** (code→qty, qty→code, or other), extended mutation-risk on **both** locators, Layer 2/3 guard expectations, hard-fail stops, and observable “non-mutating combined rehearsal” proof criteria (without claiming server cart state).
- **Post-combined ladder:** `buildPhase2kPostCombinedInteractionLadder()` — `combined_code_quantity_rehearsal` → `combined_clear_revert` → `add_or_apply_line` → `validate_order` → `checkout_submit`; each step **`out_of_scope_until_separate_approval`** until explicitly implemented and verified.
- **Truthfulness:** Successful **2h** and **2j** runs **do not** prove combined interaction is safe; **2k** states that explicitly in repo truth.

## Next execution phase (2l — not implemented)

The first **runtime** phase that could implement **combined code+quantity** rehearsal (single phase, both fields, still **no** add-to-cart/validate/checkout/submit) **must**:

1. Be documented in this table and in [rpa-safety-rules.md](./rpa-safety-rules.md) with dedicated env gates and operator approval flags.
2. Import or echo [`mlcc-phase-2k-policy.js`](../../../services/api/src/workers/mlcc-phase-2k-policy.js) only after relaxing the verify rule that currently forbids worker/probe imports of that module.
3. Extend `verify:lk:rpa-safety` and Vitest so the new path cannot land without repo truth.
4. Preserve three-layer safety; follow tenant-documented field order from **2k** manifest.

**Phase 2k** remains planning-only until **2l** (or a renamed successor) is implemented.

See [rpa-safety-rules.md](./rpa-safety-rules.md) for non-negotiable safety rules.
