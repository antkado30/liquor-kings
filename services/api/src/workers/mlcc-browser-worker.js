import path from "node:path";
import process from "node:process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { captureMlccSafeFlowMilestoneScreenshot } from "./mlcc-browser-safe-flow-screenshots.js";
import {
  runMlccPhasePipeline,
  createMlccPhase2bDescriptor,
  createMlccPhase2cDescriptor,
  createMlccPhase2dDescriptor,
  createMlccPhase2eDescriptor,
  createMlccPhase2fDescriptor,
  buildMlccPhaseContext,
  getMlccPipelinePhaseResult,
} from "./mlcc-phase-runner.js";
import {
  installMlccSafetyNetworkGuards,
  parseMutationBoundaryUncertainHints,
  parsePhase2fSafeOpenTextAllowSubstrings,
  parsePhase2gSentinelValue,
  parsePhase2hTestCode,
  parsePhase2jTestQuantity,
  parsePhase2lFieldOrder,
  parseMiloPost2uPreReadonlyCartDiscoverySettleMs,
  parsePhase2nAddApplyCandidateSelectors,
  parsePhase2oSettleMs,
  parsePhase2qPostValidateObserveSettleMs,
  parsePhase2qValidateCandidateSelectors,
  parsePhase2rSettleMs,
  parseSafeOpenCandidateSelectors,
  runAddByCodePhase2gTypingPolicyAndRehearsal,
  runAddByCodePhase2hRealCodeTypingRehearsal,
  runAddByCodePhase2jQuantityTypingRehearsal,
  runAddByCodePhase2lCombinedCodeQuantityTypingRehearsal,
  runPhase2lMiloManualParitySequenceAndPre2uSnapshot,
  runPhase2lMiloPostFillTabFromQuantityParityStep,
  runPhase2lMiloPostFillClickAwayParityStep,
  runAddByCodePhase2nAddApplyLineSingleClick,
  runAddByCodePhase2uMiloBulkSkeleton,
  build2uDeterminismPersistPayload,
  runAddByCodePhase2oPostAddApplyObservation,
  runAddByCodePhase2qBoundedValidateSingleClick,
  runAddByCodePhase2rPostValidateObservation,
  runAddByCodePhase2vMiloValidateSingleClick,
  runAddByCodePhase2wMiloPostValidateInertSkeleton,
  runMiloReadonlyPost2oCartValidateDiscovery,
  parsePhase2oMiloReadonlyCartDiscoveryPathCandidates,
  buildValidateBoundaryPolicyDecisionArtifact,
} from "./mlcc-browser-add-by-code-probe.js";
import {
  MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME,
  buildMlccSafeFlowMilestoneDiskFilename,
  buildMlccSafeFlowRunOutputDir,
  buildMlccSafeFlowRunSummaryPayload,
  buildPageSnapshotAttributes,
  collectSafeModeFailureEvidencePack,
  countMlccSafeFlowMilestoneScreenshots,
  maybeScreenshotPngBase64,
  mergeSnapshotAndScreenshot,
  tallyMlccEvidenceEntriesByKind,
  writeMlccSafeFlowRunSummaryJson,
} from "./mlcc-browser-evidence.js";
import { buildMlccDryRunPlan } from "./mlcc-dry-run.js";
import { evaluateDryRunMappingConfidenceGuard } from "../quantity-rules/index.js";
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

const PLACEHOLDER_VALUES = new Set(["__FILL_ME__", "TODO", "TBD"]);

function isPlaceholderValue(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  return PLACEHOLDER_VALUES.has(v);
}

function isValidHttpUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function uniqueUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls ?? []) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function deriveReconMappingUrls({ loginUrl, orderingEntryUrl, safeTargetUrl, env }) {
  const envRaw = env?.MLCC_RECON_URLS;
  if (typeof envRaw === "string" && envRaw.trim() !== "") {
    try {
      const arr = JSON.parse(envRaw);
      if (Array.isArray(arr)) {
        return uniqueUrls(arr.map((v) => String(v ?? "")));
      }
    } catch {
      // fall through to defaults
    }
  }

  const defaults = [];
  if (safeTargetUrl) defaults.push(safeTargetUrl);
  if (orderingEntryUrl) defaults.push(orderingEntryUrl);

  try {
    const origin = new URL(loginUrl).origin;
    defaults.push(
      `${origin}/milo/home`,
      `${origin}/milo/location`,
      `${origin}/milo/products`,
      `${origin}/milo/products/bycode`,
      `${origin}/milo/cart`,
    );
  } catch {
    // ignore
  }

  return uniqueUrls(defaults);
}

function buildPlaywrightInstallHint(executablePath) {
  const pathNote = executablePath
    ? ` Missing executable path: ${executablePath}`
    : "";
  return (
    "Playwright browser runtime is missing for services/api worker execution." +
    pathNote +
    " Install once from services/api with: npx playwright install chromium"
  );
}

function normalizeLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const missingExecutable = /Executable doesn't exist/i.test(message);
  if (!missingExecutable) return message;

  // Match worker invocation context (services/api) for deterministic install docs.
  return `${message}\n${buildPlaywrightInstallHint(null)}`;
}

