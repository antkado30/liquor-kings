import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  installMlccSafetyNetworkGuards,
  parseMutationBoundaryUncertainHints,
  parsePhase2fSafeOpenTextAllowSubstrings,
  parsePhase2gSentinelValue,
  parseSafeOpenCandidateSelectors,
  runAddByCodePhase2cFieldHardening,
  runAddByCodePhase2dMutationBoundaryMap,
  runAddByCodePhase2eMutationBoundaryMap,
  runAddByCodePhase2fSafeOpenConfirm,
  runAddByCodePhase2gTypingPolicyAndRehearsal,
  runAddByCodeProbePhase,
} from "./mlcc-browser-add-by-code-probe.js";
import {
  buildPageSnapshotAttributes,
  maybeScreenshotPngBase64,
  mergeSnapshotAndScreenshot,
} from "./mlcc-browser-evidence.js";
import { buildMlccDryRunPlan } from "./mlcc-dry-run.js";
import {
  assertDeterministicExecutionPayload,
  claimNextRun,
  finalizeRun,
  heartbeatRun,
} from "./execution-worker.js";
import {
  FAILURE_TYPE,
  classifyFailureType,
} from "../services/execution-failure.service.js";
import { MLCC_SIGNAL } from "../services/mlcc-operator-context.service.js";

/** Dry-run worker never performs order submission; kept explicit for future phases. */
export const MLCC_BROWSER_DRY_RUN_SAFE_MODE = true;

/**
 * Env (documented):
 * - MLCC_LOGIN_URL, MLCC_PASSWORD, MLCC_SAFE_TARGET_URL, MLCC_HEADLESS — existing
 * - MLCC_ORDERING_ENTRY_URL — optional; navigated after login/license step, before safe target (when both differ)
 * - MLCC_SUBMISSION_ARMED — must be "true" before any future submit step is allowed (no submit in this worker yet)
 * - MLCC_STEP_SCREENSHOTS — "true" to attach capped PNG base64 to step/failure evidence
 * - MLCC_STEP_SCREENSHOT_MAX_BYTES — default 200000
 * Phase 2a (license/store, non-destructive):
 * - MLCC_LICENSE_STORE_AUTOMATION — "true" to run bounded select+continue (requires both selectors below)
 * - MLCC_LICENSE_STORE_SELECT_SELECTOR — Playwright CSS selector for store/license choice (single bounded click)
 * - MLCC_LICENSE_STORE_CONTINUE_SELECTOR — selector for continue/next (navigation only; not checkout)
 * - MLCC_LICENSE_STORE_URL_PATTERN — optional RegExp source; if set, automation runs only when URL matches
 * - MLCC_LICENSE_STORE_WAIT_MS — wait between clicks (default 2000)
 * Phase 2b (add-by-code probe, non-mutating):
 * - MLCC_ADD_BY_CODE_PROBE — "true" to run detection-only probe after ordering-ready (no typing; guards on)
 * - MLCC_ADD_BY_CODE_ENTRY_SELECTOR — optional CSS for a single safe open action (blocked if label matches submit/cart patterns)
 * Phase 2c (selector hardening; still no cart mutation, no validate):
 * - MLCC_ADD_BY_CODE_PHASE_2C — "true" requires MLCC_ADD_BY_CODE_PROBE=true; tenant field selectors + read-only inspection
 * - MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR — optional CSS for product/code input (preferred over heuristic)
 * - MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR — optional CSS for quantity input
 * - MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR — "true" to allow guarded focus/blur only when risk check passes (still no typing)
 * Phase 2d (mutation boundary map; read-only control scan; no clicks):
 * - MLCC_ADD_BY_CODE_PHASE_2D — "true" requires MLCC_ADD_BY_CODE_PROBE=true; classifies visible controls safe / unsafe / uncertain (heuristic)
 * Phase 2e (scoped boundary map; mutually exclusive with 2D):
 * - MLCC_ADD_BY_CODE_PHASE_2E — "true" requires probe; prefers MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR scope, else broad fallback
 * - MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR — CSS for add-by-code container (optional; fallback if missing/not visible)
 * - MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS — optional JSON array [{ "contains": "...", "advisory_label": "..." }] for uncertain rows only (advisory)
 * Phase 2f (safe open confirmation; after 2b/2c/2d|2e):
 * - MLCC_ADD_BY_CODE_PHASE_2F — "true" requires probe + MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS (JSON array of CSS selectors, priority order)
 * - MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS — optional JSON array; extends uncertain-label open-intent matching
 * - MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV — "true" skips Phase 2b configured/heuristic entry clicks so Phase 2f performs the only open attempt
 * Phase 2g (pre-mutation typing policy + optional bounded rehearsal):
 * - MLCC_ADD_BY_CODE_PHASE_2G — "true" requires probe; policy + field risk readout; default no value entry
 * - MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL — optional bounded focus/blur when extended risk allows (still no product values)
 * - MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING — optional; requires MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE matching ^__LK_[A-Z0-9_]{1,48}__$ only
 */
