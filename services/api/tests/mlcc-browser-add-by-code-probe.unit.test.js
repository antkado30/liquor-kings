import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";

import { collectSafeModeFailureEvidencePack } from "../src/workers/mlcc-browser-evidence.js";
import {
  applyTenantAdvisoryForUncertain,
  build2uDeterminismPersistPayload,
  build2uDeterminismTwoPassHandoff,
  buildMiloReadonlyCartDiscoveryCandidateUrls,
  buildAddToCartDeterminismHardeningLaneArtifact,
  compute2uDeterminismCrossRunConsistency,
  parsePhase2oMiloReadonlyCartDiscoveryPathCandidates,
  DETERMINISM_CROSS_RUN_SCHEMA_VERSION,
  buildValidateBoundaryPolicyDecisionArtifact,
  buildPhase2gTypingPolicyManifest,
  buildPlaywrightSelectorFromHint,
  classifyMutationBoundaryControl,
  classifyMiloReadonlyCartDiscoveryState,
  computeBodyChildDeltaExplainer,
  collectMiloPreCartBycodeListSurfaceReadonly,
  computePhase2gExtendedMutationRisk,
  diffPhase2oObservationSnapshots,
  diffPhase2uReconciliationSnapshots,
  diffPhase2rPostValidateObservationSnapshots,
  evaluatePhase2fOpenCandidateEligibility,
  evaluatePhase2nAddApplyCandidateEligibility,
  evaluatePhase2qValidateCandidateEligibility,
  isProbeUiTextUnsafe,
  parseMutationBoundaryUncertainHints,
  parsePhase2fSafeOpenTextAllowSubstrings,
  parsePhase2gSentinelValue,
  parsePhase2hTestCode,
  validatePhase2hTestCodeForNumberInputSurface,
  parsePhase2jTestQuantity,
  parsePhase2lFieldOrder,
  phase2lCodeFieldDomSnapshotAllowed,
  parsePhase2nAddApplyCandidateSelectors,
  parsePhase2oSettleMs,
  parsePhase2qPostValidateObserveSettleMs,
  parsePhase2qValidateCandidateSelectors,
  parsePhase2rSettleMs,
  parseSafeOpenCandidateSelectors,
  miloSafeCartIconTextFailsOrderSafetyFilter,
  PHASE_2G_TYPING_POLICY_VERSION,
  PHASE_2J_QUANTITY_POLICY_VERSION,
  PHASE_2L_COMBINED_POLICY_VERSION,
  MLCC_PROBE_VALIDATE_LOCATOR_FALLBACK_STRATEGY_ORDER,
  MLCC_PROBE_QUANTITY_LOCATOR_FALLBACK_STRATEGY_ORDER,
  MLCC_PROBE_CODE_FIELD_LOCATOR_FALLBACK_STRATEGY_ORDER,
  resolveMlccProbeValidateClickLocatorWithFallbackChain,
  resolveMlccProbeQuantityFillLocatorWithFallbackChain,
  resolveMlccProbeCodeFieldFillLocatorWithFallbackChain,
  shouldBlockHttpRequest,
} from "../src/workers/mlcc-browser-add-by-code-probe.js";

describe("buildAddToCartDeterminismHardeningLaneArtifact", () => {
  const baseArgs = {
    clickPerformed: true,
    selectorClicked: "role=button[name=/Add all/i]",
    selectorList: ['role=button[name=/Add all/i]', "text=Other"],
    candidateEvaluations: [
      { selector: 'role=button[name=/Add all/i]', eligible: true },
      { selector: "text=Other", eligible: false },
    ],
  };

  it("classifies cart evidence when cart summary samples change", () => {
    const out = buildAddToCartDeterminismHardeningLaneArtifact({
      ...baseArgs,
      reconciliationDiff: {
        any_reconciliation_signal_changed: true,
        cart_summary_samples_changed: true,
        cart_badge_or_count_samples_changed: false,
        bycode_row_samples_changed: false,
        success_error_samples_changed: false,
      },
    });
    expect(out.determinism_outcome_category).toBe("2u_attempt_observed_cart_evidence");
    expect(out.attempt_evidence.winning_selector_list_index).toBe(0);
    expect(out.safety.validate_blocked).toBe(true);
  });

  it("classifies local UI only when non-cart signals change", () => {
    const out = buildAddToCartDeterminismHardeningLaneArtifact({
      ...baseArgs,
      reconciliationDiff: {
        any_reconciliation_signal_changed: true,
        body_text_excerpt_changed: true,
        cart_summary_samples_changed: false,
        cart_badge_or_count_samples_changed: false,
        bycode_row_samples_changed: false,
      },
    });
    expect(out.determinism_outcome_category).toBe("2u_attempt_observed_local_ui_change_only");
  });

  it("classifies no effect when reconciliation unchanged", () => {
    const out = buildAddToCartDeterminismHardeningLaneArtifact({
      ...baseArgs,
      reconciliationDiff: {
        any_reconciliation_signal_changed: false,
      },
    });
    expect(out.determinism_outcome_category).toBe("2u_attempt_observed_no_effect");
  });

  it("classifies inconclusive when diff missing", () => {
    const out = buildAddToCartDeterminismHardeningLaneArtifact({
      ...baseArgs,
      reconciliationDiff: null,
    });
    expect(out.determinism_outcome_category).toBe("2u_outcome_inconclusive");
  });

  it("includes two_pass_execution_handoff with inspect path and readiness defaults", () => {
    const out = buildAddToCartDeterminismHardeningLaneArtifact({
      ...baseArgs,
      reconciliationDiff: {
        any_reconciliation_signal_changed: false,
      },
    });
    expect(out.two_pass_execution_handoff).toBeTruthy();
    expect(out.two_pass_execution_handoff.inspect_after_pass_2).toBe(
      "add_to_cart_determinism_hardening_non_validate.cross_run_consistency",
    );
    expect(out.two_pass_execution_handoff.readiness.prior_state_path_configured).toBe(false);
    expect(out.two_pass_execution_handoff.readiness.run_ready_for_first_persist_pass).toBe(false);
    expect(out.two_pass_execution_handoff.readiness.run_ready_for_second_compare_pass).toBe(false);
  });

  it("marks readiness for first persist pass when path and write gates and 2U lane are set", () => {
    const out = buildAddToCartDeterminismHardeningLaneArtifact({
      ...baseArgs,
      reconciliationDiff: { any_reconciliation_signal_changed: false },
      workerConfigForTwoPassHandoff: {
        addByCodePhase2uMiloBulk: true,
        addByCodePhase2uMiloBulkApproved: true,
        addByCode2uDeterminismStatePath: "/tmp/lk-2u.json",
        addByCode2uDeterminismStateWrite: true,
        addByCode2uDeterminismStateWriteApproved: true,
      },
    });
    const r = out.two_pass_execution_handoff.readiness;
    expect(r.prior_state_path_configured).toBe(true);
    expect(r.prior_state_write_enabled).toBe(true);
    expect(r.prior_state_write_approved).toBe(true);
    expect(r.run_ready_for_first_persist_pass).toBe(true);
    expect(r.run_ready_for_second_compare_pass).toBe(false);
  });
});