/**
 * Env (documented):
 * - MLCC_LOGIN_URL, MLCC_PASSWORD, MLCC_SAFE_TARGET_URL, MLCC_HEADLESS — existing
 * - MLCC_ORDERING_ENTRY_URL — optional; navigated after login/license step, before safe target (when both differ)
 * - MLCC_SUBMISSION_ARMED — must be "true" before any future submit step is allowed (no submit in this worker yet)
 * - MLCC_STEP_SCREENSHOTS — "true" to attach capped PNG base64 to step/failure evidence
 * - MLCC_STEP_SCREENSHOT_MAX_BYTES — default 200000
 * - MLCC_LOGIN_FAILURE_SNAPSHOT_MAX_BYTES — max bytes for full-page login failure PNG (default 450000)
 * - MLCC_RECON_MODE — "true" enables recon-only mode (maps MILO pages; blocks mutation-phase env flags)
 * Phase 2a (license/store, non-destructive):
 * - MLCC_LICENSE_STORE_AUTOMATION — "true" to run bounded select+continue (requires both selectors below)
 * - MLCC_LICENSE_STORE_SELECT_SELECTOR — Playwright CSS selector for store/license choice (single bounded click)
 * - MLCC_LICENSE_STORE_CONTINUE_SELECTOR — selector for continue/next (navigation only; not checkout)
 * - MLCC_LICENSE_STORE_URL_PATTERN — optional RegExp source; if set, automation runs only when URL matches
 * - MLCC_LICENSE_STORE_WAIT_MS — wait between clicks (default 2000)
 * Phase 2b (add-by-code probe, non-mutating):
 * - MLCC_ADD_BY_CODE_PROBE — "true" to run detection-only probe after ordering-ready (no typing; guards on)
 * - MLCC_ADD_BY_CODE_ENTRY_SELECTOR — optional CSS for a single safe open action (blocked if label matches submit/cart patterns)
 *   MILO note: products/home may have no visible code field and no safe text-matched entry; stop_reason
 *   no_safe_entry_path_found_without_dangerous_controls is then expected. Use Phase 2C default /milo/products/bycode
 *   navigation for bounded field hardening, or set ENTRY_SELECTOR to a verified nav-only control (e.g. link to by-code).
 * Phase 2c (selector hardening; still no cart mutation, no validate):
 * - MLCC_ADD_BY_CODE_PHASE_2C — "true" requires MLCC_ADD_BY_CODE_PROBE=true; field hardening on dedicated by-code route by default
 * - MLCC_ADD_BY_CODE_PHASE_2C_NAV_URL — optional full URL for Phase 2c (default: {login origin}/milo/products/bycode)
 * - MLCC_ADD_BY_CODE_PHASE_2C_SKIP_BYCODE_NAV — "true" to stay on current page after Phase 2b (no goto)
 * - MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR — optional CSS for product/code input (preferred over heuristic)
 * - MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR — optional CSS for quantity input
 * - MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR — "true" to allow guarded focus/blur only when risk check passes (still no typing)
 * Phase 2d (mutation boundary map; read-only control scan; no clicks):
 * - MLCC_ADD_BY_CODE_PHASE_2D — "true" requires MLCC_ADD_BY_CODE_PROBE=true; by-code surface boundary pack + control scan
 *   After Phase 2c nav to /milo/products/bycode, prefers bounded scan (form / role=search / .search-container / parent); else full page.
 *   Evidence: bycode_surface_boundary_pack (fields, containers, help/error text samples, observed-only control risk). Heuristic safe/unsafe/uncertain.
 * Phase 2e (scoped boundary map; mutually exclusive with 2D):
 * - MLCC_ADD_BY_CODE_PHASE_2E — "true" requires probe; tenant MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR if set, else auto-scope from resolved by-code field (same bounded root as 2d), else full page
 * - MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR — CSS for add-by-code container (optional; overrides auto by-code field scope)
 * - MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS — optional JSON array [{ "contains": "...", "advisory_label": "..." }] for uncertain rows only (advisory)
 * Phase 2f (safe open confirmation; after 2b/2c/2d|2e):
 * - MLCC_ADD_BY_CODE_PHASE_2F — "true" requires probe + MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS (JSON array of CSS selectors, priority order)
 * - MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS — optional JSON array; extends uncertain-label open-intent matching
 * - MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV — "true" skips Phase 2b configured/heuristic entry clicks so Phase 2f performs the only open attempt
 * Phase 2g (pre-mutation typing policy + optional bounded rehearsal):
 * - MLCC_ADD_BY_CODE_PHASE_2G — "true" requires probe; policy + field risk readout; default no value entry
 * - MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL — optional bounded focus/blur when extended risk allows (still no product values)
 * - MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING — optional; requires MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE matching ^__LK_[A-Z0-9_]{1,48}__$ only
 * Phase 2h (real code-field typing rehearsal; single field; zero qty/cart mutation):
 * - MLCC_ADD_BY_CODE_PHASE_2H — "true" requires probe
 * - MLCC_ADD_BY_CODE_PHASE_2H_APPROVED — must be "true" (dedicated operator approval)
 * - MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE — non-empty test string (max 64 chars; no newlines).
 *   When the tenant code field is input type=number, value must be digits-only, 1–12 chars (synthetic; operator avoids real SKUs).
 * - MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR — required tenant CSS for code field only (no heuristic)
 * - MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR — optional; not typed in 2h; set (e.g. MILO #quantity) so 2g policy rows disambiguate qty from code
 * Phase 2j (quantity-field-only rehearsal; no code interaction; combined interaction is Phase 2l):
 * - MLCC_ADD_BY_CODE_PHASE_2J — "true" requires probe
 * - MLCC_ADD_BY_CODE_PHASE_2J_APPROVED — must be "true" (dedicated operator approval)
 * - MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY — digits only, 1–8 chars, positive integer, no leading zero (e.g. "3", "12")
 * - MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR — required tenant CSS for quantity field only (no heuristic)
 * - MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR — optional "true"; default no blur (Phase 2i-aligned explicit opt-in)
 * Phase 2l (combined code+quantity rehearsal in one sequence; no add line, no validate/checkout/submit):
 * - MLCC_ADD_BY_CODE_PHASE_2L — "true" requires probe
 * - MLCC_ADD_BY_CODE_PHASE_2L_APPROVED — must be "true"
 * - MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE — same base rules as Phase 2h (non-empty, ≤64 chars, no newlines).
 *   When the tenant code field is input type=number, value must be 1–12 digits only (synthetic; same as Phase 2h).
 * - MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY — same rules as Phase 2j test quantity
 * - MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER — required: code_first | quantity_first (tenant-documented)
 * - MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR and MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR — both required
 * - MLCC_ADD_BY_CODE_PHASE_2L_ALLOW_BLUR — optional "true"; blur on last filled field only after both fills
 * - MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED — optional "true" only with Phase 2L+2L_APPROVED +
 *   Phase 2U MILO bulk + 2U_APPROVED; skips Phase 2l reverse-order field clear so list fields stay filled for 2u
 *   (default off; operator-gated hypothesis lane only; no extra clicks)
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY — optional MILO-only "true": after successful 2l fills,
 *   blur active element then one bounded click on empty page chrome (default target `main` at a fixed corner) to
 *   mimic operator "click whitespace" row materialization; requires 2L+2L_APPROVED + dedicated APPROVED; no validate/cart/submit
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_APPROVED — must be "true" when click-away is enabled
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_TARGET_SELECTOR — optional CSS selector for click-away
 *   (default: main; falls back to body if no match); max 200 chars, no newlines
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_SETTLE_MS — optional 0–2000 ms wait after blur+click (default 500)
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY — optional MILO-only "true": after successful 2l fills,
 *   focus tenant qty field and send one Tab (MILO on-page copy); requires 2L+2L_APPROVED + dedicated APPROVED; no validate/cart/submit
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_APPROVED — must be "true" when Tab-from-qty is enabled
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_SETTLE_MS — optional 0–2000 ms after Tab (default 500)
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE — optional MILO-only "true": replaces standard Phase 2l fill-only
 *   rehearsal with operator click → pressSequentially type on code/qty (per FIELD_ORDER), blank corner click, then read-only
 *   pre-2U list surface snapshot; requires 2L+2L_APPROVED + dedicated APPROVED; Tab/click-away post-fill steps are skipped when on
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED — must be "true" when manual parity is enabled
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_SETTLE_MS — optional 0–2000 ms after blank click (default 600)
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE — optional MILO-only "true": under manual-parity gate, use exact
 *   operator keyboard flow `click code -> type code -> Tab -> type qty -> Tab -> short settle` before pre-2U read-only snapshot
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE_APPROVED — must be "true" when full keyboard parity is enabled
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_TARGET_SELECTOR — optional CSS for blank click (default main; fallback body)
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_POSITION_X — optional integer 0–4000 for Playwright click position.x on the resolved blank target (default 28 when unset)
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_POSITION_Y — optional integer 0–4000 for click position.y (default 28 when unset)
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_SUBSTRING — optional non-empty substring (≤120 chars, no newlines); when set, worker polls document.body.innerText read-only (no clicks) after blank settle until match or timeout
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_MS — optional 1–12000 ms max wait when substring is set (default 8000 if substring set and this omitted); observation-only; not server truth
 * - MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_APPROVED — must be "true" when post-blank wait substring is set
 * Phase 2n (single tenant add-line / apply-line click; no validate/checkout/submit; requires 2l same run):
 * - MLCC_ADD_BY_CODE_PHASE_2N — "true" requires probe + Phase 2L enabled and approved in config
 * - MLCC_ADD_BY_CODE_PHASE_2N_APPROVED — must be "true" (dedicated operator approval)
 * - MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS — required JSON array of CSS selectors (priority order; no heuristic-only path)
 * - MLCC_ADD_BY_CODE_PHASE_2N_TEXT_ALLOW_SUBSTRINGS — optional JSON array; extends uncertain-label matching for add/apply intent (same shape as Phase 2f allowlist)
 *   MILO note: observed by-code UI may expose only bulk "Add all to Cart" and no single-line add/apply control.
 *   In that case, keep 2N off and use the planning-only MILO bulk-action contract documented in architecture docs
 *   before implementing any MILO-specific click phase.
 * Phase 2u (MILO-specific guarded bulk-action click after 2l):
 * - MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK — "true" requires probe + 2L enabled and approved
 * - MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED — must be "true" (dedicated operator approval)
 * - MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS — required JSON array of CSS selectors (tenant-locked bulk candidates)
 * - MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_TEXT_ALLOW_SUBSTRINGS — optional JSON array for uncertain-label matching
 * - MLCC_2U_DETERMINISM_STATE_PATH — optional path to prior compact JSON for bounded cross-run 2U determinism compare (requires 2U bulk lane)
 * - MLCC_2U_DETERMINISM_STATE_WRITE — "true" to persist compact state after successful 2U (requires PATH + WRITE_APPROVED; no payload capture)
 * - MLCC_2U_DETERMINISM_STATE_WRITE_APPROVED — must be "true" when STATE_WRITE is enabled
 * - Runtime behavior: at most one bounded bulk-target click; no validate/checkout/submit/finalize
 * Phase 2o (read-only post-click observation; no clicks; no validate/checkout/submit):
 * - MLCC_ADD_BY_CODE_PHASE_2O — "true" requires probe + Phase 2N enabled/approved and successful same-run 2n click
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U — optional MILO variant; when "true" requires probe + 2U enabled/approved and successful same-run 2u click
 * - MLCC_ADD_BY_CODE_PHASE_2O_APPROVED — must be "true"
 * - MLCC_ADD_BY_CODE_PHASE_2O_SETTLE_MS — optional non-negative ms between pre/post read-only scrapes (default 500; max 5000); no clicks during wait
 * MILO read-only cart validate discovery (after successful 2o MILO post-2u only; no validate/checkout/submit click):
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY — "true" requires probe + 2O MILO post-2U + 2O approved + 2U bulk enabled/approved + discovery approved flag
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED — must be "true"
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_URL — optional full cart URL tried first; then default paths /milo/cart, /cart, /milo/order/cart (deduped, max 5; read-only goto only)
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_DISCOVERY_PATH_CANDIDATES — optional JSON array of extra path strings (each starts with /), max 5, merged after defaults
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK — optional "true": before URL goto attempts, one bounded safe click on header cart affordance (requires readonly cart discovery lane + its APPROVED + SAFE_CART_ICON_APPROVED; no validate/checkout/submit/finalize)
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK_APPROVED — must be "true" when safe cart icon click is enabled
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_DISCOVERY_SETTLE_MS — optional ms after cart load before scan (default 600 if unset; max 5000; same parser as Phase 2r settle)
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_MS — optional ms wait after Phase 2o (MILO post-2u) on current page before read-only cart goto (default 0 = off; max 5000)
 * - MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_APPROVED — must be "true" when pre-cart settle ms is positive
 * - MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR — optional tenant CSS for MILO product-list host; read-only pre-cart sampling only; requires discovery lane + APPROVED (default off)
 * - MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR_APPROVED — must be "true" when list-root selector is non-empty
 * Phase 2q (bounded single validate click after 2n; optional read-only post-validate scrape; no checkout/submit/finalize):
 * - MLCC_ADD_BY_CODE_PHASE_2Q — "true" requires probe + Phase 2N + 2L gates (same as 2n) + MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED=true
 * - MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED — must be "true" (dedicated operator approval)
 * - MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS — required JSON array of CSS selectors (priority order; tenant-listed only; no heuristic-only path)
 * - MLCC_ADD_BY_CODE_PHASE_2Q_TEXT_ALLOW_SUBSTRINGS — optional JSON array; extends uncertain validate-intent matching (same shape as Phase 2f)
 * - MLCC_ADD_BY_CODE_PHASE_2Q_POST_VALIDATE_OBSERVE_SETTLE_MS — optional ms before optional read-only post-validate scrape (default 400; max 3000; 0 skips extra scrape)
 * - When MLCC_ADD_BY_CODE_PHASE_2O is not "true", MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O must be "true" (explicit waiver per Phase 2p when 2o read-only observation was not run)
 * Phase 2r (read-only post-validate observation after 2q; zero clicks; no checkout/submit/finalize):
 * - MLCC_ADD_BY_CODE_PHASE_2R — "true" requires probe + Phase 2Q enabled and approved + successful same-run 2q validate click
 * - MLCC_ADD_BY_CODE_PHASE_2R_APPROVED — must be "true"
 * - MLCC_ADD_BY_CODE_PHASE_2R_SETTLE_MS — optional non-negative ms between pre/post read-only scrapes (default 600; max 5000); no clicks during wait
 * Phase 2v / 2w (MILO validate successor contracts after 2u->2o):
 * - 2V executes at most one bounded validate click when explicitly gated + approved.
 * - 2W remains inert design-only blocked evidence (no post-validate runtime execution yet).
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
  } else if (isPlaceholderValue(passwordRaw)) {
    errors.push({
      type: "config",
      message: "MLCC_PASSWORD contains a placeholder value; set the real secret",
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
  } else if (isPlaceholderValue(loginUrlRaw)) {
    errors.push({
      type: "config",
      message: "MLCC_LOGIN_URL contains a placeholder value; set a real URL",
    });
  } else if (!isValidHttpUrl(loginUrl)) {
    errors.push({
      type: "config",
      message: "MLCC_LOGIN_URL must be a valid http(s) URL",
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
    if (isPlaceholderValue(safeTargetRaw)) {
      errors.push({
        type: "config",
        message:
          "MLCC_SAFE_TARGET_URL contains a placeholder value; set a real URL or leave it unset",
      });
    } else if (!isValidHttpUrl(safeTargetUrl)) {
      errors.push({
        type: "config",
        message: "MLCC_SAFE_TARGET_URL must be a valid http(s) URL when set",
      });
    }
  }

  const orderingEntryRaw = env?.MLCC_ORDERING_ENTRY_URL;
  let orderingEntryUrl = null;

  if (
    typeof orderingEntryRaw === "string" &&
    orderingEntryRaw.trim() !== ""
  ) {
    orderingEntryUrl = orderingEntryRaw.trim();
    if (isPlaceholderValue(orderingEntryRaw)) {
      errors.push({
        type: "config",
        message:
          "MLCC_ORDERING_ENTRY_URL contains a placeholder value; set a real URL or leave it unset",
      });
    } else if (!isValidHttpUrl(orderingEntryUrl)) {
      errors.push({
        type: "config",
        message: "MLCC_ORDERING_ENTRY_URL must be a valid http(s) URL when set",
      });
    }
  }

  const headless = env?.MLCC_HEADLESS === "false" ? false : true;

  const submissionArmed = env?.MLCC_SUBMISSION_ARMED === "true";

  const stepScreenshotsEnabled = env?.MLCC_STEP_SCREENSHOTS === "true";

  const maxRaw = env?.MLCC_STEP_SCREENSHOT_MAX_BYTES;
  const maxParsed = maxRaw != null ? Number.parseInt(String(maxRaw), 10) : NaN;
  const stepScreenshotMaxBytes = Number.isFinite(maxParsed) && maxParsed > 0
    ? maxParsed
    : 200_000;

  const loginFailRaw = env?.MLCC_LOGIN_FAILURE_SNAPSHOT_MAX_BYTES;
  const loginFailParsed =
    loginFailRaw != null ? Number.parseInt(String(loginFailRaw), 10) : NaN;
  const loginFailureSnapshotMaxBytes =
    Number.isFinite(loginFailParsed) && loginFailParsed > 0
      ? loginFailParsed
      : 450_000;

  const safeFlowScreenshotDirRaw = env?.MLCC_SAFE_FLOW_SCREENSHOT_DIR;
  const safeFlowScreenshotDir =
    typeof safeFlowScreenshotDirRaw === "string" && safeFlowScreenshotDirRaw.trim() !== ""
      ? safeFlowScreenshotDirRaw.trim()
      : null;

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

  const addByCodePhase2cSkipBycodeNav =
    env?.MLCC_ADD_BY_CODE_PHASE_2C_SKIP_BYCODE_NAV === "true";

  const addByCodePhase2cNavUrlRaw = env?.MLCC_ADD_BY_CODE_PHASE_2C_NAV_URL;
  let addByCodePhase2cNavBycodeUrl = null;
  if (typeof addByCodePhase2cNavUrlRaw === "string" && addByCodePhase2cNavUrlRaw.trim() !== "") {
    addByCodePhase2cNavBycodeUrl = addByCodePhase2cNavUrlRaw.trim();
  } else if (addByCodePhase2c && !addByCodePhase2cSkipBycodeNav) {
    try {
      addByCodePhase2cNavBycodeUrl = new URL("/milo/products/bycode", loginUrl).href;
    } catch {
      addByCodePhase2cNavBycodeUrl = null;
    }
  }

  if (
    addByCodePhase2c &&
    !addByCodePhase2cSkipBycodeNav &&
    !addByCodePhase2cNavBycodeUrl
  ) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2C=true requires a valid MLCC_LOGIN_URL origin for default by-code navigation, or set MLCC_ADD_BY_CODE_PHASE_2C_NAV_URL, or MLCC_ADD_BY_CODE_PHASE_2C_SKIP_BYCODE_NAV=true",
    });
  }

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

  const addByCodePhase2h = env?.MLCC_ADD_BY_CODE_PHASE_2H === "true";

  const addByCodePhase2hApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2H_APPROVED === "true";

  let addByCodePhase2hTestCode = null;

  if (addByCodePhase2h) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2H=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2hApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2H=true requires MLCC_ADD_BY_CODE_PHASE_2H_APPROVED=true",
      });
    }

    const parsedCode = parsePhase2hTestCode(
      env?.MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE,
    );

    if (!parsedCode.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE: ${parsedCode.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2hTestCode = parsedCode.value;
    }

    const tenantCodeSel =
      typeof addByCodeCodeFieldSelector === "string"
        ? addByCodeCodeFieldSelector.trim()
        : "";

    if (!tenantCodeSel) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2H=true requires MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR (tenant code field)",
      });
    }
  }

  const addByCodePhase2j = env?.MLCC_ADD_BY_CODE_PHASE_2J === "true";

  const addByCodePhase2jApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2J_APPROVED === "true";

  const addByCodePhase2jAllowBlur =
    env?.MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR === "true";

  let addByCodePhase2jTestQuantity = null;

  if (addByCodePhase2j) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2J=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2jApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2J=true requires MLCC_ADD_BY_CODE_PHASE_2J_APPROVED=true",
      });
    }

    const parsedQty = parsePhase2jTestQuantity(
      env?.MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY,
    );

    if (!parsedQty.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY: ${parsedQty.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2jTestQuantity = parsedQty.value;
    }

    if (!addByCodeQtyFieldSelector) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2J=true requires MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR (tenant quantity field)",
      });
    }
  }

  const addByCodePhase2l = env?.MLCC_ADD_BY_CODE_PHASE_2L === "true";

  const addByCodePhase2lApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_APPROVED === "true";

  const addByCodePhase2lAllowBlur =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_ALLOW_BLUR === "true";

  let addByCodePhase2lTestCode = null;
  let addByCodePhase2lTestQuantity = null;
  let addByCodePhase2lFieldOrder = null;

  if (addByCodePhase2l) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    const parsed2lCode = parsePhase2hTestCode(
      env?.MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE,
    );

    if (!parsed2lCode.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE: ${parsed2lCode.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2lTestCode = parsed2lCode.value;
    }

    const parsed2lQty = parsePhase2jTestQuantity(
      env?.MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY,
    );

    if (!parsed2lQty.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY: ${parsed2lQty.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2lTestQuantity = parsed2lQty.value;
    }

    const parsedOrder = parsePhase2lFieldOrder(
      env?.MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER,
    );

    if (!parsedOrder.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER: ${parsedOrder.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2lFieldOrder = parsedOrder.value;
    }

    if (!addByCodeCodeFieldSelector) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L=true requires MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR (tenant code field)",
      });
    }

    if (!addByCodeQtyFieldSelector) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L=true requires MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR (tenant quantity field)",
      });
    }
  }

  const addByCodePhase2n = env?.MLCC_ADD_BY_CODE_PHASE_2N === "true";

  const addByCodePhase2nApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2N_APPROVED === "true";

  let addByCodePhase2nAddApplyCandidateSelectors = [];
  let addByCodePhase2nTextAllowSubstrings = [];

  if (addByCodePhase2n) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2N=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2nApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2N=true requires MLCC_ADD_BY_CODE_PHASE_2N_APPROVED=true",
      });
    }

    if (!addByCodePhase2l) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2N=true requires MLCC_ADD_BY_CODE_PHASE_2L=true (same-run combined rehearsal prerequisite)",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2N=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    try {
      addByCodePhase2nAddApplyCandidateSelectors =
        parsePhase2nAddApplyCandidateSelectors(
          env?.MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS,
        );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS: ${m}`,
      });
    }

    const allow2nRaw = env?.MLCC_ADD_BY_CODE_PHASE_2N_TEXT_ALLOW_SUBSTRINGS;

    if (allow2nRaw != null && String(allow2nRaw).trim() !== "") {
      try {
        addByCodePhase2nTextAllowSubstrings =
          parsePhase2fSafeOpenTextAllowSubstrings(allow2nRaw);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);

        errors.push({
          type: "config",
          message: `Invalid MLCC_ADD_BY_CODE_PHASE_2N_TEXT_ALLOW_SUBSTRINGS: ${m}`,
        });
      }
    }
  }

  const addByCodePhase2uMiloBulk =
    env?.MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK === "true";

  const addByCodePhase2uMiloBulkApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED === "true";

  let addByCodePhase2uMiloBulkCandidateSelectors = [];
  let addByCodePhase2uMiloBulkTextAllowSubstrings = [];

  if (addByCodePhase2uMiloBulk) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2uMiloBulkApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED=true",
      });
    }

    if (!addByCodePhase2l) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true requires MLCC_ADD_BY_CODE_PHASE_2L=true",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    try {
      addByCodePhase2uMiloBulkCandidateSelectors =
        parsePhase2nAddApplyCandidateSelectors(
          env?.MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS,
        );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS: ${m}`,
      });
    }

    const allow2uRaw =
      env?.MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_TEXT_ALLOW_SUBSTRINGS;

    if (allow2uRaw != null && String(allow2uRaw).trim() !== "") {
      try {
        addByCodePhase2uMiloBulkTextAllowSubstrings =
          parsePhase2fSafeOpenTextAllowSubstrings(allow2uRaw);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        errors.push({
          type: "config",
          message: `Invalid MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_TEXT_ALLOW_SUBSTRINGS: ${m}`,
        });
      }
    }

    if (addByCodePhase2n) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true cannot be combined with MLCC_ADD_BY_CODE_PHASE_2N=true (choose one post-2L model)",
      });
    }
  }

  const addByCode2uDeterminismStatePathRaw = env?.MLCC_2U_DETERMINISM_STATE_PATH;
  const addByCode2uDeterminismStatePath =
    typeof addByCode2uDeterminismStatePathRaw === "string" &&
    addByCode2uDeterminismStatePathRaw.trim() !== ""
      ? addByCode2uDeterminismStatePathRaw.trim()
      : null;
  const addByCode2uDeterminismStateWrite = env?.MLCC_2U_DETERMINISM_STATE_WRITE === "true";
  const addByCode2uDeterminismStateWriteApproved =
    env?.MLCC_2U_DETERMINISM_STATE_WRITE_APPROVED === "true";

  if (addByCode2uDeterminismStateWrite) {
    if (!addByCode2uDeterminismStatePath) {
      errors.push({
        type: "config",
        message:
          "MLCC_2U_DETERMINISM_STATE_WRITE=true requires MLCC_2U_DETERMINISM_STATE_PATH (non-empty)",
      });
    }
    if (!addByCode2uDeterminismStateWriteApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_2U_DETERMINISM_STATE_WRITE=true requires MLCC_2U_DETERMINISM_STATE_WRITE_APPROVED=true",
      });
    }
  }

  if (
    (addByCode2uDeterminismStatePath || addByCode2uDeterminismStateWrite) &&
    !addByCodePhase2uMiloBulk
  ) {
    errors.push({
      type: "config",
      message:
        "MLCC_2U_DETERMINISM_STATE_PATH or MLCC_2U_DETERMINISM_STATE_WRITE requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true",
    });
  }

  if (
    (addByCode2uDeterminismStatePath || addByCode2uDeterminismStateWrite) &&
    addByCodePhase2uMiloBulk &&
    !addByCodePhase2uMiloBulkApproved
  ) {
    errors.push({
      type: "config",
      message:
        "MLCC_2U determinism state path/write requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED=true",
    });
  }

  const addByCodePhase2lSkipClearWhen2uApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED === "true";

  if (addByCodePhase2lSkipClearWhen2uApproved) {
    if (!addByCodePhase2l) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED=true requires MLCC_ADD_BY_CODE_PHASE_2L=true",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    if (!addByCodePhase2uMiloBulk) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true",
      });
    }

    if (!addByCodePhase2uMiloBulkApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED=true",
      });
    }
  }

  const addByCodePhase2lMiloManualParitySequence =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE === "true";

  const addByCodePhase2lMiloManualParitySequenceApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED === "true";

  let addByCodePhase2lMiloManualParitySequenceSettleMs = 600;
  let addByCodePhase2lMiloFullKeyboardParitySequence = false;
  let addByCodePhase2lMiloFullKeyboardParitySequenceApproved = false;
  let addByCodePhase2lMiloManualParityBlankClickTargetSelector = null;
  let addByCodePhase2lMiloManualParityBlankClickPositionX = null;
  let addByCodePhase2lMiloManualParityBlankClickPositionY = null;
  let addByCodePhase2lMiloManualParityPostBlankWaitForTextSubstring = null;
  let addByCodePhase2lMiloManualParityPostBlankWaitForTextMs = 0;

  if (addByCodePhase2lMiloManualParitySequence) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2l) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE=true requires MLCC_ADD_BY_CODE_PHASE_2L=true",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    if (!addByCodePhase2lMiloManualParitySequenceApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE=true requires MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_APPROVED=true",
      });
    }

    if (!addByCodeCodeFieldSelector || !addByCodeQtyFieldSelector) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE=true requires MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR and MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR",
      });
    }

    const rawManSettle =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_SETTLE_MS;

    if (rawManSettle != null && String(rawManSettle).trim() !== "") {
      const n = Number.parseInt(String(rawManSettle).trim(), 10);

      if (!Number.isFinite(n) || n < 0 || n > 2000) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_SETTLE_MS must be an integer 0–2000",
        });
      } else {
        addByCodePhase2lMiloManualParitySequenceSettleMs = n;
      }
    }

    const rawManBlank =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_TARGET_SELECTOR;

    addByCodePhase2lMiloFullKeyboardParitySequence =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE === "true";

    addByCodePhase2lMiloFullKeyboardParitySequenceApproved =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE_APPROVED ===
      "true";

    if (
      addByCodePhase2lMiloFullKeyboardParitySequence &&
      !addByCodePhase2lMiloFullKeyboardParitySequenceApproved
    ) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE=true requires MLCC_ADD_BY_CODE_PHASE_2L_MILO_FULL_KEYBOARD_PARITY_SEQUENCE_APPROVED=true",
      });
    }

    if (rawManBlank != null && String(rawManBlank).trim() !== "") {
      const t = String(rawManBlank).trim();

      if (t.length > 200) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_TARGET_SELECTOR exceeds max length 200",
        });
      } else if (/[\r\n]/.test(t)) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_TARGET_SELECTOR must not contain newline characters",
        });
      } else {
        addByCodePhase2lMiloManualParityBlankClickTargetSelector = t;
      }
    }

    const rawBlankPx =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_POSITION_X;

    if (rawBlankPx != null && String(rawBlankPx).trim() !== "") {
      const n = Number.parseInt(String(rawBlankPx).trim(), 10);

      if (!Number.isFinite(n) || n < 0 || n > 4000) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_POSITION_X must be an integer 0–4000",
        });
      } else {
        addByCodePhase2lMiloManualParityBlankClickPositionX = n;
      }
    }

    const rawBlankPy =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_POSITION_Y;

    if (rawBlankPy != null && String(rawBlankPy).trim() !== "") {
      const n = Number.parseInt(String(rawBlankPy).trim(), 10);

      if (!Number.isFinite(n) || n < 0 || n > 4000) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_BLANK_CLICK_POSITION_Y must be an integer 0–4000",
        });
      } else {
        addByCodePhase2lMiloManualParityBlankClickPositionY = n;
      }
    }

    const postBlankWaitApproved =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_APPROVED ===
      "true";

    const rawPostBlankWaitSub =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_SUBSTRING;

    if (rawPostBlankWaitSub != null && String(rawPostBlankWaitSub).trim() !== "") {
      const w = String(rawPostBlankWaitSub).trim();

      if (w.length > 120) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_SUBSTRING exceeds max length 120",
        });
      } else if (/[\r\n]/.test(w)) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_SUBSTRING must not contain newline characters",
        });
      } else if (!postBlankWaitApproved) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_SUBSTRING requires MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_APPROVED=true",
        });
      } else {
        const rawPostBlankWaitMs =
          env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_MS;

        let waitMs = 8000;
        let waitMsValid = true;

        if (rawPostBlankWaitMs != null && String(rawPostBlankWaitMs).trim() !== "") {
          const nMs = Number.parseInt(String(rawPostBlankWaitMs).trim(), 10);

          if (!Number.isFinite(nMs) || nMs < 1 || nMs > 12_000) {
            errors.push({
              type: "config",
              message:
                "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_POST_BLANK_WAIT_FOR_TEXT_MS must be an integer 1–12000 when post-blank wait substring is set",
            });
            waitMsValid = false;
          } else {
            waitMs = nMs;
          }
        }

        if (waitMsValid) {
          addByCodePhase2lMiloManualParityPostBlankWaitForTextSubstring = w;
          addByCodePhase2lMiloManualParityPostBlankWaitForTextMs = waitMs;
        }
      }
    }
  }

  const addByCodePhase2lMiloPostFillTabFromQuantity =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY === "true";

  const addByCodePhase2lMiloPostFillTabFromQuantityApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_APPROVED ===
    "true";

  let addByCodePhase2lMiloPostFillTabFromQuantitySettleMs = 500;

  if (addByCodePhase2lMiloPostFillTabFromQuantity) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2l) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY=true requires MLCC_ADD_BY_CODE_PHASE_2L=true",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    if (!addByCodePhase2lMiloPostFillTabFromQuantityApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY=true requires MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_APPROVED=true",
      });
    }

    if (!addByCodeQtyFieldSelector) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY=true requires MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR",
      });
    }

    const rawTabSettle =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_SETTLE_MS;

    if (rawTabSettle != null && String(rawTabSettle).trim() !== "") {
      const n = Number.parseInt(String(rawTabSettle).trim(), 10);

      if (!Number.isFinite(n) || n < 0 || n > 2000) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY_SETTLE_MS must be an integer 0–2000",
        });
      } else {
        addByCodePhase2lMiloPostFillTabFromQuantitySettleMs = n;
      }
    }
  }

  const addByCodePhase2lMiloPostFillClickAway =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY === "true";

  const addByCodePhase2lMiloPostFillClickAwayApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_APPROVED === "true";

  let addByCodePhase2lMiloPostFillClickAwayTargetSelector = null;
  let addByCodePhase2lMiloPostFillClickAwaySettleMs = 500;

  if (addByCodePhase2lMiloPostFillClickAway) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2l) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY=true requires MLCC_ADD_BY_CODE_PHASE_2L=true",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    if (!addByCodePhase2lMiloPostFillClickAwayApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY=true requires MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_APPROVED=true",
      });
    }

    const rawClickAwayTarget =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_TARGET_SELECTOR;

    if (rawClickAwayTarget != null && String(rawClickAwayTarget).trim() !== "") {
      const t = String(rawClickAwayTarget).trim();

      if (t.length > 200) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_TARGET_SELECTOR exceeds max length 200",
        });
      } else if (/[\r\n]/.test(t)) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_TARGET_SELECTOR must not contain newline characters",
        });
      } else {
        addByCodePhase2lMiloPostFillClickAwayTargetSelector = t;
      }
    }

    const rawClickAwaySettle =
      env?.MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_SETTLE_MS;

    if (rawClickAwaySettle != null && String(rawClickAwaySettle).trim() !== "") {
      const n = Number.parseInt(String(rawClickAwaySettle).trim(), 10);

      if (!Number.isFinite(n) || n < 0 || n > 2000) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY_SETTLE_MS must be an integer 0–2000",
        });
      } else {
        addByCodePhase2lMiloPostFillClickAwaySettleMs = n;
      }
    }
  }

  const addByCodePhase2o = env?.MLCC_ADD_BY_CODE_PHASE_2O === "true";
  const addByCodePhase2oMiloPost2u =
    env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U === "true";

  const addByCodePhase2oApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2O_APPROVED === "true";

  let addByCodePhase2oSettleMs = 500;

  if (addByCodePhase2o || addByCodePhase2oMiloPost2u) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O/MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2oApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O/MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U requires MLCC_ADD_BY_CODE_PHASE_2O_APPROVED=true",
      });
    }

    if (addByCodePhase2o && !addByCodePhase2n) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O=true requires MLCC_ADD_BY_CODE_PHASE_2N=true",
      });
    }

    if (addByCodePhase2o && !addByCodePhase2nApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O=true requires MLCC_ADD_BY_CODE_PHASE_2N_APPROVED=true",
      });
    }

    if (addByCodePhase2oMiloPost2u && !addByCodePhase2uMiloBulk) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true",
      });
    }

    if (addByCodePhase2oMiloPost2u && !addByCodePhase2uMiloBulkApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED=true",
      });
    }

    if (addByCodePhase2o && addByCodePhase2oMiloPost2u) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O=true cannot be combined with MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U=true (choose one post-click observation model)",
      });
    }

    const parsedSettle = parsePhase2oSettleMs(
      env?.MLCC_ADD_BY_CODE_PHASE_2O_SETTLE_MS,
    );

    if (!parsedSettle.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2O_SETTLE_MS: ${parsedSettle.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2oSettleMs = parsedSettle.value;
    }
  }

  const addByCodePhase2oMiloReadonlyCartValidateDiscovery =
    env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY === "true";

  const addByCodePhase2oMiloReadonlyCartValidateDiscoveryApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED === "true";

  let addByCodePhase2oMiloReadonlyCartValidateDiscoveryUrl = null;
  let addByCodePhase2oMiloReadonlyCartValidateDiscoverySettleMs = 600;
  let addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleMs = 0;
  let addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleApproved = false;
  let addByCodeMiloPreCartListRootSelector = null;
  let addByCodeMiloPreCartListRootSelectorApproved = false;
  let addByCodePhase2oMiloReadonlyCartDiscoveryPathCandidates = [];

  const addByCodePhase2oMiloSafeCartIconClick =
    env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK === "true";
  const addByCodePhase2oMiloSafeCartIconClickApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK_APPROVED === "true";

  if (addByCodePhase2oMiloSafeCartIconClick) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2oMiloReadonlyCartValidateDiscovery) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK=true requires MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY=true",
      });
    }

    if (!addByCodePhase2oMiloSafeCartIconClickApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK=true requires MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK_APPROVED=true",
      });
    }
  }

  if (addByCodePhase2oMiloReadonlyCartValidateDiscovery) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2oMiloReadonlyCartValidateDiscoveryApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY=true requires MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_APPROVED=true",
      });
    }

    if (!addByCodePhase2oMiloPost2u) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY=true requires MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U=true",
      });
    }

    if (!addByCodePhase2oApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY=true requires MLCC_ADD_BY_CODE_PHASE_2O_APPROVED=true",
      });
    }

    if (!addByCodePhase2uMiloBulk || !addByCodePhase2uMiloBulkApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true and MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED=true",
      });
    }

    const rawDiscUrl = env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_URL;

    if (rawDiscUrl != null && String(rawDiscUrl).trim() !== "") {
      const u = String(rawDiscUrl).trim();

      if (!isValidHttpUrl(u)) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY_URL must be a valid http(s) URL",
        });
      } else {
        addByCodePhase2oMiloReadonlyCartValidateDiscoveryUrl = u;
      }
    }

    const rawPathCand =
      env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_DISCOVERY_PATH_CANDIDATES;

    if (rawPathCand != null && String(rawPathCand).trim() !== "") {
      const parsedPc = parsePhase2oMiloReadonlyCartDiscoveryPathCandidates(rawPathCand);

      if (!parsedPc.ok) {
        errors.push({
          type: "config",
          message: `Invalid MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_DISCOVERY_PATH_CANDIDATES: ${parsedPc.reason ?? "invalid"}`,
        });
      } else {
        addByCodePhase2oMiloReadonlyCartDiscoveryPathCandidates = parsedPc.paths;
      }
    }

    const parsedDiscSettle = parsePhase2rSettleMs(
      env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_DISCOVERY_SETTLE_MS,
    );

    if (!parsedDiscSettle.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_DISCOVERY_SETTLE_MS: ${parsedDiscSettle.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2oMiloReadonlyCartValidateDiscoverySettleMs = parsedDiscSettle.value;
    }

    const parsedPreCartSettle = parseMiloPost2uPreReadonlyCartDiscoverySettleMs(
      env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_MS,
    );

    if (!parsedPreCartSettle.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_MS: ${parsedPreCartSettle.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleMs =
        parsedPreCartSettle.value;
    }

    addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleApproved =
      env?.MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_APPROVED ===
      "true";

    if (
      addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleMs > 0 &&
      !addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleApproved
    ) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_MS>0 requires MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_APPROVED=true",
      });
    }

    const rawListRoot = env?.MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR;
    addByCodeMiloPreCartListRootSelectorApproved =
      env?.MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR_APPROVED === "true";

    if (rawListRoot != null && String(rawListRoot).trim() !== "") {
      const lr = String(rawListRoot).trim();

      if (lr.length > 480) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR exceeds max length 480",
        });
      } else if (/[\r\n]/.test(lr)) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR must not contain newline characters",
        });
      } else if (!addByCodeMiloPreCartListRootSelectorApproved) {
        errors.push({
          type: "config",
          message:
            "MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR requires MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR_APPROVED=true",
        });
      } else {
        addByCodeMiloPreCartListRootSelector = lr;
      }
    }
  }

  const addByCodePhase2q = env?.MLCC_ADD_BY_CODE_PHASE_2Q === "true";

  const addByCodePhase2qApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED === "true";

  const addByCodePhase2qOperatorAcceptsMissing2o =
    env?.MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O === "true";

  let addByCodePhase2qValidateCandidateSelectors = [];
  let addByCodePhase2qTextAllowSubstrings = [];
  let addByCodePhase2qPostValidateObserveSettleMs = 400;

  if (addByCodePhase2q) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2Q=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2qApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2Q=true requires MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED=true",
      });
    }

    if (!addByCodePhase2n) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2Q=true requires MLCC_ADD_BY_CODE_PHASE_2N=true",
      });
    }

    if (!addByCodePhase2nApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2Q=true requires MLCC_ADD_BY_CODE_PHASE_2N_APPROVED=true",
      });
    }

    if (!addByCodePhase2l) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2Q=true requires MLCC_ADD_BY_CODE_PHASE_2L=true (same-run prerequisite as Phase 2n)",
      });
    }

    if (!addByCodePhase2lApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2Q=true requires MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true",
      });
    }

    if (!addByCodePhase2o && !addByCodePhase2qOperatorAcceptsMissing2o) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2Q=true with MLCC_ADD_BY_CODE_PHASE_2O not enabled requires MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true (explicit operator acknowledgment per Phase 2p)",
      });
    }

    try {
      addByCodePhase2qValidateCandidateSelectors =
        parsePhase2qValidateCandidateSelectors(
          env?.MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS,
        );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS: ${m}`,
      });
    }

    const allow2qRaw = env?.MLCC_ADD_BY_CODE_PHASE_2Q_TEXT_ALLOW_SUBSTRINGS;

    if (allow2qRaw != null && String(allow2qRaw).trim() !== "") {
      try {
        addByCodePhase2qTextAllowSubstrings =
          parsePhase2fSafeOpenTextAllowSubstrings(allow2qRaw);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);

        errors.push({
          type: "config",
          message: `Invalid MLCC_ADD_BY_CODE_PHASE_2Q_TEXT_ALLOW_SUBSTRINGS: ${m}`,
        });
      }
    }

    const parsed2qObserve = parsePhase2qPostValidateObserveSettleMs(
      env?.MLCC_ADD_BY_CODE_PHASE_2Q_POST_VALIDATE_OBSERVE_SETTLE_MS,
    );

    if (!parsed2qObserve.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2Q_POST_VALIDATE_OBSERVE_SETTLE_MS: ${parsed2qObserve.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2qPostValidateObserveSettleMs = parsed2qObserve.value;
    }
  }

  const addByCodePhase2r = env?.MLCC_ADD_BY_CODE_PHASE_2R === "true";

  const addByCodePhase2rApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2R_APPROVED === "true";

  let addByCodePhase2rSettleMs = 600;

  const addByCodePhase2vMiloValidate =
    env?.MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE === "true";
  const addByCodePhase2vMiloValidateApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_APPROVED === "true";
  let addByCodePhase2vMiloValidateSelectors = [];
  let addByCodePhase2vMiloValidateTextAllowSubstrings = [];

  const addByCodePhase2wMiloPostValidate =
    env?.MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE === "true";
  const addByCodePhase2wMiloPostValidateApproved =
    env?.MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE_APPROVED === "true";
  let addByCodePhase2wMiloPostValidateSettleMs = 600;

  if (addByCodePhase2r) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2R=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }

    if (!addByCodePhase2rApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2R=true requires MLCC_ADD_BY_CODE_PHASE_2R_APPROVED=true",
      });
    }

    if (!addByCodePhase2q) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2R=true requires MLCC_ADD_BY_CODE_PHASE_2Q=true",
      });
    }

    if (!addByCodePhase2qApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2R=true requires MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED=true",
      });
    }

    const parsed2rSettle = parsePhase2rSettleMs(
      env?.MLCC_ADD_BY_CODE_PHASE_2R_SETTLE_MS,
    );

    if (!parsed2rSettle.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2R_SETTLE_MS: ${parsed2rSettle.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2rSettleMs = parsed2rSettle.value;
    }
  }

  if (addByCodePhase2vMiloValidate) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }
    if (!addByCodePhase2vMiloValidateApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true requires MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_APPROVED=true",
      });
    }
    if (!addByCodePhase2uMiloBulk || !addByCodePhase2uMiloBulkApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true and MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED=true",
      });
    }
    if (!addByCodePhase2oMiloPost2u || !addByCodePhase2oApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true requires MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U=true and MLCC_ADD_BY_CODE_PHASE_2O_APPROVED=true",
      });
    }
    if (addByCodePhase2q || addByCodePhase2r) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true cannot be combined with legacy MLCC_ADD_BY_CODE_PHASE_2Q/2R flags (choose one validate model)",
      });
    }

    try {
      addByCodePhase2vMiloValidateSelectors = parsePhase2qValidateCandidateSelectors(
        env?.MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_SELECTORS,
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_SELECTORS: ${m}`,
      });
    }

    const allow2vRaw = env?.MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_TEXT_ALLOW_SUBSTRINGS;
    if (allow2vRaw != null && String(allow2vRaw).trim() !== "") {
      try {
        addByCodePhase2vMiloValidateTextAllowSubstrings =
          parsePhase2fSafeOpenTextAllowSubstrings(allow2vRaw);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        errors.push({
          type: "config",
          message: `Invalid MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_TEXT_ALLOW_SUBSTRINGS: ${m}`,
        });
      }
    }

  }

  if (addByCodePhase2wMiloPostValidate) {
    if (!addByCodeProbe) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE=true requires MLCC_ADD_BY_CODE_PROBE=true",
      });
    }
    if (!addByCodePhase2wMiloPostValidateApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE=true requires MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE_APPROVED=true",
      });
    }
    if (!addByCodePhase2vMiloValidate || !addByCodePhase2vMiloValidateApproved) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE=true requires MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true and MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_APPROVED=true",
      });
    }

    const parsed2wSettle = parsePhase2rSettleMs(
      env?.MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE_SETTLE_MS,
    );
    if (!parsed2wSettle.ok) {
      errors.push({
        type: "config",
        message: `Invalid MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE_SETTLE_MS: ${parsed2wSettle.reason ?? "invalid"}`,
      });
    } else {
      addByCodePhase2wMiloPostValidateSettleMs = parsed2wSettle.value;
    }

    if (addByCodePhase2r) {
      errors.push({
        type: "config",
        message:
          "MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE=true cannot be combined with legacy MLCC_ADD_BY_CODE_PHASE_2R=true (choose one post-validate model)",
      });
    }

  }

  if (addByCodePhase2d && addByCodePhase2e) {
    errors.push({
      type: "config",
      message:
        "MLCC_ADD_BY_CODE_PHASE_2D and MLCC_ADD_BY_CODE_PHASE_2E are mutually exclusive; use 2E for scoped boundary map or 2D for full-page",
    });
  }

  const reconMode = env?.MLCC_RECON_MODE === "true";
  const reconMappingUrls = deriveReconMappingUrls({
    loginUrl,
    orderingEntryUrl,
    safeTargetUrl,
    env,
  });

  if (reconMode) {
    const forbiddenInRecon = [];
    if (submissionArmed) forbiddenInRecon.push("MLCC_SUBMISSION_ARMED");
    if (addByCodeProbe) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PROBE");
    if (addByCodePhase2f) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2F");
    if (addByCodePhase2g) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2G");
    if (addByCodePhase2h) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2H");
    if (addByCodePhase2j) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2J");
    if (addByCodePhase2l) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2L");
    if (addByCodePhase2n) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2N");
    if (addByCodePhase2uMiloBulk)
      forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK");
    if (addByCodePhase2lSkipClearWhen2uApproved) {
      forbiddenInRecon.push(
        "MLCC_ADD_BY_CODE_PHASE_2L_SKIP_CLEAR_WHEN_2U_APPROVED",
      );
    }
    if (addByCodePhase2lMiloPostFillClickAway) {
      forbiddenInRecon.push(
        "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_CLICK_AWAY",
      );
    }
    if (addByCodePhase2lMiloPostFillTabFromQuantity) {
      forbiddenInRecon.push(
        "MLCC_ADD_BY_CODE_PHASE_2L_MILO_POST_FILL_TAB_FROM_QUANTITY",
      );
    }
    if (addByCodePhase2lMiloManualParitySequence) {
      forbiddenInRecon.push(
        "MLCC_ADD_BY_CODE_PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE",
      );
    }
    if (addByCodePhase2q) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2Q");
    if (addByCodePhase2r) forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2R");
    if (addByCodePhase2vMiloValidate)
      forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE");
    if (addByCodePhase2wMiloPostValidate)
      forbiddenInRecon.push("MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE");
    if (addByCodePhase2oMiloReadonlyCartValidateDiscovery) {
      forbiddenInRecon.push(
        "MLCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_VALIDATE_DISCOVERY",
      );
    }

    if (addByCodePhase2oMiloSafeCartIconClick) {
      forbiddenInRecon.push(
        "MLCC_ADD_BY_CODE_PHASE_2O_MILO_SAFE_CART_ICON_CLICK",
      );
    }

    if (addByCodeMiloPreCartListRootSelector) {
      forbiddenInRecon.push(
        "MLCC_ADD_BY_CODE_MILO_PRE_CART_LIST_ROOT_SELECTOR",
      );
    }

    if (forbiddenInRecon.length > 0) {
      errors.push({
        type: "config",
        message:
          `Recon mode forbids mutation-capable phases/flags: ${forbiddenInRecon.join(", ")}. ` +
          "Disable these flags for reconnaissance-only runs.",
      });
    }
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
      loginFailureSnapshotMaxBytes,
      safeFlowScreenshotDir,
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
      addByCodePhase2cNavBycodeUrl,
      addByCodePhase2cSkipBycodeNav,
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
      addByCodePhase2h,
      addByCodePhase2hApproved,
      addByCodePhase2hTestCode,
      addByCodePhase2j,
      addByCodePhase2jApproved,
      addByCodePhase2jTestQuantity,
      addByCodePhase2jAllowBlur,
      addByCodePhase2l,
      addByCodePhase2lApproved,
      addByCodePhase2lTestCode,
      addByCodePhase2lTestQuantity,
      addByCodePhase2lFieldOrder,
      addByCodePhase2lAllowBlur,
      addByCodePhase2lSkipClearWhen2uApproved,
      addByCodePhase2lMiloManualParitySequence,
      addByCodePhase2lMiloManualParitySequenceApproved,
      addByCodePhase2lMiloManualParitySequenceSettleMs,
      addByCodePhase2lMiloFullKeyboardParitySequence,
      addByCodePhase2lMiloFullKeyboardParitySequenceApproved,
      addByCodePhase2lMiloManualParityBlankClickTargetSelector,
      addByCodePhase2lMiloManualParityBlankClickPositionX,
      addByCodePhase2lMiloManualParityBlankClickPositionY,
      addByCodePhase2lMiloManualParityPostBlankWaitForTextSubstring,
      addByCodePhase2lMiloManualParityPostBlankWaitForTextMs,
      addByCodePhase2lMiloPostFillTabFromQuantity,
      addByCodePhase2lMiloPostFillTabFromQuantityApproved,
      addByCodePhase2lMiloPostFillTabFromQuantitySettleMs,
      addByCodePhase2lMiloPostFillClickAway,
      addByCodePhase2lMiloPostFillClickAwayApproved,
      addByCodePhase2lMiloPostFillClickAwayTargetSelector,
      addByCodePhase2lMiloPostFillClickAwaySettleMs,
      addByCodePhase2n,
      addByCodePhase2nApproved,
      addByCodePhase2nAddApplyCandidateSelectors,
      addByCodePhase2nTextAllowSubstrings,
      addByCodePhase2uMiloBulk,
      addByCodePhase2uMiloBulkApproved,
      addByCodePhase2uMiloBulkCandidateSelectors,
      addByCodePhase2uMiloBulkTextAllowSubstrings,
      addByCode2uDeterminismStatePath,
      addByCode2uDeterminismStateWrite,
      addByCode2uDeterminismStateWriteApproved,
      addByCodePhase2o,
      addByCodePhase2oMiloPost2u,
      addByCodePhase2oApproved,
      addByCodePhase2oSettleMs,
      addByCodePhase2oMiloReadonlyCartValidateDiscovery,
      addByCodePhase2oMiloReadonlyCartValidateDiscoveryApproved,
      addByCodePhase2oMiloSafeCartIconClick,
      addByCodePhase2oMiloSafeCartIconClickApproved,
      addByCodePhase2oMiloReadonlyCartValidateDiscoveryUrl,
      addByCodePhase2oMiloReadonlyCartDiscoveryPathCandidates,
      addByCodePhase2oMiloReadonlyCartValidateDiscoverySettleMs,
      addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleMs,
      addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleApproved,
      addByCodeMiloPreCartListRootSelector,
      addByCodeMiloPreCartListRootSelectorApproved,
      addByCodePhase2q,
      addByCodePhase2qApproved,
      addByCodePhase2qOperatorAcceptsMissing2o,
      addByCodePhase2qValidateCandidateSelectors,
      addByCodePhase2qTextAllowSubstrings,
      addByCodePhase2qPostValidateObserveSettleMs,
      addByCodePhase2r,
      addByCodePhase2rApproved,
      addByCodePhase2rSettleMs,
      addByCodePhase2vMiloValidate,
      addByCodePhase2vMiloValidateApproved,
      addByCodePhase2vMiloValidateSelectors,
      addByCodePhase2vMiloValidateTextAllowSubstrings,
      addByCodePhase2wMiloPostValidate,
      addByCodePhase2wMiloPostValidateApproved,
      addByCodePhase2wMiloPostValidateSettleMs,
      reconMode,
      reconMappingUrls,
    },
    errors: [],
  };
}

/** @typedef {"bad_credentials"|"agreement_checkbox_not_checked"|"captcha_or_mfa"|"selector_mismatch"|"post_login_detection_mismatch"|"unknown_login_flow_change"} MlccLoginFailureClassification */

