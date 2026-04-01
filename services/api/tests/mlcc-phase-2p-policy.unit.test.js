import { describe, it, expect } from "vitest";

import {
  PHASE_2P_POLICY_VERSION,
  buildPhase2pPostValidateLadder,
  buildPhase2pValidateFutureGateManifest,
} from "../src/workers/mlcc-phase-2p-policy.js";

describe("mlcc-phase-2p-policy", () => {
  it("exports a stable version string", () => {
    expect(PHASE_2P_POLICY_VERSION).toMatch(/^lk-rpa-2p-/);
  });

  it("validate gate manifest has required top-level structure", () => {
    const m = buildPhase2pValidateFutureGateManifest();

    expect(m.version).toBe(PHASE_2P_POLICY_VERSION);
    expect(m.phase_intent).toMatch(/phase_2q|probe_only|no_worker_import/i);
    expect(Array.isArray(m.relationship_to_prior_phases)).toBe(true);
    expect(
      Array.isArray(m.evidence_prerequisites_before_validate_execution_considered),
    ).toBe(true);
    expect(
      m.evidence_prerequisites_before_validate_execution_considered.length,
    ).toBeGreaterThan(0);
    expect(Array.isArray(m.required_selectors_and_constraints)).toBe(true);
    expect(Array.isArray(m.network_and_layer2_special_interpretation)).toBe(
      true,
    );
    expect(Array.isArray(m.layer3_and_ui_expectations)).toBe(true);
    expect(Array.isArray(m.hard_fail_stop_conditions)).toBe(true);
    expect(Array.isArray(m.observable_bounded_validate_proof_criteria)).toBe(
      true,
    );
    expect(Array.isArray(m.mandatory_disclaimers)).toBe(true);
  });

  it("post-validate ladder: bounded validate implemented as 2q; later steps out of scope", () => {
    const ladder = buildPhase2pPostValidateLadder();

    expect(ladder.version).toBe(PHASE_2P_POLICY_VERSION);
    expect(ladder.relates_to_phase_2m_ladder_step).toBe("validate_order");
    expect(Array.isArray(ladder.steps)).toBe(true);
    expect(ladder.steps.length).toBe(4);

    const ids = ladder.steps.map((s) => s.id);

    expect(ids).toContain("validate_order_bounded_interaction");
    expect(ids).toContain("post_validate_observation");
    expect(ids).toContain("checkout_flow");
    expect(ids).toContain("submit_finalize_order");

    const validateStep = ladder.steps.find(
      (s) => s.id === "validate_order_bounded_interaction",
    );

    expect(validateStep?.status).toBe("implemented_as_phase_2q_when_env_gated");

    for (const step of ladder.steps) {
      expect(Array.isArray(step.forbids_until_approved)).toBe(true);
      if (step.id === "validate_order_bounded_interaction") {
        continue;
      }
      expect(step.status).toBe("out_of_scope_until_separate_approval");
    }

    expect(ladder.steps.some((s) => /out_of_scope/.test(String(s.status)))).toBe(
      true,
    );
  });
});