describe("build2uDeterminismTwoPassHandoff", () => {
  it("marks second compare pass when path set and write gates inactive", () => {
    const h = build2uDeterminismTwoPassHandoff({
      addByCodePhase2uMiloBulk: true,
      addByCodePhase2uMiloBulkApproved: true,
      addByCode2uDeterminismStatePath: "/data/prior.json",
      addByCode2uDeterminismStateWrite: false,
      addByCode2uDeterminismStateWriteApproved: false,
    });
    expect(h.readiness.run_ready_for_second_compare_pass).toBe(true);
    expect(h.readiness.run_ready_for_first_persist_pass).toBe(false);
  });
});

describe("compute2uDeterminismCrossRunConsistency", () => {
  const fp = {
    lane: "add_to_cart_determinism_hardening_non_validate",
    test_code_length: 3,
    test_quantity_length: 1,
    field_order: "code_first",
    milo_manual_parity_sequence: false,
    milo_full_keyboard_parity_sequence: false,
  };
  const compact = (overrides = {}) => ({
    lane_input_fingerprint: fp,
    winning_selector: "a",
    two_u_click_succeeded: true,
    determinism_outcome_category: "2u_attempt_observed_no_effect",
    immediate_reconciliation_flags: {
      any_reconciliation_signal_changed: false,
      success_error_samples_changed: false,
      cart_summary_samples_changed: false,
      cart_badge_or_count_samples_changed: false,
      bycode_row_samples_changed: false,
    },
    ...overrides,
  });

  it("returns insufficient_prior_runs when prior absent", () => {
    const r = compute2uDeterminismCrossRunConsistency(null, compact());
    expect(r.consistency_classification).toBe("insufficient_prior_runs");
    expect(r.prior_run_present).toBe(false);
  });

  it("returns insufficient_prior_runs on schema mismatch", () => {
    const r = compute2uDeterminismCrossRunConsistency(
      { schema_version: 0 },
      compact(),
    );
    expect(r.consistency_classification).toBe("insufficient_prior_runs");
    expect(r.note).toBe("prior_schema_version_mismatch");
  });

  it("classifies stable when fingerprint, selector, success, category, and flags match", () => {
    const prior = {
      schema_version: DETERMINISM_CROSS_RUN_SCHEMA_VERSION,
      ...compact(),
    };
    const r = compute2uDeterminismCrossRunConsistency(prior, compact());
    expect(r.consistency_classification).toBe("stable_across_compared_runs");
    expect(r.compared_fields.lane_input_fingerprint_match).toBe(true);
    expect(r.compared_fields.winning_selector_match).toBe(true);
    expect(r.compared_fields.two_u_click_success_match).toBe(true);
    expect(r.compared_fields.determinism_outcome_category_match).toBe(true);
    expect(r.compared_fields.immediate_reconciliation_flags_match).toBe(true);
  });

  it("classifies unstable when fingerprint differs", () => {
    const prior = {
      schema_version: DETERMINISM_CROSS_RUN_SCHEMA_VERSION,
      ...compact({ winning_selector: "a" }),
    };
    const cur = compact({
      lane_input_fingerprint: { ...fp, test_code_length: 4 },
    });
    const r = compute2uDeterminismCrossRunConsistency(prior, cur);
    expect(r.consistency_classification).toBe("unstable_across_compared_runs");
  });

  it("classifies partially_stable when category differs but core path matches", () => {
    const prior = {
      schema_version: DETERMINISM_CROSS_RUN_SCHEMA_VERSION,
      ...compact({
        determinism_outcome_category: "2u_attempt_observed_no_effect",
      }),
    };
    const cur = compact({
      determinism_outcome_category: "2u_attempt_observed_cart_evidence",
    });
    const r = compute2uDeterminismCrossRunConsistency(prior, cur);
    expect(r.consistency_classification).toBe("partially_stable_across_compared_runs");
  });
});

describe("build2uDeterminismPersistPayload", () => {
  it("writes compact fields only from artifact fragment", () => {
    const laneInputFingerprint = {
      lane: "add_to_cart_determinism_hardening_non_validate",
      test_code_length: 2,
      test_quantity_length: 1,
      field_order: "code_first",
      milo_manual_parity_sequence: true,
      milo_full_keyboard_parity_sequence: false,
    };
    const p = build2uDeterminismPersistPayload({
      laneInputFingerprint,
      artifactFragment: {
        attempt_evidence: {
          winning_selector: "role=x",
          two_u_click_succeeded: true,
        },
        determinism_outcome_category: "2u_attempt_observed_cart_evidence",
        immediate_signals: {
          cart_summary_samples_changed: true,
          any_reconciliation_signal_changed: true,
        },
      },
    });
    expect(p.schema_version).toBe(DETERMINISM_CROSS_RUN_SCHEMA_VERSION);
    expect(p.lane_input_fingerprint).toEqual(laneInputFingerprint);
    expect(p.winning_selector).toBe("role=x");
    expect(p.two_u_click_succeeded).toBe(true);
    expect(p.determinism_outcome_category).toBe("2u_attempt_observed_cart_evidence");
    expect(p.immediate_reconciliation_flags.cart_summary_samples_changed).toBe(true);
  });
});