export const MLCC_LOGIN_FAILURE_CLASS = {
  BAD_CREDENTIALS: "bad_credentials",
  AGREEMENT_NOT_CHECKED: "agreement_checkbox_not_checked",
  CAPTCHA_OR_MFA: "captcha_or_mfa",
  SELECTOR_MISMATCH: "selector_mismatch",
  POST_LOGIN_DETECTION_MISMATCH: "post_login_detection_mismatch",
  UNKNOWN: "unknown_login_flow_change",
};

export class MlccLoginFailure extends Error {
  /**
   * @param {MlccLoginFailureClassification} classification
   * @param {string} detail
   * @param {Record<string, unknown>} [diagnostics]
   */
  constructor(classification, detail, diagnostics = {}) {
    super(`MLCC login failed: ${classification} — ${detail}`);
    this.name = "MlccLoginFailure";
    this.classification = classification;
    this.diagnostics = diagnostics;
  }
}

const USERNAME_SELECTORS = [
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
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

function looksLikeLoginUrl(url) {
  try {
    const p = new URL(String(url)).pathname.toLowerCase();
    return (
      p.includes("/sign-in") ||
      p.includes("/login") ||
      p.includes("/auth/") ||
      p.endsWith("/auth")
    );
  } catch {
    return true;
  }
}

/** MILO post-login routes confirmed by manual verification (recon, no order placement). */
function isMiloPostLoginUrl(url) {
  try {
    const p = new URL(String(url)).pathname.toLowerCase();
    const postLogin = [
      "/milo/home",
      "/milo/location",
      "/milo/products",
      "/milo/cart",
    ];
    return postLogin.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
}

async function detectMiloPostLoginLandmarks(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    const t = text.slice(0, 24_000);
    return {
      choose_license_number: /CHOOSE\s+LICENSE\s+NUMBER/i.test(t),
      products_orders_or_add_by_code:
        /Products[\s\S]{0,120}(Orders|Favorites|Add\s+By\s+Code)/i.test(t),
      location_place_order_hint:
        /Place\s+Order/i.test(t) && /license|location/i.test(t),
    };
  });
}

function miloLandmarksSuggestAuthenticated(landmarks) {
  if (!landmarks) return false;
  if (landmarks.choose_license_number) return true;
  if (landmarks.products_orders_or_add_by_code) return true;
  if (landmarks.location_place_order_hint) return true;
  return false;
}

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

