# RPA rebuild phases — MLCC browser worker (canonical)

**Primary implementation:** `services/api/src/workers/mlcc-browser-worker.js`  
**Add-by-code / guards:** `services/api/src/workers/mlcc-browser-add-by-code-probe.js`  
**Dry-run plan:** `services/api/src/workers/mlcc-dry-run.js`  
**Entry script:** `npm run worker:mlcc-browser-dry-run` in `services/api/package.json`

## Completed through Phase 2g (as implemented)

| Phase | Summary | Allowed | Forbidden |
|-------|---------|---------|-----------|
| **2a** | Login, optional license/store automation (env-gated), post-login navigation, step evidence | Bounded license/store **navigation** only when configured; heartbeats + evidence | Cart mutation, submit, validate |
| **2b** | Add-by-code **probe**: optional safe open click; field detection heuristics; **no typing** | `MLCC_ADD_BY_CODE_PROBE=true`; Layer 2 network + Layer 3 UI text guards | Typing codes/qty, dangerous clicks, cart mutation |
| **2c** | Tenant selectors for code/qty fields; read-only DOM inspection; optional `MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR` | Focus/blur only when risk check + env allow | Product/qty **typing**, cart mutation |
| **2d** | Full-page mutation-boundary map: read-only scan of visible controls; heuristic `safe` / `unsafe_mutation_likely` / `uncertain` | `MLCC_ADD_BY_CODE_PHASE_2D=true` (requires 2b probe). **Mutually exclusive with 2e.** | Any click in scan, typing, mutation |
| **2e** | **Scoped** mutation-boundary map: same heuristics as 2d but prefers controls under `MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR` when that root exists and is visible; otherwise **falls back** to the same broad scan as 2d and records that in evidence | `MLCC_ADD_BY_CODE_PHASE_2E=true` (requires 2b probe). Optional `MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS` (JSON) adds **advisory** labels on `uncertain` rows only — does not reclassify | Any click, typing, mutation, validate, checkout, submit |
| **2f** | **Safe open confirmation**: evaluates tenant-listed CSS candidates (priority order); **at most one** click on the first candidate that passes Layer 3 + mutation-boundary gates; verifies add-by-code UI signals (code-like field, tenant code selector, or scoped root visibility) and network guard delta | `MLCC_ADD_BY_CODE_PHASE_2F=true` + `MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS` (non-empty JSON array). Optional `MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS` for uncertain labels. Optional `MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV=true` to defer 2b entry clicks to 2f only | Second 2f click, typing, validate/checkout/submit/add-to-cart, any non-guarded mutation path |
| **2g** | **Pre-mutation typing policy + rehearsal**: documents future typing-phase gates; resolves code/qty fields like 2c; **extended mutation-risk** signals (form action, identifiers, submit controls, input type); **default read-only** — optional `MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL` or **double-gated** sentinel fill+clear (`MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING` + `MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE` matching `^__LK_[A-Z0-9_]{1,48}__$` only). No real product codes/qty | `MLCC_ADD_BY_CODE_PHASE_2G=true` (requires probe). Rehearsal env flags optional | Real SKU/qty entry, submit/validate/checkout/add-to-cart, silent escalation beyond declared rehearsal tier |

**Pre-browser:** deterministic payload validation (`assertDeterministicExecutionPayload`) before Playwright launch.

## Environment flags (non-exhaustive)

- `MLCC_ADD_BY_CODE_PROBE`, `MLCC_ADD_BY_CODE_PHASE_2C`, `MLCC_ADD_BY_CODE_PHASE_2D`, `MLCC_ADD_BY_CODE_PHASE_2E` (2D and 2E must not both be true), `MLCC_ADD_BY_CODE_PHASE_2F`, `MLCC_ADD_BY_CODE_PHASE_2G`
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

## Next phase target (2h — planning)

- **Approved real typing** of tenant-validated product codes / quantities (still **no** submit/validate/checkout/add-to-cart until a later explicit phase), building on 2g manifest + env gates not yet implemented.

See [rpa-safety-rules.md](./rpa-safety-rules.md) for non-negotiable safety rules.