describe("shouldBlockHttpRequest", () => {
  it("blocks mutation methods to cart/order-like URLs", () => {
    const b = shouldBlockHttpRequest(
      "https://vendor.example/api/cart/add",
      "POST",
    );
    expect(b.block).toBe(true);
  });

  it("does not block POST to apply-line URLs (Phase 2n may require real apply-line XHRs; validate/checkout patterns stay blocked)", () => {
    const b = shouldBlockHttpRequest(
      "https://vendor.example/order/apply-line",
      "POST",
    );
    expect(b.block).toBe(false);
  });

  it("does not block POST to validate paths (Phase 2q may require real validate XHRs; checkout/submit patterns stay blocked)", () => {
    const b = shouldBlockHttpRequest(
      "https://vendor.example/order/validate",
      "POST",
    );
    expect(b.block).toBe(false);
  });

  it("allows GET navigation to generic pages", () => {
    const b = shouldBlockHttpRequest("https://vendor.example/home", "GET");
    expect(b.block).toBe(false);
  });

  it("blocks additional MLCC order-finalization mutations beyond the 2n/2q allowlist", () => {
    expect(
      shouldBlockHttpRequest("https://vendor.example/order/complete", "POST").block,
    ).toBe(true);
    expect(
      shouldBlockHttpRequest("https://vendor.example/order/payment", "POST").block,
    ).toBe(true);
    expect(
      shouldBlockHttpRequest("https://vendor.example/milo/order/place", "POST")
        .block,
    ).toBe(true);
    expect(
      shouldBlockHttpRequest("https://vendor.example/cart/checkout", "POST").block,
    ).toBe(true);
  });

  it("blocks order-flow GET patterns that must not fire during readonly SAFE MODE navigation", () => {
    expect(
      shouldBlockHttpRequest("https://vendor.example/cart/checkout", "GET").block,
    ).toBe(true);
    expect(
      shouldBlockHttpRequest("https://vendor.example/order/complete", "GET").block,
    ).toBe(true);
  });
});

describe("classifyMutationBoundaryControl", () => {
  it("classifies obvious mutation labels as unsafe", () => {
    const r = classifyMutationBoundaryControl({
      tag: "button",
      text: "Add to cart",
    });

    expect(r.classification).toBe("unsafe_mutation_likely");
  });

  it("classifies help/privacy style as informational heuristic only", () => {
    const r = classifyMutationBoundaryControl({
      tag: "a",
      text: "Privacy policy",
      href: "https://example.com/privacy",
    });

    expect(r.classification).toBe("safe_informational");
  });

  it("returns uncertain for ambiguous labels with uncertain_detail", () => {
    const r = classifyMutationBoundaryControl({
      tag: "button",
      text: "Continue",
    });

    expect(r.classification).toBe("uncertain");
    expect(r.uncertain_detail).toBe(
      "generic_navigation_or_action_verb_needs_tenant_context",
    );
  });
});

describe("parseMutationBoundaryUncertainHints", () => {
  it("returns empty array for null/blank", () => {
    expect(parseMutationBoundaryUncertainHints(null)).toEqual([]);
    expect(parseMutationBoundaryUncertainHints("  ")).toEqual([]);
  });

  it("parses valid hint entries", () => {
    const raw = JSON.stringify([
      { contains: "foo", advisory_label: "note" },
      { contains: "", advisory_label: "x" },
    ]);
    expect(parseMutationBoundaryUncertainHints(raw)).toEqual([
      { contains: "foo", advisory_label: "note" },
    ]);
  });

  it("throws when JSON is not an array", () => {
    expect(() => parseMutationBoundaryUncertainHints('{"x":1}')).toThrow(
      /must be a JSON array/,
    );
  });
});

describe("parsePhase2hTestCode", () => {
  it("accepts trimmed non-empty string within max length", () => {
    const r = parsePhase2hTestCode("  hi  ");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("hi");
  });

  it("rejects empty and oversize", () => {
    expect(parsePhase2hTestCode("").ok).toBe(false);
    expect(parsePhase2hTestCode("a".repeat(65)).ok).toBe(false);
    expect(parsePhase2hTestCode("a\nb").ok).toBe(false);
  });
});

describe("validatePhase2hTestCodeForNumberInputSurface", () => {
  it("accepts 1–12 digit strings", () => {
    expect(validatePhase2hTestCodeForNumberInputSurface("1").ok).toBe(true);
    expect(validatePhase2hTestCodeForNumberInputSurface(" 88888888 ").value).toBe(
      "88888888",
    );
  });

  it("rejects letters, empty, and too many digits", () => {
    expect(validatePhase2hTestCodeForNumberInputSurface("12a").ok).toBe(false);
    expect(validatePhase2hTestCodeForNumberInputSurface("").ok).toBe(false);
    expect(validatePhase2hTestCodeForNumberInputSurface("1".repeat(13)).ok).toBe(
      false,
    );
  });
});

describe("phase2lCodeFieldDomSnapshotAllowed", () => {
  it("allows number and text-like input types; rejects select", () => {
    expect(phase2lCodeFieldDomSnapshotAllowed({ type: "number" }).ok).toBe(
      true,
    );
    expect(phase2lCodeFieldDomSnapshotAllowed({ type: "text" }).ok).toBe(true);
    expect(
      phase2lCodeFieldDomSnapshotAllowed({ type: "select" }).ok,
    ).toBe(false);
  });

  it("rejects unsupported snapshots", () => {
    expect(phase2lCodeFieldDomSnapshotAllowed(null).ok).toBe(false);
    expect(phase2lCodeFieldDomSnapshotAllowed({ unsupported: true }).ok).toBe(
      false,
    );
  });
});

