import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
  assertMlccSubmissionAllowed,
  buildMlccBrowserConfig,
  inferLicenseStoreHeuristic,
  loginAndVerifyMlccLanding,
} from "../src/workers/mlcc-browser-worker.js";
import { MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME } from "../src/workers/mlcc-browser-evidence.js";
import { MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME as probeRunSummaryBasename } from "../src/workers/mlcc-browser-add-by-code-probe.js";
import { evaluateDryRunMappingConfidenceGuard } from "../src/quantity-rules/index.js";
import { shouldBlockHttpRequest } from "../src/workers/mlcc-guards.js";

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
      loginFailureSnapshotMaxBytes: 450_000,
      safeFlowScreenshotDir: null,
      reconMode: false,
      reconMappingUrls: [
        "https://example.com/safe",
        "https://example.com/milo/home",
        "https://example.com/milo/location",
        "https://example.com/milo/products",
        "https://example.com/milo/products/bycode",
        "https://example.com/milo/cart",
      ],
      addByCodeProbe: false,
      addByCodeEntrySelector: null,
      addByCodePhase2c: false,
      addByCodePhase2cNavBycodeUrl: null,
      addByCodePhase2cSkipBycodeNav: false,
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
      addByCodePhase2j: false,
      addByCodePhase2jApproved: false,
      addByCodePhase2jTestQuantity: null,
      addByCodePhase2jAllowBlur: false,
      addByCodePhase2l: false,
      addByCodePhase2lApproved: false,
      addByCodePhase2lTestCode: null,
      addByCodePhase2lTestQuantity: null,
      addByCodePhase2lFieldOrder: null,
      addByCodePhase2lAllowBlur: false,
      addByCodePhase2lSkipClearWhen2uApproved: false,
      addByCodePhase2lMiloPostFillTabFromQuantity: false,
      addByCodePhase2lMiloPostFillTabFromQuantityApproved: false,
      addByCodePhase2lMiloPostFillTabFromQuantitySettleMs: 500,
      addByCodePhase2lMiloManualParitySequence: false,
      addByCodePhase2lMiloManualParitySequenceApproved: false,
      addByCodePhase2lMiloManualParitySequenceSettleMs: 600,
      addByCodePhase2lMiloFullKeyboardParitySequence: false,
      addByCodePhase2lMiloFullKeyboardParitySequenceApproved: false,
      addByCodePhase2lMiloManualParityBlankClickTargetSelector: null,
      addByCodePhase2lMiloManualParityBlankClickPositionX: null,
      addByCodePhase2lMiloManualParityBlankClickPositionY: null,
      addByCodePhase2lMiloManualParityPostBlankWaitForTextSubstring: null,
      addByCodePhase2lMiloManualParityPostBlankWaitForTextMs: 0,
      addByCodePhase2lMiloPostFillClickAway: false,
      addByCodePhase2lMiloPostFillClickAwayApproved: false,
      addByCodePhase2lMiloPostFillClickAwayTargetSelector: null,
      addByCodePhase2lMiloPostFillClickAwaySettleMs: 500,
      addByCodePhase2n: false,
      addByCodePhase2nApproved: false,
      addByCodePhase2nAddApplyCandidateSelectors: [],
      addByCodePhase2nTextAllowSubstrings: [],
      addByCodePhase2uMiloBulk: false,
      addByCodePhase2uMiloBulkApproved: false,
      addByCodePhase2uMiloBulkCandidateSelectors: [],
      addByCodePhase2uMiloBulkTextAllowSubstrings: [],
      addByCode2uDeterminismStatePath: null,
      addByCode2uDeterminismStateWrite: false,
      addByCode2uDeterminismStateWriteApproved: false,
      addByCodePhase2o: false,
      addByCodePhase2oMiloPost2u: false,
      addByCodePhase2oApproved: false,
      addByCodePhase2oSettleMs: 500,
      addByCodePhase2oMiloReadonlyCartValidateDiscovery: false,
      addByCodePhase2oMiloReadonlyCartValidateDiscoveryApproved: false,
      addByCodePhase2oMiloSafeCartIconClick: false,
      addByCodePhase2oMiloSafeCartIconClickApproved: false,
      addByCodePhase2oMiloReadonlyCartValidateDiscoveryUrl: null,
      addByCodePhase2oMiloReadonlyCartDiscoveryPathCandidates: [],
      addByCodePhase2oMiloReadonlyCartValidateDiscoverySettleMs: 600,
      addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleMs: 0,
      addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleApproved: false,
      addByCodeMiloPreCartListRootSelector: null,
      addByCodeMiloPreCartListRootSelectorApproved: false,
      addByCodePhase2q: false,
      addByCodePhase2qApproved: false,
      addByCodePhase2qOperatorAcceptsMissing2o: false,
      addByCodePhase2qValidateCandidateSelectors: [],
      addByCodePhase2qTextAllowSubstrings: [],
      addByCodePhase2qPostValidateObserveSettleMs: 400,
      addByCodePhase2r: false,
      addByCodePhase2rApproved: false,
      addByCodePhase2rSettleMs: 600,
      addByCodePhase2vMiloValidate: false,
      addByCodePhase2vMiloValidateApproved: false,
      addByCodePhase2vMiloValidateSelectors: [],
      addByCodePhase2vMiloValidateTextAllowSubstrings: [],
      addByCodePhase2wMiloPostValidate: false,
      addByCodePhase2wMiloPostValidateApproved: false,
      addByCodePhase2wMiloPostValidateSettleMs: 600,
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
      MLCC_SAFE_FLOW_SCREENSHOT_DIR: " /tmp/mlcc-flow ",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.orderingEntryUrl).toBe("https://example.com/order");
    expect(out.config.submissionArmed).toBe(true);
    expect(out.config.stepScreenshotsEnabled).toBe(true);
    expect(out.config.stepScreenshotMaxBytes).toBe(100_000);
    expect(out.config.safeFlowScreenshotDir).toBe("/tmp/mlcc-flow");
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

  it("rejects Phase 2j without approval flag", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#qty",
      MLCC_ADD_BY_CODE_PHASE_2J: "true",
      MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY: "2",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors.some((e) => /2J_APPROVED/.test(e.message))).toBe(true);
  });

  it("accepts Phase 2j when approved with tenant qty selector and test quantity", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "  #qty  ",
      MLCC_ADD_BY_CODE_PHASE_2J: "true",
      MLCC_ADD_BY_CODE_PHASE_2J_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY: "  42  ",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2j).toBe(true);
    expect(out.config.addByCodePhase2jApproved).toBe(true);
    expect(out.config.addByCodePhase2jTestQuantity).toBe("42");
    expect(out.config.addByCodeQtyFieldSelector).toBe("#qty");
  });

  it("rejects Phase 2l without approval flag", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "X",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.errors.some((e) => /2L_APPROVED/.test(e.message))).toBe(true);
  });

  it("rejects MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED without Phase 2U bulk approved lane", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts Phase 2l skip-clear flag when MILO 2U bulk lane is fully approved", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2lSkipClearWhen2uApproved).toBe(true);
  });

  it("rejects MLCC_2U_DETERMINISM_STATE_WRITE without MLCC_2U_DETERMINISM_STATE_PATH", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_2U_DETERMINISM_STATE_WRITE: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_2U_DETERMINISM_STATE_WRITE=true requires MLCC_2U_DETERMINISM_STATE_PATH/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("rejects MLCC_2U_DETERMINISM_STATE_PATH without Phase 2U MILO bulk", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_2U_DETERMINISM_STATE_PATH: "/tmp/x.json",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_2U_DETERMINISM_STATE_PATH or MLCC_2U_DETERMINISM_STATE_WRITE requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts MLCC_2U_DETERMINISM_STATE_PATH with approved 2U bulk lane", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_2U_DETERMINISM_STATE_PATH: "/tmp/lk-2u-determinism.json",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCode2uDeterminismStatePath).toBe(
      "/tmp/lk-2u-determinism.json",
    );
  });

  it("accepts Phase 2l when approved with selectors, test values, and field order", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#sku",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#qty",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "  ABC  ",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "  2  ",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "quantity-first",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2l).toBe(true);
    expect(out.config.addByCodePhase2lTestCode).toBe("ABC");
    expect(out.config.addByCodePhase2lTestQuantity).toBe("2");
    expect(out.config.addByCodePhase2lFieldOrder).toBe("quantity_first");
  });

  it("rejects Phase 2j without tenant quantity field selector", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2J: "true",
      MLCC_ADD_BY_CODE_PHASE_2J_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY: "1",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) => /QTY_FIELD_SELECTOR/.test(e.message)),
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
    expect(out.config.addByCodePhase2cNavBycodeUrl).toBe(
      "https://example.com/milo/products/bycode",
    );
    expect(out.config.addByCodePhase2cSkipBycodeNav).toBe(false);
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

  it("rejects MILO read-only cart validate discovery without approval flag", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("rejects MILO safe cart icon click without readonly cart discovery lane", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK_APPROVED: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK=true requires MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY=true/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts MILO read-only cart validate discovery when fully gated", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_URL:
        "https://example.com/milo/cart",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2oMiloReadonlyCartValidateDiscovery).toBe(true);
    expect(out.config.addByCodePhase2oMiloReadonlyCartValidateDiscoveryUrl).toBe(
      "https://example.com/milo/cart",
    );
    expect(out.config.addByCodeMiloPreCartListRootSelector).toBe(null);
    expect(out.config.addByCodePhase2oMiloSafeCartIconClick).toBe(false);
  });

  it("accepts MILO safe cart icon click when discovery lane is fully gated", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_URL:
        "https://example.com/milo/cart",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK_APPROVED: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2oMiloSafeCartIconClick).toBe(true);
    expect(out.config.addByCodePhase2oMiloSafeCartIconClickApproved).toBe(true);
  });

  it("rejects MILO pre-cart list-root selector without operator approval in discovery lane", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_URL:
        "https://example.com/milo/cart",
      MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR: ".search-container",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR requires MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR_APPROVED/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts MILO pre-cart list-root selector when approved in discovery lane", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_URL:
        "https://example.com/milo/cart",
      MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR: ".search-container",
      MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR_APPROVED: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodeMiloPreCartListRootSelector).toBe(".search-container");
    expect(out.config.addByCodeMiloPreCartListRootSelectorApproved).toBe(true);
  });

  it("rejects MILO pre-readonly-cart settle ms without operator approval", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_MS: "2000",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /PRE_READONLY_CART_SETTLE_MS>0 requires/.test(e.message),
      ),
    ).toBe(true);
  });

  it("accepts MILO pre-readonly-cart settle when ms and approval are set", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: '["button.ok"]',
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_MS: "2500",
      MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_APPROVED: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleMs).toBe(
      2500,
    );
    expect(out.config.addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleApproved).toBe(
      true,
    );
  });

  it("rejects MILO post-fill click-away without operator approval", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_APPROVED/.test(e.message),
      ),
    ).toBe(true);
  });

  it("rejects MILO manual parity sequence without operator approval", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts MILO manual parity sequence when approved and selectors present", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_SETTLE_MS: "900",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_TARGET_SELECTOR: "main",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2lMiloManualParitySequence).toBe(true);
    expect(out.config.addByCodePhase2lMiloManualParitySequenceApproved).toBe(
      true,
    );
    expect(out.config.addByCodePhase2lMiloManualParitySequenceSettleMs).toBe(
      900,
    );
    expect(out.config.addByCodePhase2lMiloManualParityBlankClickTargetSelector).toBe(
      "main",
    );
  });

  it("rejects MILO full keyboard parity sequence without dedicated approval", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE_APPROVED/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts MILO full keyboard parity sequence when dedicated approval is present", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE_APPROVED: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2lMiloFullKeyboardParitySequence).toBe(true);
    expect(out.config.addByCodePhase2lMiloFullKeyboardParitySequenceApproved).toBe(
      true,
    );
  });

  it("rejects MILO manual parity post-blank wait substring without approval", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_SUBSTRING:
        "Patron",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_APPROVED/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts MILO manual parity post-blank wait substring when approved (default ms)", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_SUBSTRING:
        "Patron",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_APPROVED:
        "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2lMiloManualParityPostBlankWaitForTextSubstring).toBe(
      "Patron",
    );
    expect(out.config.addByCodePhase2lMiloManualParityPostBlankWaitForTextMs).toBe(8000);
  });

  it("rejects MILO Tab-from-quantity without operator approval", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY: "true",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(
      out.errors.some((e) =>
        /MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_APPROVED/.test(
          e.message,
        ),
      ),
    ).toBe(true);
  });

  it("accepts MILO Tab-from-quantity when approved and 2L + qty selector satisfied", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_SETTLE_MS: "600",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2lMiloPostFillTabFromQuantity).toBe(true);
    expect(out.config.addByCodePhase2lMiloPostFillTabFromQuantityApproved).toBe(
      true,
    );
    expect(out.config.addByCodePhase2lMiloPostFillTabFromQuantitySettleMs).toBe(
      600,
    );
  });

  it("accepts MILO post-fill click-away when approved and 2L gates satisfied", () => {
    const payload = { store: { mlcc_username: "u" } };
    const env = {
      MLCC_PASSWORD: "p",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_ADD_BY_CODE_PROBE: "true",
      MLCC_ADD_BY_CODE_PHASE_2L: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: "1",
      MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: "2",
      MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: "code_first",
      MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR: "#c",
      MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR: "#q",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_APPROVED: "true",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_TARGET_SELECTOR: "main",
      MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_SETTLE_MS: "800",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.config.addByCodePhase2lMiloPostFillClickAway).toBe(true);
    expect(out.config.addByCodePhase2lMiloPostFillClickAwayApproved).toBe(true);
    expect(out.config.addByCodePhase2lMiloPostFillClickAwayTargetSelector).toBe("main");
    expect(out.config.addByCodePhase2lMiloPostFillClickAwaySettleMs).toBe(800);
  });
});

