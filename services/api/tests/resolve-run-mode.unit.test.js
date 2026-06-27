import { describe, it, expect } from "vitest";

import { resolveFromCartRunMode } from "../src/lib/resolve-run-mode.js";

/**
 * resolveFromCartRunMode — the money-path creation-time gate. mode:"submit"
 * is returned ONLY when requestedMode==="submit" AND envArmed AND storeArmed.
 * Any ambiguity → "dry_run". Bias is always toward dry_run (a false "submit"
 * risks a real order; a false "dry_run" only costs a practice run).
 */
describe("resolveFromCartRunMode", () => {
  it("returns submit only when requested + env + store all armed", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envArmed: true, storeArmed: true }),
    ).toEqual({ mode: "submit", downgradedFromSubmit: false });
  });

  it("downgrades to dry_run when env armed but store NOT armed", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envArmed: true, storeArmed: false }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("downgrades to dry_run when store armed but env NOT armed", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envArmed: false, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("downgrades to dry_run when neither gate armed", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envArmed: false, storeArmed: false }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("returns dry_run (no downgrade flag) for rpa_run regardless of arming", () => {
    // rpa_run is the scanner's current mode — never a submit request.
    expect(
      resolveFromCartRunMode({ requestedMode: "rpa_run", envArmed: true, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
    expect(
      resolveFromCartRunMode({ requestedMode: "rpa_run", envArmed: false, storeArmed: false }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
  });

  it("returns dry_run for validate_only / unknown modes (never submit)", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "validate_only", envArmed: true, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
    expect(
      resolveFromCartRunMode({ requestedMode: "garbage", envArmed: true, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
  });

  it("treats undefined flags as not-armed (bias to dry_run)", () => {
    // envArmed / storeArmed undefined → not === true → dry_run + downgrade.
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envArmed: undefined, storeArmed: undefined }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("treats truthy-but-non-boolean flags as not-armed (strict === true)", () => {
    // "yes" / 1 / "true" are NOT === true → disarmed. Only a real boolean
    // true arms the gate, matching how the caller reads the env ("yes" → true)
    // and the store (column === true).
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envArmed: "yes", storeArmed: 1 }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("never returns downgradedFromSubmit when not a submit request", () => {
    // Only a requested submit can "downgrade" — other modes are just dry_run.
    const r = resolveFromCartRunMode({ requestedMode: "rpa_run", envArmed: false, storeArmed: false });
    expect(r.downgradedFromSubmit).toBe(false);
    expect(r.mode).toBe("dry_run");
  });
});