describe("parsePhase2lFieldOrder", () => {
  it("accepts code_first and quantity_first with optional hyphen", () => {
    expect(parsePhase2lFieldOrder("CODE_FIRST").value).toBe("code_first");
    expect(parsePhase2lFieldOrder("quantity-first").value).toBe("quantity_first");
  });

  it("rejects invalid order", () => {
    expect(parsePhase2lFieldOrder("").ok).toBe(false);
    expect(parsePhase2lFieldOrder("both_at_once").ok).toBe(false);
  });
});

describe("PHASE_2L_COMBINED_POLICY_VERSION", () => {
  it("exports a stable policy version string", () => {
    expect(PHASE_2L_COMBINED_POLICY_VERSION).toMatch(/^lk-rpa-2l-/);
  });
});

describe("parsePhase2jTestQuantity", () => {
  it("accepts positive integer strings without leading zeros", () => {
    expect(parsePhase2jTestQuantity("  7  ").ok).toBe(true);
    expect(parsePhase2jTestQuantity("  7  ").value).toBe("7");
    expect(parsePhase2jTestQuantity("12345678").ok).toBe(true);
  });

  it("rejects empty, zero, leading zero, non-numeric, too long", () => {
    expect(parsePhase2jTestQuantity("").ok).toBe(false);
    expect(parsePhase2jTestQuantity("0").ok).toBe(false);
    expect(parsePhase2jTestQuantity("01").ok).toBe(false);
    expect(parsePhase2jTestQuantity("12a").ok).toBe(false);
    expect(parsePhase2jTestQuantity("123456789").ok).toBe(false);
  });
});

describe("PHASE_2J_QUANTITY_POLICY_VERSION", () => {
  it("exports a stable policy version string", () => {
    expect(PHASE_2J_QUANTITY_POLICY_VERSION).toMatch(/^lk-rpa-2j-/);
  });
});

describe("collectMiloPreCartBycodeListSurfaceReadonly", () => {
  it("is exported for MILO pre-cart read-only list evidence", () => {
    expect(typeof collectMiloPreCartBycodeListSurfaceReadonly).toBe("function");
  });
});

describe("Phase 2g policy and risk", () => {
  it("exports a stable policy version string", () => {
    expect(PHASE_2G_TYPING_POLICY_VERSION).toMatch(/^lk-rpa-2g-/);
    expect(buildPhase2gTypingPolicyManifest().version).toBe(
      PHASE_2G_TYPING_POLICY_VERSION,
    );
  });

  it("parsePhase2gSentinelValue accepts only LK sentinel pattern", () => {
    expect(parsePhase2gSentinelValue("__LK_X__").ok).toBe(true);
    expect(parsePhase2gSentinelValue("bad").ok).toBe(false);
    expect(parsePhase2gSentinelValue(null).ok).toBe(true);
    expect(parsePhase2gSentinelValue(null).value).toBe(null);
  });

  it("computePhase2gExtendedMutationRisk blocks suspicious form action", () => {
    const r = computePhase2gExtendedMutationRisk({
      kind: "field",
      inputType: "text",
      formAction: "https://x.example/cart/add",
      formMethodAttr: "post",
      formSubmitCount: 1,
      id: "sku",
      name: "code",
    });
    expect(r.rehearsal_blocked).toBe(true);
    expect(r.block_reasons.some((x) => /form_action/.test(x))).toBe(true);
  });

  it("computePhase2gExtendedMutationRisk flags number input advisory", () => {
    const r = computePhase2gExtendedMutationRisk({
      kind: "field",
      inputType: "number",
      formAction: "",
      formMethodAttr: "get",
      formSubmitCount: 0,
      id: "qty",
      name: "qty",
    });
    expect(r.rehearsal_blocked).toBe(false);
    expect(r.advisory_signals.some((x) => /number/.test(x))).toBe(true);
  });
});

describe("parseSafeOpenCandidateSelectors", () => {
  it("parses non-empty selector array", () => {
    expect(parseSafeOpenCandidateSelectors('["a", " b "]')).toEqual(["a", "b"]);
  });

  it("throws when empty", () => {
    expect(() => parseSafeOpenCandidateSelectors("[]")).toThrow(/non-empty/);
  });
});

describe("parsePhase2fSafeOpenTextAllowSubstrings", () => {
  it("returns empty for blank", () => {
    expect(parsePhase2fSafeOpenTextAllowSubstrings(null)).toEqual([]);
  });

  it("parses string array", () => {
    expect(parsePhase2fSafeOpenTextAllowSubstrings('["x"]')).toEqual(["x"]);
  });
});

describe("evaluatePhase2fOpenCandidateEligibility", () => {
  it("rejects add-to-cart via layer3", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Add to cart" },
      [],
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/layer3/);
  });

  it("accepts add-by-code uncertain label via default intent", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Add by code" },
      [],
    );
    expect(r.eligible).toBe(true);
  });

  it("accepts uncertain when tenant substring matches", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Open special panel" },
      ["special"],
    );
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/tenant/);
  });

  it("rejects Continue without allowlist match", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Continue" },
      [],
    );
    expect(r.eligible).toBe(false);
  });
});

describe("parsePhase2oSettleMs", () => {
  it("defaults to 500 when blank", () => {
    expect(parsePhase2oSettleMs(null).ok).toBe(true);
    expect(parsePhase2oSettleMs(null).value).toBe(500);
    expect(parsePhase2oSettleMs("  ").value).toBe(500);
  });

  it("caps at 5000", () => {
    expect(parsePhase2oSettleMs("99999").value).toBe(5000);
  });

  it("rejects negative", () => {
    expect(parsePhase2oSettleMs("-1").ok).toBe(false);
  });
});

describe("parsePhase2rSettleMs", () => {
  it("defaults to 600 when blank", () => {
    expect(parsePhase2rSettleMs(null).ok).toBe(true);
    expect(parsePhase2rSettleMs(null).value).toBe(600);
  });

  it("caps at 5000", () => {
    expect(parsePhase2rSettleMs("99999").value).toBe(5000);
  });
});

