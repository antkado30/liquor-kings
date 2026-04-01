import { describe, it, expect } from "vitest";

import { enforceParamStoreMatches } from "../src/middleware/store-param.middleware.js";
import { requireServiceRole } from "../src/middleware/require-service-role.middleware.js";
import {
  MLCC_BROWSER_DRY_RUN_SAFE_MODE,
  assertMlccSubmissionAllowed,
} from "../src/workers/mlcc-browser-worker.js";
import {
  installMlccSafetyNetworkGuards,
  shouldBlockHttpRequest,
} from "../src/workers/mlcc-browser-add-by-code-probe.js";

describe("anti-drift invariants", () => {
  it("store param enforcement middleware exists", () => {
    expect(typeof enforceParamStoreMatches).toBe("function");
  });

  it("service role middleware exists for worker claim path", () => {
    expect(typeof requireServiceRole).toBe("function");
  });

  it("RPA dry-run declares safe mode and submission guard (unused until submit phase)", () => {
    expect(MLCC_BROWSER_DRY_RUN_SAFE_MODE).toBe(true);
    expect(() =>
      assertMlccSubmissionAllowed({ submissionArmed: false }),
    ).toThrow(/MLCC submission blocked/);
  });

  it("network guard helpers exist for rebuild path", () => {
    expect(typeof installMlccSafetyNetworkGuards).toBe("function");
    expect(typeof shouldBlockHttpRequest).toBe("function");
    const b = shouldBlockHttpRequest("https://x/cart/add", "POST");
    expect(b.block).toBe(true);
  });
});
