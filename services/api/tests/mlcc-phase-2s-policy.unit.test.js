import { describe, it, expect } from "vitest";

import {
  PHASE_2S_POLICY_VERSION,
  buildPhase2sCheckoutFutureGateManifest,
  buildPhase2sPostCheckoutLadder,
} from "../src/workers/mlcc-phase-2s-policy.js";

describe("mlcc-phase-2s-policy", () => {
  it("exports a stable version string", () => {
    expect(PHASE_2S_POLICY_VERSION).toMatch(/^lk-rpa-2s-/);
  });

  it("checkout gate manifest has required top-level structure", () => {
    const m = buildPhase2sCheckoutFutureGateManifest();

    expect(m.version).toBe(PHASE_2S_POLICY_VERSION);
    expect(m.phase_intent).toMatch(/planning_only|no_runtime_import/i);
    expect(Array.isArray(m.relationship_to_prior_phases)).toBe(true);
    expect(
      Array.isArray(m.evidence_prerequisites_before_checkout_execution_considered),
    ).toBe(true);
    expect(
      m.evidence_prerequisites_before_checkout_execution_considered.length,
    ).toBeGreaterThan(0);
    expect(Array.isArray(m.required_selectors_and_constraints)).toBe(true);
    expect(Array.isArray(m.network_and_layer2_special_interpretation)).toBe(
      true,
    );
    expect(Array.isArray(m.layer3_and_ui_expectations)).toBe(true);
    expect(Array.isArray(m.hard_fail_stop_conditions)).toBe(true);
    expect(Array.isArray(m.observable_bounded_checkout_proof_criteria)).toBe(
      true,
    );
    expect(Array.isArray(m.mandatory_disclaimers)).toBe(true);
  });

  it("post-checkout ladder marks all steps out of scope until separate approval", () => {
    const ladder = buildPhase2sPostCheckoutLadder();

    expect(ladder.version).toBe(PHASE_2S_POLICY_VERSION);
    expect(Array.isArray(ladder.steps)).toBe(true);
    expect(ladder.steps.length).toBe(3);

    const ids = ladder.steps.map((s) => s.id);

    expect(ids).toContain("checkout_bounded_interaction");
    expect(ids).toContain("post_checkout_observation");
    expect(ids).toContain("submit_finalize_order");

    for (const step of ladder.steps) {
      expect(step.status).toBe("out_of_scope_until_separate_approval");
      expect(Array.isArray(step.forbids_until_approved)).toBe(true);
    }
  });
});