describe("diffPhase2rPostValidateObservationSnapshots", () => {
  it("flags validate selector state change", () => {
    const pre = {
      url: "u",
      title: "t",
      ui_open_signals: { open_signal: true },
      visible_input_field_summary: { code_field_detected: true },
      tenant_code_field_state: { visible: true },
      tenant_quantity_field_state: { visible: false },
      body_text_digest: { char_length: 10, head_snippet: "hello" },
      status_alert_and_live_region_samples: [],
      inferred_cart_or_line_text_clues: { regex_hits_visible_text_only: [] },
      add_apply_selector_states: [],
      validate_selector_states: [{ selector: "#v", visible: true, disabled: false }],
      checkout_like_controls_inferred: { samples: [] },
    };
    const post = {
      ...pre,
      validate_selector_states: [{ selector: "#v", visible: true, disabled: true }],
    };
    const d = diffPhase2rPostValidateObservationSnapshots(pre, post);
    expect(d.validate_selector_states_changed).toBe(true);
    expect(d.any_heuristic_dom_or_signal_delta).toBe(true);
  });
});

describe("diffPhase2oObservationSnapshots", () => {
  it("detects url change", () => {
    const d = diffPhase2oObservationSnapshots({ url: "a" }, { url: "b" });
    expect(d.url_changed).toBe(true);
    expect(d.any_heuristic_dom_or_signal_delta).toBe(true);
  });

  it("reports no delta when key fields match", () => {
    const snap = {
      url: "u",
      title: "t",
      ui_open_signals: { open_signal: true },
      visible_input_field_summary: { code_field_detected: true },
      tenant_code_field_state: { visible: true },
      tenant_quantity_field_state: { visible: false },
      body_text_digest: { char_length: 10, head_snippet: "hello" },
      status_alert_and_live_region_samples: [],
      inferred_cart_or_line_text_clues: { regex_hits_visible_text_only: [] },
      add_apply_selector_states: [],
    };
    const d = diffPhase2oObservationSnapshots(snap, { ...snap });
    expect(d.any_heuristic_dom_or_signal_delta).toBe(false);
  });
});

describe("diffPhase2uReconciliationSnapshots", () => {
  it("reports no change when key pre/post fields match", () => {
    const snap = {
      page_url: "https://example.test/milo/products/bycode",
      title: "By code",
      body_text_char_length: 123,
      body_text_excerpt: "hello",
      success_error_samples: ["ok"],
      cart_summary_samples: ["Cart: 1"],
      bycode_row_samples: ["2458"],
      cart_badge_or_count_samples: ["1"],
    };
    const d = diffPhase2uReconciliationSnapshots(snap, { ...snap });
    expect(d.any_reconciliation_signal_changed).toBe(false);
  });

  it("detects cart summary sample drift", () => {
    const pre = {
      page_url: "u",
      title: "t",
      body_text_char_length: 10,
      body_text_excerpt: "a",
      success_error_samples: [],
      cart_summary_samples: ["Cart: 1"],
      bycode_row_samples: [],
      cart_badge_or_count_samples: [],
    };
    const post = { ...pre, cart_summary_samples: ["Cart: 2"] };
    const d = diffPhase2uReconciliationSnapshots(pre, post);
    expect(d.cart_summary_samples_changed).toBe(true);
    expect(d.any_reconciliation_signal_changed).toBe(true);
  });
});

describe("parsePhase2nAddApplyCandidateSelectors", () => {
  it("parses non-empty JSON array", () => {
    expect(parsePhase2nAddApplyCandidateSelectors('["#a","#b"]')).toEqual([
      "#a",
      "#b",
    ]);
  });

  it("throws when empty", () => {
    expect(() => parsePhase2nAddApplyCandidateSelectors("")).toThrow(
      /MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS/,
    );
  });
});

describe("parsePhase2qValidateCandidateSelectors", () => {
  it("parses non-empty JSON array", () => {
    expect(parsePhase2qValidateCandidateSelectors('["#v",".x"]')).toEqual([
      "#v",
      ".x",
    ]);
  });

  it("throws when empty", () => {
    expect(() => parsePhase2qValidateCandidateSelectors("")).toThrow(
      /MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS/,
    );
  });
});

describe("parsePhase2qPostValidateObserveSettleMs", () => {
  it("defaults to 400 when blank", () => {
    expect(parsePhase2qPostValidateObserveSettleMs(null).ok).toBe(true);
    expect(parsePhase2qPostValidateObserveSettleMs(null).value).toBe(400);
  });

  it("caps at 3000", () => {
    expect(parsePhase2qPostValidateObserveSettleMs("99999").value).toBe(3000);
  });
});

describe("evaluatePhase2qValidateCandidateEligibility", () => {
  it("accepts validate wording via default intent", () => {
    const r = evaluatePhase2qValidateCandidateEligibility(
      { tag: "button", text: "Validate order" },
      [],
    );
    expect(r.eligible).toBe(true);
  });

  it("rejects checkout labels", () => {
    const r = evaluatePhase2qValidateCandidateEligibility(
      { tag: "button", text: "Checkout" },
      [],
    );
    expect(r.eligible).toBe(false);
  });
});

describe("evaluatePhase2nAddApplyCandidateEligibility", () => {
  it("rejects validate-style labels (downstream blocklist and/or layer3)", () => {
    const r = evaluatePhase2nAddApplyCandidateEligibility(
      { tag: "button", text: "Validate order" },
      [],
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/downstream|layer3/);
  });

  it("accepts Add line label via default add/apply intent (mutation-boundary cart-line heuristic)", () => {
    const r = evaluatePhase2nAddApplyCandidateEligibility(
      { tag: "button", text: "Add line" },
      [],
    );
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe("accepted_add_apply_line_default_intent_pattern");
  });

  it("accepts Apply alone as uncertain + default intent", () => {
    const r = evaluatePhase2nAddApplyCandidateEligibility(
      { tag: "button", text: "Apply" },
      [],
    );
    expect(r.eligible).toBe(true);
  });

  it("rejects Continue without tenant allowlist match", () => {
    const r = evaluatePhase2nAddApplyCandidateEligibility(
      { tag: "button", text: "Continue" },
      [],
    );
    expect(r.eligible).toBe(false);
  });

  it("accepts uncertain label when tenant substring matches add/apply wording", () => {
    const r = evaluatePhase2nAddApplyCandidateEligibility(
      { tag: "button", text: "Continue to apply line" },
      ["apply line"],
    );
    expect(r.eligible).toBe(true);
  });
});