describe("MLCC SAFE MODE network policy (same rules as installMlccSafetyNetworkGuards)", () => {
  it("blocks high-risk order completion mutations while keeping 2n/2q allowlisted XHR paths open", () => {
    expect(
      shouldBlockHttpRequest("https://vendor.example/order/complete", "POST").block,
    ).toBe(true);
    expect(
      shouldBlockHttpRequest("https://vendor.example/milo/order/submit", "POST")
        .block,
    ).toBe(true);
    expect(
      shouldBlockHttpRequest("https://vendor.example/cart/checkout", "POST").block,
    ).toBe(true);
    expect(
      shouldBlockHttpRequest("https://vendor.example/order/apply-line", "POST")
        .block,
    ).toBe(false);
    expect(
      shouldBlockHttpRequest("https://vendor.example/order/validate", "POST")
        .block,
    ).toBe(false);
  });

  it("blocks checkout-confirm GET navigation patterns used in order flows", () => {
    expect(
      shouldBlockHttpRequest("https://vendor.example/checkout/confirm", "GET")
        .block,
    ).toBe(true);
    expect(shouldBlockHttpRequest("https://vendor.example/home", "GET").block).toBe(
      false,
    );
  });
});

describe("MLCC safe-flow evidence baseline (probe ↔ evidence)", () => {
  it("re-exports the canonical run summary basename for operators and drift checks", () => {
    expect(probeRunSummaryBasename).toBe(MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME);
    expect(probeRunSummaryBasename).toBe("mlcc_run_summary.json");
  });
});

