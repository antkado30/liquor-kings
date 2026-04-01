import { describe, it, expect } from "vitest";

import {
  PHASE_2I_POLICY_VERSION,
  buildPhase2iBroaderInteractionLadder,
  buildPhase2iQuantityFutureGateManifest,
} from "../src/workers/mlcc-phase-2i-policy.js";

describe("mlcc-phase-2i-policy", () => {
  it("exports a stable version string", () => {
    expect(PHASE_2I_POLICY_VERSION).toMatch(/^lk-rpa-2i-/);
  });

  it("quantity future gate manifest has required top-level structure", () => {
    const m = buildPhase2iQuantityFutureGateManifest();

    expect(m.version).toBe(PHASE_2I_POLICY_VERSION);
    expect(m.phase_intent).toMatch(/planning_only/i);
    expect(Array.isArray(m.evidence_prerequisites_before_quantity_considered)).toBe(
      true,
    );
    expect(m.evidence_prerequisites_before_quantity_considered.length).toBeGreaterThan(
      0,
    );
    expect(Array.isArray(m.required_selectors_and_constraints)).toBe(true);
    expect(Array.isArray(m.mutation_risk_checks_must_pass)).toBe(true);
    expect(
      Array.isArray(m.network_and_ui_guard_signals_required_zero_for_non_mutating_claim),
    ).toBe(true);
    expect(Array.isArray(m.hard_fail_stop_conditions)).toBe(true);
    expect(Array.isArray(m.observable_non_mutating_quantity_proof_criteria)).toBe(
      true,
    );
  });

  it("broader interaction ladder marks all steps out of scope until separate approval", () => {
    const ladder = buildPhase2iBroaderInteractionLadder();

    expect(ladder.version).toBe(PHASE_2I_POLICY_VERSION);
    expect(Array.isArray(ladder.steps)).toBe(true);
    expect(ladder.steps.length).toBeGreaterThanOrEqual(4);

    const ids = ladder.steps.map((s) => s.id);

    expect(ids).toContain("quantity_rehearsal");
    expect(ids).toContain("quantity_clear_revert");
    expect(ids).toContain("add_or_apply_line");
    expect(ids).toContain("validate_order");
    expect(ids).toContain("checkout_submit");

    for (const step of ladder.steps) {
      expect(step.status).toBe("out_of_scope_until_separate_approval");
      expect(Array.isArray(step.forbids_until_approved)).toBe(true);
    }
  });
});