describe("applyTenantAdvisoryForUncertain", () => {
  it("does not attach hints for unsafe classification", () => {
    const row = { text: "Add to cart" };
    const out = applyTenantAdvisoryForUncertain(row, "unsafe_mutation_likely", [
      { contains: "cart", advisory_label: "wrong" },
    ]);
    expect(out).toEqual({});
  });

  it("attaches advisory only for uncertain rows", () => {
    const row = { text: "Enter sku here" };
    const out = applyTenantAdvisoryForUncertain(row, "uncertain", [
      { contains: "sku", advisory_label: "Tenant: code field area" },
    ]);
    expect(out.tenant_advisory_label).toBe("Tenant: code field area");
    expect(out.tenant_advisory_disclaimer).toMatch(/non_authoritative/);
  });
});

describe("buildPlaywrightSelectorFromHint", () => {
  it("prefers id when valid", () => {
    expect(buildPlaywrightSelectorFromHint({ id: "skuInput", name: "x" })).toBe(
      "#skuInput",
    );
  });

  it("falls back to name when id missing", () => {
    expect(buildPlaywrightSelectorFromHint({ id: null, name: "mlcc_code" })).toBe(
      '[name="mlcc_code"]',
    );
  });

  it("returns null when not constructible", () => {
    expect(buildPlaywrightSelectorFromHint({})).toBe(null);
  });
});

describe("isProbeUiTextUnsafe", () => {
  it("flags checkout and add-to-cart labels", () => {
    expect(isProbeUiTextUnsafe("Add to cart").unsafe).toBe(true);
    expect(isProbeUiTextUnsafe("Checkout").unsafe).toBe(true);
  });

  it("does not globally block validate labels (Phase 2q uses evaluatePhase2qValidateCandidateEligibility)", () => {
    expect(isProbeUiTextUnsafe("Validate order").unsafe).toBe(false);
  });

  it("allows neutral labels", () => {
    expect(isProbeUiTextUnsafe("Add by code").unsafe).toBe(false);
    expect(isProbeUiTextUnsafe("Enter code").unsafe).toBe(false);
  });

  it("does not treat add-line / apply-line wording as globally unsafe (Phase 2n uses dedicated eligibility)", () => {
    expect(isProbeUiTextUnsafe("Add line").unsafe).toBe(false);
    expect(isProbeUiTextUnsafe("Apply line").unsafe).toBe(false);
  });
});

describe("miloSafeCartIconTextFailsOrderSafetyFilter", () => {
  it("flags submit, checkout, place order, finalize (word-boundary)", () => {
    expect(miloSafeCartIconTextFailsOrderSafetyFilter("Submit order")).toBe(true);
    expect(miloSafeCartIconTextFailsOrderSafetyFilter("aria-label: Checkout")).toBe(true);
    expect(miloSafeCartIconTextFailsOrderSafetyFilter("Place order")).toBe(true);
    expect(miloSafeCartIconTextFailsOrderSafetyFilter("Finalize purchase")).toBe(true);
  });

  it("allows shopping cart and view cart style labels", () => {
    expect(miloSafeCartIconTextFailsOrderSafetyFilter("Shopping cart")).toBe(false);
    expect(miloSafeCartIconTextFailsOrderSafetyFilter("View cart 3 items")).toBe(false);
    expect(miloSafeCartIconTextFailsOrderSafetyFilter("My cart")).toBe(false);
  });
});

describe("buildMiloReadonlyCartDiscoveryCandidateUrls", () => {
  it("orders explicit URL first then default paths deduped max 5", () => {
    const urls = buildMiloReadonlyCartDiscoveryCandidateUrls(
      "https://vendor.example/mlcc/login",
      "https://vendor.example/milo/cart",
      ["/other/cart"],
    );
    expect(urls[0]).toBe("https://vendor.example/milo/cart");
    expect(urls.length).toBeLessThanOrEqual(5);
    expect(urls.includes("https://vendor.example/milo/cart")).toBe(true);
  });

  it("uses defaults when no explicit URL", () => {
    const urls = buildMiloReadonlyCartDiscoveryCandidateUrls(
      "https://vendor.example/foo",
      null,
      [],
    );
    expect(urls[0]).toBe("https://vendor.example/milo/cart");
    expect(urls).toContain("https://vendor.example/cart");
  });
});

describe("parsePhase2oMiloReadonlyCartDiscoveryPathCandidates", () => {
  it("parses valid JSON path array", () => {
    const p = parsePhase2oMiloReadonlyCartDiscoveryPathCandidates('["/a","/b"]');
    expect(p.ok).toBe(true);
    expect(p.paths).toEqual(["/a", "/b"]);
  });

  it("rejects non-slash paths", () => {
    const p = parsePhase2oMiloReadonlyCartDiscoveryPathCandidates('["nope"]');
    expect(p.ok).toBe(false);
  });
});