/**
 * Semantic + selector-list fallbacks for identifier (email/username).
 */
async function fillMlccLoginIdentifier(page, username) {
  const semantic = [
    async () => {
      const loc = page
        .getByPlaceholder(/email|username|user\s*id|account/i)
        .first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.fill(username);
        return "getByPlaceholder_auth";
      }
      return null;
    },
    async () => {
      const loc = page.getByLabel(/username\s*or\s*email/i).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.fill(username);
        return "getByLabel_username_or_email";
      }
      return null;
    },
    async () => {
      const loc = page.getByLabel(/email|user\s*name|login|account/i).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.fill(username);
        return "getByLabel";
      }
      return null;
    },
    async () => {
      const loc = page.getByRole("textbox", {
        name: /username\s*or\s*email|email|user|login/i,
      }).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.fill(username);
        return "getByRole_textbox_milo";
      }
      return null;
    },
    async () => {
      const loc = page.getByRole("textbox", { name: /email|user|login/i }).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.fill(username);
        return "getByRole_textbox";
      }
      return null;
    },
    async () => {
      const loc = page.locator('input[type="email"]').first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.fill(username);
        return "input[type=email]";
      }
      return null;
    },
  ];

  for (const tryFill of semantic) {
    const label = await tryFill();
    if (label) return { ok: true, via: label };
  }

  const ok = await fillFirstVisible(page, USERNAME_SELECTORS, username);
  return { ok, via: ok ? "selector_list" : null };
}

async function fillMlccLoginPassword(page, password) {
  const semantic = async () => {
    const loc = page.getByLabel(/password/i).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      await loc.fill(password);
      return "getByLabel_password";
    }
    return null;
  };

  const byLabel = await semantic();
  if (byLabel) return { ok: true, via: byLabel };

  const ok = await fillFirstVisible(page, PASSWORD_SELECTORS, password);
  return { ok, via: ok ? "selector_list" : null };
}

/**
 * If a terms/agreement checkbox is visible and clearly labeled, ensure it is checked (read-only safe: only consent, no order actions).
 */
async function tryCheckMlccAgreementIfPresent(page) {
  const miloTerms =
    /I have read and accepted the terms\.?/i;
  const labelRe =
    /agree|terms|conditions|acknowledge|privacy|user agreement|i have read/i;

  const miloCb = page.getByRole("checkbox", { name: miloTerms }).first();
  if ((await miloCb.count()) > 0 && (await miloCb.isVisible().catch(() => false))) {
    const checked = await miloCb.isChecked().catch(() => false);
    if (!checked) {
      await miloCb.check({ force: true }).catch(async () => {
        await miloCb.click({ force: true });
      });
    }
    return {
      handled: true,
      strategy: "milo_terms_checkbox",
      was_checked: checked,
    };
  }

  const byRole = page.getByRole("checkbox", { name: labelRe }).first();
  if ((await byRole.count()) > 0 && (await byRole.isVisible().catch(() => false))) {
    const checked = await byRole.isChecked().catch(() => false);
    if (!checked) {
      await byRole.check({ force: true }).catch(async () => {
        await byRole.click({ force: true });
      });
    }
    return {
      handled: true,
      strategy: "getByRole_checkbox",
      was_checked: checked,
    };
  }

  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count();

  for (let i = 0; i < n; i++) {
    const cb = boxes.nth(i);
    const vis = await cb.isVisible().catch(() => false);
    if (!vis) continue;

    const id = await cb.getAttribute("id");
    let nearby = "";

    if (id) {
      nearby +=
        (await page
          .locator(`label[for="${id}"]`)
          .innerText()
          .catch(() => "")) || "";
    }
    const wrap = await cb
      .evaluate((el) => {
        const p = el.closest("label,fieldset,div,form");
        return p?.innerText?.slice(0, 600) ?? "";
      })
      .catch(() => "");

    nearby += wrap;
    if (!labelRe.test(nearby)) continue;

    const checked = await cb.isChecked().catch(() => false);
    if (!checked) {
      await cb.check({ force: true }).catch(async () => {
        await cb.click({ force: true });
      });
    }

    return {
      handled: true,
      strategy: "scan_checkboxes",
      was_checked: checked,
      label_excerpt: nearby.trim().slice(0, 280),
    };
  }

  return { handled: false, strategy: null };
}

async function detectCaptchaOrMfaSignals(page) {
  return page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe")).map((f) =>
      (f.getAttribute("src") || "").toLowerCase(),
    );
    const captchaFrame = iframes.some(
      (s) =>
        s.includes("recaptcha") ||
        s.includes("hcaptcha") ||
        s.includes("captcha") ||
        s.includes("challenges.cloudflare"),
    );
    const text = document.body?.innerText?.toLowerCase() ?? "";
    const mfaHints =
      /verification code|one[- ]time password|authenticator app|two[- ]factor authentication|multi[- ]factor authentication|enter (the )?code (sent|we)|security code/i.test(
        text,
      );

    return { captchaFrame, mfaHints, iframe_count: iframes.length };
  });
}

async function scrapeLoginFormControlSummary(page) {
  return page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll("input, select, textarea"),
    ).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || null,
      name: el.getAttribute("name") || null,
      id: el.getAttribute("id") || null,
      placeholder: el.getAttribute("placeholder") || null,
      autocomplete: el.getAttribute("autocomplete") || null,
      visible: el instanceof HTMLElement && el.offsetParent !== null,
    }));

    const buttons = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"]',
      ),
    ).map((el) => ({
      text: (el.textContent || el.value || "").trim().slice(0, 120),
      type: el.getAttribute("type") || null,
      visible: el instanceof HTMLElement && el.offsetParent !== null,
    }));

    const checkboxes = Array.from(
      document.querySelectorAll('input[type="checkbox"]'),
    ).map((el) => ({
      id: el.getAttribute("id") || null,
      checked: el.checked,
      visible: el instanceof HTMLElement && el.offsetParent !== null,
      near_text: el
        .closest("label,fieldset,div")
        ?.innerText?.trim()
        ?.slice(0, 200),
    }));

    return { inputs, buttons, checkboxes, input_count: inputs.length };
  });
}

async function getBodyTextExcerpt(page, maxLen = 12000) {
  try {
    const t = await page.evaluate(() => document.body?.innerText ?? "");
    return String(t).slice(0, maxLen);
  } catch {
    return null;
  }
}

async function getLoginRegionHtmlExcerpt(page, maxLen = 80000) {
  try {
    return await page.evaluate((max) => {
      const el =
        document.querySelector(
          'main, form, [role="main"], [data-testid*="login" i], #root',
        ) || document.body;
      const raw = el?.innerHTML ?? "";
      return raw.slice(0, max);
    }, maxLen);
  } catch {
    return null;
  }
}

export async function buildMlccLoginFailureEvidencePack(page, config, extra = {}) {
  const maxBytes = config.loginFailureSnapshotMaxBytes ?? 450_000;
  const snap = await buildPageSnapshotAttributes(page);
  const bodyText = await getBodyTextExcerpt(page);
  const formSummary = await scrapeLoginFormControlSummary(page);
  const loginHtml = await getLoginRegionHtmlExcerpt(page);
  const captcha = page ? await detectCaptchaOrMfaSignals(page) : null;

  let shot = await maybeScreenshotPngBase64(page, maxBytes, { fullPage: true });
  let attrs = {
    ...snap,
    login_body_text_excerpt: bodyText,
    login_form_control_summary: formSummary,
    login_region_html_excerpt: loginHtml,
    captcha_or_mfa_signals: captcha,
    ...extra,
  };
  attrs = mergeSnapshotAndScreenshot(attrs, shot);

  if (!shot.included && shot.reason === "over_size_limit") {
    const shotVp = await maybeScreenshotPngBase64(page, maxBytes, {
      fullPage: false,
    });
    attrs = mergeSnapshotAndScreenshot(attrs, shotVp);
    attrs.login_screenshot_fallback = "viewport_after_fullpage_oversize";
  }

  return attrs;
}

/**
 * Only on the auth/sign-in page: avoid class*="error" heuristics that match unrelated post-login UI.
 */
async function hasObviousLoginError(page) {
  if (!looksLikeLoginUrl(page.url())) {
    return false;
  }

  const authFailureText =
    /invalid|incorrect|wrong\s+(password|credentials)|failed|could\s+not|unable\s+to\s+sign|authentication\s+failed|verify\s+your\s+(credentials|password)|unauthorized|denied/i;

  const alert = page.locator('[role="alert"]').first();
  if (await alert.isVisible().catch(() => false)) {
    const t = (await alert.innerText().catch(() => "")).trim();
    if (t && authFailureText.test(t)) return true;
  }

  const summary = page.locator(".validation-summary-errors").first();
  if (await summary.isVisible().catch(() => false)) {
    const t = (await summary.innerText().catch(() => "")).trim();
    if (t && authFailureText.test(t)) return true;
  }

  return false;
}

async function readInlineLoginErrorHint(page) {
  if (!looksLikeLoginUrl(page.url())) {
    return null;
  }
  try {
    const t = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('[role="alert"], .validation-summary-errors'),
      );
      return nodes
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 5)
        .join(" | ");
    });
    return t ? t.slice(0, 800) : null;
  } catch {
    return null;
  }
}

async function finalizeMiloLoginSuccess(page, landmarks, reason) {
  const finalUrl = page.url();
  let title = null;

  try {
    title = (await page.title()) || null;
  } catch {
    title = null;
  }

  return {
    finalUrl,
    title,
    milo_post_login: true,
    milo_landmarks: landmarks,
    milo_success_reason: reason,
  };
}

async function collectLoginPrepSafeModeForensics(page) {
  return collectSafeModeFailureEvidencePack(page, {
    screenshotMaxBytes: 200_000,
    excerptMaxChars: 12_000,
    htmlExcerptMaxChars: 8000,
  }).catch(() => ({ forensics_unavailable: true }));
}

async function prepareMlccLoginPage(page, config) {
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const identifierFill = await fillMlccLoginIdentifier(page, config.username);
  if (!identifierFill.ok) {
    const safe_mode_failure_forensics = await collectLoginPrepSafeModeForensics(page);
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.SELECTOR_MISMATCH,
      "Could not find a visible username/email field (see diagnostics.safe_mode_failure_forensics for screenshot/HTML excerpt)",
      { identifier_fill: identifierFill, safe_mode_failure_forensics },
    );
  }

  const passwordFill = await fillMlccLoginPassword(page, config.password);
  if (!passwordFill.ok) {
    const safe_mode_failure_forensics = await collectLoginPrepSafeModeForensics(page);
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.SELECTOR_MISMATCH,
      "Could not find a visible password field (see diagnostics.safe_mode_failure_forensics for screenshot/HTML excerpt)",
      { password_fill: passwordFill, identifier_fill: identifierFill, safe_mode_failure_forensics },
    );
  }

  const agreement = await tryCheckMlccAgreementIfPresent(page);

  return { identifierFill, passwordFill, agreement };
}

async function commitMlccLogin(page) {
  const loginBtnClicked = await clickMiloLoginButton(page);
  if (loginBtnClicked) {
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(
      () => {},
    );
    await new Promise((r) => setTimeout(r, 1500));
    return { via: "milo_login_button" };
  }

  const form = page.locator("form").first();
  if (
    (await form.count()) > 0 &&
    (await form.isVisible().catch(() => false))
  ) {
    const submitted = await form.evaluate((f) => {
      if (typeof f.requestSubmit === "function") {
        f.requestSubmit();
        return true;
      }
      return false;
    });
    if (submitted) {
      await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(
        () => {},
      );
      await new Promise((r) => setTimeout(r, 1500));
      return { via: "form_requestSubmit" };
    }
  }

  const clicked = await clickMlccLoginSubmitFallback(page);

  if (!clicked) {
    const safe_mode_failure_forensics = await collectLoginPrepSafeModeForensics(page);
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.SELECTOR_MISMATCH,
      "Could not find a visible Login / sign-in submit control (see diagnostics.safe_mode_failure_forensics for screenshot/HTML excerpt)",
      { safe_mode_failure_forensics },
    );
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(
    () => {},
  );

  await new Promise((r) => setTimeout(r, 1500));
  return { via: "click_fallback" };
}

/** MILO sign-in uses a primary "Login" button (manual verification). */
async function clickMiloLoginButton(page) {
  const exact = page.getByRole("button", { name: /^Login$/i }).first();
  if (
    (await exact.count()) > 0 &&
    (await exact.isVisible().catch(() => false))
  ) {
    await exact.click();
    return true;
  }

  return false;
}

