import { describe, it, expect } from "vitest";

import { resolveFromCartRunMode } from "../src/lib/resolve-run-mode.js";

/**
 * resolveFromCartRunMode — the money-path creation-time gate. mode:"submit"
 * is returned ONLY when requestedMode==="submit" AND storeArmed AND the
 * break-glass kill is not engaged (envKilled !== true). Any ambiguity →
 * "dry_run". Bias is always toward dry_run (a false "submit" risks a real
 * order; a false "dry_run" only costs a practice run).
 *
 * 2026-07-23: env retired from a required arm to a break-glass KILL — its
 * ABSENCE now permits (no laptop needed to arm); only envKilled===true blocks.
 * The store flag is the real gate. See submit-arming-model.md.
 */
describe("resolveFromCartRunMode", () => {
  it("returns submit when requested + store armed + kill NOT engaged", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: false, storeArmed: true }),
    ).toEqual({ mode: "submit", downgradedFromSubmit: false });
  });

  it("the break-glass kill (envKilled) forces dry_run even with the store armed", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: true, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("store NOT armed → dry_run, kill absent (the store flag holds the line)", () => {
    // The key post-2026-07-23 safety: env absent (envKilled falsey) does NOT
    // arm on its own — the store must be a real-ordering store.
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: false, storeArmed: false }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
    // undefined envKilled behaves like "not killed" — still gated by the store.
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: undefined, storeArmed: false }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("env absent + store armed = submit (no laptop needed to arm — the vision)", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: undefined, storeArmed: true }),
    ).toEqual({ mode: "submit", downgradedFromSubmit: false });
  });

  it("returns dry_run (no downgrade flag) for rpa_run regardless of gates", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "rpa_run", envKilled: false, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
    expect(
      resolveFromCartRunMode({ requestedMode: "rpa_run", envKilled: true, storeArmed: false }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
  });

  it("returns dry_run for validate_only / unknown modes (never submit)", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "validate_only", envKilled: false, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
    expect(
      resolveFromCartRunMode({ requestedMode: "garbage", envKilled: false, storeArmed: true }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: false });
  });

  it("undefined storeArmed is treated as not-armed (bias to dry_run)", () => {
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: false, storeArmed: undefined }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("truthy-but-non-boolean storeArmed is NOT armed (strict === true)", () => {
    // Only a real boolean true arms; the caller reads the column as === true.
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: false, storeArmed: 1 }),
    ).toEqual({ mode: "dry_run", downgradedFromSubmit: true });
  });

  it("only a literal envKilled===true kills; other truthy values do NOT kill", () => {
    // The caller passes envKilled = (env === "no"); this asserts the pure fn
    // treats only boolean true as the kill, so a stray truthy can't over-block
    // in a way that hides intent — but also can't UNDER-block (store still gates).
    expect(
      resolveFromCartRunMode({ requestedMode: "submit", envKilled: "no", storeArmed: true }),
    ).toEqual({ mode: "submit", downgradedFromSubmit: false });
  });

  it("never returns downgradedFromSubmit when not a submit request", () => {
    const r = resolveFromCartRunMode({ requestedMode: "rpa_run", envKilled: true, storeArmed: false });
    expect(r.downgradedFromSubmit).toBe(false);
    expect(r.mode).toBe("dry_run");
  });
});