describe("computeBodyChildDeltaExplainer", () => {
  const slot = (overrides = {}) => ({
    slot_index: 0,
    dom_path_compact: "body > div.app",
    tag: "div",
    id: null,
    class_sample: "app",
    visible: true,
    text_head: "hello",
    text_length: 5,
    bounding_rect: { top: 0, left: 0, width: 100, height: 50 },
    position: "relative",
    z_index: 0,
    display_visibility_opacity: { display: "block", visibility: "visible", opacity: "1" },
    child_count: 2,
    looks_like: "layout shell",
    cart_like_micro_signals: {
      tr_two_td_visible: 0,
      mat_row_visible: 0,
      cdk_row_visible: 0,
      qty_input_visible: 0,
      dollar_like_token_hits: 0,
      validate_button_text_visible: false,
      checkout_button_text_visible: false,
      place_order_button_text_visible: false,
    },
    ...overrides,
  });

  it("returns non-comparable when snapshots missing", () => {
    const out = computeBodyChildDeltaExplainer(null, { body_direct_child_slots: [] });
    expect(out.comparable).toBe(false);
    expect(out.changed_items.length).toBe(0);
  });

  it("detects newly visible slot", () => {
    const pre = {
      body_direct_child_slots: [slot({ visible: false, text_length: 0, text_head: "" })],
      body_child_total: 1,
      truncated: false,
    };
    const post = {
      body_direct_child_slots: [slot({ visible: true, text_length: 12, text_head: "cart line here" })],
      body_child_total: 1,
      truncated: false,
    };
    const out = computeBodyChildDeltaExplainer(pre, post);
    expect(out.comparable).toBe(true);
    expect(out.changed_items.some((c) => c.change_kind === "newly_visible_at_slot")).toBe(true);
  });

  it("flags cart-like relevance when micro-signals show rows", () => {
    const pre = {
      body_direct_child_slots: [slot({ visible: false })],
      body_child_total: 1,
      truncated: false,
    };
    const post = {
      body_direct_child_slots: [
        slot({
          visible: true,
          looks_like: "unknown",
          cart_like_micro_signals: {
            tr_two_td_visible: 1,
            mat_row_visible: 0,
            cdk_row_visible: 0,
            qty_input_visible: 0,
            dollar_like_token_hits: 0,
            validate_button_text_visible: false,
            checkout_button_text_visible: false,
            place_order_button_text_visible: false,
          },
        }),
      ],
      body_child_total: 1,
      truncated: false,
    };
    const out = computeBodyChildDeltaExplainer(pre, post);
    expect(out.summary.any_likely_cart_result_relevant).toBe(true);
    expect(
      out.changed_items.some(
        (c) => c.relevance_heuristic === "likely_hidden_or_compact_cart_surface",
      ),
    ).toBe(true);
  });
});

describe("classifyMiloReadonlyCartDiscoveryState", () => {
  it("classifies empty cart when no line heuristic and no validate-shaped nodes", () => {
    const out = classifyMiloReadonlyCartDiscoveryState(
      {
        line_items_likely_present_heuristic: false,
        data_row_heuristic_count: 0,
        tr_count_in_largest_tbody: 0,
      },
      [],
      [],
    );
    expect(out.classification).toBe("empty_cart_surface");
  });

  it("classifies nonempty without validate when line heuristic and no shaped nodes", () => {
    const out = classifyMiloReadonlyCartDiscoveryState(
      {
        line_items_likely_present_heuristic: true,
        data_row_heuristic_count: 2,
        tr_count_in_largest_tbody: 3,
      },
      [],
      [],
    );
    expect(out.classification).toBe("nonempty_cart_no_validate_visible");
  });

  it("returns other when visible enriched candidates exist", () => {
    const out = classifyMiloReadonlyCartDiscoveryState({}, [{ selector: "x" }], []);
    expect(out.classification).toBe("other");
  });
});

describe("buildValidateBoundaryPolicyDecisionArtifact", () => {
  it("emits policy classification and options when both lanes hit no-evidence boundaries", () => {
    const out = buildValidateBoundaryPolicyDecisionArtifact({
      phase2lResult: {
        pre_2u_probe_boundary_conclusion: {
          classification: "bounded_pre_2u_no_evidence_boundary_reached",
        },
      },
      phase2oMiloReadonlyCartValidateDiscoveryResult: {
        cart_validate_discovery_performed: true,
        post_2u_probe_boundary_conclusion: {
          classification: "bounded_post_2u_no_evidence_boundary_reached",
        },
      },
      config: { addByCodeProbe: true },
    });
    expect(out.classification).toBe("validate_boundary_policy_decision_required");
    expect(out.selected_policy_option).toBe("keep_validate_blocked_under_current_evidence_rules");
    expect(out.policy_options[0].selected).toBe(true);
    expect(out.policy_options[1].selected).toBe(false);
    expect(out.current_evidence_status.both_bounded_lanes_concluded_no_evidence_boundaries).toBe(
      true,
    );
    expect(out.current_evidence_status.validate_boundary_evidence_threshold_not_met_under_current_rules).toBe(
      true,
    );
    expect(out.policy_options).toHaveLength(3);
    expect(out.policy_options[0].guardrails.length).toBeGreaterThan(0);
    expect(out.compact_human_summary).toMatch(/Current selected policy:/i);
    expect(out.lane_closure_handoff?.lane_status).toBe("closed_under_current_policy");
    expect(
      out.lane_closure_handoff?.recommended_next_safe_engineering_lanes?.length,
    ).toBeGreaterThan(0);
  });
});