export function buildMlccBrowserConfig({ payload, env }) {
  if (!payload) {
    return {
      ready: false,
      config: null,
      errors: [
        {
          type: "config",
          message: "Execution payload is missing",
        },
      ],
    };
  }

  if (!payload.store) {
    return {
      ready: false,
      config: null,
      errors: [
        {
          type: "config",
          message: "Store is missing from execution payload",
        },
      ],
    };
  }

  const errors = [];

  const usernameRaw = payload.store.mlcc_username;
  const username =
    typeof usernameRaw === "string" ? usernameRaw.trim() : "";

  if (!username) {
    errors.push({
      type: "config",
      message: "Store is missing MLCC username",
    });
  }

  const passwordRaw = env?.MLCC_PASSWORD;
  const password =
    typeof passwordRaw === "string" ? passwordRaw.trim() : "";

  if (!password) {
    errors.push({
      type: "config",
      message: "MLCC password is not configured",
    });
  }

  const loginUrlRaw = env?.MLCC_LOGIN_URL;
  const loginUrl =
    typeof loginUrlRaw === "string" ? loginUrlRaw.trim() : "";

  if (!loginUrl) {
    errors.push({
      type: "config",
      message: "MLCC login URL is not configured",
    });
  }

  if (errors.length > 0) {
    return {
      ready: false,
      config: null,
      errors,
    };
  }

  const safeTargetRaw = env?.MLCC_SAFE_TARGET_URL;
  let safeTargetUrl = null;

  if (
    typeof safeTargetRaw === "string" &&
    safeTargetRaw.trim() !== ""
  ) {
    safeTargetUrl = safeTargetRaw.trim();
  }

  const orderingEntryRaw = env?.MLCC_ORDERING_ENTRY_URL;
  let orderingEntryUrl = null;

  if (
    typeof orderingEntryRaw === "string" &&
    orderingEntryRaw.trim() !== ""
  ) {
    orderingEntryUrl = orderingEntryRaw.trim();
  }

  const headless = env?.MLCC_HEADLESS === "false" ? false : true;

  const submissionArmed = env?.MLCC_SUBMISSION_ARMED === "true";

  const stepScreenshotsEnabled = env?.MLCC_STEP_SCREENSHOTS === "true";

  const maxRaw = env?.MLCC_STEP_SCREENSHOT_MAX_BYTES;
  const maxParsed = maxRaw != null ? Number.parseInt(String(maxRaw), 10) : NaN;
  const stepScreenshotMaxBytes = Number.isFinite(maxParsed) && maxParsed > 0
    ? maxParsed
    : 200_000;

  const licenseStoreAutomation =
    env?.MLCC_LICENSE_STORE_AUTOMATION === "true";

  const licenseStoreSelectRaw = env?.MLCC_LICENSE_STORE_SELECT_SELECTOR;
  const licenseStoreSelectSelector =
    typeof licenseStoreSelectRaw === "string"
      ? licenseStoreSelectRaw.trim()
      : "";

  const licenseStoreContinueRaw = env?.MLCC_LICENSE_STORE_CONTINUE_SELECTOR;
  const licenseStoreContinueSelector =
    typeof licenseStoreContinueRaw === "string"
      ? licenseStoreContinueRaw.trim()
      : "";

  const licenseStorePatternRaw = env?.MLCC_LICENSE_STORE_URL_PATTERN;
  const licenseStoreUrlPattern =
    typeof licenseStorePatternRaw === "string" &&
    licenseStorePatternRaw.trim() !== ""
      ? licenseStorePatternRaw.trim()
      : null;

  const licenseWaitParsed = env?.MLCC_LICENSE_STORE_WAIT_MS != null
    ? Number.parseInt(String(env.MLCC_LICENSE_STORE_WAIT_MS), 10)
    : NaN;
  const licenseStoreWaitMs = Number.isFinite(licenseWaitParsed) && licenseWaitParsed >= 0
    ? licenseWaitParsed
    : 2000;

  if (licenseStoreAutomation) {
    if (!licenseStoreSelectSelector || !licenseStoreContinueSelector) {
      errors.push({
        type: "config",
        message:
          "MLCC_LICENSE_STORE_AUTOMATION=true requires MLCC_LICENSE_STORE_SELECT_SELECTOR and MLCC_LICENSE_STORE_CONTINUE_SELECTOR",
      });
    }
  }

  const addByCodeProbe = env?.MLCC_ADD_BY_CODE_PROBE === "true";

  const addByCodeEntryRaw = env?.MLCC_ADD_BY_CODE_ENTRY_SELECTOR;
  const addByCodeEntrySelector =
    typeof addByCodeEntryRaw === "string" && addByCodeEntryRaw.trim() !== ""
      ? addByCodeEntryRaw.trim()
      : null;

  const addByCodePhase2c = env?.MLCC_ADD_BY_CODE_PHASE_2C === "true";

  const addByCodeCodeFieldRaw = env?.MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR;
  const addByCodeCodeFieldSelector =
    typeof addByCodeCodeFieldRaw === "string" &&
    addByCodeCodeFieldRaw.trim() !== ""
      ? addByCodeCodeFieldRaw.trim()
      : null;

  const addByCodeQtyFieldRaw = env?.MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR;
  const addByCodeQtyFieldSelector =
    typeof addByCodeQtyFieldRaw === "string" &&
    addByCodeQtyFieldRaw.trim() !== ""
      ? addByCodeQtyFieldRaw.trim()
      : null;

  const addByCodeSafeFocusBlur =
    env?.MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR === "true";

  const addByCodePhase2d = env?.MLCC_ADD_BY_CODE_PHASE_2D === "true";

  const addByCodePhase2e = env?.MLCC_ADD_BY_CODE_PHASE_2E === "true";

  const mutationBoundaryRootRaw = env?.MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR;
  const mutationBoundaryRootSelector =
    typeof mutationBoundaryRootRaw === "string" &&
    mutationBoundaryRootRaw.trim() !== ""
      ? mutationBoundaryRootRaw.trim()
      : null;

  let mutationBoundaryUncertainHints = [];
  const uncertainHintsRaw = env?.MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS;

  if (uncertainHintsRaw != null && String(uncertainHintsRaw).trim() !== "") {
    try {
      mutationBoundaryUncertainHints = parseMutationBoundaryUncertainHints(
        uncertainHintsRaw,
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      errors.push({
        type: "config",
        message: `Invalid MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS: ${m}`,
      });
    }
  }

  if (addByCodePhase2c && !addByCodeProbe) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2C=true requires MLCC_ADD_BY_CODE_PROBE=true",
    });
  }

  if (addByCodePhase2d && !addByCodeProbe) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2D=true requires MLCC_ADD_BY_CODE_PROBE=true",
    });
  }

  if (addByCodePhase2e && !addByCodeProbe) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2E=true requires MLCC_ADD_BY_CODE_PROBE=true",
    });
  }

  const addByCodePhase2f = env?.MLCC_ADD_BY_CODE_PHASE_2F === "true";

  const addByCodeProbeSkipEntryNav =
    env?.MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV === "true";

  let addByCodeSafeOpenCandidateSelectors = [];
  let addByCodeSafeOpenTextAllowSubstrings = [];

  if (addByCodePhase2f) {
    try {
      addByCodeSafeOpenCandidateSelectors = parseSafeOpenCandidateSelectors(
        env?.MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS,
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS: ${m}`,
      });
    }

    const allowRaw = env?.MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS;

    if (allowRaw != null && String(allowRaw).trim() !== "") {
      try {
        addByCodeSafeOpenTextAllowSubstrings =
          parsePhase2fSafeOpenTextAllowSubstrings(allowRaw);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);

        errors.push({
          type: "config",
          message: `Invalid MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS: ${m}`,
        });
      }
    }
  }

  if (addByCodePhase2f && !addByCodeProbe) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2F=true requires MLCC_ADD_BY_CODE_PROBE=true",
    });
  }

  const addByCodePhase2g = env?.MLCC_ADD_BY_CODE_PHASE_2G === "true";

  const addByCodePhase2gFocusBlurRehearsal =
    env?.MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL === "true";

  const addByCodePhase2gSentinelTyping =
    env?.MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING === "true";

  let addByCodePhase2gSentinelValue = null;

  if (addByCodePhase2gSentinelTyping) {
    const parsed = parsePhase2gSentinelValue(
      env?.MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE,
    );

    if (!parsed.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE: ${parsed.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2gSentinelValue = parsed.value;
    }

    if (parsed.ok && !parsed.value) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING=true requires MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE set to a valid __LK_…__ sentinel",
      });
    }
  }

  if (addByCodePhase2g && !addByCodeProbe) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2G=true requires MLCC_ADD_BY_CODE_PROBE=true",
    });
  }

  if (addByCodePhase2d && addByCodePhase2e) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2D and MLCC_ADD_BY_CODE_PHASE_2E are mutually exclusive; use 2E for scoped boundary map or 2D for full-page",
    });
  }

  if (errors.length > 0) {
    return {
      ready: false,
      config: null,
      errors,
    };
  }

  return {
    ready: true,
    config: {
      username,
      password,
      loginUrl,
      safeTargetUrl,
      orderingEntryUrl,
      headless,
      submissionArmed,
      stepScreenshotsEnabled,
      stepScreenshotMaxBytes,
      licenseStoreAutomation,
      licenseStoreSelectSelector:
        licenseStoreSelectSelector || null,
      licenseStoreContinueSelector:
        licenseStoreContinueSelector || null,
      licenseStoreUrlPattern,
      licenseStoreWaitMs,
      addByCodeProbe,
      addByCodeEntrySelector,
      addByCodePhase2c,
      addByCodeCodeFieldSelector,
      addByCodeQtyFieldSelector,
      addByCodeSafeFocusBlur,
      addByCodePhase2d,
      addByCodePhase2e,
      mutationBoundaryRootSelector,
      mutationBoundaryUncertainHints,
      addByCodePhase2f,
      addByCodeSafeOpenCandidateSelectors,
      addByCodeSafeOpenTextAllowSubstrings,
      addByCodeProbeSkipEntryNav,
      addByCodePhase2g,
      addByCodePhase2gFocusBlurRehearsal,
      addByCodePhase2gSentinelTyping,
      addByCodePhase2gSentinelValue,
    },
    errors: [],
  };
}

const USERNAME_SELECTORS = [
  'input[name="username"]',
  'input[name="email"]',
  'input[id*="user" i]',
  'input[type="email"]',
  'input[type="text"]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name*="password" i]',
];

async function fillFirstVisible(page, selectors, value) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();

    try {
      await loc.waitFor({ state: "visible", timeout: 8000 });
      await loc.fill(value);

      return true;
    } catch {
      // try next selector
    }
  }

  return false;
}

async function clickFirstSubmit(page) {
  const buttonSubmit = page.locator('button[type="submit"]').first();

  if (
    (await buttonSubmit.count()) > 0 &&
    (await buttonSubmit.isVisible().catch(() => false))
  ) {
    await buttonSubmit.click();

    return true;
  }

  const inputSubmit = page.locator('input[type="submit"]').first();

  if (
    (await inputSubmit.count()) > 0 &&
    (await inputSubmit.isVisible().catch(() => false))
  ) {
    await inputSubmit.click();

    return true;
  }

  const textButton = page.getByRole("button", {
    name: /sign\s*in|log\s*in|login/i,
  }).first();

  if (
    (await textButton.count()) > 0 &&
    (await textButton.isVisible().catch(() => false))
  ) {
    await textButton.click();

    return true;
  }

  return false;
}

async function hasObviousLoginError(page) {
  const errorLoc = page
    .locator(
      '[role="alert"], .error, .validation-summary-errors, [class*="error"]',
    )
    .first();

  return errorLoc.isVisible().catch(() => false);
}

async function prepareMlccLoginPage(page, config) {
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });

  const userOk = await fillFirstVisible(
    page,
    USERNAME_SELECTORS,
    config.username,
  );

  if (!userOk) {
    throw new Error("MLCC login failed");
  }

  const pwdOk = await fillFirstVisible(
    page,
    PASSWORD_SELECTORS,
    config.password,
  );

  if (!pwdOk) {
    throw new Error("MLCC login failed");
  }
}

async function commitMlccLogin(page) {
  const clicked = await clickFirstSubmit(page);

  if (!clicked) {
    throw new Error("MLCC login failed");
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(
    () => {},
  );

  await new Promise((r) => setTimeout(r, 1500));
}

async function assertMlccLoginSucceeded(page) {
  if (await hasObviousLoginError(page)) {
    throw new Error("MLCC login failed");
  }

  const passwordStill = page.locator('input[type="password"]').first();
  const stillVisible = await passwordStill.isVisible().catch(() => false);

  if (stillVisible) {
    throw new Error("MLCC login failed");
  }

  const finalUrl = page.url();
  let title = null;

  try {
    const t = await page.title();

    title = t || null;
  } catch {
    title = null;
  }

  return { finalUrl, title };
}

/**
 * Advisory only: URL/title keyword match does not prove a license/store step is required.
 */
export function inferLicenseStoreHeuristic(url, title) {
  const u = String(url ?? "").toLowerCase();
  const t = String(title ?? "").toLowerCase();
  const combined = `${u} ${t}`;
  const keywords = [
    "license",
    "select store",
    "choose store",
    "store selection",
    "location",
    "retail",
  ];
  const matched = keywords.filter((k) => combined.includes(k));

  return {
    hint:
      matched.length > 0
        ? "possible_license_or_store_interstitial"
        : "no_keyword_match",
    matched_keywords: matched,
    disclaimer:
      "heuristic_only_url_title_keywords_not_proof_of_required_flow",
  };
}

export async function loginAndVerifyMlccLanding({ page, config }) {
  await prepareMlccLoginPage(page, config);
  await commitMlccLogin(page);

  return assertMlccLoginSucceeded(page);
}

/**
 * Future submit/checkout steps must call this and abort unless explicitly armed.
 */
export function assertMlccSubmissionAllowed(config) {
  if (!config?.submissionArmed) {
    throw new Error(
      "MLCC submission blocked: set MLCC_SUBMISSION_ARMED=true only after explicit operator approval",
    );
  }
}

/**
 * Post-login navigation only: optional ordering entry, then optional safe target.
 * Never submits orders. Add-by-code is Phase 2b+.
 */
export async function navigateMlccPostLoginSafeFlow({
  page,
  config,
  heartbeat,
}) {
  const { orderingEntryUrl, safeTargetUrl } = config;

  if (orderingEntryUrl) {
    await page.goto(orderingEntryUrl, { waitUntil: "domcontentloaded" });

    await heartbeat({
      progressStage: "mlcc_ordering_entry",
      progressMessage: "MLCC ordering entry URL loaded (post-login)",
    });
  }

  if (safeTargetUrl) {
    const sameAsPrevious =
      orderingEntryUrl && safeTargetUrl === orderingEntryUrl;

    if (!sameAsPrevious) {
      await page.goto(safeTargetUrl, { waitUntil: "domcontentloaded" });
    }

    await heartbeat({
      progressStage: "mlcc_safe_navigation_complete",
      progressMessage: sameAsPrevious
        ? "MLCC safe target matches ordering entry; single navigation"
        : "MLCC safe target navigation completed",
    });
  } else {
    await heartbeat({
      progressStage: "mlcc_safe_navigation_complete",
      progressMessage: orderingEntryUrl
        ? "Post-login flow stopped at ordering entry (no MLCC_SAFE_TARGET_URL)"
        : "MLCC authenticated landing verified (no extra navigation URLs)",
    });
  }
}

/**
 * Phase 2a: optional bounded license/store interaction (two clicks max) or observe-only evidence.
 * Does not add lines, validate cart, or submit.
 */
export async function runLicenseStorePhase({
  page,
  config,
  heartbeat,
  buildStepEvidence,
  buildEvidence,
  evidenceCollected,
}) {
  const title = await page.title().catch(() => "");
  const heuristic = inferLicenseStoreHeuristic(page.url(), title);

  if (!config.licenseStoreAutomation) {
    const snap = await buildPageSnapshotAttributes(page);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_step_snapshot",
        stage: "mlcc_license_store_checkpoint",
        message:
          "License/store: automation off; heuristic + snapshot for operator review only",
        attributes: {
          automation_enabled: false,
          heuristic,
          ...snap,
        },
      }),
    );
    await heartbeat({
      progressStage: "mlcc_license_store_skipped",
      progressMessage:
        "License/store automation disabled; see evidence for URL/title heuristic",
    });

    return;
  }

  let urlPatternOk = true;

  if (config.licenseStoreUrlPattern) {
    try {
      const re = new RegExp(config.licenseStoreUrlPattern);
      urlPatternOk = re.test(page.url());
    } catch {
      throw new Error(
        "MLCC license/store step failed: invalid MLCC_LICENSE_STORE_URL_PATTERN",
      );
    }
  }

  if (!urlPatternOk) {
    const snap = await buildPageSnapshotAttributes(page);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_step_snapshot",
        stage: "mlcc_license_store_checkpoint",
        message:
          "License/store automation skipped: URL does not match MLCC_LICENSE_STORE_URL_PATTERN",
        attributes: {
          automation_enabled: true,
          skipped: true,
          skip_reason: "url_pattern_no_match",
          pattern: config.licenseStoreUrlPattern,
          heuristic,
          ...snap,
        },
      }),
    );
    await heartbeat({
      progressStage: "mlcc_license_store_skipped",
      progressMessage:
        "License/store step skipped (URL pattern mismatch); no interaction",
    });

    return;
  }

  await heartbeat({
    progressStage: "mlcc_license_store_in_progress",
    progressMessage:
      "Running bounded license/store selection (select + continue only)",
  });

  evidenceCollected.push(
    await buildStepEvidence({
      page,
      stage: "mlcc_license_store_before_interaction",
      message: "Before license/store bounded interaction",
      kind: "mlcc_step_snapshot",
      buildEvidence,
      config,
    }),
  );

  try {
    const selectSel = config.licenseStoreSelectSelector;
    const continueSel = config.licenseStoreContinueSelector;
    const selectLoc = page.locator(selectSel).first();

    await selectLoc.waitFor({ state: "visible", timeout: 20_000 });
    await selectLoc.click();
    await new Promise((r) =>
      setTimeout(r, config.licenseStoreWaitMs ?? 2000),
    );
    const continueLoc = page.locator(continueSel).first();

    await continueLoc.waitFor({ state: "visible", timeout: 20_000 });
    await continueLoc.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(
      () => {},
    );
    await new Promise((r) => setTimeout(r, 800));
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);

    throw new Error(`MLCC license/store step failed: ${m}`);
  }

  evidenceCollected.push(
    await buildStepEvidence({
      page,
      stage: "mlcc_license_store_after_interaction",
      message: "After license/store bounded interaction",
      kind: "mlcc_step_snapshot",
      buildEvidence,
      config,
    }),
  );

  await heartbeat({
    progressStage: "mlcc_license_store_complete",
    progressMessage:
      "License/store bounded step finished without cart mutation",
  });
}

async function buildStepEvidence({
  page,
  stage,
  message,
  kind,
  buildEvidence,
  config,
}) {
  const snap = await buildPageSnapshotAttributes(page);
  let attrs = { ...snap };

  if (config.stepScreenshotsEnabled) {
    const shot = await maybeScreenshotPngBase64(
      page,
      config.stepScreenshotMaxBytes,
    );
    attrs = mergeSnapshotAndScreenshot(attrs, shot);
  }

  return buildEvidence({
    kind,
    stage,
    message,
    attributes: attrs,
  });
}

export async function processOneMlccBrowserDryRun({
  apiBaseUrl,
  workerId,
  env,
}) {
  const claimBody = await claimNextRun({
    apiBaseUrl,
    workerId,
    workerNotes: "claimed by MLCC browser dry-run worker",
  });

  if (claimBody.data === null) {
    return {
      success: true,
      claimed: false,
    };
  }

  const { run, payload } = claimBody.data;
  const storeId = run.store_id;

  const buildEvidence = ({
    kind,
    stage,
    message,
    path = null,
    contentType = null,
    attributes = {},
  }) => ({
    kind,
    stage,
    message,
    artifact_path: path,
    content_type: contentType,
    attributes,
    created_at: new Date().toISOString(),
  });

  const planResult = buildMlccDryRunPlan(payload);

  if (!planResult.ready) {
    const errorMessage = planResult.errors.map((e) => e.message).join("; ");

    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "MLCC browser dry run failed during payload preflight",
      errorMessage,
      failureType: FAILURE_TYPE.QUANTITY_RULE_VIOLATION,
      failureDetails: {
        stage: "payload_preflight",
        mlcc_signal: MLCC_SIGNAL.DRY_RUN_PREFLIGHT,
        errors: planResult.errors,
      },
      evidence: [
        buildEvidence({
          kind: "cart_verification_snapshot",
          stage: "payload_preflight",
          message: "Payload preflight failed",
          attributes: { errors: planResult.errors },
        }),
      ],
    });

    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
    };
  }

  const browserConfig = buildMlccBrowserConfig({ payload, env });

  if (!browserConfig.ready) {
    const errorMessage = browserConfig.errors.map((e) => e.message).join("; ");

    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "MLCC browser dry run failed during browser config validation",
      errorMessage,
      failureType: FAILURE_TYPE.MLCC_UI_CHANGE,
      failureDetails: {
        stage: "browser_config",
        mlcc_signal: MLCC_SIGNAL.CONFIG_ENV,
        errors: browserConfig.errors,
      },
      evidence: [
        buildEvidence({
          kind: "mlcc_ui_diagnostics",
          stage: "browser_config",
          message: "Browser config validation failed",
          attributes: { errors: browserConfig.errors },
        }),
      ],
    });

    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
    };
  }

  const config = browserConfig.config;

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    workerId,
    progressStage: "validate",
    progressMessage: "Validating execution payload (deterministic, pre-browser)",
  });

  const deterministic = assertDeterministicExecutionPayload(payload);
  if (!deterministic.ok) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "deterministic assertion failed in MLCC browser worker (pre-browser)",
      errorMessage: deterministic.message,
      failureType: deterministic.code ?? FAILURE_TYPE.UNKNOWN,
      failureDetails: {
        ...(deterministic.details && typeof deterministic.details === "object"
          ? deterministic.details
          : {}),
        stage: "validate",
        mlcc_signal:
          deterministic.code === FAILURE_TYPE.CODE_MISMATCH
            ? MLCC_SIGNAL.CART_IDENTITY
            : MLCC_SIGNAL.QUANTITY_RULES,
      },
      evidence: [
        buildEvidence({
          kind: "cart_verification_snapshot",
          stage: "validate",
          message: deterministic.message,
          attributes: deterministic.details ?? {},
        }),
      ],
    });

    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
    };
  }

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    workerId,
    progressStage: "assertions_passed",
    progressMessage: "Deterministic payload assertions passed; starting browser",
  });

  let browser;
  /** @type {import('playwright').Page | null} */
  let page = null;

  const evidenceCollected = [];

  const heartbeat = async ({ progressStage, progressMessage }) =>
    heartbeatRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      workerId,
      progressStage,
      progressMessage,
    });

  try {
    const { chromium } = await import("playwright");

    const guardStats = { blockedRequestCount: 0 };

    browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext();

    await installMlccSafetyNetworkGuards(context, guardStats);

    page = await context.newPage();

    await heartbeat({
      progressStage: "mlcc_browser_launching",
      progressMessage: "Launching MLCC browser dry-run session",
    });

    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_browser_ready",
        message: "Browser context ready",
        kind: "mlcc_step_snapshot",
        buildEvidence,
        config,
      }),
    );

    await prepareMlccLoginPage(page, config);

    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_pre_login_submit",
        message: "Credentials filled; checkpoint immediately before login submit",
        kind: "mlcc_step_snapshot",
        buildEvidence,
        config,
      }),
    );

    await commitMlccLogin(page);
    await assertMlccLoginSucceeded(page);

    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_post_login_landing",
        message: "Post-login landing after successful auth check",
        kind: "mlcc_step_snapshot",
        buildEvidence,
        config,
      }),
    );

    await heartbeat({
      progressStage: "mlcc_authenticated",
      progressMessage: "MLCC login succeeded",
    });

    await runLicenseStorePhase({
      page,
      config,
      heartbeat: async (args) => heartbeat(args),
      buildStepEvidence,
      buildEvidence,
      evidenceCollected,
    });

    await navigateMlccPostLoginSafeFlow({
      page,
      config,
      heartbeat: async (args) => heartbeat(args),
    });

    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_ordering_ready_before_add_by_code_probe",
        message:
          "Ordering-ready checkpoint immediately before Phase 2b add-by-code probe",
        kind: "mlcc_step_snapshot",
        buildEvidence,
        config,
      }),
    );

    let phase2bResult = null;
    let phase2cResult = null;
    let phase2dResult = null;
    let phase2eResult = null;
    let phase2fResult = null;
    let phase2gResult = null;

    if (config.addByCodeProbe) {
      phase2bResult = await runAddByCodeProbePhase({
        page,
        config,
        heartbeat: async (args) => heartbeat(args),
        buildStepEvidence,
        buildEvidence,
        evidenceCollected,
      });

      if (config.addByCodePhase2c) {
        try {
          phase2cResult = await runAddByCodePhase2cFieldHardening({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            phase2bFieldInfo: phase2bResult?.field_info ?? null,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2c failed: ${m}`);
        }
      }

      if (config.addByCodePhase2e) {
        try {
          phase2eResult = await runAddByCodePhase2eMutationBoundaryMap({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2e failed: ${m}`);
        }
      } else if (config.addByCodePhase2d) {
        try {
          phase2dResult = await runAddByCodePhase2dMutationBoundaryMap({
            page,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2d failed: ${m}`);
        }
      }

      if (config.addByCodePhase2f) {
        try {
          phase2fResult = await runAddByCodePhase2fSafeOpenConfirm({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
            buildStepEvidence,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2f failed: ${m}`);
        }
      }

      if (config.addByCodePhase2g) {
        try {
          phase2gResult = await runAddByCodePhase2gTypingPolicyAndRehearsal({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
            phase2bFieldInfo: phase2bResult?.field_info ?? null,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2g failed: ${m}`);
        }
      }
    } else {
      await heartbeat({
        progressStage: "mlcc_add_by_code_probe_skipped",
        progressMessage:
          "Phase 2b add-by-code probe disabled (MLCC_ADD_BY_CODE_PROBE not true)",
      });

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_add_by_code_probe_skipped",
          message: "Phase 2b not run; enable MLCC_ADD_BY_CODE_PROBE=true for live UI mapping",
          attributes: {
            skipped: true,
            reason: "MLCC_ADD_BY_CODE_PROBE_not_enabled",
          },
        }),
      );
    }

    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_ordering_ready_landing",
        message:
          "Final ordering-ready checkpoint after Phase 2b/2c/2d|2e/2f/2g (no validate/checkout/submit/cart mutation)",
        kind: "mlcc_step_snapshot",
        buildEvidence,
        config,
      }),
    );

    const finalUrl = page.url();
    let title = null;

    try {
      const t = await page.title();

      title = t || null;
    } catch {
      title = null;
    }

    const orderingReadyHeuristic = inferLicenseStoreHeuristic(finalUrl, title);
    const result = {
      finalUrl,
      title,
      ordering_ready_heuristic: orderingReadyHeuristic,
      phase_2b_add_by_code: phase2bResult,
      phase_2c_field_hardening: phase2cResult,
      phase_2d_mutation_boundary: phase2dResult,
      phase_2e_mutation_boundary: phase2eResult,
      phase_2f_safe_open: phase2fResult,
      phase_2g_typing_policy: phase2gResult,
    };

    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "succeeded",
      workerNotes:
        "MLCC browser dry run completed successfully; no cart mutations or submit actions were performed. " +
        `dry_run_safe_mode=${MLCC_BROWSER_DRY_RUN_SAFE_MODE} submission_armed=${config.submissionArmed} ` +
        `license_store_automation=${config.licenseStoreAutomation} ` +
        `add_by_code_probe=${config.addByCodeProbe} ` +
        `add_by_code_phase_2c=${config.addByCodePhase2c} ` +
        `add_by_code_phase_2d=${config.addByCodePhase2d} ` +
        `add_by_code_phase_2e=${config.addByCodePhase2e} ` +
        `add_by_code_phase_2f=${config.addByCodePhase2f} ` +
        `add_by_code_phase_2g=${config.addByCodePhase2g}`,
      errorMessage: undefined,
      evidence: [
        ...evidenceCollected,
        buildEvidence({
          kind: "worker_log",
          stage: "completed",
          message:
            "MLCC browser dry-run completed (Phase 2a/2b/2c/2d|2e/2f/2g checkpoints; no cart mutation)",
          attributes: {
            finalUrl,
            title,
            dry_run_safe_mode: MLCC_BROWSER_DRY_RUN_SAFE_MODE,
            submission_armed: config.submissionArmed,
            ordering_entry_configured: Boolean(config.orderingEntryUrl),
            safe_target_configured: Boolean(config.safeTargetUrl),
            license_store_automation: config.licenseStoreAutomation,
            ordering_ready_heuristic: orderingReadyHeuristic,
            checkpoint_ordering_ready: "mlcc_ordering_ready_landing",
            checkpoint_before_add_by_code_probe:
              "mlcc_ordering_ready_before_add_by_code_probe",
            phase_2b_probe_enabled: config.addByCodeProbe,
            phase_2b_add_by_code_ui_reached:
              phase2bResult?.add_by_code_ui_reached ?? null,
            phase_2b_code_field_detected:
              phase2bResult?.code_field_detected ?? null,
            phase_2b_quantity_field_detected:
              phase2bResult?.quantity_field_detected ?? null,
            phase_2b_stop_reason: phase2bResult?.stop_reason ?? null,
            phase_2c_enabled: config.addByCodePhase2c,
            phase_2c_code_non_mutating:
              phase2cResult?.code_field?.non_mutating_interaction_possible ??
              null,
            phase_2c_qty_non_mutating:
              phase2cResult?.quantity_field?.non_mutating_interaction_possible ??
              null,
            phase_2c_tenant_env_code:
              phase2cResult?.tenant_env_selectors_provided?.code_field ?? null,
            phase_2c_tenant_env_qty:
              phase2cResult?.tenant_env_selectors_provided?.quantity_field ??
              null,
            phase_2d_enabled: config.addByCodePhase2d,
            phase_2d_scan_count: phase2dResult?.scan_count ?? null,
            phase_2d_safe_count: phase2dResult?.safe_count ?? null,
            phase_2d_unsafe_count: phase2dResult?.unsafe_count ?? null,
            phase_2d_uncertain_count: phase2dResult?.uncertain_count ?? null,
            phase_2d_network_guard_blocked_requests:
              guardStats?.blockedRequestCount ?? null,
            phase_2e_enabled: config.addByCodePhase2e,
            phase_2e_scoped_root_matched:
              phase2eResult?.scoped_root_matched_visible ?? null,
            phase_2e_fallback_broad: phase2eResult?.fallback_to_broad_scan ?? null,
            phase_2e_scope_status: phase2eResult?.scope_status ?? null,
            phase_2e_uncertain_count: phase2eResult?.uncertain_count ?? null,
            phase_2f_enabled: config.addByCodePhase2f,
            phase_2f_tenant_safe_open_confirmed:
              phase2fResult?.tenant_safe_open_confirmed ?? null,
            phase_2f_expected_ui_state:
              phase2fResult?.expected_ui_state_after_phase_2f ?? null,
            phase_2f_ui_already_open_before:
              phase2fResult?.ui_was_already_open_before_phase_2f ?? null,
            phase_2f_selector_clicked: phase2fResult?.selector_clicked ?? null,
            phase_2f_recommendation_strength:
              phase2fResult?.recommendation_strength ?? null,
            phase_2f_recommend_selector:
              phase2fResult?.recommend_tenant_safe_open_selector ?? null,
            phase_2f_skip_click_reason: phase2fResult?.skip_click_reason ?? null,
            phase_2g_enabled: config.addByCodePhase2g,
            phase_2g_any_rehearsal:
              phase2gResult?.any_rehearsal_performed ?? null,
            phase_2g_run_non_mutating:
              phase2gResult?.run_remained_fully_non_mutating ?? null,
            phase_2g_policy_version:
              phase2gResult?.typing_policy_manifest?.version ?? null,
          },
        }),
      ],
    });

    return {
      success: true,
      claimed: true,
      runId: run.id,
      result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    const isLogin = lower.includes("mlcc login failed");
    const isLicenseStore = lower.includes("mlcc license/store step failed");
    const isAddByCodeProbe =
      lower.includes("mlcc add-by-code probe failed") ||
      lower.includes("mlcc add-by-code phase 2c failed") ||
      lower.includes("mlcc add-by-code phase 2d failed") ||
      lower.includes("mlcc add-by-code phase 2e failed") ||
      lower.includes("mlcc add-by-code phase 2f failed") ||
      lower.includes("mlcc add-by-code phase 2g failed");
    const classified = classifyFailureType({ errorMessage: msg, explicitType: undefined });
    const looksTransport =
      /timeout|econn|network|fetch failed|502|503|enotfound|etimedout/i.test(msg);
    const failureType = isLogin
      ? FAILURE_TYPE.MLCC_UI_CHANGE
      : isLicenseStore || isAddByCodeProbe
        ? FAILURE_TYPE.MLCC_UI_CHANGE
        : looksTransport
          ? FAILURE_TYPE.NETWORK_ERROR
          : FAILURE_TYPE.MLCC_UI_CHANGE;
    const mlccSignal = isLogin
      ? MLCC_SIGNAL.LOGIN_AUTH
      : isLicenseStore || isAddByCodeProbe
        ? MLCC_SIGNAL.SELECTOR_UI
        : looksTransport
          ? MLCC_SIGNAL.NETWORK_TRANSPORT
          : MLCC_SIGNAL.BROWSER_RUNTIME;

    const failAttrs = await buildPageSnapshotAttributes(page);
    let failureEvidenceAttrs = { ...failAttrs, error: msg };

    if (page && config.stepScreenshotsEnabled) {
      const shot = await maybeScreenshotPngBase64(
        page,
        config.stepScreenshotMaxBytes,
      );
      failureEvidenceAttrs = mergeSnapshotAndScreenshot(
        failureEvidenceAttrs,
        shot,
      );
    }

    try {
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "failed",
        workerNotes: "MLCC browser dry run failed",
        errorMessage: msg,
        failureType,
        failureDetails: {
          stage: isLicenseStore
            ? "mlcc_license_store"
            : isAddByCodeProbe
              ? "mlcc_add_by_code_probe_or_phase_2c_or_2d"
              : "browser_runtime",
          mlcc_signal: mlccSignal,
          classified_type: classified,
        },
        evidence: [
          ...evidenceCollected,
          buildEvidence({
            kind: "mlcc_ui_diagnostics",
            stage: "browser_runtime",
            message: "MLCC browser runtime failure",
            attributes: failureEvidenceAttrs,
          }),
        ],
      });
    } catch {
      // ignore secondary finalize errors
    }

    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      error: msg,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMainModule =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);

if (isMainModule) {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const workerId = process.env.WORKER_ID ?? "mlcc-browser-worker-1";

  try {
    const out = await processOneMlccBrowserDryRun({
      apiBaseUrl,
      workerId,
      env: process.env,
    });

    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);

    process.exit(out.success ? 0 : 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
