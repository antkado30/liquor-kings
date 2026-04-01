import { describe, it, expect } from "vitest";

import {
  PHASE_2M_POLICY_VERSION,
  buildPhase2mAddApplyLineFutureGateManifest,
  buildPhase2mPostAddApplyLadder,
} from "../src/workers/mlcc-phase-2m-policy.js";

describe("mlcc-phase-2m-policy", () => {
  it("exports a stable version string", () => {
    expect(PHASE_2M_POLICY_VERSION).toMatch(/^lk-rpa-2m-/);
  });

  it("add/apply-line gate manifest has required top-level structure", () => {
    const m = buildPhase2mAddApplyLineFutureGateManifest();

    expect(m.version).toBe(PHASE_2M_POLICY_VERSION);
    expect(m.phase_intent).toMatch(/planning_only/i);
    expect(Array.isArray(m.relationship_to_prior_phases)).toBe(true);
    expect(
      Array.isArray(m.evidence_prerequisites_before_add_apply_considered),
    ).toBe(true);
    expect(
      m.evidence_prerequisites_before_add_apply_considered.length,
    ).toBeGreaterThan(0);
    expect(Array.isArray(m.required_selectors_and_constraints)).toBe(true);
    expect(
      Array.isArray(m.network_and_ui_guard_expectations_for_non_mutating_claim),
    ).toBe(true);
    expect(Array.isArray(m.hard_fail_stop_conditions)).toBe(true);
    expect(
      Array.isArray(m.observable_non_mutating_add_apply_proof_criteria),
    ).toBe(true);
    expect(Array.isArray(m.mandatory_disclaimers)).toBe(true);
  });

  it("post-add/apply ladder marks all steps out of scope until separate approval", () => {
    const ladder = buildPhase2mPostAddApplyLadder();

    expect(ladder.version).toBe(PHASE_2M_POLICY_VERSION);
    expect(Array.isArray(ladder.steps)).toBe(true);
    expect(ladder.steps.length).toBe(4);

    const ids = ladder.steps.map((s) => s.id);

    expect(ids).toContain("add_apply_line_rehearsal");
    expect(ids).toContain("post_add_apply_observation");
    expect(ids).toContain("validate_order");
    expect(ids).toContain("checkout_submit");

    for (const step of ladder.steps) {
      expect(step.status).toBe("out_of_scope_until_separate_approval");
      expect(Array.isArray(step.forbids_until_approved)).toBe(true);
    }
  });
});