describe(
  "resolveMlccProbeValidateClickLocatorWithFallbackChain (validate selector hardening)",
  { timeout: 45_000 },
  () => {
  let browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("primary: prefers a visible control inside main when it matches the selector", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <main><button type="button" id="v-main" class="vbtn">Validate</button></main>
      <button type="button" id="v-ghost" class="vbtn" style="display:none">Validate</button>
    </body></html>`);
    const r = await resolveMlccProbeValidateClickLocatorWithFallbackChain(
      page,
      ".vbtn",
      {},
    );
    expect(r.ok).toBe(true);
    expect(r.resolution).toBe("main_scoped");
    const id = await r.loc.evaluate((el) => el.id);
    expect(id).toBe("v-main");
    await ctx.close();
  });

  it("fallback: resolves from dialog when main has no matching control", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <main></main>
      <div role="dialog"><button type="button" id="v-dlg" class="vx">Validate</button></div>
    </body></html>`);
    const r = await resolveMlccProbeValidateClickLocatorWithFallbackChain(
      page,
      ".vx",
      {},
    );
    expect(r.ok).toBe(true);
    expect(r.resolution).toBe("dialog_0");
    const id = await r.loc.evaluate((el) => el.id);
    expect(id).toBe("v-dlg");
    await ctx.close();
  });

  it("fallback: uses mutation boundary root after main and dialogs miss", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <div id="cart-root" data-test="boundary"><button type="button" id="v-c" class="vy">Validate</button></div>
    </body></html>`);
    const r = await resolveMlccProbeValidateClickLocatorWithFallbackChain(
      page,
      ".vy",
      { mutationBoundaryRootSelector: "#cart-root" },
    );
    expect(r.ok).toBe(true);
    expect(r.resolution).toBe("mutation_boundary_scoped");
    await ctx.close();
  });

  it("aborts when multiple visible global matches are ambiguous", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <main></main>
      <button type="button" class="amb" style="display:inline-block;width:40px;height:24px">Validate</button>
      <button type="button" class="amb" style="display:inline-block;width:40px;height:24px">Validate</button>
    </body></html>`);
    const r = await resolveMlccProbeValidateClickLocatorWithFallbackChain(
      page,
      ".amb",
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("multiple_visible_validate_controls_ambiguous");
    await ctx.close();
  });

  it("aborts when multiple dialogs each expose a single visible target", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <main></main>
      <div role="dialog"><button type="button" class="d1">Validate</button></div>
      <div role="dialog"><button type="button" class="d1">Validate</button></div>
    </body></html>`);
    const r = await resolveMlccProbeValidateClickLocatorWithFallbackChain(
      page,
      ".d1",
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("multiple_dialog_validate_targets_ambiguous");
    await ctx.close();
  });

  it("documents stable ordered fallback scope kinds", () => {
    expect(MLCC_PROBE_VALIDATE_LOCATOR_FALLBACK_STRATEGY_ORDER).toEqual([
      "main_scoped",
      "dialog_scoped",
      "mutation_boundary_scoped",
      "global_scoped",
    ]);
  });
});

describe(
  "resolveMlccProbeQuantityFillLocatorWithFallbackChain (quantity selector hardening)",
  { timeout: 45_000 },
  () => {
    let browser;

    beforeAll(async () => {
      browser = await chromium.launch({ headless: true });
    });

    afterAll(async () => {
      await browser?.close();
    });

    it("primary: tenant CSS quantity inside main when visible and allowlisted", async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
      <main><input type="number" id="q-main" class="qty-tenant" value="" /></main>
      <input type="number" id="q-ghost" class="qty-tenant" style="display:none" value="" />
    </body></html>`);
      const r = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(page, ".qty-tenant", {});
      expect(r.ok).toBe(true);
      expect(r.strategy).toBe("tenant_css");
      const id = await r.loc.evaluate((el) => el.id);
      expect(id).toBe("q-main");
      await ctx.close();
    });

    it("fallback: uses first visible spinbutton/number in main when tenant selector has no visible match", async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
      <main>
        <input type="number" class="qty-miss" style="display:none" value="" />
        <input type="number" id="q-fallback" value="" />
      </main>
    </body></html>`);
      const r = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(
        page,
        ".qty-miss",
        {},
      );
      expect(r.ok).toBe(true);
      expect(r.strategy).toBe("spinbutton_role_fallback");
      const id = await r.loc.evaluate((el) => el.id);
      expect(id).toBe("q-fallback");
      await ctx.close();
    });

    it("rejects empty tenant selector string", async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent("<html><body><main></main></body></html>");
      const r = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(page, "   ", {});
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("empty_tenant_quantity_selector");
      await ctx.close();
    });

    it("documents stable ordered quantity fallback scope kinds", () => {
      expect(MLCC_PROBE_QUANTITY_LOCATOR_FALLBACK_STRATEGY_ORDER).toEqual([
        "main_scoped",
        "dialog_scoped",
        "mutation_boundary_scoped",
        "global_html_scoped",
      ]);
    });
  },
);

describe(
  "resolveMlccProbeCodeFieldFillLocatorWithFallbackChain (code-field hardening)",
  { timeout: 45_000 },
  () => {
    let browser;

    beforeAll(async () => {
      browser = await chromium.launch({ headless: true });
    });

    afterAll(async () => {
      await browser?.close();
    });

    it("primary: tenant CSS code field inside main when visible and allowlisted", async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
      <main><input type="text" id="c-main" class="code-tenant" placeholder="ignored" /></main>
      <input type="text" id="c-ghost" class="code-tenant" style="display:none" />
    </body></html>`);
      const r = await resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(page, ".code-tenant", {});
      expect(r.ok).toBe(true);
      expect(r.strategy).toBe("tenant_css");
      const id = await r.loc.evaluate((el) => el.id);
      expect(id).toBe("c-main");
      await ctx.close();
    });

    it("fallback: placeholder anchor in main when tenant selector has no visible match", async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
      <main>
        <input type="text" class="code-miss" style="display:none" />
        <input type="text" id="c-ph" placeholder="Search by code" />
      </main>
    </body></html>`);
      const r = await resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(page, ".code-miss", {});
      expect(r.ok).toBe(true);
      expect(r.strategy).toBe("placeholder_regex_fallback");
      const id = await r.loc.evaluate((el) => el.id);
      expect(id).toBe("c-ph");
      await ctx.close();
    });

    it("rejects empty tenant selector string", async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setContent("<html><body><main></main></body></html>");
      const r = await resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(page, "   ", {});
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("empty_tenant_code_field_selector");
      await ctx.close();
    });

    it("documents stable ordered code-field fallback scope kinds", () => {
      expect(MLCC_PROBE_CODE_FIELD_LOCATOR_FALLBACK_STRATEGY_ORDER).toEqual([
        "main_scoped",
        "dialog_scoped",
        "mutation_boundary_scoped",
        "global_html_scoped",
      ]);
    });
  },
);

describe("collectSafeModeFailureEvidencePack (HTML excerpt)", { timeout: 45_000 }, () => {
  it("collectSafeModeFailureEvidencePack attaches bounded HTML and text excerpts", async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(
      `<!DOCTYPE html><html><body><div id="x" data-trap="1">hello</div></body></html>`,
    );
    const pack = await collectSafeModeFailureEvidencePack(page, {
      screenshotMaxBytes: 0,
      excerptMaxChars: 500,
      htmlExcerptMaxChars: 2000,
    });
    expect(pack.safe_mode_failure_body_html_excerpt).toBeTruthy();
    expect(String(pack.safe_mode_failure_body_html_excerpt)).toMatch(/data-trap/);
    expect(pack.safe_mode_failure_text_excerpt).toMatch(/hello/);
    await ctx.close();
    await browser.close();
  });
});