async function clickMlccLoginSubmitFallback(page) {
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
    name: /sign\s*in|log\s*in|login|continue/i,
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

async function assertMlccLoginSucceeded(page) {
  const captchaBefore = await detectCaptchaOrMfaSignals(page);
  if (captchaBefore.captchaFrame) {
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.CAPTCHA_OR_MFA,
      "Captcha iframe detected before post-login assertion",
      { captcha_or_mfa_signals: captchaBefore },
    );
  }

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const u = page.url();
    if (!looksLikeLoginUrl(u)) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  let landmarks = await detectMiloPostLoginLandmarks(page);
  let urlNow = page.url();

  if (isMiloPostLoginUrl(urlNow)) {
    return finalizeMiloLoginSuccess(page, landmarks, "milo_post_login_url");
  }

  if (!looksLikeLoginUrl(urlNow) && miloLandmarksSuggestAuthenticated(landmarks)) {
    return finalizeMiloLoginSuccess(page, landmarks, "milo_post_login_landmarks");
  }

  if (looksLikeLoginUrl(urlNow)) {
    await new Promise((r) => setTimeout(r, 1500));
    landmarks = await detectMiloPostLoginLandmarks(page);
    urlNow = page.url();
    if (isMiloPostLoginUrl(urlNow)) {
      return finalizeMiloLoginSuccess(page, landmarks, "milo_post_login_url_delayed");
    }
    if (!looksLikeLoginUrl(urlNow) && miloLandmarksSuggestAuthenticated(landmarks)) {
      return finalizeMiloLoginSuccess(
        page,
        landmarks,
        "milo_post_login_landmarks_delayed",
      );
    }
  }

  const captchaAfter = await detectCaptchaOrMfaSignals(page);
  if (captchaAfter.captchaFrame) {
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.CAPTCHA_OR_MFA,
      "Captcha iframe detected after submit",
      { captcha_or_mfa_signals: captchaAfter },
    );
  }

  if (captchaAfter.mfaHints && looksLikeLoginUrl(page.url())) {
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.CAPTCHA_OR_MFA,
      "MFA / verification copy detected while still on auth URL",
      { captcha_or_mfa_signals: captchaAfter },
    );
  }

  if (await hasObviousLoginError(page)) {
    const hint = await readInlineLoginErrorHint(page);
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.BAD_CREDENTIALS,
      "Authentication error message on sign-in page",
      { inline_error_hint: hint },
    );
  }

  const bodyAfter = (await getBodyTextExcerpt(page, 8000)) ?? "";
  if (
    looksLikeLoginUrl(page.url()) &&
    /must\s+accept|must\s+agree|check\s+the\s+box|accept\s+the\s+terms/i.test(
      bodyAfter,
    )
  ) {
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.AGREEMENT_NOT_CHECKED,
      "Page text indicates agreement/terms must be accepted",
      { body_excerpt: bodyAfter.slice(0, 1200) },
    );
  }

  const passwordField = page.locator('input[type="password"]').first();
  const passwordVisible = await passwordField.isVisible().catch(() => false);
  const stillOnLogin = looksLikeLoginUrl(page.url());

  if (stillOnLogin && passwordVisible) {
    const unchecked = await page
      .locator('input[type="checkbox"]:not(:checked)')
      .first()
      .isVisible()
      .catch(() => false);

    if (unchecked) {
      throw new MlccLoginFailure(
        MLCC_LOGIN_FAILURE_CLASS.AGREEMENT_NOT_CHECKED,
        "Still on login page with visible unchecked checkbox",
        { url: page.url() },
      );
    }

    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.BAD_CREDENTIALS,
      "Still on login URL with password field visible (likely failed auth or blocked submit)",
      { url: page.url() },
    );
  }

  if (stillOnLogin && !passwordVisible) {
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.POST_LOGIN_DETECTION_MISMATCH,
      "Still on auth URL but password field not visible — unexpected SPA state",
      { url: page.url() },
    );
  }

  landmarks = await detectMiloPostLoginLandmarks(page);
  if (miloLandmarksSuggestAuthenticated(landmarks)) {
    return finalizeMiloLoginSuccess(page, landmarks, "milo_post_login_landmarks_late");
  }

  if (!stillOnLogin && passwordVisible) {
    throw new MlccLoginFailure(
      MLCC_LOGIN_FAILURE_CLASS.POST_LOGIN_DETECTION_MISMATCH,
      "Left login URL but password field still visible — detection may need tuning",
      { url: page.url() },
    );
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

async function waitForReconContentReady(page, timeoutMs = 8000) {
  const start = Date.now();
  let lastMetrics = null;

  while (Date.now() - start < timeoutMs) {
    lastMetrics = await page
      .evaluate(() => {
        const textLen = (document.body?.innerText || "").trim().length;
        const rootChildren = document.body?.children?.length ?? 0;
        const interactive = document.querySelectorAll(
          "button,a[href],input,select,textarea,[role='button'],[role='tab']",
        ).length;
        const appRoot =
          document.querySelector("#root, #app, [data-reactroot], [ng-version]") != null;
        return { textLen, rootChildren, interactive, appRoot };
      })
      .catch(() => null);

    if (
      lastMetrics &&
      (lastMetrics.interactive > 4 ||
        lastMetrics.textLen > 300 ||
        (lastMetrics.appRoot && lastMetrics.rootChildren > 0))
    ) {
      break;
    }

    await new Promise((r) => setTimeout(r, 350));
  }

  return lastMetrics;
}

async function collectReconLandmarks(page) {
  return page.evaluate(() => {
    const textOf = (n) => (n?.textContent || n?.value || "").replace(/\s+/g, " ").trim();
    const sample = (arr, mapper, limit = 12) =>
      arr
        .map((x) => mapper(x))
        .filter(Boolean)
        .slice(0, limit);
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    };

    const inTopStrip = (el) => {
      if (!(el instanceof HTMLElement) || !isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < 240 && r.width > 0 && r.height > 0;
    };

    const inUpperAppChrome = (el, maxTopPx = 420) => {
      if (!(el instanceof HTMLElement) || !isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < maxTopPx && r.width > 0 && r.height > 0;
    };

    const allRoots = [document];
    const seen = new Set();
    const queue = [document.documentElement];

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.shadowRoot) {
        allRoots.push(node.shadowRoot);
        queue.push(node.shadowRoot);
      }
      if (node.children) {
        for (const child of node.children) queue.push(child);
      }
    }

    const collect = (selector) => {
      const out = [];
      for (const root of allRoots) {
        out.push(...Array.from(root.querySelectorAll(selector)));
      }
      return out;
    };

    const buttons = collect(
      "button,[role='button'],input[type='button'],input[type='submit'],[aria-label*='button' i]",
    ).filter(isVisible);
    const links = collect("a[href]").filter(isVisible);
    const forms = collect("form").filter(isVisible);
    const tables = collect("table,[role='table'],[role='grid'],[aria-label*='table' i]");
    const inputs = collect("input,select,textarea,[role='textbox'],[role='combobox']").filter(
      isVisible,
    );
    const headings = collect("h1,h2,h3,[role='heading']").filter(isVisible);
    const tabsLoose = collect("[role='tab'], nav a, [aria-label*='tab' i]").filter(isVisible);
    const lists = collect("ul,ol,[role='list'],[role='listbox']").filter(isVisible);
    const cards = collect("[class*='card' i],[data-testid*='card' i]").filter(isVisible);
    const iframes = collect("iframe");

    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    let chromeTextProbe = bodyText;
    for (const root of allRoots) {
      if (root === document) continue;
      try {
        chromeTextProbe += ` ${(root.textContent || "").replace(/\s+/g, " ").trim()}`;
      } catch {
        /* ignore detached shadow */
      }
      if (chromeTextProbe.length > 50000) break;
    }
    chromeTextProbe = chromeTextProbe.slice(0, 50000);
    const path = window.location.pathname || "";
    const pagePurposeHints = {
      choose_license_number: /CHOOSE\s+LICENSE\s+NUMBER/i.test(bodyText),
      products_orders_favorites_tabs:
        /Products/i.test(chromeTextProbe) &&
        /Orders/i.test(chromeTextProbe) &&
        /Favorites/i.test(chromeTextProbe),
      add_by_code_tab: /Add\s+By\s+Code/i.test(bodyText),
      place_order_visible: /Place\s+Order/i.test(bodyText),
      cart_visible: /\bCart\b/i.test(bodyText),
    };

    const chrome_nav_coherence_hints = [];
    if (pagePurposeHints.products_orders_favorites_tabs) {
      chrome_nav_coherence_hints.push("Orders", "Favorites");
    }

    const dedupeNav = (rows) => {
      const seenKey = new Set();
      const out = [];
      for (const row of rows) {
        const label = String(row.label || "").trim();
        if (!label || label.length > 120) continue;
        const href = row.href || "";
        const k = `${label.toLowerCase()}|${href}`;
        if (seenKey.has(k)) continue;
        seenKey.add(k);
        out.push({ ...row, label });
      }
      return out;
    };

    const navRows = [];

    for (const root of allRoots) {
      const tablists = root.querySelectorAll('[role="tablist"]');
      for (const tl of tablists) {
        const tabs = tl.querySelectorAll('[role="tab"], a[href], button');
        for (const el of tabs) {
          if (!isVisible(el)) continue;
          const label = textOf(el);
          if (!label) continue;
          const href =
            el.getAttribute("href") ||
            el.closest("a[href]")?.getAttribute?.("href") ||
            null;
          navRows.push({
            label,
            href,
            source: "tablist",
          });
        }
      }
    }

    for (const el of collect('[role="tab"]')) {
      if (!isVisible(el)) continue;
      const label = textOf(el);
      if (!label) continue;
      const href =
        el.getAttribute("href") ||
        el.closest("a[href]")?.getAttribute?.("href") ||
        null;
      navRows.push({ label, href, source: "role_tab" });
    }

    const navAnchors = collect(
      'nav[role="navigation"] a[href], nav a[href], header a[href], [role="banner"] a[href]',
    );
    for (const a of navAnchors) {
      if (!inUpperAppChrome(a, 360)) continue;
      const label = textOf(a);
      if (!label || label.length > 100) continue;
      navRows.push({
        label,
        href: a.getAttribute("href") || "",
        source: "top_strip_nav_link",
      });
    }

    for (const el of collect('[role="link"]')) {
      if (!inUpperAppChrome(el, 360) || !isVisible(el)) continue;
      const label = textOf(el);
      if (!label || label.length > 80) continue;
      navRows.push({
        label,
        href: el.getAttribute("href") || "",
        source: "role_link_top_strip",
      });
    }

    for (const el of collect('[role="tab"]')) {
      if (!inUpperAppChrome(el, 880)) continue;
      const label = textOf(el);
      if (!label || label.length > 80) continue;
      const href =
        el.getAttribute("href") ||
        el.closest("a[href]")?.getAttribute?.("href") ||
        null;
      navRows.push({
        label,
        href,
        source: "role_tab_upper_chrome",
      });
    }

    const knownNavPattern =
      /^(Home|Products|Orders|Favorites|Add By Code|Cart|Shopping Cart)$/i;

    const navLabelFromChromeString = (raw) => {
      const full = String(raw || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!full || full.length > 72) return null;
      const head = full.split(/[,:·|]/)[0].trim();
      for (const t of [head, full]) {
        const rules = [
          [/^add by code(\b|[\s,:-]|$)/i, "Add By Code"],
          [/^shopping\s*cart(\b|[\s,:-]|$)/i, "Cart"],
          [/^cart(\b|[\s,:-]|$)/i, "Cart"],
          [/^favorites?(\b|[\s,:-]|$)/i, "Favorites"],
          [/^orders(\b|[\s,:-]|$)/i, "Orders"],
          [/^products(\b|[\s,:-]|$)/i, "Products"],
          [/^home(\b|[\s,:-]|$)/i, "Home"],
        ];
        for (const [re, lab] of rules) {
          if (re.test(t)) return lab;
        }
        if (knownNavPattern.test(t)) return t.replace(/\s+/g, " ").trim();
      }
      return null;
    };

    const chromeAriaSelectors =
      'a[href],button,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
    for (const el of collect(chromeAriaSelectors)) {
      if (!isVisible(el) || !inUpperAppChrome(el, 880)) continue;
      for (const attr of ["aria-label", "title"]) {
        const raw = el.getAttribute(attr);
        const lab = navLabelFromChromeString(raw);
        if (!lab) continue;
        const href =
          el.getAttribute("href") ||
          el.closest("a[href]")?.getAttribute?.("href") ||
          null;
        navRows.push({
          label: lab,
          href,
          source: attr === "title" ? "chrome_title_upper" : "chrome_aria_label_upper",
        });
        break;
      }
    }

    const knownLabelAnchors = collect("a[href]").filter(
      (a) => isVisible(a) && inUpperAppChrome(a, 800),
    );
    for (const a of knownLabelAnchors) {
      const label = textOf(a);
      if (!label || !knownNavPattern.test(label.trim())) continue;
      navRows.push({
        label: label.trim(),
        href: a.getAttribute("href") || "",
        source: "known_label_upper_viewport_link",
      });
    }

    const navChromeButtons = collect(
      'button,[role="button"],[role="menuitem"]',
    ).filter((el) => isVisible(el) && inUpperAppChrome(el, 880));
    for (const el of navChromeButtons) {
      const label = textOf(el);
      if (!label || label.length > 64) continue;
      const trimmed = label.trim();
      if (!knownNavPattern.test(trimmed)) continue;
      navRows.push({
        label: trimmed,
        href: null,
        source: "known_label_upper_viewport_button",
      });
    }

    const miloTabPathToLabel = {
      "/milo/home": "Home",
      "/milo/products": "Products",
      "/milo/orders": "Orders",
      "/milo/favorites": "Favorites",
      "/milo/cart": "Cart",
      "/milo/products/bycode": "Add By Code",
    };
    const normalizeMiloPath = (pathname) => {
      const noQuery = pathname.split(/[#?]/)[0];
      const trimmed = noQuery.replace(/\/+$/, "") || "/";
      return trimmed.toLowerCase();
    };
    for (const a of collect("a[href]")) {
      if (!isVisible(a) || !inUpperAppChrome(a, 880)) continue;
      const href = (a.getAttribute("href") || "").trim();
      if (!href) continue;
      let pathOnly = href;
      try {
        if (href.startsWith("http")) pathOnly = new URL(href).pathname;
      } catch {
        continue;
      }
      const norm = normalizeMiloPath(pathOnly);
      const canonicalLabel = miloTabPathToLabel[norm];
      if (!canonicalLabel) continue;
      navRows.push({
        label: canonicalLabel,
        href: norm,
        source: "milo_tab_route_upper_viewport_link",
      });
    }

    for (const root of allRoots) {
      for (const tl of root.querySelectorAll('[role="tablist"]')) {
        for (const a of tl.querySelectorAll("a[href]")) {
          if (!isVisible(a)) continue;
          const href = (a.getAttribute("href") || "").trim();
          if (!href) continue;
          let pathOnly = href;
          try {
            if (href.startsWith("http")) pathOnly = new URL(href, window.location.href).pathname;
          } catch {
            continue;
          }
          const norm = normalizeMiloPath(pathOnly);
          const canonicalLabel = miloTabPathToLabel[norm];
          if (!canonicalLabel) continue;
          navRows.push({
            label: canonicalLabel,
            href: norm,
            source: "milo_tab_route_tablist_link",
          });
        }
      }
    }

    for (const img of collect("img[alt]")) {
      if (!isVisible(img) || !inUpperAppChrome(img, 880)) continue;
      const lab = navLabelFromChromeString(img.getAttribute("alt") || "");
      if (!lab) continue;
      const href = img.closest("a[href]")?.getAttribute("href") || null;
      navRows.push({
        label: lab,
        href,
        source: "chrome_img_alt_upper",
      });
    }

    for (const a of collect("a[href]")) {
      if (!isVisible(a)) continue;
      const cls = (typeof a.className === "string" ? a.className : String(a.className || "")).toLowerCase();
      if (!cls.includes("navbar__navigation")) continue;
      const href = (a.getAttribute("href") || "").trim();
      if (!href) continue;
      let pathOnly = href;
      try {
        if (href.startsWith("http")) pathOnly = new URL(href, window.location.href).pathname;
      } catch {
        continue;
      }
      const norm = normalizeMiloPath(pathOnly);
      const canonicalLabel = miloTabPathToLabel[norm];
      if (!canonicalLabel) continue;
      navRows.push({
        label: canonicalLabel,
        href: norm,
        source: "milo_tab_route_navbar_class_link",
      });
    }

    const chromeHostSelectors = 'header,[role="banner"],[role="tablist"],nav';
    for (const host of collect(chromeHostSelectors)) {
      if (!(host instanceof HTMLElement) || !isVisible(host)) continue;
      const hr = host.getBoundingClientRect();
      if (host.matches("nav") && hr.top > 360) continue;
      if (!host.matches('[role="tablist"]') && hr.top > 420) continue;
      for (const a of host.querySelectorAll("a[href]")) {
        if (!isVisible(a)) continue;
        const href = (a.getAttribute("href") || "").trim();
        if (!href) continue;
        let pathOnly = href;
        try {
          if (href.startsWith("http")) pathOnly = new URL(href, window.location.href).pathname;
        } catch {
          continue;
        }
        const norm = normalizeMiloPath(pathOnly);
        const canonicalLabel = miloTabPathToLabel[norm];
        if (!canonicalLabel) continue;
        navRows.push({
          label: canonicalLabel,
          href: norm,
          source: "milo_tab_route_chrome_host_link",
        });
      }
    }

    const topNavTabs = dedupeNav(navRows);

    const knownNavLabels = [
      "Home",
      "Products",
      "Orders",
      "Favorites",
      "Add By Code",
      "Cart",
    ];
    const bodyNavLabelChecks = [
      { label: "Home", re: /\bHome\b/ },
      { label: "Products", re: /\bProducts\b/ },
      { label: "Orders", re: /\bOrders\b/ },
      { label: "Favorites", re: /\bFavorites\b/ },
      { label: "Add By Code", re: /\bAdd By Code\b/ },
      { label: "Cart", re: /\bCart\b/ },
    ];
    const nav_labels_in_body_text = bodyNavLabelChecks
      .filter(({ re }) => re.test(bodyText))
      .map(({ label }) => label);

    const matchedKnownDom = knownNavLabels.filter((k) =>
      topNavTabs.some((t) => t.label.toLowerCase().includes(k.toLowerCase())),
    );
    const matchedKnownBody = knownNavLabels.filter((k) =>
      nav_labels_in_body_text.includes(k),
    );
    const matchedKnown = [
      ...new Set([...matchedKnownDom, ...matchedKnownBody]),
    ];

    const riskyRe =
      /add\s*to\s*cart|place\s*order|checkout|submit\s*order|buy\s*now|complete\s*order|confirm\s*order|finalize|purchase|pay\s*now/i;
    const riskySeen = new Set();
    const riskyObserved = [];
    for (const el of [...links, ...buttons]) {
      const t = textOf(el);
      if (!t || !riskyRe.test(t)) continue;
      const href = el.tagName === "A" ? el.getAttribute("href") || "" : null;
      const rk = `${t.slice(0, 120)}|${href || ""}`;
      if (riskySeen.has(rk)) continue;
      riskySeen.add(rk);
      riskyObserved.push({
        kind: el.tagName === "A" ? "link" : "button",
        text: t.slice(0, 160),
        href,
        observed_only: true,
      });
    }

    const primaryCtas = [];
    for (const el of buttons) {
      const t = textOf(el);
      if (!t || riskyRe.test(t)) continue;
      const compact = t.replace(/\s+/g, " ").trim();
      if (compact.length <= 2 && /^[×✕x]$/i.test(compact)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < 120) continue;
      primaryCtas.push(t.slice(0, 120));
      if (primaryCtas.length >= 15) break;
    }

    const searchFilter = [];
    for (const el of inputs) {
      const ph = (el.getAttribute("placeholder") || "").trim();
      const nm = (el.getAttribute("name") || "").trim();
      const al = (el.getAttribute("aria-label") || "").trim();
      const combined = `${ph} ${nm} ${al}`;
      if (!/search|filter|find|lookup|query/i.test(combined)) continue;
      searchFilter.push({
        type: el.getAttribute("type") || el.tagName.toLowerCase(),
        name: nm || null,
        placeholder: ph || null,
        aria_label: al || null,
      });
      if (searchFilter.length >= 12) break;
    }

    let pagePurpose = "milo_authenticated_area";
    if (path.includes("/milo/home")) pagePurpose = "milo_home_dashboard";
    else if (path.includes("/milo/location")) pagePurpose = "milo_license_selection";
    else if (path.includes("/milo/products")) pagePurpose = "milo_product_catalog";
    else if (path.includes("/milo/cart")) pagePurpose = "milo_shopping_cart";

    const majorRegions = {
      main: collect("main,[role='main']").length > 0,
      navigation: collect("nav,[role='navigation']").length > 0,
      complementary: collect("aside,[role='complementary']").length > 0,
      sample_headings: sample(
        headings.filter((n) => /^(H1|H2)$/i.test(n.tagName)),
        (n) => textOf(n).slice(0, 120),
        10,
      ),
    };

    const cartChromeSeen = new Set();
    const cart_chrome_observed = [];
    for (const a of collect("a[href]")) {
      if (!isVisible(a) || !inUpperAppChrome(a, 880)) continue;
      const href = (a.getAttribute("href") || "").trim();
      if (!href) continue;
      let pathOnly = href;
      try {
        pathOnly = new URL(href, window.location.href).pathname;
      } catch {
        continue;
      }
      if (!/^\/milo\/cart(\/|$)/i.test(pathOnly)) continue;
      const k = `${a.getAttribute("aria-label") || ""}|${a.getAttribute("title") || ""}|${textOf(a).slice(0, 40)}`;
      if (cartChromeSeen.has(k)) continue;
      cartChromeSeen.add(k);
      cart_chrome_observed.push({
        aria_label: (a.getAttribute("aria-label") || "").trim().slice(0, 160) || null,
        title: (a.getAttribute("title") || "").trim().slice(0, 160) || null,
        visible_text_sample: textOf(a).replace(/\s+/g, " ").trim().slice(0, 48) || null,
        href_path_sample: pathOnly.slice(0, 96),
      });
      if (cart_chrome_observed.length >= 8) break;
    }

    let add_by_code_entry_observed = null;
    if (/\/milo\/products/i.test(path)) {
      const codeish = inputs.filter((i) => {
        const blob = `${i.getAttribute("placeholder") || ""} ${i.getAttribute("name") || ""} ${i.getAttribute("aria-label") || ""}`.toLowerCase();
        return /code|sku|item|product\s*#|style/.test(blob);
      });
      const bycodeLinks = links.filter((a) =>
        /bycode|by-code|add.*code/i.test(a.getAttribute("href") || ""),
      ).length;
      add_by_code_entry_observed = {
        visible_links_to_bycode_href: bycodeLinks,
        codeish_input_samples: sample(
          codeish,
          (n) => ({
            type: n.getAttribute("type") || n.tagName.toLowerCase(),
            name: (n.getAttribute("name") || "").trim().slice(0, 80) || null,
            placeholder: (n.getAttribute("placeholder") || "").trim().slice(0, 120) || null,
            aria_label: (n.getAttribute("aria-label") || "").trim().slice(0, 120) || null,
          }),
          10,
        ),
      };
    }

    let license_selection_observed = null;
    if (path.includes("/milo/location")) {
      const licInputs = inputs.filter((i) => {
        const blob = `${i.getAttribute("placeholder") || ""} ${i.getAttribute("aria-label") || ""} ${i.getAttribute("name") || ""}`;
        return /license|group\s*name|store/i.test(blob);
      });
      const rowish = collect('tr,[role="row"]').filter(isVisible).length;
      license_selection_observed = {
        license_or_store_like_inputs: licInputs.length,
        visible_row_like_count: Math.min(rowish, 500),
        list_like_containers: collect("ul,ol,[role='list'],[role='listbox']").filter(isVisible)
          .length,
      };
    }

    const operational_entry_points = [];
    if (searchFilter.length) {
      operational_entry_points.push({
        kind: "search_or_filter",
        note: "Search/filter fields present (see search_filter_controls)",
      });
    }
    if (cart_chrome_observed.length) {
      operational_entry_points.push({
        kind: "cart_chrome",
        note: "Cart affordance in upper chrome (see cart_chrome_observed)",
      });
    }
    if (add_by_code_entry_observed?.visible_links_to_bycode_href) {
      operational_entry_points.push({
        kind: "add_by_code",
        note: "Route or fields related to add-by-code (see add_by_code_entry_observed)",
      });
    }
    if (license_selection_observed?.license_or_store_like_inputs) {
      operational_entry_points.push({
        kind: "license_selection",
        note: "License / store selection inputs (see license_selection_observed)",
      });
    }
    if (riskyObserved.length) {
      operational_entry_points.push({
        kind: "risky_controls_visible",
        observed_texts_sample: riskyObserved.slice(0, 6).map((r) => r.text),
      });
    }
    if (path.includes("/milo/cart")) {
      operational_entry_points.push({
        kind: "cart_route_surface",
        note: "On MILO cart route; chrome links may be icon-only (see cart_chrome_observed, nav rows)",
      });
    }

    const semantic = {
      page_purpose: pagePurpose,
      page_purpose_hints: pagePurposeHints,
      chrome_nav_coherence_hints,
      top_nav_tabs: topNavTabs,
      known_nav_labels_matched: matchedKnown,
      known_nav_labels_matched_dom_only: matchedKnownDom,
      nav_labels_in_body_text,
      search_filter_controls: searchFilter,
      major_content_regions: majorRegions,
      primary_ctas_observed_non_risky_sample: primaryCtas.slice(0, 15),
      risky_controls_observed: riskyObserved.slice(0, 40),
      cart_chrome_observed,
      add_by_code_entry_observed,
      license_selection_observed,
      operational_entry_points,
    };

    return {
      url: window.location.href,
      title: document.title || null,
      render_stats: {
        body_text_length: bodyText.length,
        shadow_root_count: Math.max(0, allRoots.length - 1),
        iframe_count: iframes.length,
      },
      controls: {
        buttons: buttons.length,
        links: links.length,
        forms: forms.length,
        tables: tables.length,
        inputs: inputs.length,
        headings: headings.length,
        tabs_or_nav_items: topNavTabs.length,
        lists: lists.length,
        cards: cards.length,
      },
      landmarks: {
        main_exists: collect("main,[role='main']").length > 0,
        nav_exists: collect("nav,[role='navigation']").length > 0,
        header_exists: collect("header,[role='banner']").length > 0,
        footer_exists: collect("footer,[role='contentinfo']").length > 0,
        page_purpose_hints: pagePurposeHints,
      },
      semantic,
      inventory: {
        headings: sample(headings, (n) => textOf(n), 16),
        nav_or_tabs: topNavTabs.map((t) => t.label).slice(0, 24),
        primary_buttons: sample(buttons, (n) => textOf(n), 20),
        primary_links: sample(
          links,
          (n) => `${textOf(n)}|${n.getAttribute("href") || ""}`,
          20,
        ),
        input_hints: sample(
          inputs,
          (n) =>
            `${n.getAttribute("name") || ""}|${n.getAttribute("placeholder") || ""}|${n.getAttribute("aria-label") || ""}`,
          20,
        ),
        table_or_grid_markers: sample(
          tables,
          (n) => n.getAttribute("id") || n.getAttribute("class") || n.getAttribute("role") || "table",
          12,
        ),
        tabs_loose_count_legacy: tabsLoose.length,
      },
    };
  });
}

function normalizeNavMergeKey(label) {
  const s = String(label || "")
    .trim()
    .toLowerCase();
  if (s === "shopping cart") return "cart";
  if (s === "favorite") return "favorites";
  return s;
}

function canonicalTabDisplayLabel(label) {
  const l = String(label || "").trim();
  if (/^shopping cart$/i.test(l)) return "Cart";
  if (/^favorite$/i.test(l)) return "Favorites";
  return l;
}

function mergeTopNavTabRows(existing, incoming) {
  const sourceRank = (s) => {
    const order = [
      "milo_tab_route_upper_viewport_link",
      "milo_tab_route_tablist_link",
      "milo_tab_route_chrome_host_link",
      "milo_tab_route_navbar_class_link",
      "chrome_img_alt_upper",
      "top_strip_nav_link",
      "chrome_aria_label_upper",
      "chrome_title_upper",
      "role_link_top_strip",
      "known_label_upper_viewport_link",
      "known_label_upper_viewport_button",
      "role_tab_upper_chrome",
      "role_tab",
      "tablist",
      "playwright_ax_tree",
      "playwright_milo_tab_path_anchor",
      "playwright_role_tab",
      "playwright_known_chrome_button",
    ];
    const i = order.indexOf(s);
    return i >= 0 ? i : -1;
  };
  const pickBetter = (a, b) => {
    const ha = String(a.href || "").trim();
    const hb = String(b.href || "").trim();
    if (ha && !hb) return a;
    if (hb && !ha) return b;
    const ra = sourceRank(a.source);
    const rb = sourceRank(b.source);
    return ra <= rb ? a : b;
  };
  const combined = [...(existing || []), ...(incoming || [])];
  const byLabel = new Map();
  const orderKeys = [];
  for (const row of combined) {
    const label = canonicalTabDisplayLabel(String(row.label || "").trim());
    if (!label || label.length > 120) continue;
    const key = normalizeNavMergeKey(label);
    const rowNorm = { ...row, label };
    const prev = byLabel.get(key);
    if (!prev) {
      byLabel.set(key, rowNorm);
      orderKeys.push(key);
      continue;
    }
    byLabel.set(key, pickBetter(prev, rowNorm));
  }
  return orderKeys.map((k) => byLabel.get(k));
}

function normalizeMiloPathnameForTabs(pathname) {
  const noQuery = pathname.split(/[#?]/)[0];
  const trimmed = noQuery.replace(/\/+$/, "") || "/";
  return trimmed.toLowerCase();
}

const MILO_TAB_PATH_TO_LABEL = {
  "/milo/home": "Home",
  "/milo/products": "Products",
  "/milo/orders": "Orders",
  "/milo/favorites": "Favorites",
  "/milo/cart": "Cart",
  "/milo/products/bycode": "Add By Code",
};

function canonicalNavLabelFromAxName(name) {
  const full = String(name || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!full || full.length > 120) return null;
  const head = full.split(/[,:·|]/)[0].trim();
  const candidates = head.length >= 2 && head !== full ? [head, full] : [full];
  for (const t of candidates) {
    if (t.length > 80) continue;
    const rules = [
      [/^add by code(\b|[\s,:-]|$)/i, "Add By Code"],
      [/^shopping\s*cart(\b|[\s,:-]|$)/i, "Cart"],
      [/^cart(\b|[\s,:-]|$)/i, "Cart"],
      [/^favorites?(\b|[\s,:-]|$)/i, "Favorites"],
      [/^orders(\b|[\s,:-]|$)/i, "Orders"],
      [/^products(\b|[\s,:-]|$)/i, "Products"],
      [/^home(\b|[\s,:-]|$)/i, "Home"],
    ];
    for (const [re, lab] of rules) {
      if (re.test(t)) return lab;
    }
    if (/^(Home|Products|Orders|Favorites|Add By Code|Cart|Shopping Cart)$/i.test(t)) {
      return canonicalTabDisplayLabel(t);
    }
  }
  return null;
}

function miloPathNavHints(pathname) {
  const path = pathname.toLowerCase();
  const hints = [];
  if (path.includes("/milo/cart")) hints.push("Cart");
  if (path.includes("/milo/products/bycode")) hints.push("Add By Code");
  else if (path.includes("/milo/products")) hints.push("Products");
  if (path.includes("/milo/orders")) hints.push("Orders");
  if (path.includes("/milo/favorites")) hints.push("Favorites");
  if (path.includes("/milo/home")) hints.push("Home");
  return hints;
}

function navLabelStronglyPresentForPathHint(sem, merged, canonicalLabel) {
  const k = canonicalLabel.toLowerCase();
  if ((sem.nav_labels_in_body_text || []).some((b) => b.toLowerCase() === k)) {
    return true;
  }
  for (const t of merged || []) {
    const L = String(t.label || "").trim().toLowerCase();
    if (!L) continue;
    if (L === k) return true;
    if (k === "cart" && (L === "shopping cart" || L.includes("cart"))) return true;
    if (k === "favorites" && L.startsWith("favorite")) return true;
  }
  return false;
}

function syncReconSemanticNavDerivedFields(summary) {
  const sem = summary?.semantic;
  if (!sem) return;
  const merged = sem.top_nav_tabs || [];
  if (summary.controls) {
    summary.controls.tabs_or_nav_items = merged.length;
  }
  const knownNavOrder = [
    "Home",
    "Products",
    "Orders",
    "Favorites",
    "Add By Code",
    "Cart",
  ];
  let pathHintsRaw = [];
  try {
    pathHintsRaw = miloPathNavHints(new URL(summary.url || "about:blank").pathname);
  } catch {
    pathHintsRaw = [];
  }
  const pathHints = pathHintsRaw.filter(
    (h) => !navLabelStronglyPresentForPathHint(sem, merged, h),
  );
  const combined = new Set([
    ...merged.map((t) => canonicalTabDisplayLabel(String(t.label || "").trim())).filter(Boolean),
    ...(sem.nav_labels_in_body_text || []),
    ...(sem.chrome_nav_coherence_hints || []),
    ...pathHints,
  ]);
  sem.top_nav_ordered_labels = knownNavOrder.filter((k) => combined.has(k));
  if (summary.inventory) {
    summary.inventory.nav_or_tabs = sem.top_nav_ordered_labels.slice(0, 24);
  }
  const knownNavLabels = [
    "Home",
    "Products",
    "Orders",
    "Favorites",
    "Add By Code",
    "Cart",
  ];
  const matchedKnownDom = knownNavLabels.filter((k) =>
    merged.some((t) => t.label.toLowerCase().includes(k.toLowerCase())),
  );
  sem.known_nav_labels_matched_dom_only = matchedKnownDom;
  const bodySet = new Set(sem.nav_labels_in_body_text || []);
  const coherenceSet = sem.chrome_nav_coherence_hints || [];
  sem.known_nav_labels_matched = [
    ...new Set([...matchedKnownDom, ...bodySet, ...pathHints, ...coherenceSet]),
  ];
  sem.milo_readonly_inventory = {
    page_purpose: sem.page_purpose,
    top_navigation_tab_labels_ordered: sem.top_nav_ordered_labels,
    top_navigation_dom_rows: merged,
    chrome_nav_coherence_hints_readonly:
      sem.chrome_nav_coherence_hints?.length ? sem.chrome_nav_coherence_hints : null,
    primary_cta_controls_observed: sem.primary_ctas_observed_non_risky_sample || [],
    search_or_filter_controls: sem.search_filter_controls || [],
    major_content_landmarks: sem.major_content_regions || {},
    risky_controls_observed_not_clicked: sem.risky_controls_observed || [],
    path_context_nav_hints_gapfill_only: pathHints,
    cart_chrome_observed: sem.cart_chrome_observed || [],
    add_by_code_entry_observed: sem.add_by_code_entry_observed,
    license_selection_observed: sem.license_selection_observed,
    operational_entry_points: sem.operational_entry_points || [],
    operational_surface_deep_map: sem.operational_surface_deep_map || null,
  };
}

async function enrichReconTopNavFromAccessibilityTree(page, summary) {
  const sem = summary?.semantic;
  if (!sem) return;
  const axRoles = new Set(["tab", "link", "button", "menuitem"]);
  const extra = [];
  const walk = (node) => {
    if (!node) return;
    const { role, name, children } = node;
    const nm = String(name || "")
      .replace(/\s+/g, " ")
      .trim();
    if (role && axRoles.has(role) && nm) {
      const lab = canonicalNavLabelFromAxName(nm);
      if (lab) {
        extra.push({
          label: lab,
          href: null,
          source: "playwright_ax_tree",
          ax_role: role,
          raw_accessible_name: nm.slice(0, 120),
        });
      }
    }
    for (const c of children || []) walk(c);
  };
  try {
    for (const frame of page.frames()) {
      const snap = await frame
        .accessibility.snapshot({ interestingOnly: false })
        .catch(() => null);
      walk(snap);
    }
  } catch {
    /* cross-origin or transient ax failures */
  }
  sem.top_nav_tabs = mergeTopNavTabRows(sem.top_nav_tabs || [], extra);
  syncReconSemanticNavDerivedFields(summary);
}

async function enrichReconTopNavFromPlaywrightTabs(page, summary) {
  const sem = summary?.semantic;
  if (!sem) return;
  const base = page.url();
  const extra = [];
  try {
    const tabs = page.getByRole("tab");
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const tab = tabs.nth(i);
      if (!(await tab.isVisible().catch(() => false))) continue;
      let name =
        (await tab.getAttribute("aria-label").catch(() => null)) ||
        (await tab.getAttribute("title").catch(() => null)) ||
        (await tab.innerText().catch(() => null)) ||
        "";
      name = name.replace(/\s+/g, " ").trim();
      if (!name || name.length > 100) continue;
      let href =
        (await tab.locator("a[href]").first().getAttribute("href").catch(() => null)) ||
        (await tab
          .evaluate((el) => el.closest("a")?.getAttribute("href") || null)
          .catch(() => null));
      if (href) {
        try {
          href = new URL(href, base).pathname;
        } catch {
          /* keep href as-is */
        }
      } else {
        href = null;
      }
      extra.push({
        label: name.slice(0, 120),
        href,
        source: "playwright_role_tab",
      });
    }
  } catch {
    /* ignore a11y/DOM edge cases */
  }
  sem.top_nav_tabs = mergeTopNavTabRows(sem.top_nav_tabs || [], extra);
  syncReconSemanticNavDerivedFields(summary);
}

async function enrichReconTopNavFromPlaywrightMiloTabAnchors(page, summary) {
  const sem = summary?.semantic;
  if (!sem) return;
  const base = page.url();
  const extra = [];
  try {
    const loc = page.locator("a[href]");
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const a = loc.nth(i);
      if (!(await a.isVisible().catch(() => false))) continue;
      const hrefRaw = await a.getAttribute("href");
      if (!hrefRaw) continue;
      let pathOnly;
      try {
        pathOnly = new URL(hrefRaw, base).pathname;
      } catch {
        continue;
      }
      const norm = normalizeMiloPathnameForTabs(pathOnly);
      const canonical = MILO_TAB_PATH_TO_LABEL[norm];
      if (!canonical) continue;
      const box = await a.boundingBox().catch(() => null);
      if (!box || box.width <= 0 || box.height <= 0) continue;
      const inUpperChrome = box.y >= -12 && box.y < 880;
      const compactControl =
        box.width <= 260 && box.height <= 160 && box.y < 520;
      if (!inUpperChrome && !compactControl) continue;
      extra.push({
        label: canonical,
        href: norm,
        source: "playwright_milo_tab_path_anchor",
      });
    }
  } catch {
    /* ignore */
  }
  sem.top_nav_tabs = mergeTopNavTabRows(sem.top_nav_tabs || [], extra);
  syncReconSemanticNavDerivedFields(summary);
}

async function enrichReconTopNavFromPlaywrightKnownChromeButtons(page, summary) {
  const sem = summary?.semantic;
  if (!sem) return;
  const knownNavPattern =
    /^(Home|Products|Orders|Favorites|Add By Code|Cart|Shopping Cart)$/i;
  const extra = [];
  try {
    const loc = page.locator('button,[role="button"]');
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const b = loc.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const al = (await b.getAttribute("aria-label").catch(() => null)) || "";
      const txt = (await b.innerText().catch(() => null)) || "";
      const cand = al.replace(/\s+/g, " ").trim() || txt.replace(/\s+/g, " ").trim();
      if (!cand || !knownNavPattern.test(cand)) continue;
      const box = await b.boundingBox().catch(() => null);
      if (!box || box.y < -12 || box.y >= 880) continue;
      extra.push({
        label: cand,
        href: null,
        source: "playwright_known_chrome_button",
      });
    }
  } catch {
    /* ignore */
  }
  sem.top_nav_tabs = mergeTopNavTabRows(sem.top_nav_tabs || [], extra);
  syncReconSemanticNavDerivedFields(summary);
}

function flattenAxSnapshot(node, acc, max, depth, maxDepth) {
  if (!node || acc.length >= max || depth > maxDepth) return;
  const { role, name, value, children } = node;
  if (role || name) {
    acc.push({
      depth,
      role: role || null,
      name: name ? String(name).slice(0, 160) : null,
      value: value != null ? String(value).slice(0, 80) : null,
    });
  }
  for (const c of children || []) {
    flattenAxSnapshot(c, acc, max, depth + 1, maxDepth);
  }
}

/**
 * Read-only diagnostic: top strip / app chrome DOM + a11y excerpts (no clicks).
 * Used to wire matchers for Orders / Favorites / cart and to archive what live MILO exposes.
 */
async function collectTopStripChromeExport(page) {
  const MAX_TOP = 900;
  const viewport = typeof page.viewportSize === "function" ? page.viewportSize() : null;
  const frames = page.frames();
  const outFrames = [];
  const axExcerpts = [];

  for (const frame of frames) {
    const domPart = await frame
      .evaluate((maxTop) => {
        const textOf = (n) =>
          (n?.textContent || n?.value || "").replace(/\s+/g, " ").trim();
        const isVisible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        };
        const allRoots = [document];
        const seen = new Set();
        const queue = [document.documentElement];
        while (queue.length > 0) {
          const node = queue.shift();
          if (!node || seen.has(node)) continue;
          seen.add(node);
          if (node.shadowRoot) {
            allRoots.push(node.shadowRoot);
            queue.push(node.shadowRoot);
          }
          if (node.children) {
            for (const child of node.children) queue.push(child);
          }
        }
        const collect = (selector) => {
          const out = [];
          for (const root of allRoots) {
            out.push(...Array.from(root.querySelectorAll(selector)));
          }
          return out;
        };

        const resolveLabelledBy = (el) => {
          const ref = el.getAttribute("aria-labelledby");
          if (!ref) return null;
          const r = el.getRootNode();
          const parts = ref
            .trim()
            .split(/\s+/)
            .map((id) => {
              let n = null;
              try {
                if (r && /** @type {any} */ (r).getElementById) {
                  n = /** @type {Document | ShadowRoot} */ (r).getElementById(id);
                }
              } catch {
                n = null;
              }
              if (!n && typeof document !== "undefined") {
                try {
                  n = document.getElementById(id);
                } catch {
                  n = null;
                }
              }
              return n ? textOf(n).slice(0, 100) : "";
            })
            .filter(Boolean);
          const joined = parts.join(" ").slice(0, 220);
          return joined || null;
        };

        const dataAttrs = (el) => {
          const out = {};
          if (!el.attributes) return out;
          for (let i = 0; i < el.attributes.length && Object.keys(out).length < 14; i++) {
            const { name, value } = el.attributes[i];
            if (name.startsWith("data-")) {
              out[name] = String(value).slice(0, 96);
            }
          }
          return out;
        };

        const sel =
          'a[href],button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],img[alt],svg';
        const candidates = [];
        for (const el of collect(sel)) {
          if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.top < -8 || r.top >= maxTop || r.width < 1 || r.height < 1) continue;
          candidates.push({ el, top: r.top, area: r.width * r.height });
        }
        candidates.sort((a, b) => a.top - b.top || a.area - b.area);
        const picked = candidates.slice(0, 42);
        const narrowTop = 340;
        const pickedNarrow = candidates.filter((c) => c.top < narrowTop).slice(0, 24);

        const mapEl = (el) => {
          const tag = el.tagName.toLowerCase();
          const roleAttr = el.getAttribute("role") || "";
          const r = el.getBoundingClientRect();
          return {
            tag,
            role: roleAttr || null,
            id: (el.id || "").slice(0, 88) || null,
            class:
              (typeof el.className === "string" ? el.className : String(el.className || "")).slice(
                0,
                120,
              ) || null,
            aria_label: el.getAttribute("aria-label")?.slice(0, 180) || null,
            aria_labelledby_resolved: resolveLabelledBy(el),
            title: el.getAttribute("title")?.slice(0, 180) || null,
            alt: el.getAttribute("alt")?.slice(0, 180) || null,
            href: el.getAttribute("href")?.slice(0, 220) || null,
            text: textOf(el).slice(0, 140) || null,
            data: dataAttrs(el),
            rect: { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) },
          };
        };

        const dom_excerpt = picked.map(({ el }) => mapEl(el));
        const dom_excerpt_narrow_top_px = pickedNarrow.map(({ el }) => mapEl(el));

        let visible_text_strip = "";
        let visible_text_narrow_top = "";
        try {
          visible_text_strip = Array.from(
            new Set(picked.map(({ el }) => textOf(el).slice(0, 72)).filter(Boolean)),
          )
            .join(" | ")
            .slice(0, 2400);
          visible_text_narrow_top = Array.from(
            new Set(pickedNarrow.map(({ el }) => textOf(el).slice(0, 72)).filter(Boolean)),
          )
            .join(" | ")
            .slice(0, 1200);
        } catch {
          visible_text_strip = "";
          visible_text_narrow_top = "";
        }

        return {
          dom_excerpt,
          dom_excerpt_narrow_top_px,
          narrow_top_cutoff_px: narrowTop,
          visible_text_strip,
          visible_text_narrow_top,
          max_top_px: maxTop,
        };
      }, MAX_TOP)
      .catch((e) => ({
        error: String(e?.message || e).slice(0, 240),
        dom_excerpt: [],
        dom_excerpt_narrow_top_px: [],
        narrow_top_cutoff_px: 340,
        visible_text_strip: "",
        visible_text_narrow_top: "",
        max_top_px: MAX_TOP,
      }));

    outFrames.push({
      is_main: frame === page.mainFrame(),
      frame_url: frame.url(),
      ...domPart,
    });

    const acc = [];
    let snap = null;
    if (frame === page.mainFrame() && page.accessibility?.snapshot) {
      snap = await page.accessibility.snapshot({ interestingOnly: false }).catch(() => null);
    }
    flattenAxSnapshot(snap, acc, 140, 0, 16);
    const interestRe = /\b(order|favorite|cart|product|home|code)\b/i;
    const interesting = acc
      .filter((n) => n.name && (interestRe.test(n.name) || interestRe.test(n.role || "")))
      .slice(0, 72);
    axExcerpts.push({
      frame_url: frame.url(),
      is_main: frame === page.mainFrame(),
      a11y_skipped: frame !== page.mainFrame(),
      a11y_nodes_matching_interest_hint: interesting,
      a11y_shallow_excerpt: acc.slice(0, 36),
    });
  }

  return {
    kind: "mlcc_top_strip_chrome_export_readonly",
    collected_at: new Date().toISOString(),
    viewport,
    max_top_px: MAX_TOP,
    frames: outFrames,
    ax_excerpts: axExcerpts,
  };
}

