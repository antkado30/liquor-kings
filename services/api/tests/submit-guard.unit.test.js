import { describe, it, expect } from "vitest";
import {
  assertSubmitMachineryAllowed,
  SUBMIT_ALLOWED_RUN_TYPE,
} from "../src/workers/submit-guard.js";

/**
 * THE "CHECK NEVER SUBMITS" INVARIANT (Tony, 2026-07-23).
 * The submit machinery is reachable only from a real order run. A check
 * (validate_only) or cart reset must throw before any submit code runs.
 * This is the fail-closed guard both submit call sites in execution-worker.js
 * call immediately before submitting.
 */
describe("assertSubmitMachineryAllowed — check never submits", () => {
  it("allows a real order run (rpa_run)", () => {
    expect(() => assertSubmitMachineryAllowed({ runType: "rpa_run" })).not.toThrow();
    expect(SUBMIT_ALLOWED_RUN_TYPE).toBe("rpa_run");
  });

  it("BLOCKS a check/preview (validate_only) — the invariant", () => {
    expect(() => assertSubmitMachineryAllowed({ runType: "validate_only" })).toThrow(
      /SUBMIT MACHINERY BLOCKED/,
    );
  });

  it("BLOCKS a cart reset", () => {
    expect(() => assertSubmitMachineryAllowed({ runType: "cart_reset_only" })).toThrow(
      /must NEVER reach here/,
    );
  });

  it("BLOCKS null / undefined / unknown run types (fail closed)", () => {
    for (const rt of [null, undefined, "", "preview", "submit", "SUBMIT"]) {
      expect(() => assertSubmitMachineryAllowed({ runType: rt })).toThrow();
    }
  });

  it("carries a typed error code and the call-site label", () => {
    try {
      assertSubmitMachineryAllowed({ runType: "validate_only", site: "engine_submit(node)" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.code).toBe("LK_CHECK_NEVER_SUBMITS_VIOLATION");
      expect(e.message).toContain("engine_submit(node)");
    }
  });
});