describe("Dry-run mapping confidence guard (worker preflight)", () => {
  it("worker invokes evaluateDryRunMappingConfidenceGuard after deterministic validation", () => {
    const workerPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/workers/mlcc-browser-worker.js",
    );
    const src = fs.readFileSync(workerPath, "utf8");
    expect(src).toContain("evaluateDryRunMappingConfidenceGuard(payload)");
    expect(src).toContain("validate_mapping_confidence");
    expect(src).toContain("mlcc_dry_run_mapping_confidence");
  });

  it("matches quantity-rules module behavior for confirmed / inferred / unknown", () => {
    expect(
      evaluateDryRunMappingConfidenceGuard({
        items: [{ cartItemId: "1", bottle: { mlcc_code: "x" } }],
      }).ok,
    ).toBe(true);
    expect(
      evaluateDryRunMappingConfidenceGuard({
        items: [
          { cartItemId: "1", mappingconfidence: "unknown", bottle: { mlcc_code: "7127" } },
        ],
      }).ok,
    ).toBe(false);
    expect(
      evaluateDryRunMappingConfidenceGuard({
        items: [
          { cartItemId: "1", mappingconfidence: "inferred", bottle: { mlcc_code: "4101" } },
        ],
      }).inferred_items,
    ).toHaveLength(1);
  });
});