/**
 * Read-only, route-specific deep map for license / add-by-code / cart surfaces (no clicks).
 */
async function collectOperationalSurfaceDeepMap(page) {
  return page.evaluate(() => {
    const textOf = (n) =>
      (n?.textContent || n?.value || "").replace(/\s+/g, " ").trim();
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    };

    const allRoots = [document];
    const seen = new Set();
    const queue = [document.documentElement];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.shadowRoot) {
        allRoots.push(node.shadowRoot);
        queue.push(node.shadowRoot);
      }
      if (node.children) {
        for (const child of node.children) queue.push(child);
      }
    }

    const collect = (selector) => {
      const out = [];
      for (const root of allRoots) {
        out.push(...Array.from(root.querySelectorAll(selector)));
      }
      return out;
    };

    const path = window.location.pathname || "";
    const bodyInner = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const result = {
      page_path: path,
      license_selection_surface: null,
      add_by_code_surface: null,
      cart_validate_surface: null,
    };

    const riskyBtn =
      /add\s*to\s*cart|place\s*order|checkout|submit|finalize|confirm\s*order|buy\s*now|purchase|pay\s*now/i;

    if (path.includes("/milo/location")) {
      const inputs = collect("input,select,textarea").filter(isVisible);
      const search_fields = [];
      for (const el of inputs) {
        const ph = (el.getAttribute("placeholder") || "").trim();
        const nm = (el.getAttribute("name") || "").trim();
        const al = (el.getAttribute("aria-label") || "").trim();
        const id = el.id || "";
        const blob = `${ph} ${nm} ${al} ${id}`.toLowerCase();
        if (!/search|license|group|filter|find|lookup|store|location/i.test(blob)) continue;
        const r = el.getBoundingClientRect();
        search_fields.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || el.tagName.toLowerCase(),
          id: id.slice(0, 80) || null,
          name: nm.slice(0, 120) || null,
          placeholder: ph.slice(0, 200) || null,
          aria_label: al.slice(0, 200) || null,
          rect_top: Math.round(r.top),
        });
        if (search_fields.length >= 14) break;
      }

      const tables = collect("table").filter(isVisible);
      let data_row_samples = [];
      const role_row_visible_count = collect('[role="row"]').filter(isVisible).length;
      if (tables[0]) {
        const trs = Array.from(tables[0].querySelectorAll("tr")).filter(isVisible).slice(0, 12);
        data_row_samples = trs.map((tr) => textOf(tr).slice(0, 200));
      }

      let place_order_observed = null;
      for (const el of collect('button,[role="button"],a[href]')) {
        if (!isVisible(el)) continue;
        const t = textOf(el);
        if (!/place\s*order/i.test(t)) continue;
        const r = el.getBoundingClientRect();
        const par = el.parentElement;
        place_order_observed = {
          observed_only: true,
          text: t.slice(0, 120),
          tag: el.tagName.toLowerCase(),
          class:
            (typeof el.className === "string" ? el.className : String(el.className || "")).slice(0, 160) ||
            null,
          rect_top: Math.round(r.top),
          parent_tag: par?.tagName?.toLowerCase() || null,
          parent_class:
            (par && typeof par.className === "string" ? par.className : String(par.className || "")).slice(
              0,
              160,
            ) || null,
          nearest_container_class:
            el.closest("section,form,div[class]")?.className?.slice?.(0, 160) || null,
        };
        break;
      }

      const pagination_tokens = collect("a,button")
        .filter(isVisible)
        .filter((el) => {
          const t = textOf(el);
          return (
            /^[«»<>]{1,3}$/.test(t) ||
            /\bcurrent\b/i.test(t) ||
            /\(\s*current\s*\)/i.test(t)
          );
        })
        .slice(0, 16)
        .map((el) => ({
          text: textOf(el).slice(0, 40),
          tag: el.tagName.toLowerCase(),
        }));

      result.license_selection_surface = {
        search_fields,
        table_count_visible: tables.length,
        tbody_tr_visible_estimate: tables[0]
          ? Array.from(tables[0].querySelectorAll("tbody tr")).filter(isVisible).length
          : 0,
        data_row_text_samples: data_row_samples,
        role_row_visible_count: Math.min(role_row_visible_count, 800),
        pagination_or_page_controls_sample: pagination_tokens,
        place_order_observed,
        body_text_preview: bodyInner.slice(0, 700),
      };
    }

    if (path.includes("/milo/products")) {
      const isBycode = path.includes("/bycode");
      const bycodeAnchors = collect("a[href]")
        .filter(isVisible)
        .filter((a) => /bycode|by-code|add.*code/i.test(a.getAttribute("href") || ""))
        .slice(0, 12)
        .map((a) => ({
          href: (a.getAttribute("href") || "").slice(0, 220),
          text: textOf(a).slice(0, 120),
        }));

      const modals = collect('[role="dialog"],.modal,.modal-dialog').filter(isVisible);
      const inputs = collect(
        'input,select,textarea,[role="textbox"],[role="combobox"]',
      ).filter(isVisible);
      const input_inventory = inputs.slice(0, 35).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || null,
        id: (el.id || "").slice(0, 80) || null,
        name: (el.getAttribute("name") || "").trim().slice(0, 100) || null,
        placeholder: (el.getAttribute("placeholder") || "").slice(0, 160) || null,
        aria_label: (el.getAttribute("aria-label") || "").slice(0, 160) || null,
      }));

      const buttons = collect(
        'button,[role="button"],input[type="button"],input[type="submit"]',
      )
        .filter(isVisible)
        .slice(0, 45);
      const button_inventory = buttons.map((el) => {
        const t = textOf(el);
        return {
          text: t.slice(0, 120),
          tag: el.tagName.toLowerCase(),
          type_attr: el.getAttribute("type") || null,
          class:
            (typeof el.className === "string" ? el.className : String(el.className || "")).slice(0, 120) ||
            null,
          risky_observed: riskyBtn.test(t),
        };
      });

      const labels_help = collect("label")
        .filter(isVisible)
        .slice(0, 20)
        .map((l) => textOf(l).slice(0, 160));

      let exposure = "unknown_or_dynamic";
      if (isBycode) exposure = "dedicated_route";
      else if (bycodeAnchors.length) exposure = "linked_from_catalog_via_href";

      result.add_by_code_surface = {
        route_is_dedicated_bycode_page: isBycode,
        exposure,
        anchors_to_bycode_sample: bycodeAnchors,
        visible_modal_or_panel_count: modals.length,
        modal_class_samples: modals
          .slice(0, 4)
          .map((m) =>
            (typeof m.className === "string" ? m.className : String(m.className || "")).slice(0, 140),
          ),
        input_inventory,
        button_inventory,
        label_text_samples: labels_help,
        form_visible_count: collect("form").filter(isVisible).length,
        body_text_preview: bodyInner.slice(0, 700),
      };
    }

    if (path.includes("/milo/cart")) {
      const tables = collect("table").filter(isVisible);
      let line_estimate = 0;
      for (const tb of tables.slice(0, 3)) {
        line_estimate += Array.from(tb.querySelectorAll("tbody tr")).filter(isVisible).length;
      }
      const empty_hint =
        /\b(empty|no\s+items|your\s+cart\s+is\s+empty|nothing\s+in\s+your\s+cart)\b/i.test(
          bodyInner,
        );

      const validate_or_checkout_hints = [];
      for (const el of collect('button,a[href],[role="button"]')) {
        if (!isVisible(el)) continue;
        const t = textOf(el);
        if (!/validat|review|checkout|proceed|submit|complete|finalize|confirm/i.test(t)) continue;
        validate_or_checkout_hints.push({
          kind: el.tagName === "A" ? "link" : "button",
          text: t.slice(0, 120),
          href: el.tagName === "A" ? el.getAttribute("href")?.slice(0, 200) || null : null,
          observed_only: true,
        });
        if (validate_or_checkout_hints.length >= 20) break;
      }

      const headings = collect("h1,h2,h3,[role=heading]")
        .filter(isVisible)
        .slice(0, 16)
        .map((h) => ({
          level: h.tagName,
          text: textOf(h).slice(0, 140),
        }));

      result.cart_validate_surface = {
        empty_cart_text_hint: empty_hint,
        visible_tbody_line_estimate: Math.min(line_estimate, 500),
        heading_samples: headings,
        validate_checkout_related_observed: validate_or_checkout_hints,
        body_text_preview: bodyInner.slice(0, 700),
      };
    }

    return result;
  });
}

