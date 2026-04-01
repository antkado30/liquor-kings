import { describe, it, expect } from "vitest";

import {
  assertMlccSubmissionAllowed,
  buildMlccBrowserConfig,
  inferLicenseStoreHeuristic,
  loginAndVerifyMlccLanding,
} from "../src/workers/mlcc-browser-worker.js";

describe("buildMlccBrowserConfig", () => {
  it("returns ready=true for valid synthetic payload + env", () => {
    const payload = {
      store: {
        mlcc_username: "  store_user  ",
      },
    };

    const env = {
      MLCC_PASSWORD: "  secret  ",
      MLCC_LOGIN_URL: "  https://example.com/login  ",
      MLCC_SAFE_TARGET_URL: "  https://example.com/safe  ",
      MLCC_HEADLESS: "false",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.config).toEqual({
      username: "store_user",
      password: "secret",
      loginUrl: "https://example.com/login",
      safeTargetUrl: "https://example.com/safe",
      orderingEntryUrl: null,
      headless: false,
      submissionArmed: false,
      stepScreenshotsEnabled: false,
      stepScreenshotMaxBytes: 200_000,
      licenseStoreAutomation: false,
      licenseStoreSelectSelector: null,
      licenseStoreContinueSelector: null,
      licenseStoreUrlPattern: null,
      licenseStoreWaitMs: 2000,
      addByCodeProbe: false,
      addByCodeEntrySelector: null,
      addByCodePhase2c: false,
      addByCodeCodeFieldSelector: null,
      addByCodeQtyFieldSelector: null,
      addByCodeSafeFocusBlur: false,
      addByCodePhase2d: false,
      addByCodePhase2e: false,
      mutationBoundaryRootSelector: null,
      mutationBoundaryUncertainHints: [],
      addByCodePhase2f: false,
      addByCodeSafeOpenCandidateSelectors: [],
      addByCodeSafeOpenTextAllowSubstrings: [],
      addByCodeProbeSkipEntryNav: false,
      addByCodePhase2g: false,
      addByCodePhase2gFocusBlurRehearsal: false,
      addByCodePhase2gSentinelTyping: false,
      addByCodePhase2gSentinelValue: null,
      addByCodePhase2h: false,
      addByCodePhase2hApproved: false,
      addByCodePhase2hTestCode: null,
    });
  });

  it("returns missing username error when store username absent", () => {
    const payload = {
      store: {},
    };

    const env = {
      MLCC_PASSWORD: "x",
      MLCC_LOGIN_URL: "https://example.com/login",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.config).toBe(null);
    expect(out.errors).toEqual([
      {
        type: "config",
        message: "Store is missing MLCC username",
      },
    ]);
  });

  it("returns missing password error when env.MLCC_PASSWORD absent", () => {
    const payload = {
      store: { mlcc_username: "u" },
    };

    const env = {
      MLCC_LOGIN_URL: "https://example.com/login",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.config).toBe(null);
    expect(out.errors).toEqual([
      {
        type: "config",
        message: "MLCC password is not configured",
      },
    ]);
  });

  it("returns missing login url error when env.MLCC_LOGIN_URL absent", () => {
    const payload = {
      store: { mlcc_username: "u" },
    };

    const env = {
      MLCC_PASSWORD: "p",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.config).toBe(null);
    expect(out.errors).toEqual([
      {
        type: "config",
        message: "MLCC login URL is not configured",
      },
    ]);
  });

  it("loginAndVerifyMlccLanding is not exercised against real MLCC in this suite", () => {
    expect(typeof loginAndVerifyMlccLanding).toBe("function");
  });

  it("parses optional ordering entry, submission armed, and screenshot settings", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ORDERING_ENTRY_URL: "  https://example.com/order  ",
      MLCC_SUBMISSION_ARMED: "true",
      MLCC_STEP_SCREENSHOTS: "true",
      MLCC_STEP_SCREENSHOT_MAX_BYTES: "100000",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.orderingEntryUrl).toBe("https://example.com/order");
    expect(out.config.submissionArmed).toBe(true);
    expect(out.config.stepScreenshotsEnabled).toBe(true);
    expect(out.config.stepScreenshotMaxBytes).toBe(100_000);
    expect(out.config.licenseStoreAutomation).toBe(false);
    expect(out.config.licenseStoreWaitMs).toBe(2000);
  });

  it("fails when license store automation is on without selectors", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_LICENSE_STORE_AUTOMATION: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors[0].message).toMatch(/MLCC_LICENSE_STORE_SELECT_SELECTOR/);
  });

  it("accepts license store automation with both selectors", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_LICENSE_STORE_AUTOMATION: "true",
      MLCC_LICENSE_STORE_SELECT_SELECTOR: "button.pick",
      MLCC_LICENSE_STORE_CONTINUE_SELECTOR: "a.next",
      MLCC_LICENSE_STORE_URL_PATTERN: "store|license",
      MLCC_LICENSE_STORE_WAIT_MS: "500",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.licenseStoreAutomation).toBe(true);
    expect(out.config.licenseStoreSelectSelector).toBe("button.pick");
    expect(out.config.licenseStoreContinueSelector).toBe("a.next");
    expect(out.config.licenseStoreUrlPattern).toBe("store|license");
    expect(out.config.licenseStoreWaitMs).toBe(500);
  });

  it("inferLicenseStoreHeuristic is advisory keyword match only", () => {
    const h1 = inferLicenseStoreHeuristic(
      "https://portal.example.com/select-store",
      "Choose store for delivery",
    );
    expect(h1.hint).toBe("possible_license_or_store_interstitial");
    expect(h1.matched_keywords.length).toBeGreaterThan(0);

    const h2 = inferLicenseStoreHeuristic("https://portal.example.com/home", "Home");
    expect(h2.hint).toBe("no_keyword_match");
  });

  it("rejects Phase 2d without Phase 2b probe", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PHASE_2D: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors[0].message).toMatch(/MLCC_ADD_BY_CODE_PROBE/);
  });

  it("rejects Phase 2e without Phase 2b probe", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PHASE_2E: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors[0].message).toMatch(/MLCC_ADD_BY_CODE_PROBE/);
  });

  it("rejects Phase 2d and Phase 2e together", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2D: "true",
      MLCC_ADD_BY_CODE_PHASE_2E: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors.some((e) => /mutually exclusive/i.test(e.message))).toBe(
      true,
    );
  });

  it("parses Phase 2e root selector and uncertain hints JSON", () => {
    const payload = { store: { mlcc_username: "u" } };
    const hints = JSON.stringify([
      { contains: "sku", advisory_label: "Likely product lookup (advisory)" },
    ]);
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2E: "true",
      MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR: "  #add-by-code-panel  ",
      MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS: hints,
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2e).toBe(true);
    expect(out.config.mutationBoundaryRootSelector).toBe("#add-by-code-panel");
    expect(out.config.mutationBoundaryUncertainHints).toEqual([
      { contains: "sku", advisory_label: "Likely product lookup (advisory)" },
    ]);
  });

  it("rejects Phase 2h without approval flag", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#code",
      MLCC_ADD_BY_CODE_PHASE_2H: "true",
      MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE: "TEST1",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors.some((e) => /2H_APPROVED/.test(e.message))).toBe(true);
  });

  it("accepts Phase 2h when approved with tenant code selector and test code", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#sku",
      MLCC_ADD_BY_CODE_PHASE_2H: "true",
      MLCC_ADD_BY_CODE_PHASE_2H_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE: "  ABC123  ",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2h).toBe(true);
    expect(out.config.addByCodePhase2hApproved).toBe(true);
    expect(out.config.addByCodePhase2hTestCode).toBe("ABC123");
  });

  it("rejects Phase 2h without tenant code field selector", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2H: "true",
      MLCC_ADD_BY_CODE_PHASE_2H_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE: "X",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) => /CODE_FIELD_SELECTOR/.test(e.message)),
    ).toBe(true);
  });

  it("rejects Phase 2g without Phase 2b probe", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PHASE_2G: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors.some((e) => /MLCC_ADD_BY_CODE_PROBE/.test(e.message))).toBe(
      true,
    );
  });

  it("accepts Phase 2g with probe and optional sentinel when pattern valid", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2G: "true",
      MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING: "true",
      MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE: "__LK_TEST__",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2gSentinelValue).toBe("__LK_TEST__");
  });

  it("rejects Phase 2g sentinel typing when value pattern invalid", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2G: "true",
      MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING: "true",
      MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE: "real-sku-123",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) => /MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE/.test(e.message)),
    ).toBe(true);
  });

  it("rejects Phase 2f without Phase 2b probe", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PHASE_2F: "true",
      MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS: '["button.x"]',
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors.some((e) => /MLCC_ADD_BY_CODE_PROBE/.test(e.message))).toBe(
      true,
    );
  });

  it("parses Phase 2f candidate selectors and optional text allowlist", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2F: "true",
      MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS:
        '["#open-abc", "button.add-by-code"]',
      MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS: '["special open"]',
      MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2f).toBe(true);
    expect(out.config.addByCodeSafeOpenCandidateSelectors).toEqual([
      "#open-abc",
      "button.add-by-code",
    ]);
    expect(out.config.addByCodeSafeOpenTextAllowSubstrings).toEqual([
      "special open",
    ]);
    expect(out.config.addByCodeProbeSkipEntryNav).toBe(true);
  });

  it("fails config when MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS is invalid for Phase 2f", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2F: "true",
      MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS: "[]",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS/.test(e.message),
      ),
    ).toBe(true);
  });

  it("fails config when MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS is not a JSON array", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2E: "true",
      MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS: "{}",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) => /MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS/.test(e.message)),
    ).toBe(true);
  });

  it("rejects Phase 2c without Phase 2b probe", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PHASE_2C: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors[0].message).toMatch(/MLCC_ADD_BY_CODE_PROBE/);
  });

  it("parses Phase 2c field selectors and focus/blur flag", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2C: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#product-code",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "input[name=qty]",
      MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2c).toBe(true);
    expect(out.config.addByCodeCodeFieldSelector).toBe("#product-code");
    expect(out.config.addByCodeQtyFieldSelector).toBe("input[name=qty]");
    expect(out.config.addByCodeSafeFocusBlur).toBe(true);
  });

  it("assertMlccSubmissionAllowed throws when not armed", () => {
    expect(() => assertMlccSubmissionAllowed({ submissionArmed: false })).toThrow(
      /MLCC submission blocked/,
    );
    expect(() => assertMlccSubmissionAllowed({ submissionArmed: true })).not.toThrow();
  });
});
