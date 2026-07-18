import { describe, it, expect } from "vitest";

import { enforceParamStoreMatches } from "../src/middleware/store-param.middleware.js";
import { requireServiceRole } from "../src/middleware/require-service-role.middleware.js";

/*
 * Live-path anti-drift invariants. The two legacy RPA assertions (safe-mode
 * flag + network guards on mlcc-browser-worker/probe) were removed 2026-07-18
 * with the legacy browser-automation subsystem itself (strangler-fig final
 * cut — production runs the rpa/ stages via processOneRpaRun, which the money
 * path's own safety is covered by the triple-gate tests + place-gate suite).
 * What remains here guards the LIVE store-scoping + service-role middleware.
 */
describe("anti-drift invariants", () => {
  it("store param enforcement middleware exists", () => {
    expect(typeof enforceParamStoreMatches).toBe("function");
  });

  it("service role middleware exists for worker claim path", () => {
    expect(typeof requireServiceRole).toBe("function");
  });
});