async function collectFrameInventory(page) {
  const frames = page.frames();
  const mapped = [];
  for (const f of frames) {
    const isMain = f === page.mainFrame();
    const url = f.url();
    const title = await f.title().catch(() => null);
    const textLen = await f
      .evaluate(() => (document.body?.innerText || "").trim().length)
      .catch(() => null);
    mapped.push({ is_main: isMain, url, title, body_text_length: textLen });
  }
  return mapped;
}

function slimReconSummaryForApiPayload(summary) {
  if (!summary || typeof summary !== "object") return summary;
  const inv = summary.semantic?.milo_readonly_inventory;
  const semantic = summary.semantic
    ? {
        ...summary.semantic,
        operational_surface_deep_map: undefined,
        milo_readonly_inventory: inv
          ? { ...inv, operational_surface_deep_map: undefined }
          : summary.semantic.milo_readonly_inventory,
      }
    : summary.semantic;
  return {
    ...summary,
    top_strip_chrome_export_readonly: undefined,
    surface_deep_map: undefined,
    semantic,
    heavy_fields_omitted_from_this_payload: [
      "top_strip_chrome_export_readonly",
      "surface_deep_map",
      "semantic.operational_surface_deep_map",
      "semantic.milo_readonly_inventory.operational_surface_deep_map",
    ],
  };
}

async function runReconMappingPhase({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  buildStepEvidence,
}) {
  if (!config.reconMode) return [];
  const mapped = [];

  for (const url of config.reconMappingUrls) {
    await heartbeat({
      progressStage: "mlcc_recon_mapping",
      progressMessage: `Recon mapping ${url}`,
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    const readiness = await waitForReconContentReady(page, 9000);
    const summary = await collectReconLandmarks(page);
    syncReconSemanticNavDerivedFields(summary);
    await enrichReconTopNavFromAccessibilityTree(page, summary);
    await enrichReconTopNavFromPlaywrightTabs(page, summary);
    await enrichReconTopNavFromPlaywrightMiloTabAnchors(page, summary);
    await enrichReconTopNavFromPlaywrightKnownChromeButtons(page, summary);
    summary.top_strip_chrome_export_readonly = await collectTopStripChromeExport(page);
    summary.surface_deep_map = await collectOperationalSurfaceDeepMap(page).catch(() => null);
    if (summary.surface_deep_map && summary.semantic) {
      summary.semantic.operational_surface_deep_map = summary.surface_deep_map;
    }
    syncReconSemanticNavDerivedFields(summary);
    summary.frame_inventory = await collectFrameInventory(page);
    summary.readiness = readiness;
    mapped.push(summary);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_recon_page_map",
        stage: "mlcc_recon_page_summary",
        message: `Recon summary captured for ${url}`,
        attributes: slimReconSummaryForApiPayload(summary),
      }),
    );
    const surfaceSnap = await buildPageSnapshotAttributes(page);
    const mainStrip = summary.top_strip_chrome_export_readonly?.frames?.find((f) => f.is_main);
    let surfaceAttrs = {
      ...surfaceSnap,
      page_url: summary.url,
      surface_deep_map: summary.surface_deep_map,
      top_strip_narrow_visible_text_sample: mainStrip?.visible_text_narrow_top?.slice(0, 800) ?? null,
      top_strip_dom_narrow_count: mainStrip?.dom_excerpt_narrow_top_px?.length ?? null,
    };
    if (config.stepScreenshotsEnabled) {
      let surfaceShot = await maybeScreenshotPngBase64(
        page,
        config.stepScreenshotMaxBytes,
        { fullPage: true },
      );
      if (!surfaceShot.included && surfaceShot.reason === "over_size_limit") {
        surfaceShot = await maybeScreenshotPngBase64(page, config.stepScreenshotMaxBytes);
      }
      surfaceAttrs = mergeSnapshotAndScreenshot(surfaceAttrs, surfaceShot);
    }
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_operational_surface_deep_map",
        stage: "mlcc_operational_surface_deep_map",
        message: `Read-only operational surface map (license / add-by-code / cart) for ${url}`,
        attributes: surfaceAttrs,
      }),
    );

    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_recon_page_snapshot",
        message: `Recon snapshot for ${url}`,
        kind: "mlcc_step_snapshot",
        buildEvidence,
        config,
      }),
    );
  }

  return mapped;
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

  let dryRunMappingInferredItems = null;
  const mappingConfidence = evaluateDryRunMappingConfidenceGuard(payload);
  if (!mappingConfidence.ok) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes:
        "MLCC browser dry run blocked: mapping confidence unknown (pre-browser)",
      errorMessage:
        mappingConfidence.message ??
        "Dry-run blocked due to mappingconfidence=unknown on one or more items",
      failureType: FAILURE_TYPE.CODE_MISMATCH,
      failureDetails: {
        stage: "validate_mapping_confidence",
        mlcc_signal: MLCC_SIGNAL.CART_IDENTITY,
        unknown_items: mappingConfidence.unknown_items,
      },
      evidence: [
        buildEvidence({
          kind: "cart_verification_snapshot",
          stage: "validate_mapping_confidence",
          message:
            mappingConfidence.message ??
            "Mapping confidence guard rejected payload",
          attributes: {
            unknown_items: mappingConfidence.unknown_items,
            inferred_items: mappingConfidence.inferred_items,
          },
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

  if (
    Array.isArray(mappingConfidence.inferred_items) &&
    mappingConfidence.inferred_items.length > 0
  ) {
    dryRunMappingInferredItems = mappingConfidence.inferred_items;
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
  const runStartedAtIso = new Date().toISOString();
  const guardStats = { blockedRequestCount: 0 };

  if (
    Array.isArray(dryRunMappingInferredItems) &&
    dryRunMappingInferredItems.length > 0
  ) {
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_dry_run_mapping_confidence",
        stage: "mlcc_pre_browser_mapping_review",
        message:
          "Dry-run: one or more lines have mappingconfidence=inferred (allowed; human review suggested)",
        attributes: {
          inferred_items: dryRunMappingInferredItems,
          requires_human_review: true,
        },
      }),
    );
  }

  const safeFlowOrderIndex = { n: 0 };
  const safeFlowOutDir = buildMlccSafeFlowRunOutputDir(
    config.safeFlowScreenshotDir,
    run?.id,
  );

  /** @type {((stage: string, filename: string) => Promise<unknown>) | null} */
  const safeFlowShot = safeFlowOutDir
    ? async (stage, filename) => {
        const diskName = buildMlccSafeFlowMilestoneDiskFilename(
          safeFlowOrderIndex.n + 1,
          stage,
          filename,
        );
        await captureMlccSafeFlowMilestoneScreenshot({
          page,
          outputDirAbs: safeFlowOutDir,
          filename: diskName,
          stage,
          orderIndexRef: safeFlowOrderIndex,
          evidenceCollected,
          buildEvidence,
        });
      }
    : null;

  const persistMlccDryRunRunSummaryToDisk = async (outcome, errorMessage) => {
    if (!safeFlowOutDir) {
      return;
    }
    const finishedAtIso = new Date().toISOString();
    let finalUrl = null;
    try {
      finalUrl = page?.url() ?? null;
    } catch {
      finalUrl = null;
    }
    const tally = tallyMlccEvidenceEntriesByKind(evidenceCollected);
    const milestoneCount = countMlccSafeFlowMilestoneScreenshots(evidenceCollected);
    const summaryPayload = buildMlccSafeFlowRunSummaryPayload({
      runId: run.id,
      storeId,
      workerId,
      outcome,
      startedAtIso: runStartedAtIso,
      finishedAtIso,
      errorMessage: outcome === "failure" ? errorMessage : null,
      finalUrl,
      addByCodeProbe: config.addByCodeProbe === true,
      dryRunSafeMode: MLCC_BROWSER_DRY_RUN_SAFE_MODE,
      guardStats,
      evidenceEntryCount: evidenceCollected.length,
      evidenceKindsTally: tally,
      milestoneScreenshotEvidenceCount: milestoneCount,
    });
    try {
      const absPath = await writeMlccSafeFlowRunSummaryJson(
        safeFlowOutDir,
        summaryPayload,
      );
      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_safe_flow_run_summary",
          stage: "mlcc_safe_flow_run_summary_written",
          message: `Run summary JSON written (${outcome})`,
          attributes: {
            run_summary_basename: MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME,
            run_summary_absolute_path: absPath,
            outcome,
          },
        }),
      );
    } catch {
      /* optional disk */
    }
  };

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
    const { launchChromium } = await import("../lib/chromium-launch.js");

    const executablePath = chromium.executablePath();
    if (!executablePath || !fs.existsSync(executablePath)) {
      throw new Error(buildPlaywrightInstallHint(executablePath));
    }

    try {
      browser = await launchChromium({ headless: config.headless });
    } catch (launchError) {
      throw new Error(normalizeLaunchError(launchError));
    }
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

    const loginPrep = await prepareMlccLoginPage(page, config);

    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_pre_login_submit",
        message: `Credentials filled; agreement/checkbox step: ${JSON.stringify(loginPrep?.agreement ?? null)}; checkpoint before submit click`,
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

    const reconPages = await runReconMappingPhase({
      page,
      config,
      heartbeat: async (args) => heartbeat(args),
      buildEvidence,
      evidenceCollected,
      buildStepEvidence,
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
    let phase2hResult = null;
    let phase2jResult = null;
    let phase2lResult = null;
    let phase2lMiloPostFillTabFromQuantityResult = null;
    let phase2lMiloPostFillClickAwayResult = null;
    let phase2nResult = null;
    let phase2uMiloBulkResult = null;
    let phase2oResult = null;
    let phase2qResult = null;
    let phase2rResult = null;
    let phase2vMiloValidateResult = null;
    let phase2wMiloPostValidateResult = null;
    let phase2oMiloReadonlyCartValidateDiscoveryResult = null;

    if (config.addByCodeProbe) {
      const phaseContext = buildMlccPhaseContext({
        page,
        config,
        heartbeat: async (args) => heartbeat(args),
        buildStepEvidence,
        buildEvidence,
        evidenceCollected,
        safeFlowShot,
        guardStats,
      });
      const probePhases = [createMlccPhase2bDescriptor()];
      if (config.addByCodePhase2c) {
        probePhases.push(createMlccPhase2cDescriptor());
      }
      if (config.addByCodePhase2e) {
        probePhases.push(createMlccPhase2eDescriptor());
      } else if (config.addByCodePhase2d) {
        probePhases.push(createMlccPhase2dDescriptor());
      }
      if (config.addByCodePhase2f) {
        probePhases.push(createMlccPhase2fDescriptor());
      }
      const probePipeline = await runMlccPhasePipeline({
        phases: probePhases,
        context: phaseContext,
        log: undefined,
      });
      phase2bResult = getMlccPipelinePhaseResult(probePipeline, "phase_2b_add_by_code_probe");
      phase2cResult = getMlccPipelinePhaseResult(probePipeline, "phase_2c_field_hardening");
      phase2dResult = getMlccPipelinePhaseResult(probePipeline, "phase_2d_mutation_boundary_map");
      phase2eResult = getMlccPipelinePhaseResult(
        probePipeline,
        "phase_2e_scoped_mutation_boundary_map",
      );
      phase2fResult = getMlccPipelinePhaseResult(probePipeline, "phase_2f_safe_open_confirm");

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

      if (config.addByCodePhase2h) {
        try {
          phase2hResult = await runAddByCodePhase2hRealCodeTypingRehearsal({
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

          throw new Error(`MLCC add-by-code phase 2h failed: ${m}`);
        }
      }

      if (config.addByCodePhase2j) {
        try {
          phase2jResult = await runAddByCodePhase2jQuantityTypingRehearsal({
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

          throw new Error(`MLCC add-by-code phase 2j failed: ${m}`);
        }
      }

      const skipFollowupCommitGestures =
        config.addByCodePhase2lMiloManualParitySequence === true;

      if (config.addByCodePhase2l) {
        try {
          if (config.addByCodePhase2lMiloManualParitySequence) {
            phase2lResult = await runPhase2lMiloManualParitySequenceAndPre2uSnapshot({
              page,
              config,
              heartbeat: async (args) => heartbeat(args),
              buildEvidence,
              evidenceCollected,
              guardStats,
              buildStepEvidence,
            });
          } else {
            phase2lResult = await runAddByCodePhase2lCombinedCodeQuantityTypingRehearsal({
              page,
              config,
              heartbeat: async (args) => heartbeat(args),
              buildEvidence,
              evidenceCollected,
              guardStats,
              buildStepEvidence,
            });
          }
          await safeFlowShot?.("code_qty_entered", "mlcc_code_qty_entered.png");
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2l failed: ${m}`);
        }
      }

      if (
        config.addByCodePhase2lMiloPostFillTabFromQuantity &&
        !skipFollowupCommitGestures
      ) {
        try {
          phase2lMiloPostFillTabFromQuantityResult =
            await runPhase2lMiloPostFillTabFromQuantityParityStep({
              page,
              config,
              heartbeat: async (args) => heartbeat(args),
              buildEvidence,
              evidenceCollected,
              guardStats,
              phase2lResult,
            });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(
            `MLCC add-by-code phase 2l MILO Tab-from-quantity failed: ${m}`,
          );
        }
      }

      if (
        config.addByCodePhase2lMiloPostFillClickAway &&
        !skipFollowupCommitGestures
      ) {
        try {
          phase2lMiloPostFillClickAwayResult =
            await runPhase2lMiloPostFillClickAwayParityStep({
              page,
              config,
              heartbeat: async (args) => heartbeat(args),
              buildEvidence,
              evidenceCollected,
              guardStats,
              phase2lResult,
            });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2l MILO post-fill click-away failed: ${m}`);
        }
      }

      if (config.addByCodePhase2n) {
        try {
          phase2nResult = await runAddByCodePhase2nAddApplyLineSingleClick({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
            buildStepEvidence,
            phase2lResult,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2n failed: ${m}`);
        }
      }

      if (config.addByCodePhase2uMiloBulk) {
        let prior2uDeterminismState = null;
        if (config.addByCode2uDeterminismStatePath) {
          try {
            const p = path.resolve(config.addByCode2uDeterminismStatePath);
            const raw = fs.readFileSync(p, "utf8");
            prior2uDeterminismState = JSON.parse(raw);
          } catch {
            prior2uDeterminismState = null;
          }
        }
        try {
          phase2uMiloBulkResult = await runAddByCodePhase2uMiloBulkSkeleton({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
            buildStepEvidence,
            phase2lResult,
            prior2uDeterminismState,
            safeFlowShot,
          });
          if (
            config.addByCode2uDeterminismStateWrite &&
            config.addByCode2uDeterminismStatePath &&
            phase2uMiloBulkResult?.add_to_cart_determinism_hardening_non_validate
          ) {
            try {
              const art =
                phase2uMiloBulkResult.add_to_cart_determinism_hardening_non_validate;
              const payload = build2uDeterminismPersistPayload({
                laneInputFingerprint: art.lane_input_fingerprint,
                artifactFragment: art,
              });
              fs.writeFileSync(
                path.resolve(config.addByCode2uDeterminismStatePath),
                `${JSON.stringify(payload)}\n`,
                "utf8",
              );
            } catch {
              // Bounded: do not fail dry run on optional state file I/O.
            }
          }
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          throw new Error(`MLCC add-by-code phase 2u failed: ${m}`);
        }
      }

      if (config.addByCodePhase2o || config.addByCodePhase2oMiloPost2u) {
        try {
          phase2oResult = await runAddByCodePhase2oPostAddApplyObservation({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
            buildStepEvidence,
            phase2nResult,
            phase2uResult: phase2uMiloBulkResult,
            post2uMiloMode: config.addByCodePhase2oMiloPost2u === true,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2o failed: ${m}`);
        }
      }

      if (config.addByCodePhase2oMiloReadonlyCartValidateDiscovery) {
        try {
          const preCartMs =
            config.addByCodePhase2oMiloPost2uPreReadonlyCartDiscoverySettleMs ?? 0;

          if (preCartMs > 0) {
            await heartbeat({
              progressStage: "mlcc_milo_post_2u_pre_readonly_cart_settle",
              progressMessage: `MILO post-2u lane: operator-gated settle before read-only cart navigation (${preCartMs}ms; no clicks)`,
            });
            evidenceCollected.push(
              buildEvidence({
                kind: "mlcc_add_by_code_probe",
                stage: "mlcc_milo_post_2u_pre_readonly_cart_settle",
                message: `Pre-read-only-cart-discovery settle after Phase 2o (MILO post-2u): ${preCartMs}ms`,
                attributes: {
                  settle_ms: preCartMs,
                  settle_gate:
                    "MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U_PRE_READONLY_CART_SETTLE_MS_plus_APPROVED",
                  no_clicks: true,
                  no_validate_checkout_submit: true,
                },
              }),
            );
            await new Promise((r) => setTimeout(r, preCartMs));
          }

          phase2oMiloReadonlyCartValidateDiscoveryResult =
            await runMiloReadonlyPost2oCartValidateDiscovery({
              page,
              config,
              heartbeat: async (args) => heartbeat(args),
              buildEvidence,
              evidenceCollected,
              guardStats,
              buildStepEvidence,
              phase2oResult,
              safeFlowShot,
            });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC MILO read-only cart validate discovery failed: ${m}`);
        }
      }

      if (config.addByCodePhase2q) {
        try {
          phase2qResult = await runAddByCodePhase2qBoundedValidateSingleClick({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
            buildStepEvidence,
            phase2nResult,
            phase2oResult,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2q failed: ${m}`);
        }
      }

      if (config.addByCodePhase2r) {
        try {
          phase2rResult = await runAddByCodePhase2rPostValidateObservation({
            page,
            config,
            heartbeat: async (args) => heartbeat(args),
            buildEvidence,
            evidenceCollected,
            guardStats,
            buildStepEvidence,
            phase2qResult,
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);

          throw new Error(`MLCC add-by-code phase 2r failed: ${m}`);
        }
      }

      if (config.addByCodePhase2vMiloValidate) {
        try {
          phase2vMiloValidateResult =
            await runAddByCodePhase2vMiloValidateSingleClick({
              page,
              config,
              heartbeat: async (args) => heartbeat(args),
              buildEvidence,
              evidenceCollected,
              guardStats,
              buildStepEvidence,
              phase2uResult: phase2uMiloBulkResult,
              phase2oResult,
            });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          throw new Error(`MLCC add-by-code phase 2v failed: ${m}`);
        }
      }

      if (config.addByCodePhase2wMiloPostValidate) {
        try {
          phase2wMiloPostValidateResult =
            await runAddByCodePhase2wMiloPostValidateInertSkeleton({
              heartbeat: async (args) => heartbeat(args),
              buildEvidence,
              evidenceCollected,
              phase2vResult: phase2vMiloValidateResult,
            });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          throw new Error(`MLCC add-by-code phase 2w failed: ${m}`);
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
          "Final ordering-ready checkpoint after Phase 2b/2c/2d|2e/2f/2g/2h/2j/2l/2n/2u/2o/2q/2r/2v/2w (2v one-click validate when enabled; 2w inert design-only when enabled; no checkout/submit/finalize)",
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
    const validateBoundaryPolicyDecision =
      config.addByCodeProbe === true
        ? buildValidateBoundaryPolicyDecisionArtifact({
            phase2lResult,
            phase2oMiloReadonlyCartValidateDiscoveryResult,
            config,
          })
        : null;

    await persistMlccDryRunRunSummaryToDisk("success", null);

    const result = {
      finalUrl,
      title,
      ordering_ready_heuristic: orderingReadyHeuristic,
      recon_mode: config.reconMode,
      recon_pages_mapped: (reconPages || []).map((p) => slimReconSummaryForApiPayload(p)),
      phase_2b_add_by_code: phase2bResult,
      phase_2c_field_hardening: phase2cResult,
      phase_2d_mutation_boundary: phase2dResult,
      phase_2e_mutation_boundary: phase2eResult,
      phase_2f_safe_open: phase2fResult,
      phase_2g_typing_policy: phase2gResult,
      phase_2h_real_code: phase2hResult,
      phase_2j_quantity: phase2jResult,
      phase_2l_combined: phase2lResult,
      phase_2l_milo_post_fill_tab_from_quantity:
        phase2lMiloPostFillTabFromQuantityResult,
      phase_2l_milo_post_fill_click_away: phase2lMiloPostFillClickAwayResult,
      phase_2n_add_apply_line: phase2nResult,
      phase_2u_milo_bulk: phase2uMiloBulkResult,
      phase_2o_post_add_apply_observation: phase2oResult,
      phase_2o_milo_readonly_cart_validate_discovery:
        phase2oMiloReadonlyCartValidateDiscoveryResult,
      phase_2q_bounded_validate: phase2qResult,
      phase_2r_post_validate_observation: phase2rResult,
      phase_2v_milo_validate: phase2vMiloValidateResult,
      phase_2w_milo_post_validate_design_only: phase2wMiloPostValidateResult,
      validate_boundary_policy_decision: validateBoundaryPolicyDecision,
    };

    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "succeeded",
      workerNotes:
        "MLCC browser dry run completed successfully; no checkout/submit/finalization (bounded validate only when Phase 2q enabled per policy). " +
        "Combined rehearsal phases clear test fields; Phase 2n when enabled performs at most one tenant-listed add/apply-line click (server cart may still change; not proven here). " +
        "Phase 2o when enabled performs read-only DOM observation after same-run post-click prerequisite (legacy 2n or MILO 2u variant; no extra clicks; not server cart proof). " +
        "Phase 2q when enabled performs at most one tenant-listed validate click after 2n (and 2o when enabled); optional read-only post-validate scrape only; no checkout/submit/finalize. " +
        "Phase 2r when enabled performs read-only DOM observation after 2q (zero clicks; inferred checkout-adjacent scan only; not checkout safety). " +
        "Phase 2v when enabled performs at most one MILO validate click after 2u->2o gates; Phase 2w remains inert design-only blocked evidence only. " +
        `dry_run_safe_mode=${MLCC_BROWSER_DRY_RUN_SAFE_MODE} submission_armed=${config.submissionArmed} ` +
        `license_store_automation=${config.licenseStoreAutomation} ` +
        `add_by_code_probe=${config.addByCodeProbe} ` +
        `add_by_code_phase_2c=${config.addByCodePhase2c} ` +
        `add_by_code_phase_2d=${config.addByCodePhase2d} ` +
        `add_by_code_phase_2e=${config.addByCodePhase2e} ` +
        `add_by_code_phase_2f=${config.addByCodePhase2f} ` +
        `add_by_code_phase_2g=${config.addByCodePhase2g} ` +
        `add_by_code_phase_2h=${config.addByCodePhase2h} ` +
        `add_by_code_phase_2j=${config.addByCodePhase2j} ` +
        `add_by_code_phase_2l=${config.addByCodePhase2l} ` +
        `add_by_code_phase_2n=${config.addByCodePhase2n} ` +
        `add_by_code_phase_2u_milo_bulk=${config.addByCodePhase2uMiloBulk} ` +
        `add_by_code_phase_2o=${config.addByCodePhase2o} ` +
        `add_by_code_phase_2o_milo_post_2u=${config.addByCodePhase2oMiloPost2u} ` +
        `add_by_code_phase_2q=${config.addByCodePhase2q} ` +
        `add_by_code_phase_2r=${config.addByCodePhase2r} ` +
        `add_by_code_phase_2v_milo_validate=${config.addByCodePhase2vMiloValidate} ` +
        `add_by_code_phase_2w_milo_post_validate=${config.addByCodePhase2wMiloPostValidate}`,
      errorMessage: undefined,
      evidence: [
        ...evidenceCollected,
        buildEvidence({
          kind: "worker_log",
          stage: "completed",
          message:
            "MLCC browser dry-run completed (Phase 2a/2b/2c/2d|2e/2f/2g/2h/2j/2l/2n/2u/2o/2q/2r/2v/2w checkpoints; 2n at most one add/apply click when enabled; 2u at most one MILO bulk click when enabled; 2o read-only after add/apply when enabled; 2q at most one validate click when enabled; 2r read-only post-validate when enabled; 2v at most one MILO validate click when enabled; 2w inert design-only when enabled; no checkout/submit/finalize)",
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
            phase_2d_mutation_scan_scope: phase2dResult?.mutation_scan_scope ?? null,
            phase_2d_boundary_mapping_success:
              phase2dResult?.phase_2d_boundary_mapping_success ?? null,
            phase_2d_bycode_surface_boundary_success:
              phase2dResult?.phase_2d_bycode_surface_boundary_success ?? null,
            phase_2d_network_guard_blocked_requests:
              guardStats?.blockedRequestCount ?? null,
            phase_2e_enabled: config.addByCodePhase2e,
            phase_2e_scoped_root_matched:
              phase2eResult?.scoped_root_matched_visible ?? null,
            phase_2e_fallback_broad: phase2eResult?.fallback_to_broad_scan ?? null,
            phase_2e_scope_status: phase2eResult?.scope_status ?? null,
            phase_2e_uncertain_count: phase2eResult?.uncertain_count ?? null,
            phase_2e_mutation_scan_scope: phase2eResult?.mutation_scan_scope ?? null,
            phase_2e_boundary_mapping_success:
              phase2eResult?.phase_2e_boundary_mapping_success ?? null,
            phase_2e_bycode_surface_boundary_success:
              phase2eResult?.phase_2e_bycode_surface_boundary_success ?? null,
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
            phase_2h_enabled: config.addByCodePhase2h,
            phase_2h_real_code_typing:
              phase2hResult?.real_code_typing_performed ?? null,
            phase_2h_run_non_mutating:
              phase2hResult?.run_remained_fully_non_mutating ?? null,
            phase_2h_field_cleared: phase2hResult?.field_cleared_after ?? null,
            phase_2h_policy_version:
              phase2hResult?.phase_2h_policy_version ?? null,
            phase_2j_enabled: config.addByCodePhase2j,
            phase_2j_quantity_typing:
              phase2jResult?.quantity_typing_performed ?? null,
            phase_2j_run_non_mutating:
              phase2jResult?.run_remained_fully_non_mutating ?? null,
            phase_2j_field_cleared: phase2jResult?.field_cleared_after ?? null,
            phase_2j_blur_used: phase2jResult?.blur_used ?? null,
            phase_2j_policy_version:
              phase2jResult?.phase_2j_policy_version ?? null,
            phase_2j_phase_2i_policy_version:
              phase2jResult?.phase_2i_policy_version ?? null,
            phase_2l_enabled: config.addByCodePhase2l,
            phase_2l_combined_rehearsal:
              phase2lResult?.combined_rehearsal_performed ?? null,
            phase_2l_run_non_mutating:
              phase2lResult?.run_remained_fully_non_mutating ?? null,
            phase_2l_fields_cleared: phase2lResult?.fields_cleared_after ?? null,
            phase_2l_field_order: phase2lResult?.field_order ?? null,
            phase_2l_blur_used: phase2lResult?.blur_used ?? null,
            phase_2l_policy_version:
              phase2lResult?.phase_2l_policy_version ?? null,
            phase_2l_phase_2k_policy_version:
              phase2lResult?.phase_2k_policy_version ?? null,
            phase_2n_enabled: config.addByCodePhase2n,
            phase_2n_add_apply_click:
              phase2nResult?.add_apply_click_performed ?? null,
            phase_2n_selector_clicked:
              phase2nResult?.selector_clicked ?? null,
            phase_2n_no_new_blocked_downstream_requests:
              phase2nResult?.no_new_blocked_downstream_requests_observed ??
              null,
            phase_2n_policy_version:
              phase2nResult?.phase_2n_policy_version ?? null,
            phase_2n_phase_2m_policy_version:
              phase2nResult?.phase_2m_policy_version ?? null,
            phase_2u_enabled: config.addByCodePhase2uMiloBulk,
            phase_2u_click_performed:
              phase2uMiloBulkResult?.click_performed ?? null,
            phase_2u_runtime_click_execution_enabled:
              phase2uMiloBulkResult?.runtime_click_execution_enabled ?? null,
            phase_2u_exec_policy_version:
              phase2uMiloBulkResult?.phase_2u_exec_policy_version ?? null,
            phase_2u_policy_version:
              phase2uMiloBulkResult?.phase_2u_policy_version ?? null,
            phase_2o_enabled: config.addByCodePhase2o,
            phase_2o_milo_post_2u_enabled: config.addByCodePhase2oMiloPost2u,
            phase_2o_observation_performed:
              phase2oResult?.observation_performed ?? null,
            phase_2o_settle_ms_used:
              phase2oResult?.settle_ms_used ?? null,
            phase_2o_page_changed_visible_heuristic:
              phase2oResult?.page_appears_changed_visible_dom_heuristic ??
              null,
            phase_2o_no_new_blocked_downstream_requests:
              phase2oResult?.no_new_blocked_downstream_requests_observed ??
              null,
            phase_2o_policy_version:
              phase2oResult?.phase_2o_policy_version ?? null,
            phase_2o_phase_2m_policy_version:
              phase2oResult?.phase_2m_policy_version ?? null,
            phase_2q_enabled: config.addByCodePhase2q,
            phase_2q_validate_click:
              phase2qResult?.validate_click_performed ?? null,
            phase_2q_selector_clicked:
              phase2qResult?.selector_clicked ?? null,
            phase_2q_no_new_blocked_downstream_requests:
              phase2qResult?.no_new_blocked_downstream_requests_observed ??
              null,
            phase_2q_policy_version:
              phase2qResult?.phase_2q_policy_version ?? null,
            phase_2q_phase_2p_policy_version:
              phase2qResult?.phase_2p_policy_version ?? null,
            phase_2r_enabled: config.addByCodePhase2r,
            phase_2r_observation_performed:
              phase2rResult?.observation_performed ?? null,
            phase_2r_settle_ms_used: phase2rResult?.settle_ms_used ?? null,
            phase_2r_page_changed_visible_heuristic:
              phase2rResult?.page_appears_changed_visible_dom_heuristic ??
              null,
            phase_2r_no_new_blocked_downstream_requests:
              phase2rResult?.no_new_blocked_downstream_requests_observed ??
              null,
            phase_2r_policy_version:
              phase2rResult?.phase_2r_policy_version ?? null,
            phase_2r_phase_2p_policy_version:
              phase2rResult?.phase_2p_policy_version ?? null,
            phase_2v_enabled: config.addByCodePhase2vMiloValidate,
            phase_2v_validate_click_performed:
              phase2vMiloValidateResult?.validate_click_performed ?? null,
            phase_2v_runtime_execution_enabled:
              phase2vMiloValidateResult?.runtime_execution_enabled ?? null,
            phase_2v_selector_clicked:
              phase2vMiloValidateResult?.selector_clicked ?? null,
            phase_2v_no_new_blocked_downstream_requests:
              phase2vMiloValidateResult?.no_new_blocked_downstream_requests_observed ??
              null,
            phase_2v_policy_version:
              phase2vMiloValidateResult?.phase_2v_policy_version ?? null,
            phase_2v_exec_policy_version:
              phase2vMiloValidateResult?.phase_2v_exec_policy_version ?? null,
            phase_2w_enabled: config.addByCodePhase2wMiloPostValidate,
            phase_2w_design_only_blocked:
              phase2wMiloPostValidateResult?.design_only_blocked ?? null,
            phase_2w_runtime_execution_enabled:
              phase2wMiloPostValidateResult?.runtime_execution_enabled ?? null,
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
      lower.includes("mlcc add-by-code phase 2g failed") ||
      lower.includes("mlcc add-by-code phase 2h failed") ||
      lower.includes("mlcc add-by-code phase 2j failed") ||
      lower.includes("mlcc add-by-code phase 2l failed") ||
      lower.includes("mlcc add-by-code phase 2n failed") ||
      lower.includes("mlcc add-by-code phase 2u failed") ||
      lower.includes("mlcc add-by-code phase 2o failed") ||
      lower.includes("mlcc add-by-code phase 2q failed") ||
      lower.includes("mlcc add-by-code phase 2r failed") ||
      lower.includes("mlcc milo read-only cart validate discovery failed");
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

    const loginFailure = err instanceof MlccLoginFailure ? err : null;

    let failureEvidenceAttrs;
    if (isLogin && page) {
      failureEvidenceAttrs = await buildMlccLoginFailureEvidencePack(page, config, {
        error: msg,
        login_failure_classification:
          loginFailure?.classification ?? MLCC_LOGIN_FAILURE_CLASS.UNKNOWN,
        login_failure_diagnostics: loginFailure?.diagnostics ?? null,
      });
      if (safeFlowOutDir) {
        try {
          await captureMlccSafeFlowMilestoneScreenshot({
            page,
            outputDirAbs: safeFlowOutDir,
            filename: buildMlccSafeFlowMilestoneDiskFilename(
              safeFlowOrderIndex.n + 1,
              "on_failure",
              "mlcc_failure.png",
            ),
            stage: "on_failure",
            orderIndexRef: safeFlowOrderIndex,
            evidenceCollected,
            buildEvidence,
          });
        } catch {
          /* ignore secondary screenshot errors */
        }
      }
    } else {
      const shotMax =
        page && config.stepScreenshotsEnabled === true
          ? (config.stepScreenshotMaxBytes ?? 200_000)
          : 0;

      failureEvidenceAttrs = page
        ? await collectSafeModeFailureEvidencePack(page, {
            screenshotMaxBytes: shotMax,
            excerptMaxChars: 12_000,
            htmlExcerptMaxChars: 8_000,
          }).catch(async () => {
            const failAttrs = await buildPageSnapshotAttributes(page);
            return { ...failAttrs, error: msg };
          })
        : { page_available: false, error: msg };

      failureEvidenceAttrs = { ...failureEvidenceAttrs, error: msg };

      if (page && safeFlowOutDir) {
        try {
          await captureMlccSafeFlowMilestoneScreenshot({
            page,
            outputDirAbs: safeFlowOutDir,
            filename: buildMlccSafeFlowMilestoneDiskFilename(
              safeFlowOrderIndex.n + 1,
              "on_failure",
              "mlcc_failure.png",
            ),
            stage: "on_failure",
            orderIndexRef: safeFlowOrderIndex,
            evidenceCollected,
            buildEvidence,
          });
        } catch {
          /* ignore secondary screenshot errors */
        }
      }
    }

    await persistMlccDryRunRunSummaryToDisk("failure", msg);

    const loginFailureDetails =
      isLogin
        ? {
            login_failure_classification:
              loginFailure?.classification ?? MLCC_LOGIN_FAILURE_CLASS.UNKNOWN,
            login_failure_diagnostics: loginFailure?.diagnostics ?? null,
          }
        : {};

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
              : isLogin
                ? "mlcc_login"
                : "browser_runtime",
          mlcc_signal: mlccSignal,
          classified_type: classified,
          ...loginFailureDetails,
        },
        evidence: [
          ...evidenceCollected,
          buildEvidence({
            kind: "mlcc_ui_diagnostics",
            stage: isLogin ? "mlcc_login_failure" : "browser_runtime",
            message: isLogin
              ? "MLCC login failure (classification in attributes.failure_details / login_failure_classification)"
              : "MLCC browser runtime failure",
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
