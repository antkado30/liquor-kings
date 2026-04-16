/**
 * Phase 2b: non-mutating add-by-code UI mapping. No typing, validate, checkout, or submit.
 * Phase 2c: tenant selector hardening + read-only field inspection; optional guarded focus/blur (no code/qty typing).
 * Layer 2: network guards. Layer 3: blocked UI text before any probe click.
 */

import {
  PHASE_2I_POLICY_VERSION,
  buildPhase2iQuantityFutureGateManifest,
} from "./mlcc-phase-2i-policy.js";
import {
  PHASE_2K_POLICY_VERSION,
  buildPhase2kCombinedInteractionFutureGateManifest,
} from "./mlcc-phase-2k-policy.js";
import {
  PHASE_2M_POLICY_VERSION,
  buildPhase2mAddApplyLineFutureGateManifest,
  buildPhase2mPostAddApplyLadder,
} from "./mlcc-phase-2m-policy.js";
import {
  PHASE_2P_POLICY_VERSION,
  buildPhase2pPostValidateLadder,
  buildPhase2pValidateFutureGateManifest,
} from "./mlcc-phase-2p-policy.js";
import {
  PHASE_2U_MILO_BULK_POLICY_VERSION,
  buildPhase2uMiloBulkFutureGateManifest,
} from "./mlcc-phase-2u-policy.js";
import {
  PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
  buildPhase2vMiloValidateFutureGateManifest,
} from "./mlcc-phase-2v-2w-policy.js";
import {
  MLCC_PROBE_UNSAFE_UI_TEXT as MLCC_PROBE_UNSAFE_UI_TEXT_GUARD,
  shouldBlockHttpRequest as shouldBlockHttpRequestGuard,
  isProbeUiTextUnsafe as isProbeUiTextUnsafeGuard,
  installMlccSafetyNetworkGuards as installMlccSafetyNetworkGuardsGuard,
} from "./mlcc-guards.js";
import { collectSafeModeFailureEvidencePack } from "./mlcc-browser-evidence.js";

/** @type {typeof import("./mlcc-guards.js").MLCC_PROBE_UNSAFE_UI_TEXT} */
export const MLCC_PROBE_UNSAFE_UI_TEXT = MLCC_PROBE_UNSAFE_UI_TEXT_GUARD;

export function shouldBlockHttpRequest(url, method) {
  return shouldBlockHttpRequestGuard(url, method);
}

export function isProbeUiTextUnsafe(text) {
  return isProbeUiTextUnsafeGuard(text);
}

/**
 * Install route handler on browser context (call after newContext, before newPage).
 * @param {import('playwright').BrowserContext} context
 * @param {{ blockedRequestCount?: number } | null} [statsRef] — optional; increments when a request is aborted
 */
export async function installMlccSafetyNetworkGuards(context, statsRef) {
  return installMlccSafetyNetworkGuardsGuard(context, statsRef);
}

/** Conservative: informational / navigation labels that are unlikely to mutate cart (heuristic only). */
export const MUTATION_BOUNDARY_SAFE_LABEL_PATTERNS = [
  /^(help|faq)(\s|$)/i,
  /privacy|terms(\s+of\s+service)?/i,
  /^contact(\s+us)?$/i,
  /^about(\s+us)?$/i,
];

/**
 * Phase 2d: classify a control near the mutation boundary (read-only scan; no clicks).
 * Returns classification + rationale; does not assert real-world safety.
 */
export function classifyMutationBoundaryControl(row) {
  const text = String(row.text ?? "").trim().slice(0, 300);
  const href = String(row.href ?? "").toLowerCase();
  const t = text.toLowerCase();
  const tag = String(row.tag ?? "").toLowerCase();

  if (
    href &&
    /checkout|cart\/add|place-order|order\/submit|validate|finalize|add-to-cart|addtocart/i.test(
      href,
    )
  ) {
    return {
      classification: "unsafe_mutation_likely",
      rationale: "href_matches_mutation_path_heuristic",
    };
  }

  const probe = isProbeUiTextUnsafe(text);

  if (probe.unsafe) {
    return {
      classification: "unsafe_mutation_likely",
      rationale: `label_matches_layer3_ui_guard:${probe.matched}`,
    };
  }

  if (
    /\b(add\s+line|save\s+cart|update\s+line|remove\s+line|delete\s+line)\b/i.test(
      t,
    )
  ) {
    return {
      classification: "unsafe_mutation_likely",
      rationale: "label_suggests_cart_line_mutation_heuristic",
    };
  }

  for (const re of MUTATION_BOUNDARY_SAFE_LABEL_PATTERNS) {
    if (re.test(t)) {
      return {
        classification: "safe_informational",
        rationale: "label_matches_informational_heuristic_not_a_safety_guarantee",
      };
    }
  }

  if (
    tag === "a" &&
    href &&
    (href.startsWith("mailto:") || href.startsWith("tel:"))
  ) {
    return {
      classification: "safe_informational",
      rationale: "mailto_or_tel_link",
    };
  }

  return {
    classification: "uncertain",
    rationale: "no_definitive_safe_or_unsafe_match_heuristic_ambiguous",
    uncertain_detail: deriveUncertainDetail(row),
  };
}

function deriveUncertainDetail(row) {
  const text = String(row.text ?? "").trim();

  if (!text) {
    return "empty_or_missing_visible_text";
  }

  if (text.length <= 1) {
    return "very_short_label";
  }

  if (/^(continue|next|apply|done|ok|go|proceed)\b/i.test(text)) {
    return "generic_navigation_or_action_verb_needs_tenant_context";
  }

  if (/\b(add|save|update|remove)\b/i.test(text.toLowerCase())) {
    return "commerce_adjacent_verb_not_matching_layer3_blocklist";
  }

  return "no_safe_or_unsafe_pattern_match";
}

/**
 * Parse tenant advisory hints for uncertain controls only (JSON array).
 * Each item: { "contains": "substring", "advisory_label": "operator_note" }
 * Does not change classification; never overrides unsafe → safe.
 */
export function parseMutationBoundaryUncertainHints(raw) {
  if (raw == null || String(raw).trim() === "") {
    return [];
  }

  const j = JSON.parse(String(raw));

  if (!Array.isArray(j)) {
    throw new Error("MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS must be a JSON array");
  }

  const out = [];

  for (const x of j) {
    if (!x || typeof x !== "object") {
      continue;
    }

    const contains = String(x.contains ?? "").trim();
    const advisory_label = String(x.advisory_label ?? "").trim();

    if (contains && advisory_label) {
      out.push({ contains, advisory_label });
    }
  }

  return out;
}

/**
 * Attach non-authoritative tenant notes to uncertain rows only (substring match).
 */
export function applyTenantAdvisoryForUncertain(row, classification, hints) {
  if (classification !== "uncertain" || !Array.isArray(hints) || hints.length === 0) {
    return {};
  }

  const text = String(row.text ?? "").toLowerCase();

  for (const h of hints) {
    if (text.includes(h.contains.toLowerCase())) {
      return {
        tenant_advisory_label: h.advisory_label,
        tenant_advisory_matched_contains: h.contains,
        tenant_advisory_disclaimer:
          "non_authoritative_operator_env_hint_does_not_change_classification",
      };
    }
  }

  return {};
}

/**
 * Phase 2f: JSON array of CSS selectors (priority order) for tenant-approved open candidates.
 */
export function parseSafeOpenCandidateSelectors(raw) {
  if (raw == null || String(raw).trim() === "") {
    throw new Error(
      "MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS is empty (required when Phase 2f is enabled)",
    );
  }

  const j = JSON.parse(String(raw));

  if (!Array.isArray(j) || j.length === 0) {
    throw new Error(
      "MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS must be a non-empty JSON array of strings",
    );
  }

  const out = [];

  for (const x of j) {
    if (typeof x === "string" && x.trim() !== "") {
      out.push(x.trim());
    }
  }

  if (out.length === 0) {
    throw new Error(
      "MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS must contain at least one non-empty selector string",
    );
  }

  return out;
}

/**
 * Phase 2n: JSON array of CSS selectors (priority order) for the single tenant add-line / apply-line control.
 */
export function parsePhase2nAddApplyCandidateSelectors(raw) {
  if (raw == null || String(raw).trim() === "") {
    throw new Error(
      "MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS is empty (required when Phase 2n is enabled)",
    );
  }

  const j = JSON.parse(String(raw));

  if (!Array.isArray(j) || j.length === 0) {
    throw new Error(
      "MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS must be a non-empty JSON array of strings",
    );
  }

  const out = [];

  for (const x of j) {
    if (typeof x === "string" && x.trim() !== "") {
      out.push(x.trim());
    }
  }

  if (out.length === 0) {
    throw new Error(
      "MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS must contain at least one non-empty selector string",
    );
  }

  return out;
}

/**
 * Phase 2q: JSON array of CSS selectors (priority order) for the single tenant validate control.
 */
export function parsePhase2qValidateCandidateSelectors(raw) {
  if (raw == null || String(raw).trim() === "") {
    throw new Error(
      "MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS is empty (required when Phase 2q is enabled)",
    );
  }

  const j = JSON.parse(String(raw));

  if (!Array.isArray(j) || j.length === 0) {
    throw new Error(
      "MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS must be a non-empty JSON array of strings",
    );
  }

  const out = [];

  for (const x of j) {
    if (typeof x === "string" && x.trim() !== "") {
      out.push(x.trim());
    }
  }

  if (out.length === 0) {
    throw new Error(
      "MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS must contain at least one non-empty selector string",
    );
  }

  return out;
}

/**
 * Optional settle ms before read-only post-validate scrape (default 400; max 3000; 0 skips extra scrape).
 */
export function parsePhase2qPostValidateObserveSettleMs(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, value: 400 };
  }

  const n = Number.parseInt(String(raw).trim(), 10);

  if (!Number.isFinite(n) || n < 0) {
    return {
      ok: false,
      value: null,
      reason: "must_be_non_negative_integer_ms",
    };
  }

  return { ok: true, value: Math.min(n, 3000) };
}

/**
 * Optional JSON array of substrings; extends which uncertain labels may open add-by-code (Phase 2f only).
 */
export function parsePhase2fSafeOpenTextAllowSubstrings(raw) {
  if (raw == null || String(raw).trim() === "") {
    return [];
  }

  const j = JSON.parse(String(raw));

  if (!Array.isArray(j)) {
    throw new Error(
      "MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS must be a JSON array of strings",
    );
  }

  return j
    .filter((x) => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim());
}

const PHASE_2F_DEFAULT_OPEN_INTENT_RES = [
  /add\s*by\s*code/i,
  /enter\s*code/i,
  /product\s*code/i,
  /item\s*code/i,
  /^sku\b/i,
  /lookup\b.*\bcode/i,
];

function textMatchesDefaultSafeOpenIntent(text) {
  const t = String(text ?? "").trim();

  return PHASE_2F_DEFAULT_OPEN_INTENT_RES.some((re) => re.test(t));
}

function textMatchesTenantOpenSubstrings(text, substrings) {
  if (!Array.isArray(substrings) || substrings.length === 0) {
    return false;
  }

  const low = String(text ?? "").toLowerCase();

  return substrings.some((s) => low.includes(String(s).toLowerCase()));
}

/**
 * Phase 2f eligibility: Layer 3 pass; reject unsafe_mutation_likely; allow safe_informational
 * or uncertain only when open-intent patterns / tenant substring allowlist match.
 */
export function evaluatePhase2fOpenCandidateEligibility(row, textAllowSubstrings) {
  const text = String(row.text ?? "").trim();
  const layer3 = isProbeUiTextUnsafe(text);

  if (layer3.unsafe) {
    return {
      eligible: false,
      reason: `rejected_layer3_ui_guard:${layer3.matched}`,
    };
  }

  const classified = classifyMutationBoundaryControl(row);

  if (classified.classification === "unsafe_mutation_likely") {
    return {
      eligible: false,
      reason: `rejected_mutation_boundary:${classified.rationale}`,
      classification: classified.classification,
    };
  }

  if (classified.classification === "safe_informational") {
    return {
      eligible: true,
      reason: "accepted_safe_informational_heuristic",
      classification: classified.classification,
    };
  }

  if (classified.classification === "uncertain") {
    const subOk = textMatchesTenantOpenSubstrings(text, textAllowSubstrings);
    const defOk = textMatchesDefaultSafeOpenIntent(text);

    if (defOk || subOk) {
      return {
        eligible: true,
        reason: subOk
          ? "accepted_uncertain_tenant_text_allowlist"
          : "accepted_uncertain_default_open_intent_pattern",
        classification: classified.classification,
        uncertain_detail: classified.uncertain_detail,
      };
    }

    return {
      eligible: false,
      reason: "rejected_uncertain_without_open_intent_match",
      classification: classified.classification,
      uncertain_detail: classified.uncertain_detail,
    };
  }

  return {
    eligible: false,
    reason: "rejected_unexpected_classification_state",
    classification: classified.classification,
  };
}

const PHASE_2N_DOWNSTREAM_FORBIDDEN_LABEL_RES = [
  /add\s*to\s*cart/i,
  /add\s*all/i,
  /checkout/i,
  /submit(\s*order)?/i,
  /place\s*order/i,
  /validate/i,
  /finalize/i,
  /complete\s*order/i,
  /confirm\s*order/i,
  /purchase/i,
  /buy\s*now/i,
  /update\s*cart/i,
];

function isPhase2nDownstreamForbiddenLabel(text) {
  const t = String(text ?? "").trim();

  if (!t) {
    return { forbidden: true, reason: "empty_control_text" };
  }

  for (const re of PHASE_2N_DOWNSTREAM_FORBIDDEN_LABEL_RES) {
    if (re.test(t)) {
      return {
        forbidden: true,
        reason: `downstream_or_cart_like_label:${re}`,
      };
    }
  }

  return { forbidden: false };
}

const PHASE_2N_DEFAULT_ADD_APPLY_INTENT_RES = [
  /\badd\s*line\b/i,
  /\bapply\s*line\b/i,
  /^apply$/i,
  /^add$/i,
];

function textMatchesPhase2nDefaultAddApplyIntent(text) {
  const t = String(text ?? "").trim();

  return PHASE_2N_DEFAULT_ADD_APPLY_INTENT_RES.some((re) => re.test(t));
}

/**
 * Phase 2n: Layer 3 downstream blocklist + mutation-boundary rules, with explicit allowance for
 * add-line / apply-line style labels (tenant allowlist or default intent patterns).
 */
export function evaluatePhase2nAddApplyCandidateEligibility(row, textAllowSubstrings) {
  const text = String(row.text ?? "").trim();
  const downstream = isPhase2nDownstreamForbiddenLabel(text);

  if (downstream.forbidden) {
    return {
      eligible: false,
      reason: downstream.reason,
    };
  }

  const layer3 = isProbeUiTextUnsafe(text);

  if (layer3.unsafe) {
    return {
      eligible: false,
      reason: `rejected_layer3_ui_guard:${layer3.matched}`,
    };
  }

  const classified = classifyMutationBoundaryControl(row);

  if (classified.classification === "unsafe_mutation_likely") {
    if (classified.rationale === "label_suggests_cart_line_mutation_heuristic") {
      const subOk = textMatchesTenantOpenSubstrings(text, textAllowSubstrings);
      const defOk = textMatchesPhase2nDefaultAddApplyIntent(text);

      if (subOk || defOk) {
        return {
          eligible: true,
          reason: subOk
            ? "accepted_add_apply_line_tenant_text_allowlist"
            : "accepted_add_apply_line_default_intent_pattern",
          classification: classified.classification,
          rationale: classified.rationale,
        };
      }
    }

    return {
      eligible: false,
      reason: `rejected_mutation_boundary:${classified.rationale}`,
      classification: classified.classification,
    };
  }

  if (classified.classification === "safe_informational") {
    return {
      eligible: false,
      reason: "rejected_safe_informational_unlikely_add_apply_target",
      classification: classified.classification,
    };
  }

  if (classified.classification === "uncertain") {
    const subOk = textMatchesTenantOpenSubstrings(text, textAllowSubstrings);
    const defOk = textMatchesPhase2nDefaultAddApplyIntent(text);

    if (subOk || defOk) {
      return {
        eligible: true,
        reason: subOk
          ? "accepted_uncertain_tenant_allowlist_add_apply"
          : "accepted_uncertain_default_add_apply_intent",
        classification: classified.classification,
        uncertain_detail: classified.uncertain_detail,
      };
    }

    return {
      eligible: false,
      reason: "rejected_uncertain_without_add_apply_intent_match",
      classification: classified.classification,
      uncertain_detail: classified.uncertain_detail,
    };
  }

  return {
    eligible: false,
    reason: "rejected_unexpected_classification_state",
    classification: classified.classification,
  };
}

const PHASE_2U_MILO_BULK_INTENT_RES = [
  /\badd\s*all(\s*to\s*cart)?\b/i,
  /\badd\s*to\s*cart\b/i,
];

function textMatchesPhase2uBulkIntent(text) {
  const t = String(text ?? "").trim();
  return PHASE_2U_MILO_BULK_INTENT_RES.some((re) => re.test(t));
}

/**
 * Phase 2u candidate eligibility:
 * - MILO bulk-action target intent only (add-all/add-to-cart variants).
 * - Downstream order actions still forbidden.
 */
export function evaluatePhase2uMiloBulkCandidateEligibility(
  row,
  textAllowSubstrings,
) {
  const text = String(row.text ?? "").trim();

  if (!text) {
    return { eligible: false, reason: "empty_control_text" };
  }

  if (/checkout|validate|submit(\s*order)?|place\s*order|finalize|confirm/i.test(text)) {
    return {
      eligible: false,
      reason: "rejected_downstream_forbidden_label",
    };
  }

  const layer3 = isProbeUiTextUnsafe(text);
  const bulkIntent = textMatchesPhase2uBulkIntent(text);
  const tenantIntent = textMatchesTenantOpenSubstrings(text, textAllowSubstrings);

  if (layer3.unsafe && !bulkIntent && !tenantIntent) {
    return {
      eligible: false,
      reason: `rejected_layer3_ui_guard:${layer3.matched}`,
    };
  }

  const classified = classifyMutationBoundaryControl(row);
  const intentAccepted = bulkIntent || tenantIntent;

  if (!intentAccepted) {
    return {
      eligible: false,
      reason: "missing_bulk_action_intent_match",
      classification: classified.classification,
    };
  }

  if (classified.classification === "safe_informational") {
    return {
      eligible: false,
      reason: "rejected_safe_informational_unlikely_bulk_target",
      classification: classified.classification,
    };
  }

  if (
    classified.classification === "unsafe_mutation_likely" &&
    classified.rationale === "label_matches_layer3_ui_guard:/add\\s*all/i"
  ) {
    return {
      eligible: true,
      reason: bulkIntent
        ? "accepted_milo_bulk_intent_pattern"
        : "accepted_milo_bulk_tenant_allowlist",
      classification: classified.classification,
      rationale: classified.rationale,
    };
  }

  if (classified.classification === "uncertain") {
    return {
      eligible: true,
      reason: bulkIntent
        ? "accepted_uncertain_milo_bulk_intent"
        : "accepted_uncertain_milo_bulk_tenant_allowlist",
      classification: classified.classification,
      uncertain_detail: classified.uncertain_detail,
    };
  }

  if (classified.classification === "unsafe_mutation_likely") {
    return {
      eligible: false,
      reason: `rejected_mutation_boundary:${classified.rationale}`,
      classification: classified.classification,
    };
  }

  return {
    eligible: false,
    reason: "rejected_unclassified_bulk_candidate",
    classification: classified.classification,
  };
}

const PHASE_2Q_DOWNSTREAM_FORBIDDEN_LABEL_RES = [
  /add\s*to\s*cart/i,
  /add\s*all/i,
  /checkout/i,
  /submit(\s*order)?/i,
  /place\s*order/i,
  /finalize/i,
  /complete\s*order/i,
  /confirm\s*order/i,
  /purchase/i,
  /buy\s*now/i,
  /update\s*cart/i,
];

function isPhase2qDownstreamForbiddenLabel(text) {
  const t = String(text ?? "").trim();

  if (!t) {
    return { forbidden: false };
  }

  for (const re of PHASE_2Q_DOWNSTREAM_FORBIDDEN_LABEL_RES) {
    if (re.test(t)) {
      return {
        forbidden: true,
        reason: `downstream_or_non_validate_label:${re}`,
      };
    }
  }

  return { forbidden: false };
}

function isPhase2qValidateOnlyHref(href) {
  const h = String(href ?? "").trim().toLowerCase();

  if (!h) {
    return false;
  }

  if (
    /checkout|order\/submit|place-order|submit-order|finalize|cart\/add|add-to-cart|addtocart/i.test(
      h,
    )
  ) {
    return false;
  }

  return /\bvalidate\b|\/validate|validateorder|validate-order/i.test(h);
}

const PHASE_2Q_DEFAULT_VALIDATE_INTENT_RES = [/\bvalidate\b/i, /^validate$/i];

function textMatchesPhase2qDefaultValidateIntent(text) {
  const t = String(text ?? "").trim();

  return PHASE_2Q_DEFAULT_VALIDATE_INTENT_RES.some((re) => re.test(t));
}

/**
 * Phase 2q: Layer 3 + mutation-boundary rules with explicit allowance for validate intent
 * (tenant allowlist, default validate patterns, or validate-only href with empty visible text).
 */
export function evaluatePhase2qValidateCandidateEligibility(row, textAllowSubstrings) {
  const text = String(row.text ?? "").trim();
  const downstream = isPhase2qDownstreamForbiddenLabel(text);

  if (downstream.forbidden) {
    return {
      eligible: false,
      reason: downstream.reason,
    };
  }

  const layer3 = isProbeUiTextUnsafe(text);

  if (layer3.unsafe) {
    return {
      eligible: false,
      reason: `rejected_layer3_ui_guard:${layer3.matched}`,
    };
  }

  const classified = classifyMutationBoundaryControl(row);

  if (classified.classification === "unsafe_mutation_likely") {
    if (classified.rationale === "href_matches_mutation_path_heuristic") {
      const href = String(row.href ?? "");
      const subOk = textMatchesTenantOpenSubstrings(text, textAllowSubstrings);
      const defOk = textMatchesPhase2qDefaultValidateIntent(text);
      const emptyText = !text;

      if (isPhase2qValidateOnlyHref(href)) {
        if (subOk || defOk) {
          return {
            eligible: true,
            reason: subOk
              ? "accepted_validate_href_tenant_text_allowlist"
              : "accepted_validate_href_default_intent_pattern",
            classification: classified.classification,
            rationale: classified.rationale,
          };
        }

        if (emptyText) {
          return {
            eligible: true,
            reason:
              "accepted_validate_only_href_empty_visible_text_tenant_selector_target",
            classification: classified.classification,
            rationale: classified.rationale,
          };
        }
      }
    }

    return {
      eligible: false,
      reason: `rejected_mutation_boundary:${classified.rationale}`,
      classification: classified.classification,
    };
  }

  if (classified.classification === "safe_informational") {
    return {
      eligible: false,
      reason: "rejected_safe_informational_unlikely_validate_target",
      classification: classified.classification,
    };
  }

  if (classified.classification === "uncertain") {
    const subOk = textMatchesTenantOpenSubstrings(text, textAllowSubstrings);
    const defOk = textMatchesPhase2qDefaultValidateIntent(text);

    if (subOk || defOk) {
      return {
        eligible: true,
        reason: subOk
          ? "accepted_uncertain_tenant_allowlist_validate"
          : "accepted_uncertain_default_validate_intent",
        classification: classified.classification,
        uncertain_detail: classified.uncertain_detail,
      };
    }

    return {
      eligible: false,
      reason: "rejected_uncertain_without_validate_intent_match",
      classification: classified.classification,
      uncertain_detail: classified.uncertain_detail,
    };
  }

  return {
    eligible: false,
    reason: "rejected_unexpected_classification_state",
    classification: classified.classification,
  };
}

async function extractMutationBoundaryRowFromLocator(locator) {
  return locator.evaluate((el) => {
    if (!(el instanceof HTMLElement)) {
      return {
        tag: "",
        text: "",
        href: "",
        type: null,
        id: null,
      };
    }

    const tag = el.tagName.toLowerCase();
    let href = "";

    if (el instanceof HTMLAnchorElement) {
      href = el.href || "";
    } else {
      const h = el.getAttribute("href");

      href = h || "";
    }

    const inner = (el.innerText || el.textContent || "").trim();
    const aria = (el.getAttribute("aria-label") || "").trim();
    const title = (el.getAttribute("title") || "").trim();
    const text = (inner || aria || title).slice(0, 300);

    return {
      tag,
      text,
      href,
      type: el.getAttribute("type"),
      id: el.id || null,
    };
  });
}

async function measureAddByCodeUiOpenSignals(page, config) {
  const visibleInputs = await collectVisibleInputs(page);
  const fieldInfo = classifyCodeAndQtyFields(visibleInputs);

  let tenant_code_field_visible = false;

  if (config.addByCodeCodeFieldSelector) {
    const loc = page.locator(config.addByCodeCodeFieldSelector).first();
    const n = await loc.count().catch(() => 0);

    tenant_code_field_visible =
      n > 0 && (await loc.isVisible().catch(() => false));
  }

  let scoped_root_visible = false;

  if (config.mutationBoundaryRootSelector) {
    const rloc = page.locator(config.mutationBoundaryRootSelector).first();
    const n = await rloc.count().catch(() => 0);

    scoped_root_visible =
      n > 0 && (await rloc.isVisible().catch(() => false));
  }

  const open_signal =
    fieldInfo.code_field_detected ||
    tenant_code_field_visible ||
    scoped_root_visible;

  return {
    open_signal,
    code_field_detected: fieldInfo.code_field_detected,
    tenant_code_field_visible,
    scoped_root_visible,
    fieldInfo,
  };
}

/**
 * Build a single Playwright CSS selector from heuristic hint (id or name only).
 * @param {{ id?: string | null, name?: string | null }} hint
 */
export function buildPlaywrightSelectorFromHint(hint) {
  if (!hint || typeof hint !== "object") {
    return null;
  }

  if (hint.id && typeof hint.id === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(hint.id)) {
    return `#${hint.id}`;
  }

  if (hint.name && typeof hint.name === "string" && hint.name.trim() !== "") {
    const escaped = hint.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    return `[name="${escaped}"]`;
  }

  return null;
}

function classifyCodeAndQtyFields(visibleInputs) {
  const rows = Array.isArray(visibleInputs) ? visibleInputs : [];

  const codeLike = (row) => {
    const blob = `${row.id ?? ""} ${row.name ?? ""} ${row.placeholder ?? ""} ${row.ariaLabel ?? ""}`.toLowerCase();

    return /code|sku|item\s*#|product|mlcc|upc|article/.test(blob);
  };

  const qtyLike = (row) => {
    const blob = `${row.id ?? ""} ${row.name ?? ""} ${row.placeholder ?? ""} ${row.ariaLabel ?? ""}`.toLowerCase();

    return (
      row.type === "number" ||
      /qty|quantity|amount|units?/.test(blob)
    );
  };

  const codeCandidates = rows.filter(codeLike);
  const qtyCandidates = rows.filter(qtyLike);

  return {
    code_field_detected: codeCandidates.length > 0,
    quantity_field_detected: qtyCandidates.length > 0,
    code_candidates_count: codeCandidates.length,
    quantity_candidates_count: qtyCandidates.length,
    visible_input_count: rows.length,
    /** Truthful: first match summaries only (no claim of usability). */
    code_field_hints: codeCandidates.slice(0, 5).map((r) => ({
      tag: r.tag,
      type: r.type,
      id: r.id,
      name: r.name,
      placeholder: r.placeholder,
    })),
    quantity_field_hints: qtyCandidates.slice(0, 5).map((r) => ({
      tag: r.tag,
      type: r.type,
      id: r.id,
      name: r.name,
    })),
  };
}

async function collectVisibleInputs(page) {
  return page.evaluate(() => {
    const out = [];
    const nodes = document.querySelectorAll("input, textarea, select");

    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) {
        continue;
      }

      if (!el.isConnected) {
        continue;
      }

      const style = window.getComputedStyle(el);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        continue;
      }

      const rect = el.getBoundingClientRect();

      if (rect.width < 2 || rect.height < 2) {
        continue;
      }

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || "text";

      if (
        type === "hidden" ||
        type === "submit" ||
        type === "image" ||
        type === "reset"
      ) {
        continue;
      }

      out.push({
        tag,
        type,
        id: el.id || null,
        name: el.getAttribute("name"),
        placeholder: el.getAttribute("placeholder"),
        ariaLabel: el.getAttribute("aria-label"),
      });
    }

    return out;
  });
}

async function getLocatorInnerText(locator) {
  try {
    const h = await locator.evaluate((el) => {
      if (!(el instanceof HTMLElement)) {
        return "";
      }

      return (el.innerText || el.textContent || "").trim().slice(0, 400);
    });

    return h || "";
  } catch {
    return "";
  }
}

/**
 * Phase 2b probe: detection only (no keystrokes). At most one optional "open UI" click if text-safe.
 */
export async function runAddByCodeProbePhase({
  page,
  config,
  heartbeat,
  buildStepEvidence,
  buildEvidence,
  evidenceCollected,
}) {
  await heartbeat({
    progressStage: "mlcc_add_by_code_probe_start",
    progressMessage:
      "Phase 2b: add-by-code probe (guards on; no cart mutation, no typing)",
  });

  evidenceCollected.push(
    await buildStepEvidence({
      page,
      stage: "mlcc_add_by_code_entry_search",
      message: "Scanning page for add-by-code entry / fields (read-only)",
      kind: "mlcc_add_by_code_probe",
      buildEvidence,
      config,
    }),
  );

  await heartbeat({
    progressStage: "mlcc_add_by_code_entry_search",
    progressMessage: "Searching for add-by-code UI or fields",
  });

  let visibleInputs = await collectVisibleInputs(page);
  let fieldInfo = classifyCodeAndQtyFields(visibleInputs);

  let addByCodeUiReached = fieldInfo.code_field_detected;
  let openedVia = addByCodeUiReached ? "fields_already_visible" : "not_yet";
  let stopReason = null;
  let entrySelectorNotFound = false;

  const skipEntryNav = config.addByCodeProbeSkipEntryNav === true;

  const tryOpenFromConfiguredSelector = async () => {
    const sel = config.addByCodeEntrySelector;

    if (!sel || typeof sel !== "string") {
      return false;
    }

    const loc = page.locator(sel).first();
    const count = await loc.count().catch(() => 0);

    if (count === 0) {
      entrySelectorNotFound = true;

      return false;
    }

    const text = await getLocatorInnerText(loc);
    const unsafe = isProbeUiTextUnsafe(text);

    if (unsafe.unsafe) {
      stopReason = `entry_control_blocked_by_ui_guard:${unsafe.matched}`;

      return false;
    }

    await loc.click({ timeout: 12_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(
      () => {},
    );
    await new Promise((r) => setTimeout(r, 600));

    openedVia = "configured_selector_clicked";

    return true;
  };

  const tryOpenFromSafeTextControl = async () => {
    const patterns = [
      /add\s*by\s*code/i,
      /enter\s*code/i,
      /product\s*code/i,
      /item\s*code/i,
      /sku/i,
    ];

    for (const nameRe of patterns) {
      const btn = page.getByRole("button", { name: nameRe }).first();
      const link = page.getByRole("link", { name: nameRe }).first();

      for (const loc of [btn, link]) {
        const n = await loc.count().catch(() => 0);

        if (n === 0) {
          continue;
        }

        const vis = await loc.isVisible().catch(() => false);

        if (!vis) {
          continue;
        }

        const text = await getLocatorInnerText(loc);
        const unsafe = isProbeUiTextUnsafe(text);

        if (unsafe.unsafe) {
          continue;
        }

        await loc.click({ timeout: 12_000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(
          () => {},
        );
        await new Promise((r) => setTimeout(r, 600));

        openedVia = "safe_text_control_clicked";

        return true;
      }
    }

    return false;
  };

  if (!addByCodeUiReached && !skipEntryNav) {
    await tryOpenFromConfiguredSelector();

    visibleInputs = await collectVisibleInputs(page);
    fieldInfo = classifyCodeAndQtyFields(visibleInputs);
    addByCodeUiReached = fieldInfo.code_field_detected;
  }

  if (!addByCodeUiReached && !stopReason && !skipEntryNav) {
    const usedText = await tryOpenFromSafeTextControl();

    visibleInputs = await collectVisibleInputs(page);
    fieldInfo = classifyCodeAndQtyFields(visibleInputs);
    addByCodeUiReached = fieldInfo.code_field_detected;

    if (!usedText && !addByCodeUiReached) {
      stopReason = entrySelectorNotFound
        ? "entry_selector_not_found_and_no_safe_text_control"
        : "no_safe_entry_path_found_without_dangerous_controls";
    }
  }

  if (skipEntryNav && !addByCodeUiReached && !stopReason) {
    stopReason = "entry_navigation_deferred_probe_skip_entry_nav_enabled";
  }

  if (!addByCodeUiReached && !stopReason) {
    stopReason = "code_like_fields_not_detected_after_probe";
  }

  evidenceCollected.push(
    await buildStepEvidence({
      page,
      stage: "mlcc_add_by_code_ui_after_attempt",
      message: addByCodeUiReached
        ? "Add-by-code UI checkpoint (code-like field visible; still no typing in Phase 2b)"
        : "Add-by-code UI not confirmed (no code-like visible input detected)",
      kind: "mlcc_add_by_code_probe",
      buildEvidence,
      config,
    }),
  );

  await heartbeat({
    progressStage: "mlcc_add_by_code_fields_scan",
    progressMessage: "Field detection complete (detection-only; no keystrokes)",
  });

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_add_by_code_probe_findings",
      message: "Phase 2b findings (truthful; no cart mutation)",
      attributes: {
        add_by_code_ui_reached: addByCodeUiReached,
        opened_via: openedVia,
        code_field_detected: fieldInfo.code_field_detected,
        quantity_field_detected: fieldInfo.quantity_field_detected,
        code_field_hints: fieldInfo.code_field_hints,
        quantity_field_hints: fieldInfo.quantity_field_hints,
        visible_input_count: fieldInfo.visible_input_count,
        typing_policy:
          "phase_2b_no_keystrokes_avoid_implicit_submit_or_cart_mutation",
        stop_reason: stopReason,
        entry_selector_not_found: entrySelectorNotFound,
        probe_skip_entry_nav: skipEntryNav,
        network_and_ui_guards: "active",
      },
    }),
  );

  if (stopReason && !addByCodeUiReached) {
    await heartbeat({
      progressStage: "mlcc_add_by_code_probe_stopped",
      progressMessage: `Stopped: ${stopReason}`,
    });
  } else {
    await heartbeat({
      progressStage: "mlcc_add_by_code_probe_complete",
      progressMessage:
        "Phase 2b probe finished without validate/checkout/submit/cart mutation",
    });
  }

  return {
    add_by_code_ui_reached: addByCodeUiReached,
    code_field_detected: fieldInfo.code_field_detected,
    quantity_field_detected: fieldInfo.quantity_field_detected,
    stop_reason: stopReason,
    opened_via: openedVia,
    field_info: fieldInfo,
  };
}

async function readFieldDomSnapshot(locator) {
  return locator.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id || null;
    const name = el.getAttribute("name");
    const placeholder = el.getAttribute("placeholder");

    if (el instanceof HTMLSelectElement) {
      const val = el.value || "";

      return {
        tagName: tag,
        id,
        name,
        placeholder,
        type: "select",
        readOnly: false,
        disabled: el.disabled,
        value_length: val.length,
        has_value: val.length > 0,
      };
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const type = (el.type || "text").toLowerCase();
      const val = el.value || "";

      return {
        tagName: tag,
        id,
        name,
        placeholder,
        type,
        readOnly: !!el.readOnly,
        disabled: !!el.disabled,
        value_length: val.length,
        has_value: val.length > 0,
        autocomplete: el.getAttribute("autocomplete"),
        inputmode: el.getAttribute("inputmode"),
      };
    }

    return { tagName: tag, unsupported: true, id, name, placeholder };
  });
}

async function collectSurroundingControlsReadonly(locator) {
  return locator.evaluate((el) => {
    const root = el.closest("form") || el.closest("div") || el.parentElement;
    if (!root) {
      return { root_tag: null, root_class: null, controls: [] };
    }
    const out = [];
    const nodes = root.querySelectorAll(
      'button, [role="button"], a[href], input[type="submit"], input[type="button"]',
    );
    for (const n of nodes) {
      if (!(n instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(n);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const raw = (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim();
      const t =
        raw ||
        (n instanceof HTMLInputElement || n instanceof HTMLButtonElement
          ? (n.value || "").trim()
          : "");
      if (!t && n.tagName !== "INPUT") continue;
      out.push({
        tag: n.tagName.toLowerCase(),
        text_or_value: t.slice(0, 140),
        type_attr: n.getAttribute("type"),
        href: n.tagName === "A" ? (n.getAttribute("href") || "").slice(0, 200) : null,
        class: (typeof n.className === "string" ? n.className : "").slice(0, 120) || null,
      });
      if (out.length >= 20) break;
    }
    return {
      root_tag: root.tagName.toLowerCase(),
      root_class:
        (typeof root.className === "string" ? root.className : String(root.className || "")).slice(
          0,
          180,
        ) || null,
      controls: out,
    };
  });
}

function markControlRiskObserved(text) {
  const t = String(text || "").trim();
  const layer3 = isProbeUiTextUnsafe(t);
  if (layer3.unsafe) {
    return { risky_observed: true, reason: `layer3:${layer3.matched}` };
  }
  if (
    /\b(validate|validation|checkout|submit|finalize|confirm\s*order|place\s*order|add\s*to\s*cart)\b/i.test(
      t,
    )
  ) {
    return { risky_observed: true, reason: "commerce_or_validate_adjacent_heuristic" };
  }
  return { risky_observed: false, reason: null };
}

/**
 * Tenant env selector wins when it matches; else MILO by-code placeholder anchor; else heuristic hints.
 */
async function resolveCodeFieldLocatorPhase2c(page, envSelector, fieldInfo) {
  if (envSelector) {
    const tenant = await resolveFieldLocator(page, envSelector, fieldInfo.code_field_hints);
    if (tenant.locator && tenant.matched) {
      return tenant;
    }
  }

  const phLoc = page.getByPlaceholder("Search by code").first();
  const n = await phLoc.count().catch(() => 0);
  const vis = n > 0 && (await phLoc.isVisible().catch(() => false));
  if (vis) {
    return {
      locator: phLoc,
      source: envSelector ? "milo_bycode_placeholder_fallback" : "milo_bycode_placeholder_anchor",
      selector_used: 'getByPlaceholder("Search by code")',
      matched: true,
    };
  }

  return resolveFieldLocator(page, envSelector || null, fieldInfo.code_field_hints);
}

async function resolveFieldLocator(page, envSelector, hints) {
  if (envSelector && typeof envSelector === "string") {
    const loc = page.locator(envSelector).first();
    const n = await loc.count().catch(() => 0);
    const vis =
      n > 0 && (await loc.isVisible().catch(() => false));

    return {
      locator: n > 0 ? loc : null,
      source: "tenant_env",
      selector_used: envSelector,
      matched: vis,
    };
  }

  const hint = hints?.[0];
  const sel = buildPlaywrightSelectorFromHint(hint);

  if (!sel) {
    return {
      locator: null,
      source: "heuristic_fallback",
      selector_used: null,
      matched: false,
      advisory: true,
    };
  }

  const loc = page.locator(sel).first();
  const n = await loc.count().catch(() => 0);
  const vis = n > 0 && (await loc.isVisible().catch(() => false));

  return {
    locator: n > 0 ? loc : null,
    source: "heuristic_fallback",
    selector_used: sel,
    matched: vis,
    advisory: true,
  };
}

/**
 * Phase 2c: prefer tenant env selectors; heuristic fallback is advisory only.
 * No product code or quantity typing. Optional focus/blur only when safe and env allows.
 */
export async function runAddByCodePhase2cFieldHardening({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  buildStepEvidence,
  phase2bFieldInfo,
  safeFlowShot = null,
}) {
  await heartbeat({
    progressStage: "mlcc_add_by_code_phase_2c_start",
    progressMessage:
      "Phase 2c: by-code route navigation (when enabled) + selector hardening + read-only inspection (no typing; no cart mutation)",
  });

  const urlBefore = page.url();
  const bycodeNavigation = {
    performed: false,
    target_url: config.addByCodePhase2cNavBycodeUrl ?? null,
    url_before: urlBefore,
    url_after: urlBefore,
    skipped_reason: null,
  };

  if (config.addByCodePhase2cSkipBycodeNav === true) {
    bycodeNavigation.skipped_reason = "MLCC_ADD_BY_CODE_PHASE_2C_SKIP_BYCODE_NAV_true";
  } else if (!config.addByCodePhase2cNavBycodeUrl) {
    bycodeNavigation.skipped_reason = "no_nav_url_configured";
  } else {
    await page.goto(config.addByCodePhase2cNavBycodeUrl, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    bycodeNavigation.performed = true;
    bycodeNavigation.url_after = page.url();
  }

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_add_by_code_phase_2c_after_bycode_nav",
        message: bycodeNavigation.performed
          ? `Phase 2c: navigated to dedicated by-code surface (${bycodeNavigation.url_after})`
          : `Phase 2c: by-code nav skipped (${bycodeNavigation.skipped_reason ?? "unknown"}) — inspecting current page`,
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const visibleInputs = await collectVisibleInputs(page);
  const fieldInfo = classifyCodeAndQtyFields(visibleInputs);

  const tenantEnv = {
    code_field: Boolean(config.addByCodeCodeFieldSelector),
    quantity_field: Boolean(config.addByCodeQtyFieldSelector),
    entry: Boolean(config.addByCodeEntrySelector),
  };

  const codeRes = await resolveCodeFieldLocatorPhase2c(
    page,
    config.addByCodeCodeFieldSelector,
    fieldInfo,
  );

  const qtyRes = await resolveFieldLocator(
    page,
    config.addByCodeQtyFieldSelector,
    fieldInfo.quantity_field_hints,
  );

  const inspectOne = async (label, resolved) => {
    if (!resolved.locator || !resolved.matched) {
      return {
        field: label,
        resolved: false,
        source: resolved.source,
        selector_used: resolved.selector_used,
        tenant_env_used: resolved.source === "tenant_env",
        heuristic_advisory: resolved.advisory === true,
        interaction: "skipped",
        skip_reason:
          resolved.source === "tenant_env" && !resolved.matched
            ? "tenant_selector_no_match_or_not_visible"
            : "field_not_resolved",
        non_mutating_interaction_possible: false,
      };
    }

    const snap = await readFieldDomSnapshot(resolved.locator);

    const risk = await resolved.locator.evaluate((el) => {
      if (el instanceof HTMLSelectElement) {
        return { risky: true, reason: "select_element" };
      }

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const t = (el.type || "text").toLowerCase();

        if (
          ["submit", "button", "image", "reset", "checkbox", "radio"].includes(
            t,
          )
        ) {
          return { risky: true, reason: `input_type_${t}` };
        }

        const form = el.form;

        if (form && form.action) {
          const a = String(form.action).toLowerCase();

          if (
            /(checkout|cart\/add|order\/submit|place-order|validate|finalize)/i.test(
              a,
            )
          ) {
            return { risky: true, reason: "form_action_heuristic_suspicious" };
          }
        }

        return { risky: false };
      }

      return { risky: true, reason: "unsupported_element" };
    });

    const visible = await resolved.locator.isVisible().catch(() => false);

    let interaction = "readonly_dom_inspection_only";
    let focusBlur = "skipped";
    let nonMut = false;

    if (risk.risky) {
      focusBlur = `skipped_risk:${risk.reason}`;
      interaction = "skipped_mutation_risk";
    } else if (!config.addByCodeSafeFocusBlur) {
      focusBlur =
        "skipped_env_MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR_not_true";
    } else if (snap.disabled || snap.readOnly) {
      focusBlur = "skipped_disabled_or_readonly";
    } else {
      try {
        await resolved.locator.focus({ timeout: 3000 });

        if (typeof resolved.locator.blur === "function") {
          await resolved.locator.blur({ timeout: 3000 });
        } else {
          await resolved.locator.evaluate((el) => {
            if (el instanceof HTMLElement) {
              el.blur();
            }
          });
        }

        focusBlur = "focus_blur_performed";
        interaction = "readonly_dom_inspection_plus_focus_blur";
        nonMut = true;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);

        focusBlur = `skipped_focus_error:${m}`;
      }
    }

    return {
      field: label,
      resolved: true,
      source: resolved.source,
      selector_used: resolved.selector_used,
      tenant_env_used: resolved.source === "tenant_env",
      heuristic_advisory: resolved.advisory === true,
      visible,
      enabled_editable_reported: {
        disabled: snap.disabled,
        readOnly: snap.readOnly,
      },
      dom_snapshot: snap,
      focus_blur_risk: risk,
      focus_blur: focusBlur,
      interaction,
      non_mutating_interaction_possible: nonMut,
      disclaimer:
        "field_present_and_inspected_does_not_imply_safe_for_product_typing_later",
    };
  };

  const codeInspect = await inspectOne("code", codeRes);
  const qtyInspect = await inspectOne("quantity", qtyRes);

  let surrounding_controls_code_field = null;
  if (codeRes.locator && codeRes.matched) {
    const raw = await collectSurroundingControlsReadonly(codeRes.locator);
    surrounding_controls_code_field = {
      ...raw,
      controls: raw.controls.map((c) => ({
        ...c,
        ...markControlRiskObserved(c.text_or_value),
      })),
    };
  }

  const phase2cFieldHardeningSuccess = codeInspect.resolved === true;
  const phase2cLaneNote =
    "bounded_no_order_no_cart_mutation_no_validate_no_add_to_cart_typing_or_submit";

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_add_by_code_phase_2c_findings",
      message:
        "Phase 2c field hardening (by-code route default; placeholder anchor; tenant env overrides when matched)",
      attributes: {
        bycode_navigation: bycodeNavigation,
        field_detection_after_navigation: {
          visible_input_count: fieldInfo.visible_input_count,
          code_field_detected: fieldInfo.code_field_detected,
          quantity_field_detected: fieldInfo.quantity_field_detected,
          code_field_hints: fieldInfo.code_field_hints,
          quantity_field_hints: fieldInfo.quantity_field_hints,
        },
        phase_2b_field_info_carried_for_reference_only: phase2bFieldInfo ?? null,
        tenant_env_selectors_provided: tenantEnv,
        code_resolution: {
          source: codeRes.source,
          selector_used: codeRes.selector_used,
          matched: codeRes.matched,
        },
        code_field: codeInspect,
        quantity_field: qtyInspect,
        surrounding_controls_code_field,
        phase_2c_field_hardening_success: phase2cFieldHardeningSuccess,
        phase_2c_safe_no_cart_mutation: true,
        phase_2c_lane_note: phase2cLaneNote,
        typing_policy_phase_2c:
          "no_product_code_or_quantity_typing_inspection_and_optional_focus_blur_only",
        cart_mutation: "none",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_add_by_code_phase_2c_complete",
    progressMessage:
      "Phase 2c complete (no validate/add-to-cart/checkout/submit)",
  });

  if (typeof safeFlowShot === "function") {
    await safeFlowShot("bycode_page_loaded", "mlcc_bycode_loaded.png");
  }

  return {
    code_field: codeInspect,
    quantity_field: qtyInspect,
    tenant_env_selectors_provided: tenantEnv,
    bycode_navigation: bycodeNavigation,
    surrounding_controls_code_field,
    phase_2c_field_hardening_success: phase2cFieldHardeningSuccess,
    phase_2c_safe_no_cart_mutation: true,
    field_detection: fieldInfo,
  };
}

/** Bump when Phase 2g policy semantics change (anti-drift / operator docs). */
export const PHASE_2G_TYPING_POLICY_VERSION = "lk-rpa-2g-1";

export function buildPhase2gTypingPolicyManifest() {
  return {
    version: PHASE_2G_TYPING_POLICY_VERSION,
    phase_intent: "pre_mutation_typing_policy_and_bounded_rehearsal_only",
    default_behavior: "read_only_field_and_risk_analysis_no_product_value_entry",
    cart_mutation_in_phase_2g: "none_by_design",
    future_approved_typing_phase_would_require: [
      "explicit_later_phase_in_repo_plus_anti_drift_updates",
      "dedicated_env_flag_not_implemented_placeholder_MLCC_ADD_BY_CODE_TYPING_PHASE_APPROVED",
      "tenant_code_and_quantity_selectors_resolved_or_documented_operator_waiver",
      "layer_2_network_guards_remain_installed",
      "layer_3_submit_like_controls_remain_out_of_scope_for_blind_entry",
      "phase_2g_extended_mutation_risk_documented_pass_or_recorded_exception",
      "still_no_checkout_validate_add_to_cart_submit_in_worker_paths",
    ],
    stop_conditions: [
      "extended_mutation_risk_rehearsal_blocked",
      "field_disabled_readonly_or_not_visible",
      "sentinel_typing_env_on_but_value_invalid_or_missing",
      "sentinel_skipped_for_number_input_until_numeric_policy_exists",
      "network_guard_blocked_request_count_increases_during_sentinel_rehearsal",
    ],
    mutation_risk_signals_documented: [
      "input_type_and_select_eligibility",
      "form_action_url_mutation_heuristic",
      "form_http_method_post_advisory",
      "visible_submit_control_count_in_form_advisory",
      "field_id_and_name_mutation_heuristic",
      "network_abort_delta_around_sentinel_fill_clear",
    ],
  };
}

/**
 * Serializable DOM hints from the page → Node-side risk (tests call this directly).
 */
export function computePhase2gExtendedMutationRisk(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      rehearsal_blocked: true,
      block_reasons: ["invalid_risk_payload"],
      advisory_signals: [],
    };
  }

  if (raw.kind === "select") {
    return {
      rehearsal_blocked: true,
      block_reasons: ["select_element"],
      advisory_signals: [],
    };
  }

  if (raw.kind === "unsupported") {
    return {
      rehearsal_blocked: true,
      block_reasons: ["unsupported_element"],
      advisory_signals: [],
    };
  }

  if (raw.kind !== "field") {
    return {
      rehearsal_blocked: true,
      block_reasons: ["unknown_element_kind"],
      advisory_signals: [],
    };
  }

  const t = String(raw.inputType || "text").toLowerCase();

  if (
    [
      "submit",
      "button",
      "image",
      "reset",
      "checkbox",
      "radio",
      "file",
      "hidden",
    ].includes(t)
  ) {
    return {
      rehearsal_blocked: true,
      block_reasons: [`input_type_${t}`],
      advisory_signals: [],
    };
  }

  const blockReasons = [];
  const advisory = [];
  const a = String(raw.formAction ?? "").toLowerCase();

  if (
    /(checkout|cart\/add|order\/submit|place-order|validate|finalize|addtocart|add-to-cart|\/cart\/)/i.test(
      a,
    )
  ) {
    blockReasons.push("form_action_mutation_heuristic");
  }

  const method = String(raw.formMethodAttr ?? "get").toLowerCase();

  if (method === "post") {
    advisory.push("form_method_post");
  }

  const sc = Number(raw.formSubmitCount) || 0;

  if (sc > 0) {
    advisory.push(`form_contains_${sc}_submit_controls`);
  }

  const ident = `${String(raw.id ?? "")} ${String(raw.name ?? "")}`
    .toLowerCase()
    .replace(/\s+/g, "");

  if (
    /checkout|placeorder|submitorder|cartadd|addtocart|validate|finalize|place-order/i.test(
      ident,
    )
  ) {
    blockReasons.push("field_identifier_mutation_heuristic");
  }

  if (t === "number") {
    advisory.push(
      "input_type_number_sentinel_not_used_until_explicit_numeric_sentinel_policy",
    );
  }

  return {
    rehearsal_blocked: blockReasons.length > 0,
    block_reasons: blockReasons,
    advisory_signals: advisory,
    input_type: t,
  };
}

async function collectPhase2gRiskPayloadFromLocator(locator) {
  return locator.evaluate((el) => {
    if (!(el instanceof Element)) {
      return { kind: "unsupported" };
    }

    if (el instanceof HTMLSelectElement) {
      return { kind: "select" };
    }

    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return { kind: "unsupported" };
    }

    const t = (el.type || "text").toLowerCase();
    const form = el.form;
    let formAction = "";
    let formMethodAttr = "get";
    let formSubmitCount = 0;

    if (form) {
      formAction = form.action || "";
      formMethodAttr = form.getAttribute("method") || "get";
      formSubmitCount = form.querySelectorAll(
        'input[type="submit"],button[type="submit"]',
      ).length;
    }

    return {
      kind: "field",
      inputType: t,
      formAction,
      formMethodAttr,
      formSubmitCount,
      id: el.id || "",
      name: el.getAttribute("name") || "",
    };
  });
}

const PHASE_2G_SENTINEL_RE = /^__LK_[A-Z0-9_]{1,48}__$/;

/**
 * Validates optional sentinel for Phase 2g rehearsal (never a real SKU).
 */
export function parsePhase2gSentinelValue(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, value: null };
  }

  const v = String(raw).trim();

  if (!PHASE_2G_SENTINEL_RE.test(v)) {
    return {
      ok: false,
      value: null,
      reason:
        "must_match___LK_[A-Z0-9_]{1,48}__uppercase_lk_sentinel_only",
    };
  }

  return { ok: true, value: v };
}

function isPhase2gTextLikeInputType(t) {
  const x = String(t || "text").toLowerCase();

  return ["text", "search", "tel", "url", "email", "password"].includes(x);
}

async function runPhase2gFieldPolicyAndRehearsal({
  label,
  resolved,
  config,
  page,
  guardStats,
}) {
  const base = {
    field: label,
    selector_used: resolved.selector_used,
    source: resolved.source,
    matched: resolved.matched,
  };

  if (!resolved.locator || !resolved.matched) {
    return {
      ...base,
      resolved: false,
      skip_reason:
        resolved.source === "tenant_env" && !resolved.matched
          ? "tenant_selector_no_match_or_not_visible"
          : "field_not_resolved",
      focusable_editable_summary: null,
      mutation_risk: null,
      rehearsal_tier: "none",
      rehearsal_detail:
        "no_dom_target_interaction_skipped_fully_non_mutating",
      field_rehearsal_allowed: false,
      field_rehearsal_blocked_reason: "no_resolved_visible_field",
      run_remained_non_mutating: true,
    };
  }

  const snap = await readFieldDomSnapshot(resolved.locator);

  const rawPayload = await collectPhase2gRiskPayloadFromLocator(
    resolved.locator,
  );
  const mutation_risk = computePhase2gExtendedMutationRisk(rawPayload);

  if (snap.unsupported) {
    return {
      ...base,
      resolved: true,
      dom_snapshot: snap,
      focusable_editable_summary: null,
      mutation_risk,
      rehearsal_tier: "none",
      rehearsal_detail: "skipped_unsupported_dom_snapshot_element",
      field_rehearsal_allowed: false,
      field_rehearsal_blocked_reason: "unsupported_element",
      run_remained_non_mutating: true,
    };
  }

  const visible = await resolved.locator.isVisible().catch(() => false);

  const tabFocusable = await resolved.locator.evaluate((el) => {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    if (el.hasAttribute("disabled")) {
      return false;
    }

    const ti = el.getAttribute("tabindex");

    if (ti === "-1") {
      return false;
    }

    return true;
  });

  const typeLower =
    snap && typeof snap.type === "string"
      ? snap.type.toLowerCase()
      : "text";

  const focusable_editable_summary = {
    visible,
    disabled: snap.disabled,
    readOnly: snap.readOnly,
    tab_focusable_heuristic: tabFocusable,
    likely_text_entry_surface:
      !snap.disabled &&
      !snap.readOnly &&
      (snap.tagName === "textarea" || isPhase2gTextLikeInputType(typeLower)),
  };

  let rehearsal_tier = "none";
  let rehearsal_detail =
    "policy_read_only_default_no_phase_2g_rehearsal_env_enabled";
  let run_remained_non_mutating = true;
  let network_guard_delta_rehearsal = null;

  if (mutation_risk.rehearsal_blocked) {
    return {
      ...base,
      resolved: true,
      dom_snapshot: snap,
      focusable_editable_summary,
      mutation_risk,
      rehearsal_tier: "none",
      rehearsal_detail: `blocked_extended_mutation_risk:${mutation_risk.block_reasons.join("|")}`,
      field_rehearsal_allowed: false,
      field_rehearsal_blocked_reason: "extended_mutation_risk",
      run_remained_non_mutating: true,
    };
  }

  if (snap.disabled || snap.readOnly) {
    return {
      ...base,
      resolved: true,
      dom_snapshot: snap,
      focusable_editable_summary,
      mutation_risk,
      rehearsal_tier: "none",
      rehearsal_detail: "skipped_disabled_or_readonly",
      field_rehearsal_allowed: false,
      field_rehearsal_blocked_reason: "disabled_or_readonly",
      run_remained_non_mutating: true,
    };
  }

  const sentinelOn = config.addByCodePhase2gSentinelTyping === true;
  const sentinelVal = config.addByCodePhase2gSentinelValue;
  const focusBlurOn = config.addByCodePhase2gFocusBlurRehearsal === true;

  if (sentinelOn) {
    if (!sentinelVal) {
      return {
        ...base,
        resolved: true,
        dom_snapshot: snap,
        focusable_editable_summary,
        mutation_risk,
        rehearsal_tier: "none",
        rehearsal_detail:
          "sentinel_typing_env_on_but_sentinel_value_missing_or_invalid",
        field_rehearsal_allowed: false,
        field_rehearsal_blocked_reason: "sentinel_not_configured",
        run_remained_non_mutating: true,
      };
    }

    if (typeLower === "number") {
      return {
        ...base,
        resolved: true,
        dom_snapshot: snap,
        focusable_editable_summary,
        mutation_risk,
        rehearsal_tier: "none",
        rehearsal_detail:
          "sentinel_skipped_input_type_number_pending_future_numeric_policy",
        field_rehearsal_allowed: false,
        field_rehearsal_blocked_reason: "number_input_sentinel_policy_not_implemented",
        run_remained_non_mutating: true,
      };
    }

    if (
      snap.tagName !== "textarea" &&
      !isPhase2gTextLikeInputType(typeLower)
    ) {
      return {
        ...base,
        resolved: true,
        dom_snapshot: snap,
        focusable_editable_summary,
        mutation_risk,
        rehearsal_tier: "none",
        rehearsal_detail: `sentinel_skipped_non_text_like_input_type:${typeLower}`,
        field_rehearsal_allowed: false,
        field_rehearsal_blocked_reason: "input_type_not_text_like_for_sentinel",
        run_remained_non_mutating: true,
      };
    }

    const blockedBefore =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    try {
      await resolved.locator.fill(sentinelVal, { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 200));
      await resolved.locator.fill("", { timeout: 5000 });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      return {
        ...base,
        resolved: true,
        dom_snapshot: snap,
        focusable_editable_summary,
        mutation_risk,
        rehearsal_tier: "none",
        rehearsal_detail: `sentinel_rehearsal_failed:${m}`,
        field_rehearsal_allowed: false,
        field_rehearsal_blocked_reason: "playwright_error",
        run_remained_non_mutating: false,
      };
    }

    const blockedAfter =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    network_guard_delta_rehearsal =
      blockedBefore != null && blockedAfter != null
        ? blockedAfter - blockedBefore
        : null;

    const guardObserved =
      network_guard_delta_rehearsal != null && network_guard_delta_rehearsal > 0;

    return {
      ...base,
      resolved: true,
      dom_snapshot: snap,
      focusable_editable_summary,
      mutation_risk,
      rehearsal_tier: "sentinel_fill_clear",
      rehearsal_detail: guardObserved
        ? "sentinel_performed_but_network_guard_abort_observed_not_interpreted_as_cart_proof"
        : "sentinel_fill_and_clear_completed_no_new_network_aborts_observed",
      field_rehearsal_allowed: true,
      field_rehearsal_blocked_reason: null,
      network_guard_delta_rehearsal,
      run_remained_non_mutating: !guardObserved,
      sentinel_disclaimer:
        "synthetic_sentinel_only_real_product_codes_and_quantities_remain_forbidden_until_future_phase",
    };
  }

  if (focusBlurOn) {
    const blockedBefore =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    try {
      await resolved.locator.focus({ timeout: 3000 });

      if (typeof resolved.locator.blur === "function") {
        await resolved.locator.blur({ timeout: 3000 });
      } else {
        await resolved.locator.evaluate((el) => {
          if (el instanceof HTMLElement) {
            el.blur();
          }
        });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      return {
        ...base,
        resolved: true,
        dom_snapshot: snap,
        focusable_editable_summary,
        mutation_risk,
        rehearsal_tier: "none",
        rehearsal_detail: `focus_blur_failed:${m}`,
        field_rehearsal_allowed: false,
        field_rehearsal_blocked_reason: "focus_blur_error",
        run_remained_non_mutating: true,
      };
    }

    const blockedAfter =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    network_guard_delta_rehearsal =
      blockedBefore != null && blockedAfter != null
        ? blockedAfter - blockedBefore
        : null;

    const guardObserved =
      network_guard_delta_rehearsal != null && network_guard_delta_rehearsal > 0;

    return {
      ...base,
      resolved: true,
      dom_snapshot: snap,
      focusable_editable_summary,
      mutation_risk,
      rehearsal_tier: "focus_blur_only",
      rehearsal_detail: guardObserved
        ? "focus_blur_done_network_abort_observed_advisory_only"
        : "focus_blur_performed_phase_2g_env_no_new_network_aborts",
      field_rehearsal_allowed: true,
      field_rehearsal_blocked_reason: null,
      network_guard_delta_rehearsal,
      run_remained_non_mutating: !guardObserved,
    };
  }

  return {
    ...base,
    resolved: true,
    dom_snapshot: snap,
    focusable_editable_summary,
    mutation_risk,
    rehearsal_tier: "none",
    rehearsal_detail,
    field_rehearsal_allowed: false,
    field_rehearsal_blocked_reason: "rehearsal_env_disabled",
    run_remained_non_mutating: true,
  };
}

/**
 * Phase 2g: typing policy manifest + extended mutation-risk readout + env-gated rehearsal only.
 * No real product code or quantity values. No submit/validate/checkout/add-to-cart.
 */
export async function runAddByCodePhase2gTypingPolicyAndRehearsal({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  phase2bFieldInfo,
}) {
  await heartbeat({
    progressStage: "mlcc_phase_2g_typing_policy_start",
    progressMessage:
      "Phase 2g: pre-mutation typing policy + bounded rehearsal (default read-only)",
  });

  const manifest = buildPhase2gTypingPolicyManifest();

  const visibleInputs = await collectVisibleInputs(page);
  const freshFieldInfo = classifyCodeAndQtyFields(visibleInputs);
  /** Prefer current-page detection (e.g. after Phase 2c goto /bycode); 2b field_info is often empty on home/products. */
  const fieldInfo =
    freshFieldInfo.visible_input_count > 0
      ? freshFieldInfo
      : phase2bFieldInfo && typeof phase2bFieldInfo === "object"
        ? phase2bFieldInfo
        : freshFieldInfo;

  const codeRes = await resolveFieldLocator(
    page,
    config.addByCodeCodeFieldSelector,
    fieldInfo.code_field_hints,
  );

  const qtyRes = await resolveFieldLocator(
    page,
    config.addByCodeQtyFieldSelector,
    fieldInfo.quantity_field_hints,
  );

  const codeRow = await runPhase2gFieldPolicyAndRehearsal({
    label: "code",
    resolved: codeRes,
    config,
    page,
    guardStats,
  });

  const qtyRow = await runPhase2gFieldPolicyAndRehearsal({
    label: "quantity",
    resolved: qtyRes,
    config,
    page,
    guardStats,
  });

  const any_rehearsal_performed =
    codeRow.rehearsal_tier !== "none" || qtyRow.rehearsal_tier !== "none";

  const run_remained_fully_non_mutating =
    codeRow.run_remained_non_mutating !== false &&
    qtyRow.run_remained_non_mutating !== false;

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2g_typing_policy_findings",
      message:
        "Phase 2g typing policy + rehearsal (truthful; no real product values; no cart mutation paths)",
      attributes: {
        phase_2g_field_info_source:
          freshFieldInfo.visible_input_count > 0
            ? "current_page_classifyCodeAndQtyFields"
            : phase2bFieldInfo && typeof phase2bFieldInfo === "object"
              ? "phase_2b_field_info_fallback_no_visible_inputs_current_page"
              : "current_page_classifyCodeAndQtyFields",
        typing_policy_manifest: manifest,
        code_field_policy: codeRow,
        quantity_field_policy: qtyRow,
        rehearsal_env: {
          phase_2g_focus_blur_rehearsal:
            config.addByCodePhase2gFocusBlurRehearsal === true,
          phase_2g_sentinel_typing:
            config.addByCodePhase2gSentinelTyping === true,
          sentinel_configured: Boolean(config.addByCodePhase2gSentinelValue),
        },
        any_rehearsal_performed,
        run_remained_fully_non_mutating,
        layers_active: {
          layer_2_network_abort_counts_tracked:
            guardStats &&
            typeof guardStats.blockedRequestCount === "number",
          layer_3_ui_guard_module: "MLCC_PROBE_UNSAFE_UI_TEXT_for_clicks_not_for_field_typing",
        },
        cart_mutation: "none",
        typing_policy_phase_2g:
          "no_real_product_code_or_quantity_entry_default_read_only_plus_optional_gated_rehearsal",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2g_typing_policy_complete",
    progressMessage:
      "Phase 2g complete (no validate/add-to-cart/checkout/submit)",
  });

  return {
    typing_policy_manifest: manifest,
    code_field: codeRow,
    quantity_field: qtyRow,
    any_rehearsal_performed,
    run_remained_fully_non_mutating,
  };
}

export const PHASE_2H_REAL_CODE_POLICY_VERSION = "lk-rpa-2h-2";

const PHASE_2H_TEST_CODE_MAX_LEN = 64;

/** Max digits when the tenant code field is input type=number (synthetic test string only). */
const PHASE_2H_NUMBER_SURFACE_MAX_DIGITS = 12;

/**
 * When the code field is type=number, test code must be 1–12 digits only (synthetic; operator avoids real SKUs).
 * Config already validated via parsePhase2hTestCode; this gates the number-input surface only.
 */
export function validatePhase2hTestCodeForNumberInputSurface(value) {
  if (value == null || typeof value !== "string") {
    return {
      ok: false,
      reason: "missing_or_invalid_type",
    };
  }

  const v = value.trim();

  if (v.length === 0) {
    return { ok: false, reason: "empty_after_trim" };
  }

  if (v.length > PHASE_2H_NUMBER_SURFACE_MAX_DIGITS) {
    return {
      ok: false,
      reason: `exceeds_number_surface_max_digits_${PHASE_2H_NUMBER_SURFACE_MAX_DIGITS}`,
    };
  }

  if (!/^\d+$/.test(v)) {
    return {
      ok: false,
      reason: "number_input_requires_digits_only",
    };
  }

  return { ok: true, value: v };
}

/**
 * Single env-provided test code for Phase 2h (not a quantity; no newlines).
 */
export function parsePhase2hTestCode(raw) {
  if (raw == null || String(raw).trim() === "") {
    return {
      ok: false,
      value: null,
      reason: "empty_or_missing",
    };
  }

  const v = String(raw).trim();

  if (v.length > PHASE_2H_TEST_CODE_MAX_LEN) {
    return {
      ok: false,
      value: null,
      reason: `exceeds_max_length_${PHASE_2H_TEST_CODE_MAX_LEN}`,
    };
  }

  if (/[\r\n]/.test(v)) {
    return {
      ok: false,
      value: null,
      reason: "newlines_not_allowed",
    };
  }

  return { ok: true, value: v };
}

export const PHASE_2J_QUANTITY_POLICY_VERSION = "lk-rpa-2j-1";

const PHASE_2J_TEST_QUANTITY_RE = /^[1-9]\d{0,7}$/;

/**
 * Strict env test quantity for Phase 2j: 1–8 digit positive integer string (no leading zeros).
 */
export function parsePhase2jTestQuantity(raw) {
  if (raw == null || String(raw).trim() === "") {
    return {
      ok: false,
      value: null,
      reason: "empty_or_missing",
    };
  }

  const v = String(raw).trim();

  if (!PHASE_2J_TEST_QUANTITY_RE.test(v)) {
    return {
      ok: false,
      value: null,
      reason: "must_be_1_to_8_digit_positive_integer_no_leading_zero",
    };
  }

  return { ok: true, value: v };
}

export const PHASE_2L_COMBINED_POLICY_VERSION = "lk-rpa-2l-2";

/** Phase 2n: one bounded add/apply-line click; aligns with mlcc-phase-2m-policy.js gate manifest. */
export const PHASE_2N_ADD_APPLY_POLICY_VERSION = "lk-rpa-2n-1";
/** Phase 2u: MILO-specific guarded bulk-action phase execution policy. */
export const PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION = "lk-rpa-2u-exec-1";

/** Phase 2o: read-only DOM / status observation after Phase 2n; no clicks, no validate/checkout/submit. */
export const PHASE_2O_OBSERVATION_POLICY_VERSION = "lk-rpa-2o-1";

/** Phase 2q: one bounded validate click; aligns with mlcc-phase-2p-policy.js gate manifest. */
export const PHASE_2Q_VALIDATE_POLICY_VERSION = "lk-rpa-2q-1";
export const PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION = "lk-rpa-2v-exec-1";

/** Phase 2r: read-only observation after Phase 2q; no clicks; no checkout/submit/finalize. */
export const PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION = "lk-rpa-2r-1";

/**
 * Bounded settle wait between Phase 2o pre/post read-only scrapes (ms). Default 500; max 5000.
 */
export function parsePhase2oSettleMs(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, value: 500 };
  }

  const n = Number.parseInt(String(raw).trim(), 10);

  if (!Number.isFinite(n) || n < 0) {
    return {
      ok: false,
      value: null,
      reason: "must_be_non_negative_integer_ms",
    };
  }

  return { ok: true, value: Math.min(n, 5000) };
}

/**
 * Bounded settle between Phase 2r pre/post read-only scrapes after validate (ms). Default 600; max 5000.
 */
export function parsePhase2rSettleMs(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, value: 600 };
  }

  const n = Number.parseInt(String(raw).trim(), 10);

  if (!Number.isFinite(n) || n < 0) {
    return {
      ok: false,
      value: null,
      reason: "must_be_non_negative_integer_ms",
    };
  }

  return { ok: true, value: Math.min(n, 5000) };
}

/**
 * Optional ms to wait on the current page after Phase 2o (MILO post-2u) and before read-only cart navigation.
 * Default 0 (off). Max 5000. When value is positive, worker requires matching operator approval env.
 */
export function parseMiloPost2uPreReadonlyCartDiscoverySettleMs(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, value: 0 };
  }

  const n = Number.parseInt(String(raw).trim(), 10);

  if (!Number.isFinite(n) || n < 0) {
    return {
      ok: false,
      value: null,
      reason: "must_be_non_negative_integer_ms",
    };
  }

  return { ok: true, value: Math.min(n, 5000) };
}

/**
 * Compare two Phase 2o observation payloads (truthful: visible DOM heuristic only, not server cart).
 */
export function diffPhase2oObservationSnapshots(pre, post) {
  const preUrl = pre?.url ?? "";
  const postUrl = post?.url ?? "";
  const preTitle = pre?.title ?? "";
  const postTitle = post?.title ?? "";
  const preOpen = Boolean(pre?.ui_open_signals?.open_signal);
  const postOpen = Boolean(post?.ui_open_signals?.open_signal);
  const preCodeDet = Boolean(pre?.visible_input_field_summary?.code_field_detected);
  const postCodeDet = Boolean(post?.visible_input_field_summary?.code_field_detected);
  const preQtyDet = Boolean(pre?.visible_input_field_summary?.quantity_field_detected);
  const postQtyDet = Boolean(post?.visible_input_field_summary?.quantity_field_detected);
  const preCodeVis = Boolean(pre?.tenant_code_field_state?.visible);
  const postCodeVis = Boolean(post?.tenant_code_field_state?.visible);
  const preQtyVis = Boolean(pre?.tenant_quantity_field_state?.visible);
  const postQtyVis = Boolean(post?.tenant_quantity_field_state?.visible);
  const preBodyLen = pre?.body_text_digest?.char_length ?? -1;
  const postBodyLen = post?.body_text_digest?.char_length ?? -1;
  const preHead = pre?.body_text_digest?.head_snippet ?? "";
  const postHead = post?.body_text_digest?.head_snippet ?? "";
  const preStatusN = Array.isArray(pre?.status_alert_and_live_region_samples)
    ? pre.status_alert_and_live_region_samples.length
    : 0;
  const postStatusN = Array.isArray(post?.status_alert_and_live_region_samples)
    ? post.status_alert_and_live_region_samples.length
    : 0;
  const preHits = JSON.stringify(
    pre?.inferred_cart_or_line_text_clues?.regex_hits_visible_text_only ?? [],
  );
  const postHits = JSON.stringify(
    post?.inferred_cart_or_line_text_clues?.regex_hits_visible_text_only ?? [],
  );

  const addApplyPre = JSON.stringify(pre?.add_apply_selector_states ?? []);
  const addApplyPost = JSON.stringify(post?.add_apply_selector_states ?? []);

  const any_heuristic_delta =
    preUrl !== postUrl ||
    preTitle !== postTitle ||
    preOpen !== postOpen ||
    preCodeDet !== postCodeDet ||
    preQtyDet !== postQtyDet ||
    preCodeVis !== postCodeVis ||
    preQtyVis !== postQtyVis ||
    preBodyLen !== postBodyLen ||
    preHead !== postHead ||
    preStatusN !== postStatusN ||
    preHits !== postHits ||
    addApplyPre !== addApplyPost;

  return {
    url_changed: preUrl !== postUrl,
    title_changed: preTitle !== postTitle,
    open_signal_changed: preOpen !== postOpen,
    visible_input_code_field_detected_changed: preCodeDet !== postCodeDet,
    visible_input_quantity_field_detected_changed: preQtyDet !== postQtyDet,
    tenant_code_field_visible_changed: preCodeVis !== postCodeVis,
    tenant_quantity_field_visible_changed: preQtyVis !== postQtyVis,
    body_char_length_changed: preBodyLen !== postBodyLen,
    body_head_snippet_changed: preHead !== postHead,
    status_or_live_region_sample_count_changed: preStatusN !== postStatusN,
    inferred_regex_hits_changed: preHits !== postHits,
    add_apply_selector_states_changed: addApplyPre !== addApplyPost,
    any_heuristic_dom_or_signal_delta: any_heuristic_delta,
    labeling:
      "client_visible_text_and_dom_summary_diff_only_not_inventory_or_server_cart_proof",
  };
}

/**
 * Extends Phase 2o diff with validate-selector and inferred checkout-adjacent control samples (read-only scan).
 */
export function diffPhase2rPostValidateObservationSnapshots(pre, post) {
  const base = diffPhase2oObservationSnapshots(pre, post);
  const valPre = JSON.stringify(pre?.validate_selector_states ?? []);
  const valPost = JSON.stringify(post?.validate_selector_states ?? []);
  const chkPre = JSON.stringify(
    pre?.checkout_like_controls_inferred?.samples ?? [],
  );
  const chkPost = JSON.stringify(
    post?.checkout_like_controls_inferred?.samples ?? [],
  );
  const valChanged = valPre !== valPost;
  const chkChanged = chkPre !== chkPost;

  return {
    ...base,
    validate_selector_states_changed: valChanged,
    inferred_checkout_like_control_samples_changed: chkChanged,
    any_heuristic_dom_or_signal_delta:
      base.any_heuristic_dom_or_signal_delta || valChanged || chkChanged,
    labeling:
      `${base.labeling};phase_2r_includes_validate_selector_state_and_inferred_checkout_adjacent_visible_control_scan`,
  };
}

/**
 * Structured read-only snapshot used for Phase 2u reconciliation (pre vs post click).
 * Visible DOM heuristics only; not server/cart truth.
 */
export async function collectPhase2uReconciliationSnapshot(page) {
  return page.evaluate(() => {
    const compact = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const getText = (node) => compact(node?.textContent || "");

    const bodyText = compact(document.body?.innerText || "");
    const bodyExcerpt = bodyText.slice(0, 1200);

    const successNodes = Array.from(
      document.querySelectorAll(
        '[role="alert"], [role="status"], .toast, .alert, .success, .error',
      ),
    )
      .map((n) => getText(n))
      .filter(Boolean)
      .slice(0, 8);

    const cartSummaryNodes = Array.from(
      document.querySelectorAll(
        '[class*="cart"], [id*="cart"], [class*="summary"], [id*="summary"], [class*="total"], [id*="total"]',
      ),
    )
      .map((n) => getText(n).slice(0, 260))
      .filter(Boolean)
      .slice(0, 12);

    const bycodeRows = Array.from(
      document.querySelectorAll("table tr, [role='row'], .row, .line-item, .result-row"),
    )
      .map((n) => getText(n))
      .filter((t) => t.length >= 3)
      .slice(0, 20);

    const cartBadgeLike = Array.from(
      document.querySelectorAll(
        '[class*="cart"] [class*="badge"], [id*="cart"] [class*="badge"], [class*="cart-count"], [id*="cart-count"]',
      ),
    )
      .map((n) => getText(n).slice(0, 80))
      .filter(Boolean)
      .slice(0, 8);

    return {
      page_url: window.location.href,
      title: document.title || "",
      body_text_excerpt: bodyExcerpt,
      body_text_char_length: bodyText.length,
      success_error_samples: successNodes,
      cart_summary_samples: cartSummaryNodes,
      cart_summary_sample_count: cartSummaryNodes.length,
      bycode_row_samples: bycodeRows,
      bycode_row_sample_count: bycodeRows.length,
      cart_badge_or_count_samples: cartBadgeLike,
      cart_badge_or_count_sample_count: cartBadgeLike.length,
      labeling:
        "visible_dom_snapshot_only_not_server_cart_or_order_truth_phase_2u_reconciliation",
    };
  });
}

/**
 * Compare Phase 2u reconciliation snapshots (pre vs post) for immediate UI-delta signals.
 */
export function diffPhase2uReconciliationSnapshots(pre, post) {
  const preUrl = String(pre?.page_url || "");
  const postUrl = String(post?.page_url || "");
  const preTitle = String(pre?.title || "");
  const postTitle = String(post?.title || "");
  const preBodyLen = Number(pre?.body_text_char_length ?? -1);
  const postBodyLen = Number(post?.body_text_char_length ?? -1);
  const preBodyHead = String(pre?.body_text_excerpt || "");
  const postBodyHead = String(post?.body_text_excerpt || "");
  const preSuccess = JSON.stringify(pre?.success_error_samples ?? []);
  const postSuccess = JSON.stringify(post?.success_error_samples ?? []);
  const preCart = JSON.stringify(pre?.cart_summary_samples ?? []);
  const postCart = JSON.stringify(post?.cart_summary_samples ?? []);
  const preRows = JSON.stringify(pre?.bycode_row_samples ?? []);
  const postRows = JSON.stringify(post?.bycode_row_samples ?? []);
  const preBadge = JSON.stringify(pre?.cart_badge_or_count_samples ?? []);
  const postBadge = JSON.stringify(post?.cart_badge_or_count_samples ?? []);

  const changed =
    preUrl !== postUrl ||
    preTitle !== postTitle ||
    preBodyLen !== postBodyLen ||
    preBodyHead !== postBodyHead ||
    preSuccess !== postSuccess ||
    preCart !== postCart ||
    preRows !== postRows ||
    preBadge !== postBadge;

  return {
    url_changed: preUrl !== postUrl,
    title_changed: preTitle !== postTitle,
    body_text_char_length_changed: preBodyLen !== postBodyLen,
    body_text_excerpt_changed: preBodyHead !== postBodyHead,
    success_error_samples_changed: preSuccess !== postSuccess,
    cart_summary_samples_changed: preCart !== postCart,
    bycode_row_samples_changed: preRows !== postRows,
    cart_badge_or_count_samples_changed: preBadge !== postBadge,
    any_reconciliation_signal_changed: changed,
    labeling:
      "phase_2u_pre_post_visible_dom_comparison_only_not_server_cart_or_order_truth",
  };
}

/** Bounded outcome labels for add-to-cart (2U) determinism hardening lane only. */
export const ADD_TO_CART_DETERMINISM_OUTCOME_VOCABULARY = [
  "2u_attempt_observed_no_effect",
  "2u_attempt_observed_local_ui_change_only",
  "2u_attempt_observed_cart_evidence",
  "2u_outcome_inconclusive",
];

export const DETERMINISM_CROSS_RUN_SCHEMA_VERSION = 1;

/**
 * Compact lane-input fingerprint for repeatability (lengths only; no code/qty values).
 */
export function buildLaneInputFingerprintFor2uDeterminism(config) {
  return {
    lane: "add_to_cart_determinism_hardening_non_validate",
    test_code_length:
      typeof config?.addByCodePhase2lTestCode === "string"
        ? config.addByCodePhase2lTestCode.length
        : null,
    test_quantity_length:
      typeof config?.addByCodePhase2lTestQuantity === "string"
        ? config.addByCodePhase2lTestQuantity.length
        : null,
    field_order: config?.addByCodePhase2lFieldOrder ?? null,
    milo_manual_parity_sequence: config?.addByCodePhase2lMiloManualParitySequence === true,
    milo_full_keyboard_parity_sequence:
      config?.addByCodePhase2lMiloFullKeyboardParitySequence === true,
  };
}

function compactImmediateReconciliationFlagsForPersist(immediateSignals) {
  const s = immediateSignals && typeof immediateSignals === "object" ? immediateSignals : {};
  return {
    any_reconciliation_signal_changed: s.any_reconciliation_signal_changed ?? null,
    success_error_samples_changed: s.success_error_samples_changed ?? null,
    cart_summary_samples_changed: s.cart_summary_samples_changed ?? null,
    cart_badge_or_count_samples_changed: s.cart_badge_or_count_samples_changed ?? null,
    bycode_row_samples_changed: s.bycode_row_samples_changed ?? null,
  };
}

/**
 * Compare current 2U determinism compact state to a single prior persisted snapshot (bounded).
 */
export function compute2uDeterminismCrossRunConsistency(priorPersisted, currentCompact) {
  const cur = currentCompact && typeof currentCompact === "object" ? currentCompact : null;
  if (!cur) {
    return {
      consistency_classification: "insufficient_prior_runs",
      prior_run_present: false,
      compared_fields: null,
      note: "missing_current_compact",
    };
  }
  if (!priorPersisted || typeof priorPersisted !== "object") {
    return {
      consistency_classification: "insufficient_prior_runs",
      prior_run_present: false,
      compared_fields: null,
      note: "no_prior_snapshot_on_state_path",
    };
  }
  const pv = Number(priorPersisted.schema_version);
  if (pv !== DETERMINISM_CROSS_RUN_SCHEMA_VERSION) {
    return {
      consistency_classification: "insufficient_prior_runs",
      prior_run_present: true,
      compared_fields: null,
      prior_schema_version: priorPersisted.schema_version ?? null,
      note: "prior_schema_version_mismatch",
    };
  }

  const fpMatch =
    JSON.stringify(priorPersisted.lane_input_fingerprint ?? null) ===
    JSON.stringify(cur.lane_input_fingerprint ?? null);
  const selMatch =
    String(priorPersisted.winning_selector ?? "") === String(cur.winning_selector ?? "");
  const succMatch =
    Boolean(priorPersisted.two_u_click_succeeded) === Boolean(cur.two_u_click_succeeded);
  const catMatch =
    String(priorPersisted.determinism_outcome_category ?? "") ===
    String(cur.determinism_outcome_category ?? "");
  const flagsMatch =
    JSON.stringify(priorPersisted.immediate_reconciliation_flags ?? {}) ===
    JSON.stringify(cur.immediate_reconciliation_flags ?? {});

  const compared_fields = {
    lane_input_fingerprint_match: fpMatch,
    winning_selector_match: selMatch,
    two_u_click_success_match: succMatch,
    determinism_outcome_category_match: catMatch,
    immediate_reconciliation_flags_match: flagsMatch,
  };

  let consistency_classification;
  if (!fpMatch || !selMatch || !succMatch) {
    consistency_classification = "unstable_across_compared_runs";
  } else if (catMatch && flagsMatch) {
    consistency_classification = "stable_across_compared_runs";
  } else {
    consistency_classification = "partially_stable_across_compared_runs";
  }

  return {
    consistency_classification,
    prior_run_present: true,
    compared_fields,
    note: "single_prior_snapshot_compare_only_not_full_history",
  };
}

/**
 * Compact two-pass handoff description (pass 1 persist / pass 2 read+compare).
 * No orchestration; machine + human strings for operator inspection only.
 */
export function build2uDeterminismTwoPassHandoff(workerConfig) {
  const c = workerConfig && typeof workerConfig === "object" ? workerConfig : {};
  const pathRaw = c.addByCode2uDeterminismStatePath;
  const prior_state_path_configured =
    typeof pathRaw === "string" && pathRaw.trim() !== "";
  const prior_state_write_enabled = c.addByCode2uDeterminismStateWrite === true;
  const prior_state_write_approved = c.addByCode2uDeterminismStateWriteApproved === true;
  const phase2u_lane_ok =
    c.addByCodePhase2uMiloBulk === true && c.addByCodePhase2uMiloBulkApproved === true;
  const run_ready_for_first_persist_pass =
    prior_state_path_configured &&
    prior_state_write_enabled &&
    prior_state_write_approved &&
    phase2u_lane_ok;
  const run_ready_for_second_compare_pass =
    prior_state_path_configured &&
    phase2u_lane_ok &&
    !(prior_state_write_enabled && prior_state_write_approved);

  const compact_human_handoff =
    "Two-pass (optional): Pass 1 — use the same approved 2U MILO bulk dry-run env as today, set MLCC_2U_DETERMINISM_STATE_PATH to a writable file, MLCC_2U_DETERMINISM_STATE_WRITE=true, and MLCC_2U_DETERMINISM_STATE_WRITE_APPROVED=true; after a successful 2U run the worker writes a compact schema_v1 JSON there. Pass 2 — reuse the same path so the prior snapshot is read before 2U; leave write gates off (WRITE not true or WRITE_APPROVED not true) so the file is not overwritten until you choose. After pass 2, inspect evidence field add_to_cart_determinism_hardening_non_validate.cross_run_consistency (consistency_classification and compared_fields). No validate, checkout, submit, finalize, or ordering.";

  return {
    bounded_model: "two_pass_optional_single_state_file_no_background_orchestration",
    inspect_after_pass_2: "add_to_cart_determinism_hardening_non_validate.cross_run_consistency",
    pass_1_write_prior_snapshot: {
      intent: "persist_compact_schema_v1_json_after_successful_2u",
      required_env_vars: [
        "MLCC_2U_DETERMINISM_STATE_PATH=<absolute_or_worker_resolved_path>",
        "MLCC_2U_DETERMINISM_STATE_WRITE=true",
        "MLCC_2U_DETERMINISM_STATE_WRITE_APPROVED=true",
      ],
      prerequisite_note:
        "same_approved_mlcc_add_by_code_phase_2u_milo_bulk_lane_as_single_pass_dry_run_including_2l_chain_per_worker_doc",
    },
    pass_2_read_only_compare: {
      intent: "read_prior_json_before_2u_then_emit_cross_run_consistency_in_artifact",
      required_env_vars: [
        "MLCC_2U_DETERMINISM_STATE_PATH=<same_path_as_pass_1_output>",
      ],
      write_gates_should_be_inactive_note:
        "omit_or_unset MLCC_2U_DETERMINISM_STATE_WRITE and MLCC_2U_DETERMINISM_STATE_WRITE_APPROVED (or any config where WRITE is not true with WRITE_APPROVED true) so this run does not overwrite the prior file before you read cross_run_consistency",
    },
    readiness: {
      prior_state_path_configured,
      prior_state_write_enabled,
      prior_state_write_approved,
      run_ready_for_first_persist_pass,
      run_ready_for_second_compare_pass,
    },
    compact_human_handoff,
  };
}

/** Payload written to MLCC_2U_DETERMINISM_STATE_PATH for the next bounded compare. */
export function build2uDeterminismPersistPayload({ laneInputFingerprint, artifactFragment }) {
  const art =
    artifactFragment && typeof artifactFragment === "object" ? artifactFragment : {};
  const immediate = art.immediate_signals || {};
  return {
    schema_version: DETERMINISM_CROSS_RUN_SCHEMA_VERSION,
    lane_input_fingerprint: laneInputFingerprint ?? null,
    winning_selector: art.attempt_evidence?.winning_selector ?? null,
    two_u_click_succeeded: art.attempt_evidence?.two_u_click_succeeded === true,
    determinism_outcome_category: art.determinism_outcome_category ?? null,
    immediate_reconciliation_flags: compactImmediateReconciliationFlagsForPersist(immediate),
  };
}

/**
 * Compact artifact for add_to_cart_determinism_hardening_non_validate (policy: no validate/order).
 * Exported for unit tests; keep aligned with phase_2u_milo_bulk return payload.
 */
export function buildAddToCartDeterminismHardeningLaneArtifact({
  clickPerformed,
  selectorClicked,
  selectorList,
  candidateEvaluations,
  reconciliationDiff,
  laneInputFingerprint,
  priorRunPersisted,
  workerConfigForTwoPassHandoff,
}) {
  const diff = reconciliationDiff && typeof reconciliationDiff === "object" ? reconciliationDiff : null;
  const list = Array.isArray(selectorList) ? selectorList : [];
  const evals = Array.isArray(candidateEvaluations) ? candidateEvaluations : [];
  const laneFp =
    laneInputFingerprint && typeof laneInputFingerprint === "object"
      ? laneInputFingerprint
      : buildLaneInputFingerprintFor2uDeterminism({});
  const winningIndex =
    typeof selectorClicked === "string" && selectorClicked
      ? list.indexOf(selectorClicked)
      : -1;
  const eligibleCount = evals.filter((e) => e && e.eligible === true).length;

  const cartishChanged =
    diff &&
    (diff.cart_summary_samples_changed === true ||
      diff.cart_badge_or_count_samples_changed === true ||
      diff.bycode_row_samples_changed === true);
  const anyChanged = diff && diff.any_reconciliation_signal_changed === true;
  const ackCopyChanged = diff && diff.success_error_samples_changed === true;

  let determinismOutcomeCategory;
  if (!diff || typeof diff.any_reconciliation_signal_changed !== "boolean") {
    determinismOutcomeCategory = "2u_outcome_inconclusive";
  } else if (cartishChanged) {
    determinismOutcomeCategory = "2u_attempt_observed_cart_evidence";
  } else if (anyChanged) {
    determinismOutcomeCategory = "2u_attempt_observed_local_ui_change_only";
  } else {
    determinismOutcomeCategory = "2u_attempt_observed_no_effect";
  }

  const immediateSignals = {
    any_reconciliation_signal_changed: diff?.any_reconciliation_signal_changed ?? null,
    success_error_samples_changed: diff?.success_error_samples_changed ?? null,
    cart_summary_samples_changed: diff?.cart_summary_samples_changed ?? null,
    cart_badge_or_count_samples_changed: diff?.cart_badge_or_count_samples_changed ?? null,
    bycode_row_samples_changed: diff?.bycode_row_samples_changed ?? null,
    url_changed: diff?.url_changed ?? null,
    title_changed: diff?.title_changed ?? null,
    body_text_excerpt_changed: diff?.body_text_excerpt_changed ?? null,
    acknowledgment_via_success_or_error_copy_change: ackCopyChanged,
    cart_or_line_like_signals_changed: cartishChanged === true,
  };

  const currentRunCompact = {
    lane_input_fingerprint: laneFp,
    winning_selector: selectorClicked ?? null,
    two_u_click_succeeded: clickPerformed === true,
    determinism_outcome_category: determinismOutcomeCategory,
    immediate_reconciliation_flags:
      compactImmediateReconciliationFlagsForPersist(immediateSignals),
  };

  const crossRun = compute2uDeterminismCrossRunConsistency(priorRunPersisted, currentRunCompact);

  const cross_run_consistency = {
    ...crossRun,
    current_run_compact: currentRunCompact,
    bounded_compare_model: "single_prior_file_snapshot_mlcc_2u_determinism_state_path",
  };

  let compact_human_summary =
    determinismOutcomeCategory === "2u_attempt_observed_cart_evidence"
      ? "2U click completed; bounded reconciliation shows cart/line-like surface signal change (DOM heuristic only, not server cart proof)."
      : determinismOutcomeCategory === "2u_attempt_observed_local_ui_change_only"
        ? "2U click completed; some immediate visible DOM delta observed without cart/line-like reconciliation signals (heuristic only)."
        : determinismOutcomeCategory === "2u_attempt_observed_no_effect"
          ? "2U click completed; no visible reconciliation delta in bounded pre/post snapshot (does not prove no server effect)."
          : "2U determinism outcome inconclusive from reconciliation diff (missing or incomplete signals).";

  if (crossRun.consistency_classification === "stable_across_compared_runs") {
    compact_human_summary += ` Cross-run (vs single prior file): stable_across_compared_runs.`;
  } else if (crossRun.consistency_classification === "partially_stable_across_compared_runs") {
    compact_human_summary += ` Cross-run (vs single prior file): partially_stable_across_compared_runs.`;
  } else if (crossRun.consistency_classification === "unstable_across_compared_runs") {
    compact_human_summary += ` Cross-run (vs single prior file): unstable_across_compared_runs.`;
  } else {
    compact_human_summary += ` Cross-run: insufficient_prior_runs (no readable prior snapshot or schema mismatch).`;
  }

  return {
    lane_name: "add_to_cart_determinism_hardening_non_validate",
    lane_input_fingerprint: laneFp,
    labeling:
      "add_to_cart_determinism_lane_visible_dom_and_selector_evidence_only_not_validate_or_order_truth",
    determinism_target: {
      scope: "phase_2u_milo_bulk_single_click_only",
      focus: [
        "whether_2u_click_was_attempted_and_succeeded",
        "which_selector_won_and_list_precedence",
        "bounded_pre_post_reconciliation_diff_for_immediate_ui_signals",
        "compact_acknowledgment_via_success_error_copy_change",
        "cross_run_consistency_vs_optional_single_prior_file_snapshot",
      ],
    },
    attempt_evidence: {
      two_u_click_attempted: clickPerformed === true,
      two_u_click_succeeded: clickPerformed === true,
      winning_selector: selectorClicked ?? null,
      winning_selector_list_index: winningIndex >= 0 ? winningIndex : null,
      selectors_evaluated_count: evals.length,
      eligible_candidate_count: eligibleCount,
    },
    immediate_signals: immediateSignals,
    determinism_outcome_category: determinismOutcomeCategory,
    outcome_vocabulary: [...ADD_TO_CART_DETERMINISM_OUTCOME_VOCABULARY],
    cross_run_consistency,
    two_pass_execution_handoff: build2uDeterminismTwoPassHandoff(workerConfigForTwoPassHandoff),
    hardening_plan: [
      "stronger_attempt_evidence_capture_pre_post_snapshots_and_click_timestamp",
      "winning_selector_path_precedence_logging_and_ineligible_reason_rollup",
      "bounded_post_click_acknowledgment_capture_success_error_and_cart_adjacent_samples",
      "repeated_run_consistency_classification_via_outcome_category_histogram_per_environment",
    ],
    safety: {
      validate_blocked: true,
      checkout_submit_finalize_blocked: true,
      no_order_placement: true,
      existing_safe_mode_network_ui_guards_unchanged: true,
    },
    compact_human_summary,
  };
}

/**
 * Tenant-documented fill order for Phase 2l (code first vs quantity first).
 */
export function parsePhase2lFieldOrder(raw) {
  if (raw == null || String(raw).trim() === "") {
    return {
      ok: false,
      value: null,
      reason: "empty_or_missing",
    };
  }

  const v = String(raw).trim().toLowerCase().replace(/-/g, "_");

  if (v === "code_first") {
    return { ok: true, value: "code_first" };
  }

  if (v === "quantity_first") {
    return { ok: true, value: "quantity_first" };
  }

  return {
    ok: false,
    value: null,
    reason: "must_be_code_first_or_quantity_first",
  };
}

/**
 * Phase 2l code-field surface: reject select only. type=number allowed (MILO by-code);
 * digits-only synthetic test code is enforced when type=number (same rule as Phase 2h).
 */
export function phase2lCodeFieldDomSnapshotAllowed(snap) {
  if (!snap || snap.unsupported) {
    return { ok: false, reason: "unsupported_or_missing_snapshot" };
  }

  const t = String(snap.type || "").toLowerCase();

  if (t === "select") {
    return { ok: false, reason: "select_element_not_allowed_code_field" };
  }

  return { ok: true };
}

/**
 * Phase 2h: one tenant code field only; real test value from env; no Enter, no qty, no clicks.
 * Hard-fails if Layer 2 guard count increases during type. Clears field only when type caused no new aborts.
 */
export async function runAddByCodePhase2hRealCodeTypingRehearsal({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
}) {
  await heartbeat({
    progressStage: "mlcc_phase_2h_real_code_start",
    progressMessage:
      "Phase 2h: tightly gated real code-field typing rehearsal (no qty; no submit)",
  });

  const testCode = config.addByCodePhase2hTestCode;
  const codeSel = config.addByCodeCodeFieldSelector;

  const mutation_risk_checks_used = [
    "computePhase2gExtendedMutationRisk_same_as_phase_2g",
    "layer_2_network_abort_counter_guardStats_blockedRequestCount",
    "layer_2_shouldBlockHttpRequest_patterns_active_on_context",
    "no_enter_playwright_fill_only",
    "quantity_field_explicitly_out_of_scope",
    "no_explicit_blur_phase_2h_policy",
  ];

  if (!codeSel || typeof codeSel !== "string" || codeSel.trim() === "") {
    const err =
      "Phase 2h requires MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR (tenant code field only; no heuristic target)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "missing_tenant_code_field_selector",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const codeResolved = await resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(
    page,
    codeSel.trim(),
    { mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null },
  );

  if (!codeResolved.ok) {
    const ambiguousCode =
      typeof codeResolved.reason === "string" &&
      codeResolved.reason.startsWith("multiple_visible_code_");

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const err = ambiguousCode
      ? `Phase 2h: ambiguous code field targets after fallback chain (${codeResolved.reason})`
      : `Phase 2h: code field could not be resolved (${codeResolved.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          tenant_code_field_selector: codeSel,
          code_locator_resolution: codeResolved.reason,
          code_locator_strategy_trace: codeResolved.strategy_trace ?? null,
          code_locator_detail: codeResolved.detail ?? null,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: ambiguousCode ? "code_ambiguous" : "code_resolution_failed",
          mutation_risk_checks_used,
          safe_mode_failure_forensics: safeModeFailureForensics,
        },
      }),
    );

    throw new Error(err);
  }

  const loc = codeResolved.loc;
  const code_field_locator_strategy = codeResolved.strategy;
  const code_field_locator_resolution_scope = codeResolved.resolution;

  const snapBefore = await readFieldDomSnapshot(loc);

  if (snapBefore.unsupported) {
    const err = "Phase 2h: code field DOM snapshot unsupported";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          code_field_locator_strategy,
          code_field_locator_resolution_scope,
          dom_snapshot_before: snapBefore,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "unsupported_element",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const typeLower = String(snapBefore.type || "text").toLowerCase();
  const mutation_risk_checks_used_effective = [...mutation_risk_checks_used];

  if (typeLower === "number") {
    const numGate = validatePhase2hTestCodeForNumberInputSurface(testCode);

    if (!numGate.ok) {
      const err = `Phase 2h: type=number code field requires MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE to be 1–${PHASE_2H_NUMBER_SURFACE_MAX_DIGITS} digits only (synthetic non-production): ${numGate.reason}`;

      mutation_risk_checks_used_effective.push(
        "phase_2h_number_input_digits_only_test_code_gate_failed",
      );

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2h_real_code_blocked",
          message: err,
          attributes: {
            phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
            selector_used: codeSel,
            code_field_locator_strategy,
            code_field_locator_resolution_scope,
            dom_snapshot_before: snapBefore,
            code_input_surface: "number",
            real_code_typing_performed: false,
            quantity_field_touched: false,
            block_reason: `number_surface_test_code:${numGate.reason}`,
            mutation_risk_checks_used: mutation_risk_checks_used_effective,
          },
        }),
      );

      throw new Error(err);
    }

    mutation_risk_checks_used_effective.push(
      "phase_2h_number_input_digits_only_test_code_gate_passed",
    );
  } else {
    mutation_risk_checks_used_effective.push(
      "phase_2h_code_surface_non_number_text_like",
    );
  }

  if (snapBefore.disabled || snapBefore.readOnly) {
    const err = "Phase 2h: code field disabled or read-only";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          code_field_locator_strategy,
          code_field_locator_resolution_scope,
          dom_snapshot_before: snapBefore,
          code_input_surface: typeLower,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "disabled_or_readonly",
          mutation_risk_checks_used: mutation_risk_checks_used_effective,
        },
      }),
    );

    throw new Error(err);
  }

  const rawPayload = await collectPhase2gRiskPayloadFromLocator(loc);
  const mutation_risk = computePhase2gExtendedMutationRisk(rawPayload);

  if (mutation_risk.rehearsal_blocked) {
    const err = `Phase 2h: extended mutation risk blocked: ${mutation_risk.block_reasons.join("|")}`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          code_field_locator_strategy,
          code_field_locator_resolution_scope,
          dom_snapshot_before: snapBefore,
          code_input_surface: typeLower,
          mutation_risk,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "extended_mutation_risk",
          mutation_risk_checks_used: mutation_risk_checks_used_effective,
        },
      }),
    );

    throw new Error(err);
  }

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2h_pre_type_snapshot",
        message:
          "Phase 2h checkpoint immediately before real code fill (no Enter; no qty)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const blockedBefore =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  try {
    await loc.fill(testCode, { timeout: 8000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: `Phase 2h: fill failed: ${m}`,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          code_field_locator_strategy,
          code_field_locator_resolution_scope,
          dom_snapshot_before: snapBefore,
          code_input_surface: typeLower,
          mutation_risk,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: `fill_error:${m}`,
          mutation_risk_checks_used: mutation_risk_checks_used_effective,
        },
      }),
    );

    throw new Error(`Phase 2h real code fill failed: ${m}`);
  }

  await new Promise((r) => setTimeout(r, 250));

  const blockedAfterType =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_type =
    blockedBefore != null && blockedAfterType != null
      ? blockedAfterType - blockedBefore
      : null;

  const snapAfterType = await readFieldDomSnapshot(loc);

  let field_cleared_after = false;
  let network_guard_delta_during_clear = null;
  let run_remained_fully_non_mutating = true;

  if (
    network_guard_delta_during_type != null &&
    network_guard_delta_during_type > 0
  ) {
    run_remained_fully_non_mutating = false;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_findings",
        message:
          "Phase 2h stopped: network guard saw new blocked requests during real code typing; field not cleared",
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          code_field_locator_strategy,
          code_field_locator_resolution_scope,
          code_input_surface: typeLower,
          test_code_length: testCode.length,
          test_code_redacted: "[length_only_not_value]",
          dom_snapshot_before: snapBefore,
          dom_snapshot_after_type: snapAfterType,
          mutation_risk,
          mutation_risk_checks_used: mutation_risk_checks_used_effective,
          real_code_typing_performed: true,
          quantity_field_touched: false,
          network_guard_blocked_before: blockedBefore,
          network_guard_blocked_after_type: blockedAfterType,
          network_guard_delta_during_type,
          field_cleared_after: false,
          clear_skipped_reason:
            "network_abort_during_type_clearing_would_be_ambiguous_stop_hard_fail",
          run_remained_fully_non_mutating: false,
          disclaimer:
            "single_run_observation_does_not_generalize_real_code_safety_quantity_still_out_of_scope_no_cart_state_proof",
        },
      }),
    );

    throw new Error(
      "Phase 2h real code rehearsal: network guard triggered during typing (cart/order mutation URL pattern aborted)",
    );
  }

  const blockedBeforeClear = blockedAfterType;

  try {
    await loc.fill("", { timeout: 8000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_findings",
        message: `Phase 2h: clear fill failed: ${m}`,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          code_field_locator_strategy,
          code_field_locator_resolution_scope,
          code_input_surface: typeLower,
          test_code_length: testCode.length,
          dom_snapshot_after_type: snapAfterType,
          real_code_typing_performed: true,
          quantity_field_touched: false,
          field_cleared_after: false,
          clear_error: m,
          run_remained_fully_non_mutating: false,
          mutation_risk_checks_used: mutation_risk_checks_used_effective,
        },
      }),
    );

    throw new Error(`Phase 2h clear failed: ${m}`);
  }

  await new Promise((r) => setTimeout(r, 200));

  const blockedAfterClear =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  network_guard_delta_during_clear =
    blockedBeforeClear != null && blockedAfterClear != null
      ? blockedAfterClear - blockedBeforeClear
      : null;

  field_cleared_after = true;

  if (
    network_guard_delta_during_clear != null &&
    network_guard_delta_during_clear > 0
  ) {
    run_remained_fully_non_mutating = false;
  }

  const snapAfterClear = await readFieldDomSnapshot(loc);

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2h_post_clear_snapshot",
        message: "Phase 2h checkpoint after clear fill (no blur)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2h_real_code_findings",
      message:
        "Phase 2h real code typing rehearsal complete (truthful; quantity untouched)",
      attributes: {
        phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
        selector_used: codeSel,
        code_field_locator_strategy,
        code_field_locator_resolution_scope,
        code_input_surface: typeLower,
        tenant_qty_field_selector_configured: Boolean(
          typeof config.addByCodeQtyFieldSelector === "string" &&
            config.addByCodeQtyFieldSelector.trim() !== "",
        ),
        test_code_length: testCode.length,
        test_code_redacted: "[length_only_not_value]",
        dom_snapshot_before: snapBefore,
        dom_snapshot_after_type: snapAfterType,
        dom_snapshot_after_clear: snapAfterClear,
        mutation_risk,
        mutation_risk_checks_used: mutation_risk_checks_used_effective,
        real_code_typing_performed: true,
        quantity_field_touched: false,
        quantity_field_policy: "never_touched_in_phase_2h",
        network_guard_blocked_before: blockedBefore,
        network_guard_blocked_after_type: blockedAfterType,
        network_guard_delta_during_type,
        network_guard_blocked_after_clear: blockedAfterClear,
        network_guard_delta_during_clear,
        field_cleared_after,
        run_remained_fully_non_mutating,
        interaction_method: "playwright_locator_fill_no_enter_no_blur",
        disclaimer:
          "observed_no_new_layer2_aborts_during_type_and_clear_on_this_run_does_not_prove_safe_for_all_codes_or_cart_state_quantity_not_evaluated",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2h_real_code_complete",
    progressMessage:
      "Phase 2h complete (no qty; no validate/add-to-cart/checkout/submit)",
  });

  return {
    phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
    real_code_typing_performed: true,
    quantity_field_touched: false,
    field_cleared_after,
    run_remained_fully_non_mutating,
    network_guard_delta_during_type,
    network_guard_delta_during_clear,
    mutation_risk_checks_used: mutation_risk_checks_used_effective,
    code_input_surface: typeLower,
    mutation_risk,
    code_field_locator_strategy,
    code_field_locator_resolution_scope,
  };
}

function phase2jQuantityDomSnapshotAllowed(snap) {
  if (!snap || snap.unsupported) {
    return { ok: false, reason: "unsupported_or_missing_snapshot" };
  }

  const t = String(snap.type || "").toLowerCase();

  if (t === "select") {
    return { ok: false, reason: "select_element_not_allowed_phase_2j" };
  }

  if (!["number", "text", "search", "tel", "textarea"].includes(t)) {
    return {
      ok: false,
      reason: `input_type_${t}_not_on_phase_2j_quantity_allowlist`,
    };
  }

  return { ok: true };
}

async function readCodeFieldValueLengthParity(page, codeSel) {
  if (!codeSel || typeof codeSel !== "string" || codeSel.trim() === "") {
    return {
      observed: false,
      reason: "tenant_code_selector_not_configured",
    };
  }

  const sel = codeSel.trim();
  const loc = page.locator(sel).first();
  const n = await loc.count().catch(() => 0);

  if (n === 0) {
    return {
      observed: false,
      reason: "code_locator_zero_matches",
      selector_used: sel,
    };
  }

  const vis = await loc.isVisible().catch(() => false);

  if (!vis) {
    return {
      observed: false,
      reason: "code_field_not_visible",
      selector_used: sel,
    };
  }

  const snap = await readFieldDomSnapshot(loc);

  if (snap.unsupported || String(snap.type || "").toLowerCase() === "select") {
    return {
      observed: false,
      reason: "code_snapshot_unsupported",
      selector_used: sel,
    };
  }

  return {
    observed: true,
    selector_used: sel,
    value_length: snap.value_length ?? 0,
    has_value: Boolean(snap.has_value),
  };
}

/**
 * Phase 2j: one tenant quantity field only; test digits from env; no code field interaction, no Enter, no clicks.
 * Optional blur only when config.addByCodePhase2jAllowBlur === true. Same Layer 2 delta hard-fail as 2h.
 */
export async function runAddByCodePhase2jQuantityTypingRehearsal({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
}) {
  const gateManifest = buildPhase2iQuantityFutureGateManifest();

  await heartbeat({
    progressStage: "mlcc_phase_2j_quantity_start",
    progressMessage:
      "Phase 2j: gated quantity-field-only rehearsal (no code; no submit)",
  });

  const testQuantity = config.addByCodePhase2jTestQuantity;
  const qtySel = config.addByCodeQtyFieldSelector;
  const allowBlur = config.addByCodePhase2jAllowBlur === true;

  const mutation_risk_checks_used = [
    "phase_2i_quantity_future_gate_manifest_echoed_in_evidence",
    `phase_2i_policy_version_${PHASE_2I_POLICY_VERSION}`,
    "computePhase2gExtendedMutationRisk_on_quantity_locator",
    "layer_2_network_abort_counter_guardStats_blockedRequestCount",
    "layer_2_shouldBlockHttpRequest_patterns_active_on_context",
    "no_enter_playwright_fill_only",
    "code_field_never_filled_or_focused_in_phase_2j",
    allowBlur
      ? "optional_blur_explicitly_enabled_via_MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR"
      : "no_blur_unless_MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR_true",
    "quantity_surface_allowlist_number_text_search_tel_textarea_only",
    "optional_code_field_value_length_parity_when_tenant_code_selector_configured_and_visible",
  ];

  if (!qtySel || typeof qtySel !== "string" || qtySel.trim() === "") {
    const err =
      "Phase 2j requires MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR (tenant quantity field only; no heuristic target)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_blocked",
        message: err,
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          quantity_typing_performed: false,
          code_field_touched: false,
          block_reason: "missing_tenant_quantity_field_selector",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const qtyResolved = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(
    page,
    qtySel.trim(),
    { mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null },
  );

  if (!qtyResolved.ok) {
    const ambiguousQty =
      qtyResolved.reason === "multiple_visible_quantity_controls_ambiguous" ||
      qtyResolved.reason === "multiple_visible_quantity_spinbutton_ambiguous" ||
      qtyResolved.reason === "multiple_visible_quantity_number_inputs_ambiguous";

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const err = ambiguousQty
      ? `Phase 2j: ambiguous quantity targets after fallback chain (${qtyResolved.reason})`
      : `Phase 2j: quantity field could not be resolved (${qtyResolved.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_blocked",
        message: err,
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          selector_used: qtySel.trim(),
          quantity_typing_performed: false,
          code_field_touched: false,
          block_reason: ambiguousQty ? "quantity_ambiguous" : "quantity_resolution_failed",
          quantity_locator_resolution: qtyResolved.reason,
          quantity_locator_strategy_trace: qtyResolved.strategy_trace ?? null,
          quantity_locator_detail: qtyResolved.detail ?? null,
          safe_mode_failure_forensics: safeModeFailureForensics,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const loc = qtyResolved.loc;

  const snapBefore = await readFieldDomSnapshot(loc);
  const surfaceOk = phase2jQuantityDomSnapshotAllowed(snapBefore);

  if (!surfaceOk.ok) {
    const err = `Phase 2j: quantity field surface rejected (${surfaceOk.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_blocked",
        message: err,
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          selector_used: qtySel.trim(),
          quantity_locator_strategy: qtyResolved.strategy ?? null,
          dom_snapshot_before: snapBefore,
          quantity_typing_performed: false,
          code_field_touched: false,
          block_reason: surfaceOk.reason,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  if (snapBefore.disabled || snapBefore.readOnly) {
    const err = "Phase 2j: quantity field disabled or read-only";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_blocked",
        message: err,
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          selector_used: qtySel.trim(),
          quantity_locator_strategy: qtyResolved.strategy ?? null,
          dom_snapshot_before: snapBefore,
          quantity_typing_performed: false,
          code_field_touched: false,
          block_reason: "disabled_or_readonly",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const rawPayload = await collectPhase2gRiskPayloadFromLocator(loc);
  const mutation_risk = computePhase2gExtendedMutationRisk(rawPayload);

  if (mutation_risk.rehearsal_blocked) {
    const err = `Phase 2j: extended mutation risk blocked: ${mutation_risk.block_reasons.join("|")}`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_blocked",
        message: err,
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          selector_used: qtySel.trim(),
          quantity_locator_strategy: qtyResolved.strategy ?? null,
          dom_snapshot_before: snapBefore,
          mutation_risk,
          quantity_typing_performed: false,
          code_field_touched: false,
          block_reason: "extended_mutation_risk",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const codeParityBefore = await readCodeFieldValueLengthParity(
    page,
    config.addByCodeCodeFieldSelector,
  );

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2j_pre_type_snapshot",
        message:
          "Phase 2j checkpoint before quantity fill (no code interaction; no Enter)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2j_pre_type_evidence",
      message:
        "Phase 2j pre-typing evidence (quantity locator verified; Phase 2i gates echoed; non-mutating intent)",
      attributes: {
        phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
        phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
        phase_2i_quantity_gate_manifest: gateManifest,
        selector_used: qtySel.trim(),
        quantity_locator_strategy: qtyResolved.strategy ?? null,
        dom_snapshot_before: snapBefore,
        mutation_risk,
        mutation_risk_checks_used,
        code_field_parity_before: codeParityBefore,
        run_non_mutating_intent:
          "no_submit_validate_checkout_add_to_cart_no_code_field_interaction",
        quantity_test_value_redacted: "[length_only_in_post_findings]",
      },
    }),
  );

  const blockedBefore =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  try {
    await loc.fill(testQuantity, { timeout: 8000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_blocked",
        message: `Phase 2j: fill failed: ${m}`,
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          selector_used: qtySel.trim(),
          dom_snapshot_before: snapBefore,
          mutation_risk,
          quantity_typing_performed: false,
          code_field_touched: false,
          block_reason: `fill_error:${m}`,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(`Phase 2j quantity fill failed: ${m}`);
  }

  await new Promise((r) => setTimeout(r, 250));

  if (allowBlur) {
    try {
      if (typeof loc.blur === "function") {
        await loc.blur({ timeout: 3000 });
      } else {
        await loc.evaluate((el) => {
          if (el instanceof HTMLElement) {
            el.blur();
          }
        });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2j_quantity_blocked",
          message: `Phase 2j: blur failed: ${m}`,
          attributes: {
            phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
            selector_used: qtySel.trim(),
            quantity_typing_performed: true,
            code_field_touched: false,
            block_reason: `blur_error:${m}`,
            mutation_risk_checks_used,
          },
        }),
      );

      throw new Error(`Phase 2j blur failed: ${m}`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  const blockedAfterType =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_type =
    blockedBefore != null && blockedAfterType != null
      ? blockedAfterType - blockedBefore
      : null;

  const snapAfterType = await readFieldDomSnapshot(loc);

  let field_cleared_after = false;
  let network_guard_delta_during_clear = null;
  let run_remained_fully_non_mutating = true;

  const codeParityAfterType = await readCodeFieldValueLengthParity(
    page,
    config.addByCodeCodeFieldSelector,
  );

  if (
    codeParityBefore.observed &&
    codeParityAfterType.observed &&
    codeParityBefore.value_length !== codeParityAfterType.value_length
  ) {
    run_remained_fully_non_mutating = false;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_blocked",
        message:
          "Phase 2j stopped: tenant code field value length changed without code interaction",
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          selector_used: qtySel.trim(),
          code_field_parity_before: codeParityBefore,
          code_field_parity_after_type: codeParityAfterType,
          quantity_typing_performed: true,
          code_field_touched: false,
          block_reason: "code_field_value_length_drift_observed",
          mutation_risk_checks_used,
          test_quantity_length: testQuantity.length,
          test_quantity_redacted: "[length_only_not_value]",
        },
      }),
    );

    throw new Error(
      "Phase 2j: code field value length changed during quantity rehearsal (stop; capture evidence)",
    );
  }

  if (
    network_guard_delta_during_type != null &&
    network_guard_delta_during_type > 0
  ) {
    run_remained_fully_non_mutating = false;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_findings",
        message:
          "Phase 2j stopped: network guard saw new blocked requests during quantity typing; field not cleared",
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
          phase_2i_quantity_gate_manifest: gateManifest,
          selector_used: qtySel.trim(),
          test_quantity_length: testQuantity.length,
          test_quantity_redacted: "[length_only_not_value]",
          dom_snapshot_before: snapBefore,
          dom_snapshot_after_type: snapAfterType,
          mutation_risk,
          mutation_risk_checks_used,
          quantity_typing_performed: true,
          code_field_touched: false,
          code_field_parity_before: codeParityBefore,
          code_field_parity_after_type: codeParityAfterType,
          network_guard_blocked_before: blockedBefore,
          network_guard_blocked_after_type: blockedAfterType,
          network_guard_delta_during_type,
          field_cleared_after: false,
          blur_used: allowBlur,
          clear_skipped_reason:
            "network_abort_during_type_clearing_would_be_ambiguous_stop_hard_fail",
          run_remained_fully_non_mutating: false,
          disclaimer:
            "single_run_observation_does_not_generalize_quantity_safety_no_code_plus_quantity_combined_interaction_no_cart_state_proof",
        },
      }),
    );

    throw new Error(
      "Phase 2j quantity rehearsal: network guard triggered during typing (cart/order mutation URL pattern aborted)",
    );
  }

  const blockedBeforeClear = blockedAfterType;

  try {
    await loc.fill("", { timeout: 8000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_findings",
        message: `Phase 2j: clear fill failed: ${m}`,
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          selector_used: qtySel.trim(),
          test_quantity_length: testQuantity.length,
          dom_snapshot_after_type: snapAfterType,
          quantity_typing_performed: true,
          code_field_touched: false,
          field_cleared_after: false,
          blur_used: allowBlur,
          clear_error: m,
          run_remained_fully_non_mutating: false,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(`Phase 2j clear failed: ${m}`);
  }

  await new Promise((r) => setTimeout(r, 200));

  const blockedAfterClear =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  network_guard_delta_during_clear =
    blockedBeforeClear != null && blockedAfterClear != null
      ? blockedAfterClear - blockedBeforeClear
      : null;

  field_cleared_after = true;

  if (
    network_guard_delta_during_clear != null &&
    network_guard_delta_during_clear > 0
  ) {
    run_remained_fully_non_mutating = false;
  }

  const snapAfterClear = await readFieldDomSnapshot(loc);

  const codeParityAfterClear = await readCodeFieldValueLengthParity(
    page,
    config.addByCodeCodeFieldSelector,
  );

  if (
    codeParityBefore.observed &&
    codeParityAfterClear.observed &&
    codeParityBefore.value_length !== codeParityAfterClear.value_length
  ) {
    run_remained_fully_non_mutating = false;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2j_quantity_findings",
        message:
          "Phase 2j: code field value length changed after quantity clear (unexpected drift)",
        attributes: {
          phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
          selector_used: qtySel.trim(),
          code_field_parity_before: codeParityBefore,
          code_field_parity_after_clear: codeParityAfterClear,
          quantity_typing_performed: true,
          field_cleared_after,
          run_remained_fully_non_mutating: false,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(
      "Phase 2j: code field value length drift after quantity clear",
    );
  }

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2j_post_clear_snapshot",
        message: "Phase 2j checkpoint after quantity clear fill",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2j_quantity_findings",
      message:
        "Phase 2j quantity typing rehearsal complete (code field not interacted; truthful single-run bounds)",
      attributes: {
        phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
        phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
        phase_2i_quantity_gate_manifest: gateManifest,
        selector_used: qtySel.trim(),
        test_quantity_length: testQuantity.length,
        test_quantity_redacted: "[length_only_not_value]",
        dom_snapshot_before: snapBefore,
        dom_snapshot_after_type: snapAfterType,
        dom_snapshot_after_clear: snapAfterClear,
        mutation_risk,
        mutation_risk_checks_used,
        quantity_typing_performed: true,
        code_field_touched: false,
        code_field_policy: "never_interacted_in_phase_2j",
        code_field_parity_before: codeParityBefore,
        code_field_parity_after_clear: codeParityAfterClear,
        network_guard_blocked_before: blockedBefore,
        network_guard_blocked_after_type: blockedAfterType,
        network_guard_delta_during_type,
        network_guard_blocked_after_clear: blockedAfterClear,
        network_guard_delta_during_clear,
        field_cleared_after,
        blur_used: allowBlur,
        run_remained_fully_non_mutating,
        interaction_method: allowBlur
          ? "playwright_locator_fill_optional_blur_no_enter_no_clicks"
          : "playwright_locator_fill_no_enter_no_blur_no_clicks",
        disclaimer:
          "observed_no_new_layer2_aborts_during_quantity_type_and_clear_on_this_run_only_does_not_prove_general_quantity_safety_or_server_cart_state_no_code_plus_quantity_combined_phase",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2j_quantity_complete",
    progressMessage:
      "Phase 2j complete (quantity only; no validate/add-to-cart/checkout/submit)",
  });

  return {
    phase_2j_policy_version: PHASE_2J_QUANTITY_POLICY_VERSION,
    phase_2i_policy_version: PHASE_2I_POLICY_VERSION,
    quantity_typing_performed: true,
    code_field_touched: false,
    field_cleared_after,
    run_remained_fully_non_mutating,
    network_guard_delta_during_type,
    network_guard_delta_during_clear,
    mutation_risk_checks_used,
    mutation_risk,
    blur_used: allowBlur,
  };
}

/**
 * Phase 2l: combined code + quantity fill in one tenant-documented order; no Enter, no add/apply/validate/checkout/submit.
 * Echoes Phase 2k manifest in evidence. Hard-fails if Layer 2 guard increases during any fill step (no clear).
 * When config.addByCodePhase2lSkipClearWhen2uApproved, skips reverse-order clears after fills (operator-gated; MILO 2u payload test).
 */
export async function runAddByCodePhase2lCombinedCodeQuantityTypingRehearsal({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
}) {
  const gateManifest = buildPhase2kCombinedInteractionFutureGateManifest();

  await heartbeat({
    progressStage: "mlcc_phase_2l_combined_start",
    progressMessage:
      "Phase 2l: gated combined code+quantity rehearsal (no add line; no submit)",
  });

  const testCode = config.addByCodePhase2lTestCode;
  const testQuantity = config.addByCodePhase2lTestQuantity;
  const fieldOrder = config.addByCodePhase2lFieldOrder;
  const allowBlur = config.addByCodePhase2lAllowBlur === true;
  const codeSel = config.addByCodeCodeFieldSelector;
  const qtySel = config.addByCodeQtyFieldSelector;

  const mutation_risk_checks_used = [
    "phase_2k_combined_interaction_future_gate_manifest_echoed",
    `phase_2k_policy_version_${PHASE_2K_POLICY_VERSION}`,
    "computePhase2gExtendedMutationRisk_code_locator_before_sequence",
    "computePhase2gExtendedMutationRisk_quantity_locator_before_sequence",
    "computePhase2gExtendedMutationRisk_both_locators_after_first_fill",
    "layer_2_guardstats_blockedRequestCount_delta_zero_per_fill_step",
    "layer_2_delta_zero_per_clear_step_if_tracked",
    "no_enter_playwright_fill_only",
    `tenant_field_order_${fieldOrder}`,
    allowBlur
      ? "optional_blur_MLCC_ADD_BY_CODE_PHASE_2L_ALLOW_BLUR"
      : "no_blur_unless_MLCC_ADD_BY_CODE_PHASE_2L_ALLOW_BLUR_true",
    "code_dom_surface_phase_2l_select_rejected_number_ok_digits_only_gate_when_type_number_same_as_2h",
    "quantity_dom_surface_same_family_as_phase_2j",
  ];

  const baseBlockedAttrs = (extra = {}) => ({
    phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
    phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
    phase_2k_combined_gate_manifest: gateManifest,
    field_order: fieldOrder,
    combined_rehearsal_performed: false,
    mutation_risk_checks_used,
    ...extra,
  });

  if (!codeSel || !qtySel) {
    const err =
      "Phase 2l requires MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR and MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          block_reason: "missing_tenant_code_or_quantity_selector",
        }),
      }),
    );

    throw new Error(err);
  }

  const codeResolved = await resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(
    page,
    codeSel.trim(),
    { mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null },
  );

  if (!codeResolved.ok) {
    const ambiguousCode =
      typeof codeResolved.reason === "string" &&
      codeResolved.reason.startsWith("multiple_visible_code_");

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const err = ambiguousCode
      ? `Phase 2l: ambiguous code field targets after fallback chain (${codeResolved.reason})`
      : `Phase 2l: code field could not be resolved (${codeResolved.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          selector_code: codeSel.trim(),
          selector_qty: qtySel.trim(),
          block_reason: ambiguousCode ? "code_ambiguous" : "code_resolution_failed",
          code_locator_resolution: codeResolved.reason,
          code_locator_strategy_trace: codeResolved.strategy_trace ?? null,
          code_locator_detail: codeResolved.detail ?? null,
          safe_mode_failure_forensics: safeModeFailureForensics,
        }),
      }),
    );

    throw new Error(err);
  }

  const codeLoc = codeResolved.loc;

  const qtyResolved = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(
    page,
    qtySel.trim(),
    { mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null },
  );

  if (!qtyResolved.ok) {
    const ambiguousQty =
      qtyResolved.reason === "multiple_visible_quantity_controls_ambiguous" ||
      qtyResolved.reason === "multiple_visible_quantity_spinbutton_ambiguous" ||
      qtyResolved.reason === "multiple_visible_quantity_number_inputs_ambiguous";

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const err = ambiguousQty
      ? `Phase 2l: ambiguous quantity targets after fallback chain (${qtyResolved.reason})`
      : `Phase 2l: quantity field could not be resolved (${qtyResolved.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          selector_code: codeSel.trim(),
          selector_qty: qtySel.trim(),
          code_field_locator_strategy: codeResolved.strategy ?? null,
          block_reason: ambiguousQty ? "quantity_ambiguous" : "quantity_resolution_failed",
          quantity_locator_resolution: qtyResolved.reason,
          quantity_locator_strategy_trace: qtyResolved.strategy_trace ?? null,
          quantity_locator_detail: qtyResolved.detail ?? null,
          safe_mode_failure_forensics: safeModeFailureForensics,
        }),
      }),
    );

    throw new Error(err);
  }

  const qtyLoc = qtyResolved.loc;

  const codeVis = await codeLoc.isVisible().catch(() => false);
  const qtyVis = await qtyLoc.isVisible().catch(() => false);

  if (!codeVis || !qtyVis) {
    const err = "Phase 2l: code or quantity field not visible";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          code_visible: codeVis,
          qty_visible: qtyVis,
          code_field_locator_strategy: codeResolved.strategy ?? null,
          quantity_locator_strategy: qtyResolved.strategy ?? null,
          block_reason: "field_not_visible",
        }),
      }),
    );

    throw new Error(err);
  }

  const snapCodeBefore = await readFieldDomSnapshot(codeLoc);
  const snapQtyBefore = await readFieldDomSnapshot(qtyLoc);

  const codeSurface = phase2lCodeFieldDomSnapshotAllowed(snapCodeBefore);
  const qtySurface = phase2jQuantityDomSnapshotAllowed(snapQtyBefore);

  if (!codeSurface.ok) {
    const err = `Phase 2l: code field surface rejected (${codeSurface.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          dom_snapshot_code_before: snapCodeBefore,
          block_reason: codeSurface.reason,
        }),
      }),
    );

    throw new Error(err);
  }

  const codeInputTypeLower = String(snapCodeBefore.type || "text").toLowerCase();

  if (codeInputTypeLower === "number") {
    const numGate = validatePhase2hTestCodeForNumberInputSurface(testCode);

    if (!numGate.ok) {
      const err = `Phase 2l: type=number code field requires MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE to be 1–12 digits only (synthetic non-production): ${numGate.reason}`;

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2l_combined_blocked",
          message: err,
          attributes: baseBlockedAttrs({
            dom_snapshot_code_before: snapCodeBefore,
            code_input_surface: "number",
            block_reason: `number_surface_test_code:${numGate.reason}`,
          }),
        }),
      );

      throw new Error(err);
    }
  }

  if (!qtySurface.ok) {
    const err = `Phase 2l: quantity field surface rejected (${qtySurface.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          dom_snapshot_qty_before: snapQtyBefore,
          block_reason: qtySurface.reason,
        }),
      }),
    );

    throw new Error(err);
  }

  if (snapCodeBefore.disabled || snapCodeBefore.readOnly) {
    const err = "Phase 2l: code field disabled or read-only";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          dom_snapshot_code_before: snapCodeBefore,
          block_reason: "code_disabled_or_readonly",
        }),
      }),
    );

    throw new Error(err);
  }

  if (snapQtyBefore.disabled || snapQtyBefore.readOnly) {
    const err = "Phase 2l: quantity field disabled or read-only";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          dom_snapshot_qty_before: snapQtyBefore,
          block_reason: "qty_disabled_or_readonly",
        }),
      }),
    );

    throw new Error(err);
  }

  const rawCode = await collectPhase2gRiskPayloadFromLocator(codeLoc);
  const rawQty = await collectPhase2gRiskPayloadFromLocator(qtyLoc);
  let mutation_risk_code = computePhase2gExtendedMutationRisk(rawCode);
  let mutation_risk_qty = computePhase2gExtendedMutationRisk(rawQty);

  if (mutation_risk_code.rehearsal_blocked || mutation_risk_qty.rehearsal_blocked) {
    const err = `Phase 2l: extended mutation risk blocked: code=${mutation_risk_code.block_reasons.join("|")} qty=${mutation_risk_qty.block_reasons.join("|")}`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          dom_snapshot_code_before: snapCodeBefore,
          dom_snapshot_qty_before: snapQtyBefore,
          mutation_risk_code,
          mutation_risk_qty,
          block_reason: "extended_mutation_risk",
        }),
      }),
    );

    throw new Error(err);
  }

  const mutation_risk_code_before_fills = mutation_risk_code;
  const mutation_risk_qty_before_fills = mutation_risk_qty;

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2l_pre_sequence_snapshot",
        message:
          "Phase 2l checkpoint before combined fill sequence (no Enter; tenant field order)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2l_pre_sequence_evidence",
      message:
        "Phase 2l pre-interaction evidence (both locators; Phase 2k gates; non-mutating intent)",
      attributes: {
        phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
        phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
        phase_2k_combined_gate_manifest: gateManifest,
        field_order: fieldOrder,
        dom_snapshot_code_before: snapCodeBefore,
        dom_snapshot_qty_before: snapQtyBefore,
        mutation_risk_code,
        mutation_risk_qty,
        mutation_risk_checks_used,
        run_non_mutating_intent:
          "no_add_line_validate_checkout_submit_no_enter_no_apply",
        test_code_redacted: "[length_only_in_findings]",
        test_quantity_redacted: "[length_only_in_findings]",
      },
    }),
  );

  const fillSteps =
    fieldOrder === "quantity_first"
      ? [
          {
            key: "quantity",
            loc: qtyLoc,
            value: testQuantity,
            label: "quantity_first_step",
          },
          {
            key: "code",
            loc: codeLoc,
            value: testCode,
            label: "code_second_step",
          },
        ]
      : [
          {
            key: "code",
            loc: codeLoc,
            value: testCode,
            label: "code_first_step",
          },
          {
            key: "quantity",
            loc: qtyLoc,
            value: testQuantity,
            label: "quantity_second_step",
          },
        ];

  const blockedBeforeSequence =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const fillStepDeltas = [];

  for (let i = 0; i < fillSteps.length; i++) {
    const step = fillSteps[i];
    const blockedBeforeStep =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    try {
      await step.loc.fill(step.value, { timeout: 8000 });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2l_combined_blocked",
          message: `Phase 2l: fill failed (${step.label}): ${m}`,
          attributes: baseBlockedAttrs({
            failed_step: step.label,
            block_reason: `fill_error:${m}`,
            dom_snapshot_code_before: snapCodeBefore,
            dom_snapshot_qty_before: snapQtyBefore,
            mutation_risk_code,
            mutation_risk_qty,
          }),
        }),
      );

      throw new Error(`Phase 2l combined fill failed: ${m}`);
    }

    await new Promise((r) => setTimeout(r, 250));

    const blockedAfterStep =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    const deltaStep =
      blockedBeforeStep != null && blockedAfterStep != null
        ? blockedAfterStep - blockedBeforeStep
        : null;

    fillStepDeltas.push({
      step: step.label,
      key: step.key,
      network_guard_delta: deltaStep,
    });

    if (deltaStep != null && deltaStep > 0) {
      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2l_combined_findings",
          message:
            "Phase 2l stopped: network guard saw new blocked requests during a fill step; fields not cleared",
          attributes: {
            phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
            phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
            phase_2k_combined_gate_manifest: gateManifest,
            field_order: fieldOrder,
            failed_step: step.label,
            fill_step_deltas: fillStepDeltas,
            test_code_length: testCode.length,
            test_quantity_length: testQuantity.length,
            network_guard_blocked_before_sequence: blockedBeforeSequence,
            network_guard_blocked_after_failed_step: blockedAfterStep,
            combined_rehearsal_performed: true,
            fields_cleared_after: false,
            clear_skipped_reason:
              "network_abort_during_fill_clearing_would_be_ambiguous_stop_hard_fail",
            run_remained_fully_non_mutating: false,
            mutation_risk_checks_used,
            mutation_risk_code,
            mutation_risk_qty,
            disclaimer:
              "single_run_observation_does_not_prove_combined_interaction_safety_no_cart_state_proof",
          },
        }),
      );

      throw new Error(
        "Phase 2l combined rehearsal: network guard triggered during fill (cart/order mutation URL pattern aborted)",
      );
    }

    if (i === 0) {
      const rawCodeAfter = await collectPhase2gRiskPayloadFromLocator(codeLoc);
      const rawQtyAfter = await collectPhase2gRiskPayloadFromLocator(qtyLoc);
      mutation_risk_code = computePhase2gExtendedMutationRisk(rawCodeAfter);
      mutation_risk_qty = computePhase2gExtendedMutationRisk(rawQtyAfter);

      if (mutation_risk_code.rehearsal_blocked || mutation_risk_qty.rehearsal_blocked) {
        const err = `Phase 2l: extended mutation risk blocked after first fill: code=${mutation_risk_code.block_reasons.join("|")} qty=${mutation_risk_qty.block_reasons.join("|")}`;

        evidenceCollected.push(
          buildEvidence({
            kind: "mlcc_add_by_code_probe",
            stage: "mlcc_phase_2l_combined_blocked",
            message: err,
            attributes: baseBlockedAttrs({
              block_reason: "extended_mutation_risk_after_first_fill",
              mutation_risk_code_after_first_fill: mutation_risk_code,
              mutation_risk_qty_after_first_fill: mutation_risk_qty,
              fill_step_deltas: fillStepDeltas,
            }),
          }),
        );

        throw new Error(err);
      }
    }
  }

  const lastFilledLoc = fillSteps[fillSteps.length - 1].loc;

  if (allowBlur) {
    try {
      if (typeof lastFilledLoc.blur === "function") {
        await lastFilledLoc.blur({ timeout: 3000 });
      } else {
        await lastFilledLoc.evaluate((el) => {
          if (el instanceof HTMLElement) {
            el.blur();
          }
        });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2l_combined_blocked",
          message: `Phase 2l: blur failed: ${m}`,
          attributes: baseBlockedAttrs({
            block_reason: `blur_error:${m}`,
            fill_step_deltas: fillStepDeltas,
          }),
        }),
      );

      throw new Error(`Phase 2l blur failed: ${m}`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  const blockedAfterFills =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_fills =
    blockedBeforeSequence != null && blockedAfterFills != null
      ? blockedAfterFills - blockedBeforeSequence
      : null;

  const snapCodeAfterFills = await readFieldDomSnapshot(codeLoc);
  const snapQtyAfterFills = await readFieldDomSnapshot(qtyLoc);
  const preAddContainerContext = await codeLoc.evaluate((el) => {
    const root =
      el.closest(".search-container") ||
      el.closest("form") ||
      el.parentElement;
    if (!(root instanceof HTMLElement)) {
      return null;
    }
    return {
      root_tag: root.tagName.toLowerCase(),
      root_id: root.id || null,
      root_class:
        typeof root.className === "string"
          ? root.className.slice(0, 160)
          : null,
      root_role: root.getAttribute("role"),
    };
  });
  let preAddRawControls = await collectMutationBoundaryControlsFromBycodeFieldLocator(
    codeLoc,
    120,
  );
  let preAddScanScope = "bycode_field_bounded_root";
  if (preAddRawControls.length === 0) {
    preAddRawControls = await collectMutationBoundaryControls(page, 120);
    preAddScanScope =
      preAddRawControls.length > 0
        ? "full_page_fallback_after_empty_bounded_scan"
        : "no_controls_detected";
  }
  const preAddClassifiedControls = classifyBoundaryRows(preAddRawControls, []);
  const preAddControlCandidates = preAddClassifiedControls.map((row) => {
    const text = String(row.text ?? "").trim();
    const lower = text.toLowerCase();
    const appears_bulk_add_all =
      /\badd\s*all\b/i.test(text) || /\ball\s*to\s*cart\b/i.test(text);
    const appears_single_line_add_apply =
      /\b(add|apply)\s*line\b/i.test(text) || /^add$/i.test(text) || /^apply$/i.test(text);
    const eligibility_preview = evaluatePhase2nAddApplyCandidateEligibility(
      row,
      [],
    );
    return {
      ...row,
      appears_single_line_add_apply,
      appears_bulk_add_all,
      excluded_for_phase_2n_prep:
        appears_bulk_add_all ||
        /add\s*to\s*cart|addtocart|update\s*cart|checkout|validate|submit|finalize|confirm/i.test(
          lower,
        ),
      phase_2n_eligibility_preview: eligibility_preview,
    };
  });
  const preAddControlCandidatesSample = preAddControlCandidates.slice(0, 20);

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2l_pre_add_controls_readonly",
      message:
        "Phase 2l read-only control capture after fills before clear (no add/apply click performed)",
      attributes: {
        phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
        field_order: fieldOrder,
        selector_code: codeSel.trim(),
        selector_qty: qtySel.trim(),
        pre_add_controls_scan_scope: preAddScanScope,
        pre_add_controls_container_context: preAddContainerContext,
        pre_add_controls_scan_count: preAddControlCandidates.length,
        pre_add_controls_sample: preAddControlCandidatesSample,
        pre_add_controls_sample_omitted: Math.max(
          0,
          preAddControlCandidates.length - preAddControlCandidatesSample.length,
        ),
        exclusion_rule_note:
          "bulk_add_all_and_cart_checkout_validate_submit_controls_marked_excluded_for_2n_prep",
      },
    }),
  );

  let run_remained_fully_non_mutating = true;
  let network_guard_delta_during_clear = null;
  const clearStepDeltas = [];

  const skipReverseClearBecause2u =
    config.addByCodePhase2lSkipClearWhen2uApproved === true;

  if (
    network_guard_delta_during_fills != null &&
    network_guard_delta_during_fills > 0
  ) {
    run_remained_fully_non_mutating = false;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_findings",
        message:
          "Phase 2l stopped: cumulative network guard delta positive after fills; fields not cleared",
        attributes: {
          phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
          field_order: fieldOrder,
          fill_step_deltas: fillStepDeltas,
          network_guard_delta_during_fills,
          combined_rehearsal_performed: true,
          fields_cleared_after: false,
          run_remained_fully_non_mutating: false,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(
      "Phase 2l: network guard cumulative delta positive after combined fills",
    );
  }

  let blockedAfterClear;
  let snapCodeAfterClear;
  let snapQtyAfterClear;

  if (skipReverseClearBecause2u) {
    blockedAfterClear = blockedAfterFills;
    network_guard_delta_during_clear = null;
    snapCodeAfterClear = snapCodeAfterFills;
    snapQtyAfterClear = snapQtyAfterFills;
  } else {
    const clearSteps = [...fillSteps].reverse();

    for (const step of clearSteps) {
      const blockedBeforeClear =
        guardStats && typeof guardStats.blockedRequestCount === "number"
          ? guardStats.blockedRequestCount
          : null;

      try {
        await step.loc.fill("", { timeout: 8000 });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);

        evidenceCollected.push(
          buildEvidence({
            kind: "mlcc_add_by_code_probe",
            stage: "mlcc_phase_2l_combined_findings",
            message: `Phase 2l: clear fill failed (${step.label}): ${m}`,
            attributes: {
              phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
              field_order: fieldOrder,
              clear_failed_step: step.label,
              clear_error: m,
              combined_rehearsal_performed: true,
              fields_cleared_after: false,
              run_remained_fully_non_mutating: false,
              mutation_risk_checks_used,
            },
          }),
        );

        throw new Error(`Phase 2l clear failed: ${m}`);
      }

      await new Promise((r) => setTimeout(r, 200));

      const blockedAfterClearStep =
        guardStats && typeof guardStats.blockedRequestCount === "number"
          ? guardStats.blockedRequestCount
          : null;

      const dClear =
        blockedBeforeClear != null && blockedAfterClearStep != null
          ? blockedAfterClearStep - blockedBeforeClear
          : null;

      clearStepDeltas.push({ step: step.label, network_guard_delta: dClear });

      if (dClear != null && dClear > 0) {
        run_remained_fully_non_mutating = false;
      }
    }

    blockedAfterClear =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    network_guard_delta_during_clear =
      blockedAfterFills != null && blockedAfterClear != null
        ? blockedAfterClear - blockedAfterFills
        : null;

    snapCodeAfterClear = await readFieldDomSnapshot(codeLoc);
    snapQtyAfterClear = await readFieldDomSnapshot(qtyLoc);
  }

  if (
    network_guard_delta_during_clear != null &&
    network_guard_delta_during_clear > 0
  ) {
    run_remained_fully_non_mutating = false;
  }

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2l_post_clear_snapshot",
        message: skipReverseClearBecause2u
          ? "Phase 2l checkpoint after fills (reverse-order clear skipped; operator-gated 2u lane)"
          : "Phase 2l checkpoint after reverse-order clear fills",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const fieldsClearedAfter = !skipReverseClearBecause2u;

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2l_combined_findings",
      message: skipReverseClearBecause2u
        ? "Phase 2l combined rehearsal complete (fills retained for 2u; reverse clear skipped; no add line in 2l)"
        : "Phase 2l combined rehearsal complete (truthful; no add line; no cart mutation path)",
      attributes: {
        phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
        phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
        phase_2k_combined_gate_manifest: gateManifest,
        field_order: fieldOrder,
        selector_code: codeSel.trim(),
        selector_qty: qtySel.trim(),
        test_code_length: testCode.length,
        test_quantity_length: testQuantity.length,
        test_code_redacted: "[length_only_not_value]",
        test_quantity_redacted: "[length_only_not_value]",
        dom_snapshot_code_before: snapCodeBefore,
        dom_snapshot_qty_before: snapQtyBefore,
        dom_snapshot_code_after_fills: snapCodeAfterFills,
        dom_snapshot_qty_after_fills: snapQtyAfterFills,
        dom_snapshot_code_after_clear: snapCodeAfterClear,
        dom_snapshot_qty_after_clear: snapQtyAfterClear,
        mutation_risk_code_before_fills,
        mutation_risk_qty_before_fills,
        mutation_risk_checks_used,
        mutation_risk_code_after_first_fill: mutation_risk_code,
        mutation_risk_qty_after_first_fill: mutation_risk_qty,
        fill_step_deltas: fillStepDeltas,
        clear_step_deltas: clearStepDeltas,
        blur_used: allowBlur,
        network_guard_blocked_before_sequence: blockedBeforeSequence,
        network_guard_blocked_after_fills: blockedAfterFills,
        network_guard_delta_during_fills,
        network_guard_blocked_after_clear: blockedAfterClear,
        network_guard_delta_during_clear,
        combined_rehearsal_performed: true,
        code_field_touched: true,
        quantity_field_touched: true,
        phase_2l_reverse_clear_skipped_for_milo_2u: skipReverseClearBecause2u,
        fields_cleared_after: fieldsClearedAfter,
        run_remained_fully_non_mutating,
        interaction_method: skipReverseClearBecause2u
          ? allowBlur
            ? "two_fills_skip_reverse_clear_for_2u_optional_blur_last_field_no_enter_no_clicks"
            : "two_fills_skip_reverse_clear_for_2u_no_blur_no_enter_no_clicks"
          : allowBlur
            ? "two_fills_reverse_clear_optional_blur_last_field_no_enter_no_clicks"
            : "two_fills_reverse_clear_no_blur_no_enter_no_clicks",
        disclaimer: skipReverseClearBecause2u
          ? "skip_clear_is_operator_gated_hypothesis_lane_only_dom_after_clear_equals_after_fills_not_server_cart_truth"
          : "observed_no_new_layer2_aborts_during_declared_fill_and_clear_steps_on_this_run_only_does_not_prove_general_combined_safety_or_server_cart_state_not_ready_for_add_line",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2l_combined_complete",
    progressMessage: skipReverseClearBecause2u
      ? "Phase 2l complete (fill retained; clear skipped for 2u lane; no validate/add-line/checkout/submit)"
      : "Phase 2l complete (combined fill+clear; no validate/add-line/checkout/submit)",
  });

  return {
    phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
    phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
    combined_rehearsal_performed: true,
    fields_cleared_after: fieldsClearedAfter,
    field_order: fieldOrder,
    run_remained_fully_non_mutating,
    network_guard_delta_during_fills,
    network_guard_delta_during_clear,
    mutation_risk_checks_used,
    mutation_risk_code_after_first_fill: mutation_risk_code,
    mutation_risk_qty_after_first_fill: mutation_risk_qty,
    blur_used: allowBlur,
  };
}

export const PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_POLICY_VERSION = "lk-rpa-2l-milo-manual-1";

/**
 * Replaces standard Phase 2l fill-only rehearsal when operator-gated: click → pressSequentially type → click → type
 * on tenant code/qty fields (order from MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER), then one safe blank click
 * (default `main` corner). Captures collectMiloPreCartBycodeListSurfaceReadonly immediately before 2U.
 * No add-to-cart, validate, checkout, or submit in this phase.
 */
export async function runPhase2lMiloManualParitySequenceAndPre2uSnapshot({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
}) {
  const gateManifest = buildPhase2kCombinedInteractionFutureGateManifest();
  const testCode = config.addByCodePhase2lTestCode;
  const testQuantity = config.addByCodePhase2lTestQuantity;
  const fieldOrder = config.addByCodePhase2lFieldOrder;
  const codeSel =
    typeof config?.addByCodeCodeFieldSelector === "string"
      ? config.addByCodeCodeFieldSelector.trim()
      : "";
  const qtySel =
    typeof config?.addByCodeQtyFieldSelector === "string"
      ? config.addByCodeQtyFieldSelector.trim()
      : "";

  const mutation_risk_checks_used = [
    `phase_2l_milo_manual_parity_policy_${PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_POLICY_VERSION}`,
    "phase_2k_combined_gate_manifest_echoed_operator_manual_click_type_blank",
    "layer_2_guardstats_blockedRequestCount_delta_zero_end_of_sequence",
    "no_enter_press_sequentially_only_after_field_click",
    "no_add_to_cart_validate_checkout_submit_in_manual_parity_phase",
  ];

  const fullKeyboardParityEnabled =
    config?.addByCodePhase2lMiloFullKeyboardParitySequence === true;

  if (fullKeyboardParityEnabled) {
    mutation_risk_checks_used.push(
      "full_keyboard_parity_click_code_type_tab_type_qty_tab_short_settle",
    );
  }

  await heartbeat({
    progressStage: "mlcc_phase_2l_milo_manual_parity_start",
    progressMessage:
      fullKeyboardParityEnabled
        ? "MILO keyboard parity: click/type code Tab type qty Tab; pre-2U read-only list snapshot (no add-to-cart)"
        : "MILO manual parity: click/type code+qty + blank click; pre-2U read-only list snapshot (no add-to-cart)",
  });

  const baseBlocked = (extra = {}) => ({
    phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
    phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
    phase_2k_combined_gate_manifest: gateManifest,
    phase_2l_milo_manual_parity_policy_version:
      PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_POLICY_VERSION,
    field_order: fieldOrder,
    combined_rehearsal_performed: false,
    mutation_risk_checks_used,
    ...extra,
  });

  if (!codeSel || !qtySel) {
    const err =
      "MILO manual parity requires MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR and MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({ block_reason: "missing_tenant_code_or_quantity_selector" }),
      }),
    );
    throw new Error(err);
  }

  if (!testCode || !testQuantity || !fieldOrder) {
    const err =
      "MILO manual parity requires Phase 2l test code, quantity, and MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({ block_reason: "missing_2l_test_payload_or_field_order" }),
      }),
    );
    throw new Error(err);
  }

  const codeResolvedManual = await resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(
    page,
    codeSel,
    { mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null },
  );

  if (!codeResolvedManual.ok) {
    const ambiguousCode =
      typeof codeResolvedManual.reason === "string" &&
      codeResolvedManual.reason.startsWith("multiple_visible_code_");

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const err = ambiguousCode
      ? `MILO manual parity: ambiguous code field targets after fallback chain (${codeResolvedManual.reason})`
      : `MILO manual parity: code field could not be resolved (${codeResolvedManual.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: ambiguousCode ? "code_ambiguous" : "code_resolution_failed",
          selector_code: codeSel,
          selector_qty: qtySel,
          code_locator_resolution: codeResolvedManual.reason,
          code_locator_strategy_trace: codeResolvedManual.strategy_trace ?? null,
          code_locator_detail: codeResolvedManual.detail ?? null,
          safe_mode_failure_forensics: safeModeFailureForensics,
        }),
      }),
    );
    throw new Error(err);
  }

  const codeLoc = codeResolvedManual.loc;

  const qtyResolvedManual = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(
    page,
    qtySel,
    { mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null },
  );

  if (!qtyResolvedManual.ok) {
    const ambiguousQty =
      qtyResolvedManual.reason === "multiple_visible_quantity_controls_ambiguous" ||
      qtyResolvedManual.reason === "multiple_visible_quantity_spinbutton_ambiguous" ||
      qtyResolvedManual.reason === "multiple_visible_quantity_number_inputs_ambiguous";

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const err = ambiguousQty
      ? `MILO manual parity: ambiguous quantity targets after fallback chain (${qtyResolvedManual.reason})`
      : `MILO manual parity: quantity field could not be resolved (${qtyResolvedManual.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: ambiguousQty ? "quantity_ambiguous" : "quantity_resolution_failed",
          selector_code: codeSel,
          selector_qty: qtySel,
          code_field_locator_strategy: codeResolvedManual.strategy ?? null,
          quantity_locator_resolution: qtyResolvedManual.reason,
          quantity_locator_strategy_trace: qtyResolvedManual.strategy_trace ?? null,
          quantity_locator_detail: qtyResolvedManual.detail ?? null,
          safe_mode_failure_forensics: safeModeFailureForensics,
        }),
      }),
    );
    throw new Error(err);
  }

  const qtyLoc = qtyResolvedManual.loc;

  const codeVis = await codeLoc.isVisible().catch(() => false);
  const qtyVis = await qtyLoc.isVisible().catch(() => false);

  if (!codeVis || !qtyVis) {
    const err = "MILO manual parity: code or quantity field not visible";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: "field_not_visible",
          code_visible: codeVis,
          qty_visible: qtyVis,
          code_field_locator_strategy: codeResolvedManual.strategy ?? null,
          quantity_locator_strategy: qtyResolvedManual.strategy ?? null,
        }),
      }),
    );
    throw new Error(err);
  }

  const snapCodeBefore = await readFieldDomSnapshot(codeLoc);
  const snapQtyBefore = await readFieldDomSnapshot(qtyLoc);
  const codeSurface = phase2lCodeFieldDomSnapshotAllowed(snapCodeBefore);
  const qtySurface = phase2jQuantityDomSnapshotAllowed(snapQtyBefore);

  if (!codeSurface.ok) {
    const err = `MILO manual parity: code field surface rejected (${codeSurface.reason})`;
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: codeSurface.reason,
          dom_snapshot_code_before: snapCodeBefore,
        }),
      }),
    );
    throw new Error(err);
  }

  const codeInputTypeLower = String(snapCodeBefore.type || "text").toLowerCase();

  if (codeInputTypeLower === "number") {
    const numGate = validatePhase2hTestCodeForNumberInputSurface(testCode);

    if (!numGate.ok) {
      const err = `MILO manual parity: type=number code field requires digits-only test code: ${numGate.reason}`;
      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2l_milo_manual_parity_blocked",
          message: err,
          attributes: baseBlocked({
            block_reason: `number_surface_test_code:${numGate.reason}`,
            dom_snapshot_code_before: snapCodeBefore,
          }),
        }),
      );
      throw new Error(err);
    }
  }

  if (!qtySurface.ok) {
    const err = `MILO manual parity: quantity field surface rejected (${qtySurface.reason})`;
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: qtySurface.reason,
          dom_snapshot_qty_before: snapQtyBefore,
        }),
      }),
    );
    throw new Error(err);
  }

  if (snapCodeBefore.disabled || snapCodeBefore.readOnly) {
    const err = "MILO manual parity: code field disabled or read-only";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: "code_disabled_or_readonly",
          dom_snapshot_code_before: snapCodeBefore,
        }),
      }),
    );
    throw new Error(err);
  }

  if (snapQtyBefore.disabled || snapQtyBefore.readOnly) {
    const err = "MILO manual parity: quantity field disabled or read-only";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: "qty_disabled_or_readonly",
          dom_snapshot_qty_before: snapQtyBefore,
        }),
      }),
    );
    throw new Error(err);
  }

  const settleMs = Math.min(
    2000,
    Math.max(
      0,
      Number(config?.addByCodePhase2lMiloManualParitySequenceSettleMs ?? 600) || 0,
    ),
  );

  const blankClickX =
    typeof config?.addByCodePhase2lMiloManualParityBlankClickPositionX ===
      "number" &&
    Number.isFinite(config.addByCodePhase2lMiloManualParityBlankClickPositionX)
      ? Math.min(
          4000,
          Math.max(
            0,
            Math.round(config.addByCodePhase2lMiloManualParityBlankClickPositionX),
          ),
        )
      : 28;

  const blankClickY =
    typeof config?.addByCodePhase2lMiloManualParityBlankClickPositionY ===
      "number" &&
    Number.isFinite(config.addByCodePhase2lMiloManualParityBlankClickPositionY)
      ? Math.min(
          4000,
          Math.max(
            0,
            Math.round(config.addByCodePhase2lMiloManualParityBlankClickPositionY),
          ),
        )
      : 28;

  let blankTargetSel =
    typeof config?.addByCodePhase2lMiloManualParityBlankClickTargetSelector ===
      "string" &&
    config.addByCodePhase2lMiloManualParityBlankClickTargetSelector.trim() !== ""
      ? config.addByCodePhase2lMiloManualParityBlankClickTargetSelector.trim()
      : "main";

  const blockedBeforeSequence =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const collectAppProductByCodeTimelineSnapshot = async (checkpoint) =>
    page.evaluate((label) => {
      const probeTerms = ["Patron", "Anejo", "2458", "375ml", "General Wine"];
      const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      };
      const mount = document.querySelector("app-product-by-code");
      const timelineState = window.__lk_app_product_by_code_timeline_state || null;
      const domPathCompact = (el) => {
        const out = [];
        let cur = el;
        let d = 0;
        while (cur && d < 6 && cur !== document.body) {
          const tag = String(cur.tagName || "").toLowerCase();
          const p = cur.parentElement;
          const idx = p ? Array.from(p.children).indexOf(cur) + 1 : 1;
          const cls = normalize(cur.className || "").split(" ").filter(Boolean).slice(0, 2).join(".");
          out.unshift(`${tag}${cls ? `.${cls}` : ""}:nth-child(${Math.max(1, idx)})`);
          cur = p;
          d += 1;
        }
        return out.join(" > ");
      };
      if (!mount) {
        return {
          checkpoint: label,
          mount_present: false,
          families: [],
          any_family_looks_like_real_items: false,
          mutation_state: timelineState,
        };
      }

      const familyMap = new Map();
      const familyRepNodeByKey = new Map();
      const allNodes = Array.from(mount.querySelectorAll("*"))
        .filter((n) => n instanceof HTMLElement && isVisible(n))
        .slice(0, 500);

      const looksChrome = (cls, txt) =>
        /wrapper|layout|container|toolbar|header|navbar|spacer|padding|margin|search|form-group|border-bottom/i.test(
          String(cls || ""),
        ) ||
        /add all to cart|liquor code|quantity|choose license|account home|to add products by code/i.test(
          String(txt || "").toLowerCase(),
        );

      for (const node of allNodes) {
        const p = node.parentElement;
        if (!p) continue;
        const sameTagVisibleSiblings = Array.from(p.children).filter(
          (s) =>
            s instanceof HTMLElement &&
            isVisible(s) &&
            String(s.tagName || "").toLowerCase() === String(node.tagName || "").toLowerCase(),
        );
        if (sameTagVisibleSiblings.length < 2) continue;
        const key = `${String(node.tagName || "").toLowerCase()}|${String(p.tagName || "").toLowerCase()}|${normalize(node.className || "").split(" ").slice(0, 2).join(" ")}`;
        if (familyMap.has(key)) continue;

        const samples = sameTagVisibleSiblings.slice(0, 5).map((s) => {
          const st = normalize(s.textContent || "");
          return {
            tag: String(s.tagName || "").toLowerCase(),
            class_sample: normalize(s.className || "").slice(0, 120),
            text_head: st.slice(0, 140),
            text_length: st.length,
          };
        });
        const rep = sameTagVisibleSiblings[0];
        const repTxt = normalize(rep?.textContent || "");
        const repParentTxt = normalize(rep?.parentElement?.textContent || "");
        const repGrandTxt = normalize(rep?.parentElement?.parentElement?.textContent || "");
        const localContextWindow = [repParentTxt.slice(0, 120), repTxt.slice(0, 120), repGrandTxt.slice(0, 120)]
          .filter(Boolean)
          .join(" | ");
        const probeHits = probeTerms
          .map((term) => ({
            term,
            observed: localContextWindow.toLowerCase().includes(term.toLowerCase()),
          }))
          .filter((x) => x.observed);
        const textFingerprint = samples
          .map((s) => s.text_head.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
          .join(" | ")
          .slice(0, 220);
        const outerHtmlFingerprint = normalize(rep?.outerHTML || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .slice(0, 220);
        const familyLooksShell = looksChrome(rep?.className, localContextWindow);
        const familyLooksRealItems =
          sameTagVisibleSiblings.length >= 2 &&
          !familyLooksShell &&
          samples.some((s) => s.text_length > 20);

        familyMap.set(key, {
          family_key: key,
          family_size: sameTagVisibleSiblings.length,
          representative_tag: String(rep?.tagName || "").toLowerCase(),
          representative_class_sample: normalize(rep?.className || "").slice(0, 120),
          representative_dom_path: domPathCompact(rep),
          container_dom_path: domPathCompact(p),
          outer_html_fingerprint: outerHtmlFingerprint,
          text_fingerprint: textFingerprint,
          local_context_window: localContextWindow.slice(0, 320),
          probe_term_hits: probeHits,
          family_looks_shell_or_chrome: familyLooksShell,
          family_looks_like_real_item_rows: familyLooksRealItems,
          sibling_samples: samples,
        });
        familyRepNodeByKey.set(key, rep);
      }

      const families = Array.from(familyMap.values()).slice(0, 20);
      const trackedSet = new Set([
        mount,
        ...families
          .map((f) => familyRepNodeByKey.get(f.family_key))
          .filter((n) => n instanceof HTMLElement),
      ]);
      const expandedCarrierSet = new Set();
      const relationByElement = new Map();
      const addCarrier = (el, relation) => {
        if (!(el instanceof HTMLElement)) return;
        if (!isVisible(el)) return;
        expandedCarrierSet.add(el);
        if (!relationByElement.has(el)) relationByElement.set(el, relation);
      };
      addCarrier(mount, "mount");
      for (const t of trackedSet) {
        if (!(t instanceof HTMLElement)) continue;
        addCarrier(t.parentElement, "parent");
        if (t.parentElement?.parentElement) addCarrier(t.parentElement.parentElement, "parent");
        for (const c of Array.from(t.children || []).slice(0, 8)) addCarrier(c, "child");
        const sibs = t.parentElement ? Array.from(t.parentElement.children) : [];
        for (const s of sibs.slice(0, 10)) {
          if (s !== t) addCarrier(s, "adjacent_sibling");
        }
      }
      // Nearby repeated-looking containers within/near mount.
      for (const n of allNodes.slice(0, 220)) {
        const p = n.parentElement;
        if (!p) continue;
        const repSibs = Array.from(p.children).filter(
          (x) =>
            x instanceof HTMLElement &&
            isVisible(x) &&
            String(x.tagName || "").toLowerCase() === String(n.tagName || "").toLowerCase(),
        );
        if (repSibs.length >= 2) addCarrier(p, "nearby_repeating_family");
      }
      // Containers just outside current scaffolding influence.
      for (const n of allNodes.slice(0, 120)) {
        const cls = normalize(n.className || "");
        if (/wrapper|layout|container|toolbar|header|navbar|search|form-group|border-bottom/i.test(cls)) {
          continue;
        }
        const p = n.parentElement;
        if (!p) continue;
        if (!trackedSet.has(p) && !trackedSet.has(n)) addCarrier(n, "nearby_outside");
      }
      const expandedCarriers = Array.from(expandedCarrierSet)
        .slice(0, 30)
        .map((el) => {
          const txt = normalize(el.textContent || "");
          const sig = `${String(el.tagName || "").toLowerCase()}|${normalize(el.className || "").slice(0, 120)}`;
          const childSummary = Array.from(el.children || [])
            .slice(0, 6)
            .map((c) => ({
              tag: String(c.tagName || "").toLowerCase(),
              class_sample: normalize(c.className || "").slice(0, 120),
            }));
          const outerFp = normalize(el.outerHTML || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .slice(0, 220);
          const innerFp = txt
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .slice(0, 220);
          const p = el.parentElement;
          const repSibs = p
            ? Array.from(p.children).filter(
                (x) =>
                  x instanceof HTMLElement &&
                  isVisible(x) &&
                  String(x.tagName || "").toLowerCase() === String(el.tagName || "").toLowerCase(),
              )
            : [];
          const shellLike =
            /wrapper|layout|container|toolbar|header|navbar|spacer|padding|margin|search|form-group|border-bottom/i.test(
              `${el.className || ""} ${p?.className || ""}`,
            ) || looksChrome(el.className, txt);
          const closerToItemCarrier =
            !shellLike && txt.length > 20 && repSibs.length >= 2;
          return {
            carrier_id: `${domPathCompact(el)}|${sig}`,
            dom_path: domPathCompact(el),
            relation_to_tracked_set: relationByElement.get(el) || "other_bounded_relation",
            tag_class_signature: sig,
            child_count: el.children?.length || 0,
            direct_child_summary: childSummary,
            outer_html_fingerprint: outerFp,
            inner_text_fingerprint: innerFp,
            shell_like: shellLike,
            looks_closer_to_item_carrier: closerToItemCarrier,
          };
        });
      const markerKeywords = [
        "loading",
        "please wait",
        "searching",
        "no results",
        "empty",
      ];
      const extractAriaAttrs = (el) =>
        Object.fromEntries(
          Array.from(el.attributes || [])
            .filter((a) => a && /^aria-/i.test(a.name))
            .map((a) => [a.name, String(a.value || "")]),
        );
      const extractDataAttrs = (el) =>
        Object.fromEntries(
          Array.from(el.attributes || [])
            .filter((a) => a && /^data-/i.test(a.name))
            .map((a) => [a.name, String(a.value || "")]),
        );
      const extractStateMarker = (el, checkpointLabel, carrierLabel) => {
        if (!(el instanceof HTMLElement)) {
          return {
            carrier_label: carrierLabel,
            checkpoint: checkpointLabel,
            present: false,
          };
        }
        const text = normalize(el.textContent || "");
        const style = window.getComputedStyle(el);
        const classList = Array.from(el.classList || []);
        const keywordPresence = Object.fromEntries(
          markerKeywords.map((k) => [k, text.toLowerCase().includes(k)]),
        );
        return {
          carrier_label: carrierLabel,
          checkpoint: checkpointLabel,
          present: true,
          dom_path: domPathCompact(el),
          tag_class_signature: `${String(el.tagName || "").toLowerCase()}|${normalize(
            el.className || "",
          ).slice(0, 120)}`,
          class_list_full: classList,
          role_attr: el.getAttribute("role"),
          aria_attrs: extractAriaAttrs(el),
          data_attrs: extractDataAttrs(el),
          disabled_flag:
            el.hasAttribute("disabled") || String(el.getAttribute("aria-disabled") || "") === "true",
          hidden_flag:
            el.hidden ||
            el.getAttribute("aria-hidden") === "true" ||
            style.display === "none" ||
            style.visibility === "hidden",
          visible_flag: isVisible(el),
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          local_text_short: text.slice(0, 180),
          keyword_presence: keywordPresence,
        };
      };
      const productNameCarrierEl = Array.from(expandedCarrierSet).find((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const sig = `${String(el.tagName || "").toLowerCase()}|${normalize(el.className || "").slice(
          0,
          120,
        )}`;
        return sig.startsWith("div|product-name");
      });
      const colXl3SiblingCarrierEl = Array.from(expandedCarrierSet).find((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const cls = normalize(el.className || "").toLowerCase();
        const rel = relationByElement.get(el) || "";
        return rel === "adjacent_sibling" && /\bcol-xl-3\b/.test(cls);
      });
      const targetShellCarrierStateMarkers = {
        product_name_child: extractStateMarker(
          productNameCarrierEl,
          label,
          "product_name_child",
        ),
        adjacent_col_xl_3_family: extractStateMarker(
          colXl3SiblingCarrierEl,
          label,
          "adjacent_col_xl_3_family",
        ),
      };
      return {
        checkpoint: label,
        mount_present: true,
        mount_dom_path: domPathCompact(mount),
        mount_tag_class_signature: `${String(mount.tagName || "").toLowerCase()}|${normalize(mount.className || "").slice(0, 120)}`,
        mount_child_count: mount.children?.length || 0,
        mount_direct_child_summary: Array.from(mount.children || [])
          .slice(0, 8)
          .map((c) => ({
            tag: String(c.tagName || "").toLowerCase(),
            class_sample: normalize(c.className || "").slice(0, 120),
          })),
        mount_outer_html_fingerprint: normalize(mount.outerHTML || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .slice(0, 220),
        mount_inner_text_fingerprint: normalize(mount.textContent || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .slice(0, 220),
        mount_text_head: normalize(mount.textContent || "").slice(0, 220),
        families,
        expanded_carriers: expandedCarriers,
        target_shell_carrier_state_markers: targetShellCarrierStateMarkers,
        any_family_looks_like_real_items: families.some(
          (f) => f.family_looks_like_real_item_rows === true,
        ),
        mutation_state: timelineState,
      };
    }, checkpoint);

  await page.evaluate(() => {
    const mount = document.querySelector("app-product-by-code");
    const state = {
      observer_active: false,
      child_list_change_count: 0,
      subtree_change_count: 0,
      character_data_change_count: 0,
      added_node_count: 0,
      removed_node_count: 0,
      started_at_ms: Date.now(),
    };
    if (!mount) {
      window.__lk_app_product_by_code_timeline_state = state;
      return;
    }
    const obs = new MutationObserver((records) => {
      state.subtree_change_count += records.length;
      for (const rec of records) {
        if (rec.type === "childList") {
          state.child_list_change_count += 1;
          state.added_node_count += rec.addedNodes?.length || 0;
          state.removed_node_count += rec.removedNodes?.length || 0;
        } else if (rec.type === "characterData") {
          state.character_data_change_count += 1;
        }
      }
      state.last_mutation_at_ms = Date.now();
    });
    obs.observe(mount, { childList: true, subtree: true, characterData: true });
    state.observer_active = true;
    window.__lk_app_product_by_code_timeline_observer = obs;
    window.__lk_app_product_by_code_timeline_state = state;
  });

  const timelineStartMs = Date.now();
  const checkpointTimes = [];
  const networkEventTimeline = [];
  await page.evaluate(() => {
    if (window.__lk_inpage_net_state?.patched === true) return;
    const state = {
      patched: true,
      start_ms: Date.now(),
      fetch_count_total: 0,
      xhr_open_count_total: 0,
      xhr_send_count_total: 0,
      websocket_present: typeof window.WebSocket === "function",
      websocket_constructor_count_total: 0,
      websocket_send_count_total: 0,
      events: [],
    };
    const pushEvent = (kind) => {
      if (!Array.isArray(state.events)) state.events = [];
      if (state.events.length >= 240) return;
      state.events.push({ t_ms: Date.now() - state.start_ms, kind });
    };
    const originalFetch = window.fetch?.bind(window);
    if (originalFetch) {
      window.fetch = (...args) => {
        state.fetch_count_total += 1;
        pushEvent("fetch");
        return originalFetch(...args);
      };
    }
    const XHRProto = window.XMLHttpRequest?.prototype;
    if (XHRProto && !XHRProto.__lk_patched) {
      const origOpen = XHRProto.open;
      const origSend = XHRProto.send;
      XHRProto.open = function (...args) {
        state.xhr_open_count_total += 1;
        pushEvent("xhr_open");
        return origOpen.apply(this, args);
      };
      XHRProto.send = function (...args) {
        state.xhr_send_count_total += 1;
        pushEvent("xhr_send");
        return origSend.apply(this, args);
      };
      XHRProto.__lk_patched = true;
    }
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket === "function" && !NativeWebSocket.__lk_patched) {
      const PatchedWebSocket = function (...args) {
        state.websocket_constructor_count_total += 1;
        pushEvent("websocket_constructor");
        const ws = new NativeWebSocket(...args);
        if (ws && typeof ws.send === "function" && !ws.__lk_send_patched) {
          const nativeSend = ws.send.bind(ws);
          ws.send = (...sendArgs) => {
            state.websocket_send_count_total += 1;
            pushEvent("websocket_send");
            return nativeSend(...sendArgs);
          };
          ws.__lk_send_patched = true;
        }
        return ws;
      };
      PatchedWebSocket.prototype = NativeWebSocket.prototype;
      Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
      PatchedWebSocket.__lk_patched = true;
      window.WebSocket = PatchedWebSocket;
    }
    window.__lk_inpage_net_state = state;
  });
  const inPageCheckpointCounters = [];
  const readInPageCounters = async () =>
    page.evaluate(() => {
      const st = window.__lk_inpage_net_state || {};
      return {
        page_t_ms: Number.isFinite(Date.now() - Number(st.start_ms || Date.now()))
          ? Date.now() - Number(st.start_ms || Date.now())
          : 0,
        fetch_count_total: Number(st.fetch_count_total || 0),
        xhr_open_count_total: Number(st.xhr_open_count_total || 0),
        xhr_send_count_total: Number(st.xhr_send_count_total || 0),
        websocket_present: st.websocket_present === true,
        websocket_constructor_count_total: Number(st.websocket_constructor_count_total || 0),
        websocket_send_count_total: Number(st.websocket_send_count_total || 0),
      };
    });
  const classifyNetworkBucket = (url, resourceType) => {
    const u = String(url || "").toLowerCase();
    const rt = String(resourceType || "").toLowerCase();
    if (u.includes("graphql")) return "graphql";
    if (u.includes("/api/") || u.includes("rest") || u.includes("search")) return "api";
    if (rt === "xhr") return "xhr";
    if (rt === "fetch") return "fetch";
    if (["script", "stylesheet", "image", "font", "media"].includes(rt)) return "asset";
    return "other";
  };
  const statusBucket = (status) => {
    const n = Number(status);
    if (!Number.isFinite(n) || n <= 0) return "unknown";
    if (n >= 200 && n < 300) return "2xx";
    if (n >= 300 && n < 400) return "3xx";
    if (n >= 400 && n < 500) return "4xx";
    if (n >= 500 && n < 600) return "5xx";
    return "unknown";
  };
  const onRequest = (req) => {
    if (networkEventTimeline.length >= 220) return;
    networkEventTimeline.push({
      t_ms: Date.now() - timelineStartMs,
      event: "request",
      bucket: classifyNetworkBucket(req.url(), req.resourceType?.()),
      method: String(req.method?.() || "").toUpperCase(),
      status_bucket: "unknown",
    });
  };
  const onResponse = (res) => {
    if (networkEventTimeline.length >= 220) return;
    const req = res.request?.();
    networkEventTimeline.push({
      t_ms: Date.now() - timelineStartMs,
      event: "response",
      bucket: classifyNetworkBucket(req?.url?.() || "", req?.resourceType?.()),
      method: String(req?.method?.() || "").toUpperCase(),
      status_bucket: statusBucket(res.status?.()),
    });
  };
  const onRequestFailed = (req) => {
    if (networkEventTimeline.length >= 220) return;
    networkEventTimeline.push({
      t_ms: Date.now() - timelineStartMs,
      event: "request_failed",
      bucket: classifyNetworkBucket(req.url(), req.resourceType?.()),
      method: String(req.method?.() || "").toUpperCase(),
      status_bucket: "blocked",
    });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  const captureTimelineCheckpoint = async (label) => {
    checkpointTimes.push({
      checkpoint: label,
      t_ms: Date.now() - timelineStartMs,
    });
    inPageCheckpointCounters.push({
      checkpoint: label,
      ...(await readInPageCounters()),
    });
    timelineSnapshots.push(await collectAppProductByCodeTimelineSnapshot(label));
  };

  const timelineSnapshots = [];
  await captureTimelineCheckpoint("pre_sequence_baseline");

  const clickTypeField = async (loc, label, text) => {
    try {
      await loc.click({ timeout: 12_000 });
      await loc.fill("");
      await loc.pressSequentially(String(text), { delay: 28 });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      throw new Error(`${label}_click_or_type_failed:${m}`);
    }
  };

  const runFullKeyboardParitySequence = async () => {
    await codeLoc.click({ timeout: 12_000 });
    await codeLoc.fill("");
    await codeLoc.pressSequentially(String(testCode), { delay: 28 });
    await captureTimelineCheckpoint("post_code_entry");
    await codeLoc.press("Tab");
    await qtyLoc.fill("");
    await qtyLoc.pressSequentially(String(testQuantity), { delay: 28 });
    await qtyLoc.press("Tab");
    await captureTimelineCheckpoint("post_keyboard_parity_step");
  };

  const runManualParitySequence = async () => {
    const steps = [];

    if (fieldOrder === "quantity_first") {
      steps.push(() => clickTypeField(qtyLoc, "quantity", testQuantity));
      steps.push(() => clickTypeField(codeLoc, "code", testCode));
    } else {
      steps.push(() => clickTypeField(codeLoc, "code", testCode));
      steps.push(() => clickTypeField(qtyLoc, "quantity", testQuantity));
    }

    for (const step of steps) {
      await step();
    }
  };

  try {
    if (fullKeyboardParityEnabled) {
      await runFullKeyboardParitySequence();
    } else {
      await runManualParitySequence();
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: `MILO manual parity: ${m}`,
        attributes: baseBlocked({
          block_reason: m,
          selector_code: codeSel,
          selector_qty: qtySel,
        }),
      }),
    );
    throw new Error(`MILO manual parity sequence failed: ${m}`);
  }

  await new Promise((r) => setTimeout(r, 160));

  let blankLoc = page.locator(blankTargetSel).first();
  let blankN = await blankLoc.count().catch(() => 0);

  if (blankN === 0 && blankTargetSel !== "body") {
    blankTargetSel = "body";
    blankLoc = page.locator(blankTargetSel).first();
    blankN = await blankLoc.count().catch(() => 0);
  }

  if (blankN === 0) {
    const err = "MILO manual parity: blank-click target not found (main/body missing)";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({ block_reason: "blank_click_target_no_match" }),
      }),
    );
    throw new Error(err);
  }

  try {
    await blankLoc.click({
      position: { x: blankClickX, y: blankClickY },
      timeout: 12_000,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: `MILO manual parity: blank click failed: ${m}`,
        attributes: baseBlocked({
          block_reason: `blank_click_error:${m}`,
          blank_click_target_resolved: blankTargetSel,
        }),
      }),
    );
    throw new Error(`MILO manual parity blank click failed: ${m}`);
  }

  await captureTimelineCheckpoint("post_blank_click");

  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }

  await captureTimelineCheckpoint("early_post_blank");

  const waitSubRaw =
    typeof config?.addByCodePhase2lMiloManualParityPostBlankWaitForTextSubstring ===
      "string"
      ? config.addByCodePhase2lMiloManualParityPostBlankWaitForTextSubstring.trim()
      : "";

  const waitMaxMs = Math.min(
    12_000,
    Math.max(
      0,
      Number(config?.addByCodePhase2lMiloManualParityPostBlankWaitForTextMs ?? 0) ||
        0,
    ),
  );

  let postBlankWaitReadonly = null;

  if (waitSubRaw !== "") {
    const pollMs = 250;
    const started = Date.now();
    let matched = false;

    while (Date.now() - started < waitMaxMs) {
      matched = await page.evaluate((needle) => {
        const t = document.body?.innerText || "";

        return t.toLowerCase().includes(String(needle).toLowerCase());
      }, waitSubRaw);

      if (matched) {
        break;
      }

      await new Promise((r) => setTimeout(r, pollMs));
    }

    const elapsed = Date.now() - started;
    const timedOut = !matched && elapsed >= waitMaxMs;

    postBlankWaitReadonly = {
      scan_read_only_no_clicks: true,
      wait_substring_length: waitSubRaw.length,
      max_wait_ms: waitMaxMs,
      poll_interval_ms: pollMs,
      elapsed_ms: elapsed,
      substring_observed_in_body_inner_text: matched,
      timed_out: timedOut,
      labeling:
        "read_only_body_text_substring_poll_after_blank_click_not_server_truth",
    };

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_post_blank_wait_for_text_readonly",
        message:
          "MILO manual parity: read-only post-blank wait-for-substring probe on document.body.innerText (no clicks)",
        attributes: postBlankWaitReadonly,
      }),
    );
  }

  await captureTimelineCheckpoint("late_post_wait");

  const blockedAfterSequence =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_sequence =
    blockedBeforeSequence != null && blockedAfterSequence != null
      ? blockedAfterSequence - blockedBeforeSequence
      : null;

  if (
    network_guard_delta_during_sequence != null &&
    network_guard_delta_during_sequence > 0
  ) {
    const err =
      "MILO manual parity: Layer 2 network guard abort count increased during click/type/blank/wait window";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: err,
        attributes: baseBlocked({
          block_reason: "positive_layer2_abort_delta_during_manual_parity",
          network_guard_blocked_before: blockedBeforeSequence,
          network_guard_blocked_after: blockedAfterSequence,
          network_guard_delta_during_sequence,
          blank_click_target_resolved: blankTargetSel,
        }),
      }),
    );
    throw new Error(err);
  }

  const patronSignals = await page.evaluate(() => {
    const raw = document.body?.innerText || "";
    const compact = raw.replace(/\s+/g, " ").trim();
    const head = compact.slice(0, 1200);

    return {
      patron_like_visible_heuristic: /\bpatron\b/i.test(compact),
      patron_or_anejo_visible_heuristic:
        /\bpatron\b/i.test(compact) && /\banejo\b/i.test(compact),
      body_inner_text_head_after_manual_parity: head,
    };
  });

  const immediatePre2uKeyboardParityEvidence = await page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const productLikePattern =
      /(patron|anejo|tequila|item|product|2458|750ml|sku|code)\b/i;
    const samples = [];

    for (const rawLine of (document.body?.innerText || "").split("\n")) {
      const line = rawLine.replace(/\s+/g, " ").trim();

      if (!line) continue;
      if (!productLikePattern.test(line)) continue;
      samples.push(line.slice(0, 220));
      if (samples.length >= 8) break;
    }

    const selectorChecks = [
      "table tbody tr",
      "ul li",
      ".row",
      ".item",
      ".product",
      ".cart-item",
      ".line-item",
      ".search-result",
    ].map((selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const visible = nodes.filter((n) => {
        if (!(n instanceof HTMLElement)) return false;
        const rect = n.getBoundingClientRect();
        const style = window.getComputedStyle(n);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      }).length;

      return { selector, total_count: nodes.length, visible_count: visible };
    });

    return {
      patron_visible: /\bpatron\b/i.test(text),
      patron_anejo_visible: /\bpatron\b/i.test(text) && /\banejo\b/i.test(text),
      product_like_text_visible: productLikePattern.test(text),
      product_like_text_samples: samples,
      selector_visibility_checks: selectorChecks,
      possible_materialized_item_heuristic:
        productLikePattern.test(text) &&
        selectorChecks.some((s) => s.visible_count > 0),
    };
  });

  const expandedPre2uReadonlySurfaceCoverage = await (async () => {
    const frameTextSamples = [];
    const frameProbeHits = [];
    const probeTerms = ["Patron", "Anejo", "2458", "375ml", "General Wine"];

    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      try {
        const payload = await fr.evaluate((terms) => {
          const bodyText = String(document.body?.innerText || "")
            .replace(/\s+/g, " ")
            .trim();
          const head = bodyText.slice(0, 500);
          const hits = terms
            .map((term) => ({
              term,
              observed: bodyText.toLowerCase().includes(String(term).toLowerCase()),
            }))
            .filter((x) => x.observed);

          return {
            url: String(window.location.href || ""),
            text_head: head,
            probe_hits: hits,
            body_text_length: bodyText.length,
          };
        }, probeTerms);

        frameTextSamples.push(payload);
        for (const hit of payload.probe_hits || []) {
          frameProbeHits.push({
            frame_url: payload.url || "",
            term: hit.term,
            observed: hit.observed === true,
          });
        }
      } catch {
        frameTextSamples.push({
          url: fr.url(),
          unreadable_or_cross_origin: true,
        });
      }
    }

    const domCoverage = await page.evaluate((terms) => {
      const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      };

      const shadowHosts = [];
      const stack = [document.documentElement];

      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) continue;
        const children = Array.from(cur.children || []);
        for (const c of children) {
          stack.push(c);
          if (c.shadowRoot) shadowHosts.push(c);
        }
      }

      const shadowRootSummaries = shadowHosts.slice(0, 40).map((host) => {
        const txt = normalize(host.shadowRoot?.textContent || "");
        const hostTag = String(host.tagName || "").toLowerCase();
        const hostId = host.id || null;
        const hostClass = normalize(host.className || "").slice(0, 120) || null;
        return {
          host_tag: hostTag,
          host_id: hostId,
          host_class_sample: hostClass,
          text_head: txt.slice(0, 240),
          text_length: txt.length,
          term_hits: terms
            .map((term) => ({
              term,
              observed: txt.toLowerCase().includes(String(term).toLowerCase()),
            }))
            .filter((x) => x.observed),
        };
      });

      const offMainSelectors = [
        "aside",
        "section",
        "[role='region']",
        "[role='complementary']",
        ".modal",
        ".drawer",
        ".panel",
        ".sidebar",
      ];

      const offMainCoverage = offMainSelectors.map((selector) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        const visibleNodes = nodes.filter((n) => isVisible(n));
        const samples = visibleNodes.slice(0, 8).map((n) => {
          const txt = normalize(n.textContent || "");
          return {
            text_head: txt.slice(0, 220),
            text_length: txt.length,
          };
        });
        return {
          selector,
          total_count: nodes.length,
          visible_count: visibleNodes.length,
          visible_text_samples: samples,
        };
      });

      const virtualizedSelectors = [
        "[role='row']",
        "[role='grid']",
        "[role='gridcell']",
        "[role='listitem']",
        "[class*='virtual']",
        "[class*='grid']",
        "[class*='list']",
        "[class*='card']",
        "[class*='row']",
      ];

      const virtualizedCoverage = virtualizedSelectors.map((selector) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        const visibleNodes = nodes.filter((n) => isVisible(n));
        const samples = visibleNodes.slice(0, 10).map((n) => {
          const txt = normalize(n.textContent || "");
          return {
            tag: String(n.tagName || "").toLowerCase(),
            class_sample: normalize(n.className || "").slice(0, 120),
            text_head: txt.slice(0, 220),
            text_length: txt.length,
          };
        });
        return {
          selector,
          total_count: nodes.length,
          visible_count: visibleNodes.length,
          visible_samples: samples,
        };
      });

      const mainText = normalize(document.body?.innerText || "");
      const mainProbeHits = terms.map((term) => ({
        term,
        observed_in_main_body: mainText.toLowerCase().includes(String(term).toLowerCase()),
      }));

      const anyObserved =
        mainProbeHits.some((x) => x.observed_in_main_body) ||
        shadowRootSummaries.some((x) => (x.term_hits || []).length > 0) ||
        offMainCoverage.some((x) =>
          (x.visible_text_samples || []).some((s) =>
            terms.some((t) => s.text_head.toLowerCase().includes(String(t).toLowerCase())),
          ),
        ) ||
        virtualizedCoverage.some((x) =>
          (x.visible_samples || []).some((s) =>
            terms.some((t) => s.text_head.toLowerCase().includes(String(t).toLowerCase())),
          ),
        );

      return {
        probe_terms: terms,
        main_body_probe_hits: mainProbeHits,
        shadow_root_host_count: shadowHosts.length,
        shadow_root_summaries: shadowRootSummaries,
        off_main_container_coverage: offMainCoverage,
        virtualized_grid_card_list_coverage: virtualizedCoverage,
        any_probe_term_observed_across_surfaces: anyObserved,
      };
    }, probeTerms);

    return {
      scan_read_only_no_clicks: true,
      frame_count_total: page.frames().length,
      iframe_frame_text_samples: frameTextSamples,
      iframe_frame_probe_hits: frameProbeHits,
      ...domCoverage,
      labeling:
        "expanded_pre_2u_readonly_surface_scan_shadow_iframe_offmain_virtualized_not_server_truth",
    };
  })();

  const appProductByCodeRenderMountReadonly = await page.evaluate(() => {
    const probeTerms = ["Patron", "Anejo", "2458", "375ml", "General Wine"];
    const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };

    const mounts = Array.from(document.querySelectorAll("app-product-by-code"));
    const buildDomPath = (el) => {
      const segments = [];
      let cur = el;
      let depth = 0;
      while (cur && depth < 7 && cur !== document.body && cur.nodeType === 1) {
        const tag = String(cur.tagName || "").toLowerCase();
        const parent = cur.parentElement;
        const sibs = parent ? Array.from(parent.children).filter((n) => n.tagName === cur.tagName) : [];
        const idx = parent ? sibs.indexOf(cur) + 1 : 1;
        const cls = normalize(cur.className || "")
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .join(".");
        segments.unshift(`${tag}${cls ? `.${cls}` : ""}:nth-of-type(${Math.max(1, idx)})`);
        cur = parent;
        depth += 1;
      }
      return segments.join(" > ");
    };
    const mountSummaries = mounts.slice(0, 6).map((mount, mountIdx) => {
      const mountText = normalize(mount.textContent || "");
      const immediateChildren = Array.from(mount.children || []);
      const immediateChildSummaries = immediateChildren.slice(0, 16).map((child, idx) => {
        const txt = normalize(child.textContent || "");
        return {
          child_index: idx,
          tag: String(child.tagName || "").toLowerCase(),
          class_sample: normalize(child.className || "").slice(0, 120),
          visible: isVisible(child),
          text_head: txt.slice(0, 220),
          text_length: txt.length,
        };
      });

      const ngStarBlocks = Array.from(
        mount.querySelectorAll(
          "[class*='ng-star'], [id*='ng-star'], [class*='ng-tns'], [class*='ng-trigger'], [ng-reflect-ng-for-of], [ng-reflect-ng-if], [ng-reflect-name]",
        ),
      );

      const candidateSelectors = [
        "tr",
        "[role='row']",
        "li",
        "[role='listitem']",
        "[class*='item']",
        "[class*='row']",
        "[class*='card']",
        "[class*='product']",
        "[class*='result']",
      ];

      const candidateNodes = candidateSelectors.flatMap((selector) =>
        Array.from(mount.querySelectorAll(selector)),
      );

      const seen = new Set();
      const uniqueCandidates = candidateNodes.filter((n) => {
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      });

      const candidateNodeSummaries = uniqueCandidates.slice(0, 24).map((node) => {
        const txt = normalize(node.textContent || "");
        const parentText = normalize(node.parentElement?.textContent || "");
        const grandParentText = normalize(node.parentElement?.parentElement?.textContent || "");
        const parentTag = String(node.parentElement?.tagName || "").toLowerCase();
        const grandParentTag = String(node.parentElement?.parentElement?.tagName || "").toLowerCase();
        const parentClass = normalize(node.parentElement?.className || "").slice(0, 120);
        const grandParentClass = normalize(node.parentElement?.parentElement?.className || "").slice(0, 120);
        const siblingIndex =
          node.parentElement && node.parentElement.children
            ? Array.from(node.parentElement.children).indexOf(node)
            : -1;
        const children = Array.from(node.children || []);
        const childClusterSamples = children.slice(0, 8).map((c, childIdx) => {
          const cText = normalize(c.textContent || "");
          return {
            child_index: childIdx,
            tag: String(c.tagName || "").toLowerCase(),
            class_sample: normalize(c.className || "").slice(0, 120),
            text_head: cText.slice(0, 120),
            text_length: cText.length,
          };
        });
        const textWindow = [parentText.slice(0, 200), txt.slice(0, 200), grandParentText.slice(0, 200)]
          .filter((x) => x && x.length > 0)
          .join(" | ");
        const normalizedFingerprint = txt
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .slice(0, 200);
        const outerHtmlFingerprint = normalize(node.outerHTML || "")
          .replace(/\s+/g, " ")
          .slice(0, 260);
        const localContextProbeHits = probeTerms
          .map((term) => ({
            term,
            observed: textWindow.toLowerCase().includes(term.toLowerCase()),
          }))
          .filter((x) => x.observed);
        const descendantPool = Array.from(node.querySelectorAll("*"));
        const descendantCandidates = descendantPool.filter((d) => {
          if (!(d instanceof HTMLElement)) return false;
          if (!isVisible(d)) return false;
          const t = normalize(d.textContent || "");
          if (t.length < 8) return false;
          const cls = normalize(d.className || "").toLowerCase();
          const tag = String(d.tagName || "").toLowerCase();
          // Down-rank/exclude obvious shell/chrome/layout wrappers.
          if (
            /wrapper|layout|container|toolbar|header|navbar|spacer|padding|margin|search-input-container|search-container/.test(
              cls,
            )
          ) {
            return false;
          }
          if (["main", "header", "nav", "section"].includes(tag) && t.length < 80) {
            return false;
          }
          return true;
        });
        const siblingFamilyScores = descendantCandidates.slice(0, 30).map((d) => {
          const p = d.parentElement;
          if (!p) return { repeated_sibling_family_size: 0, sibling_same_tag_visible_count: 0 };
          const siblings = Array.from(p.children).filter(
            (s) =>
              s instanceof HTMLElement &&
              String(s.tagName || "").toLowerCase() === String(d.tagName || "").toLowerCase() &&
              isVisible(s),
          );
          return {
            repeated_sibling_family_size: siblings.length,
            sibling_same_tag_visible_count: siblings.length,
          };
        });
        const descendantSnapshots = descendantCandidates.slice(0, 20).map((d, idx) => {
          const dt = normalize(d.textContent || "");
          const dp = normalize(d.parentElement?.textContent || "");
          const dg = normalize(d.parentElement?.parentElement?.textContent || "");
          const dWindow = [dp.slice(0, 120), dt.slice(0, 120), dg.slice(0, 120)]
            .filter(Boolean)
            .join(" | ");
          const dFingerprint = dt
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .slice(0, 180);
          const dHits = probeTerms
            .map((term) => ({
              term,
              observed: dWindow.toLowerCase().includes(term.toLowerCase()),
            }))
            .filter((x) => x.observed);
          const fam = siblingFamilyScores[idx] || {
            repeated_sibling_family_size: 0,
            sibling_same_tag_visible_count: 0,
          };
          return {
            tag: String(d.tagName || "").toLowerCase(),
            class_sample: normalize(d.className || "").slice(0, 120),
            text_head: dt.slice(0, 180),
            text_length: dt.length,
            descendant_text_fingerprint: dFingerprint,
            descendant_local_context_window: dWindow.slice(0, 320),
            descendant_probe_hits: dHits,
            repeated_sibling_family_size: fam.repeated_sibling_family_size,
          };
        });
        const descendantFamilyLooksLikeItems = descendantSnapshots.some(
          (d) =>
            d.repeated_sibling_family_size >= 2 &&
            d.text_length > 12 &&
            !/liquor code|quantity|add all to cart/i.test(d.text_head),
        );
        const descendantIdentityHits = descendantSnapshots
          .flatMap((d) => d.descendant_probe_hits || [])
          .reduce((acc, hit) => {
            if (!acc.some((x) => x.term === hit.term)) acc.push(hit);
            return acc;
          }, []);
        const looksLikeStaticScaffolding =
          txt.length < 16 ||
          /add all to cart|liquor code|quantity|choose license|account home/i.test(txt) ||
          /btn|header|toolbar|navbar|search-container/i.test(
            `${node.className || ""} ${node.parentElement?.className || ""}`,
          );
        const likelyRepeatedItemContainer =
          (children.length >= 2 && txt.length > 16 && !looksLikeStaticScaffolding) ||
          (node.getAttribute?.("role") === "row" && txt.length > 16);
        return {
          tag: String(node.tagName || "").toLowerCase(),
          class_sample: normalize(node.className || "").slice(0, 120),
          role: node.getAttribute?.("role") || null,
          visible: isVisible(node),
          text_head: txt.slice(0, 220),
          text_length: txt.length,
          normalized_text_fingerprint: normalizedFingerprint,
          local_text_window: textWindow.slice(0, 420),
          nearest_neighbor_context: {
            parent_text_head: parentText.slice(0, 220),
            grand_parent_text_head: grandParentText.slice(0, 220),
          },
          child_descendant_cluster: {
            child_count: children.length,
            child_samples: childClusterSamples,
          },
          local_context_probe_hits: localContextProbeHits,
          descendant_retargeting: {
            descendant_candidate_count: descendantCandidates.length,
            descendant_candidate_samples: descendantSnapshots,
            descendant_identity_hits: descendantIdentityHits,
            descendant_repeated_item_family_heuristic: descendantFamilyLooksLikeItems,
          },
          deterministic_dom_snapshot: {
            dom_path_compact: buildDomPath(node),
            sibling_index: siblingIndex,
            outer_html_fingerprint: outerHtmlFingerprint,
            parent_summary: {
              tag: parentTag || null,
              class_sample: parentClass || null,
            },
            grand_parent_summary: {
              tag: grandParentTag || null,
              class_sample: grandParentClass || null,
            },
            local_context_text: textWindow.slice(0, 420),
            static_scaffolding_likely: looksLikeStaticScaffolding,
            repeated_item_container_likely: likelyRepeatedItemContainer,
          },
        };
      });

      const termHits = probeTerms.map((term) => ({
        term,
        observed_in_mount_text: mountText.toLowerCase().includes(term.toLowerCase()),
      }));

      const mountAppearsPopulated =
        candidateNodeSummaries.some((c) => c.visible && c.text_length > 12) ||
        immediateChildSummaries.some((c) => c.visible && c.text_length > 12);

      const mountInternalIdentityHits = candidateNodeSummaries
        .flatMap((c) => c.local_context_probe_hits || [])
        .reduce((acc, hit) => {
          if (!acc.some((x) => x.term === hit.term)) acc.push(hit);
          return acc;
        }, []);

      const chromeClassLike = (s) =>
        /wrapper|layout|container|toolbar|header|navbar|spacer|padding|margin|search-input-container|search-container|form-group|border-bottom/i.test(
          String(s || ""),
        );
      const chromeTextLike = (s) =>
        /add all to cart|liquor code|quantity|choose license|account home|to add products by code/i.test(
          String(s || "").toLowerCase(),
        );

      const scaffoldingRootNodes = uniqueCandidates.filter((node) => {
        const txt = normalize(node.textContent || "");
        const cls = normalize(node.className || "");
        return txt.length < 16 || chromeTextLike(txt) || chromeClassLike(cls);
      });

      const anchorNodes = Array.from(
        mount.querySelectorAll(
          "[class*='ng-star'], [id*='ng-star'], [class*='ng-tns'], [class*='ng-trigger'], [ng-reflect-ng-for-of], [ng-reflect-ng-if], ng-template",
        ),
      );

      let commentAnchorCount = 0;
      try {
        const walker = document.createTreeWalker(mount, NodeFilter.SHOW_COMMENT);
        let c = walker.nextNode();
        while (c) {
          const msg = String(c.nodeValue || "").toLowerCase();
          if (/ngfor|ngif|template|container/.test(msg)) commentAnchorCount += 1;
          c = walker.nextNode();
        }
      } catch {
        commentAnchorCount = 0;
      }

      const visibleDescendants = Array.from(mount.querySelectorAll("*"))
        .filter((n) => n instanceof HTMLElement && isVisible(n))
        .slice(0, 500);

      const altFamilyMap = new Map();
      const addFamilyCandidate = (seedNode, seedSource) => {
        if (!(seedNode instanceof HTMLElement)) return;
        const p = seedNode.parentElement;
        if (!p) return;
        const sibs = Array.from(p.children).filter(
          (x) =>
            x instanceof HTMLElement &&
            isVisible(x) &&
            String(x.tagName || "").toLowerCase() === String(seedNode.tagName || "").toLowerCase(),
        );
        if (sibs.length < 2) return;

        const seedClass = normalize(seedNode.className || "").split(" ").slice(0, 2).join(" ");
        const key = `${buildDomPath(p)}|${String(seedNode.tagName || "").toLowerCase()}|${seedClass}`;
        if (altFamilyMap.has(key)) return;

        const sibSnapshots = sibs.slice(0, 6).map((s) => {
          const st = normalize(s.textContent || "");
          return {
            tag: String(s.tagName || "").toLowerCase(),
            class_sample: normalize(s.className || "").slice(0, 120),
            text_head: st.slice(0, 140),
            text_length: st.length,
            dom_path_compact: buildDomPath(s),
          };
        });
        const textFingerprint = sibSnapshots
          .map((s) => s.text_head.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
          .join(" | ")
          .slice(0, 220);
        const rep = sibs[0];
        const repTxt = normalize(rep?.textContent || "");
        const repParentTxt = normalize(rep?.parentElement?.textContent || "");
        const repGrandTxt = normalize(rep?.parentElement?.parentElement?.textContent || "");
        const localContextWindow = [repParentTxt.slice(0, 120), repTxt.slice(0, 120), repGrandTxt.slice(0, 120)]
          .filter(Boolean)
          .join(" | ");
        const termHits = probeTerms
          .map((term) => ({
            term,
            observed: localContextWindow.toLowerCase().includes(term.toLowerCase()),
          }))
          .filter((h) => h.observed);

        const relationToScaffoldingRoots = scaffoldingRootNodes.some((root) => root.contains(rep))
          ? "inside_scaffolding_root"
          : scaffoldingRootNodes.some(
                (root) =>
                  root.parentElement === rep?.parentElement ||
                  root.parentElement === rep ||
                  rep?.parentElement === root,
              )
            ? "adjacent_to_scaffolding_root"
            : "outside_scaffolding_root";

        const familyLooksShellChrome =
          chromeClassLike(seedNode.className || "") ||
          chromeTextLike(localContextWindow) ||
          sibSnapshots.every((s) => s.text_length < 20);

        const familyLooksLikeRealItemRows =
          sibs.length >= 2 &&
          !familyLooksShellChrome &&
          sibSnapshots.some((s) => s.text_length > 20);

        altFamilyMap.set(key, {
          seed_source: seedSource,
          family_size: sibs.length,
          family_container_dom_path: buildDomPath(p),
          representative_dom_path: buildDomPath(rep),
          representative_tag: String(rep?.tagName || "").toLowerCase(),
          representative_class_sample: normalize(rep?.className || "").slice(0, 120),
          text_fingerprint: textFingerprint,
          local_context_window: localContextWindow.slice(0, 320),
          probe_term_hits: termHits,
          relation_to_scaffolding_roots: relationToScaffoldingRoots,
          family_looks_shell_or_chrome: familyLooksShellChrome,
          family_looks_like_real_item_rows: familyLooksLikeRealItemRows,
          sibling_samples: sibSnapshots,
        });
      };

      for (const a of anchorNodes.slice(0, 80)) {
        addFamilyCandidate(a, "angular_anchor");
        const parent = a.parentElement;
        if (parent) addFamilyCandidate(parent, "angular_anchor_parent");
      }
      for (const d of visibleDescendants.slice(0, 240)) {
        addFamilyCandidate(d, "visible_descendant_repetition_scan");
      }

      const alternativeRootFamilies = Array.from(altFamilyMap.values()).slice(0, 30);
      const anyAlternativeRootFamilyLooksLikeRealItems = alternativeRootFamilies.some(
        (f) => f.family_looks_like_real_item_rows === true,
      );
      const alternativeRootIdentityHits = alternativeRootFamilies
        .flatMap((f) => f.probe_term_hits || [])
        .reduce((acc, hit) => {
          if (!acc.some((x) => x.term === hit.term)) acc.push(hit);
          return acc;
        }, []);
      const alternativeRootDiscovery = {
        angular_anchor_count: anchorNodes.length,
        angular_comment_anchor_count: commentAnchorCount,
        alternative_root_family_count: alternativeRootFamilies.length,
        alternative_root_family_candidates: alternativeRootFamilies,
        any_alternative_root_family_looks_like_real_items:
          anyAlternativeRootFamilyLooksLikeRealItems,
        alternative_root_identity_hits: alternativeRootIdentityHits,
      };

      return {
        mount_index: mountIdx,
        tag: String(mount.tagName || "").toLowerCase(),
        visible: isVisible(mount),
        mount_text_head: mountText.slice(0, 320),
        mount_text_length: mountText.length,
        immediate_child_count: immediateChildren.length,
        immediate_child_summaries: immediateChildSummaries,
        angular_render_block_count: ngStarBlocks.length,
        angular_render_block_samples: ngStarBlocks.slice(0, 12).map((n) => ({
          tag: String(n.tagName || "").toLowerCase(),
          class_sample: normalize(n.className || "").slice(0, 120),
          id_sample: normalize(n.id || "").slice(0, 120) || null,
          visible: isVisible(n),
          text_head: normalize(n.textContent || "").slice(0, 160),
        })),
        candidate_item_card_row_count: uniqueCandidates.length,
        candidate_item_card_row_samples: candidateNodeSummaries,
        probe_term_hits: termHits,
        mount_internal_identity_hits: mountInternalIdentityHits,
        mount_internal_identity_detected_heuristic: mountInternalIdentityHits.length > 0,
        alternative_root_discovery: alternativeRootDiscovery,
        mount_appears_populated_heuristic: mountAppearsPopulated,
      };
    });

    const anyMountPopulated = mountSummaries.some(
      (m) =>
        m.mount_appears_populated_heuristic ||
        m.probe_term_hits.some((hit) => hit.observed_in_mount_text),
    );
    const anyMountInternalIdentityDetected = mountSummaries.some(
      (m) => m.mount_internal_identity_detected_heuristic === true,
    );
    const anyAlternativeRootFamilyLooksLikeRealItems = mountSummaries.some(
      (m) =>
        m.alternative_root_discovery?.any_alternative_root_family_looks_like_real_items ===
        true,
    );

    return {
      scan_read_only_no_clicks: true,
      render_mount_selector: "app-product-by-code",
      render_mount_count: mounts.length,
      render_mount_summaries: mountSummaries,
      any_render_mount_populated_heuristic: anyMountPopulated,
      any_mount_internal_identity_detected_heuristic: anyMountInternalIdentityDetected,
      any_alternative_root_family_looks_like_real_items:
        anyAlternativeRootFamilyLooksLikeRealItems,
      labeling:
        "app_product_by_code_render_mount_readonly_scan_not_server_truth",
    };
  });

  await captureTimelineCheckpoint("pre_2u_final_observation_point");

  const inPageNetFinalState = await page.evaluate(() => {
    const st = window.__lk_inpage_net_state || {};
    return {
      fetch_count_total: Number(st.fetch_count_total || 0),
      xhr_open_count_total: Number(st.xhr_open_count_total || 0),
      xhr_send_count_total: Number(st.xhr_send_count_total || 0),
      websocket_present: st.websocket_present === true,
      websocket_constructor_count_total: Number(st.websocket_constructor_count_total || 0),
      websocket_send_count_total: Number(st.websocket_send_count_total || 0),
      events: Array.isArray(st.events) ? st.events.slice(0, 240) : [],
    };
  });

  const appProductByCodeTimelineReadonly = (() => {
    const keySig = (f) => `${f?.representative_tag || ""}|${f?.representative_class_sample || ""}`;
    const byCheckpoint = timelineSnapshots.map((s) => ({
      checkpoint: s.checkpoint,
      mount_present: s.mount_present,
      family_count: Array.isArray(s.families) ? s.families.length : 0,
      any_family_looks_like_real_items: s.any_family_looks_like_real_items === true,
      families: Array.isArray(s.families) ? s.families : [],
      mount_dom_path: s.mount_dom_path || null,
      mount_tag_class_signature: s.mount_tag_class_signature || null,
      mount_child_count: s.mount_child_count ?? null,
      mount_direct_child_summary: Array.isArray(s.mount_direct_child_summary)
        ? s.mount_direct_child_summary
        : [],
      mount_outer_html_fingerprint: s.mount_outer_html_fingerprint || null,
      mount_inner_text_fingerprint: s.mount_inner_text_fingerprint || null,
      expanded_carriers: Array.isArray(s.expanded_carriers) ? s.expanded_carriers : [],
      target_shell_carrier_state_markers:
        s.target_shell_carrier_state_markers || {},
      mutation_state: s.mutation_state || null,
    }));
    const allFamilies = new Map();
    for (const snap of byCheckpoint) {
      for (const f of snap.families) {
        const k = keySig(f);
        if (!allFamilies.has(k)) allFamilies.set(k, []);
        allFamilies.get(k).push({
          checkpoint: snap.checkpoint,
          family_size: f.family_size,
          text_fingerprint: f.text_fingerprint,
          local_context_window: f.local_context_window,
          probe_term_hits: f.probe_term_hits || [],
          family_looks_like_real_item_rows: f.family_looks_like_real_item_rows === true,
        });
      }
    }
    const familyDeltas = Array.from(allFamilies.entries())
      .slice(0, 20)
      .map(([family_key, events]) => {
        const presentAt = events.map((e) => e.checkpoint);
        const sizes = events.map((e) => e.family_size);
        const looksRealAt = events.filter((e) => e.family_looks_like_real_item_rows).map((e) => e.checkpoint);
        return {
          family_key,
          present_at_checkpoints: presentAt,
          transient_presence: presentAt.length > 0 && presentAt.length < byCheckpoint.length,
          sibling_family_size_min: Math.min(...sizes),
          sibling_family_size_max: Math.max(...sizes),
          sibling_family_size_changed: new Set(sizes).size > 1,
          ever_looked_like_real_item_rows: looksRealAt.length > 0,
          looked_like_real_item_rows_at_checkpoints: looksRealAt,
          probe_term_hits_union: events
            .flatMap((e) => e.probe_term_hits || [])
            .reduce((acc, hit) => {
              if (!acc.some((x) => x.term === hit.term)) acc.push(hit);
              return acc;
            }, []),
        };
      });
    const everReal = familyDeltas.some((f) => f.ever_looked_like_real_item_rows === true);
    const timelineMutationSignals = (() => {
      const latest = byCheckpoint[byCheckpoint.length - 1]?.mutation_state || null;
      return latest
        ? {
            child_list_change_count: latest.child_list_change_count ?? 0,
            subtree_change_count: latest.subtree_change_count ?? 0,
            character_data_change_count: latest.character_data_change_count ?? 0,
            added_node_count: latest.added_node_count ?? 0,
            removed_node_count: latest.removed_node_count ?? 0,
          }
        : null;
    })();
    const structuralContainersByCheckpoint = byCheckpoint.map((s) => {
      const topFamilies = (s.families || []).slice(0, 3).map((f) => ({
        id: `family:${f.family_key}`,
        dom_path: f.container_dom_path || f.representative_dom_path || null,
        tag_class_signature: `${f.representative_tag || ""}|${f.representative_class_sample || ""}`,
        child_count: f.family_size ?? null,
        direct_child_summary: (f.sibling_samples || []).slice(0, 3).map((x) => ({
          tag: x.tag,
          class_sample: x.class_sample,
        })),
        outer_html_fingerprint: f.outer_html_fingerprint || null,
        inner_text_fingerprint: f.text_fingerprint || null,
        shell_like: f.family_looks_shell_or_chrome === true,
        closer_to_item_carrier: f.family_looks_like_real_item_rows === true,
      }));
      return {
        checkpoint: s.checkpoint,
        containers: [
          {
            id: "mount:app-product-by-code",
            dom_path: s.mount_dom_path,
            tag_class_signature: s.mount_tag_class_signature,
            child_count: s.mount_child_count,
            direct_child_summary: s.mount_direct_child_summary,
            outer_html_fingerprint: s.mount_outer_html_fingerprint,
            inner_text_fingerprint: s.mount_inner_text_fingerprint,
            shell_like: true,
            closer_to_item_carrier: false,
          },
          ...topFamilies,
        ],
      };
    });
    const allContainerIds = [
      ...new Set(
        structuralContainersByCheckpoint.flatMap((c) =>
          c.containers.map((x) => x.id),
        ),
      ),
    ];
    const changedContainers = [];
    for (const cid of allContainerIds) {
      const seq = structuralContainersByCheckpoint
        .map((c) => ({
          checkpoint: c.checkpoint,
          container: c.containers.find((x) => x.id === cid) || null,
        }))
        .filter((x) => x.container);
      if (seq.length < 2) continue;
      const changePoints = [];
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1].container;
        const cur = seq[i].container;
        const childCountDelta =
          (cur.child_count ?? 0) - (prev.child_count ?? 0);
        const tagClassCompositionDelta =
          JSON.stringify(cur.direct_child_summary || []) !==
          JSON.stringify(prev.direct_child_summary || []);
        const textFingerprintDelta =
          String(cur.inner_text_fingerprint || "") !==
          String(prev.inner_text_fingerprint || "");
        const outerHtmlFingerprintDelta =
          String(cur.outer_html_fingerprint || "") !==
          String(prev.outer_html_fingerprint || "");
        if (
          childCountDelta !== 0 ||
          tagClassCompositionDelta ||
          textFingerprintDelta ||
          outerHtmlFingerprintDelta
        ) {
          changePoints.push({
            checkpoint: seq[i].checkpoint,
            child_count_delta: childCountDelta,
            tag_class_composition_delta: tagClassCompositionDelta,
            text_fingerprint_delta: textFingerprintDelta,
            outer_html_fingerprint_delta: outerHtmlFingerprintDelta,
          });
        }
      }
      if (changePoints.length > 0) {
        changedContainers.push({
          container_id: cid,
          dom_path: seq[seq.length - 1].container.dom_path,
          changed_at_checkpoints: changePoints,
          shell_like: seq[seq.length - 1].container.shell_like === true,
          looks_closer_to_item_carrier:
            seq.some((x) => x.container.closer_to_item_carrier === true) || false,
        });
      }
    }
    const structuralDiffSummary = {
      changed_container_count: changedContainers.length,
      changed_containers: changedContainers,
      all_changed_containers_shell_like:
        changedContainers.length > 0 &&
        changedContainers.every((c) => c.shell_like === true),
      any_changed_container_looks_closer_to_item_carrier: changedContainers.some(
        (c) => c.looks_closer_to_item_carrier === true,
      ),
    };
    const expandedCarrierByCheckpoint = byCheckpoint.map((s) => ({
      checkpoint: s.checkpoint,
      carriers: s.expanded_carriers,
    }));
    const expandedCarrierIds = [
      ...new Set(
        expandedCarrierByCheckpoint.flatMap((c) =>
          (c.carriers || []).map((x) => x.carrier_id),
        ),
      ),
    ];
    const changedExpandedCarriers = [];
    for (const cid of expandedCarrierIds) {
      const seq = expandedCarrierByCheckpoint
        .map((c) => ({
          checkpoint: c.checkpoint,
          carrier: (c.carriers || []).find((x) => x.carrier_id === cid) || null,
        }))
        .filter((x) => x.carrier);
      if (seq.length < 2) continue;
      const changePoints = [];
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1].carrier;
        const cur = seq[i].carrier;
        const childCountDelta = (cur.child_count ?? 0) - (prev.child_count ?? 0);
        const childCompositionDelta =
          JSON.stringify(cur.direct_child_summary || []) !==
          JSON.stringify(prev.direct_child_summary || []);
        const textFingerprintDelta =
          String(cur.inner_text_fingerprint || "") !==
          String(prev.inner_text_fingerprint || "");
        const outerHtmlFingerprintDelta =
          String(cur.outer_html_fingerprint || "") !==
          String(prev.outer_html_fingerprint || "");
        if (
          childCountDelta !== 0 ||
          childCompositionDelta ||
          textFingerprintDelta ||
          outerHtmlFingerprintDelta
        ) {
          changePoints.push({
            checkpoint: seq[i].checkpoint,
            child_count_delta: childCountDelta,
            child_composition_delta: childCompositionDelta,
            text_fingerprint_delta: textFingerprintDelta,
            outer_html_fingerprint_delta: outerHtmlFingerprintDelta,
          });
        }
      }
      if (changePoints.length > 0) {
        changedExpandedCarriers.push({
          carrier_id: cid,
          relation_to_tracked_set: seq[seq.length - 1].carrier.relation_to_tracked_set,
          shell_like: seq[seq.length - 1].carrier.shell_like === true,
          looks_closer_to_item_carrier:
            seq.some((x) => x.carrier.looks_closer_to_item_carrier === true) || false,
          changed_at_checkpoints: changePoints,
        });
      }
    }
    const expandedStructuralDiffSummary = {
      expanded_carrier_count: expandedCarrierIds.length,
      changed_expanded_carrier_count: changedExpandedCarriers.length,
      changed_expanded_carriers: changedExpandedCarriers,
      any_changed_expanded_carrier_looks_closer_to_item_carrier:
        changedExpandedCarriers.some(
          (c) => c.looks_closer_to_item_carrier === true,
        ),
    };
    const networkCorrelationSummary = (() => {
      const checkpoints = checkpointTimes.map((c) => ({
        checkpoint: c.checkpoint,
        t_ms: c.t_ms,
      }));
      const byCheckpoint = checkpoints.map((cp) => {
        const win = networkEventTimeline.filter(
          (e) => Math.abs((e.t_ms ?? 0) - cp.t_ms) <= 1500,
        );
        const bucketCounts = {};
        const statusCounts = {};
        for (const ev of win) {
          bucketCounts[ev.bucket] = (bucketCounts[ev.bucket] || 0) + 1;
          statusCounts[ev.status_bucket] = (statusCounts[ev.status_bucket] || 0) + 1;
        }
        return {
          checkpoint: cp.checkpoint,
          nearby_event_count: win.length,
          request_buckets: bucketCounts,
          status_buckets: statusCounts,
        };
      });
      const changedCarrierCheckpoints = [
        ...new Set(
          changedExpandedCarriers.flatMap((c) =>
            (c.changed_at_checkpoints || []).map((p) => p.checkpoint),
          ),
        ),
      ];
      const burstNearChangedCarrier = byCheckpoint.filter(
        (b) =>
          changedCarrierCheckpoints.includes(b.checkpoint) && b.nearby_event_count > 0,
      );
      const hasBackendishActivity = networkEventTimeline.some((e) =>
        ["graphql", "api", "xhr", "fetch"].includes(e.bucket),
      );
      const inPageEvents = Array.isArray(inPageNetFinalState.events)
        ? inPageNetFinalState.events
        : [];
      const inPageByCheckpoint = inPageCheckpointCounters.map((cp) => {
        const near = inPageEvents.filter(
          (e) => Math.abs((Number(e.t_ms) || 0) - (Number(cp.page_t_ms) || 0)) <= 1500,
        );
        const eventCounts = near.reduce((acc, ev) => {
          const k = String(ev.kind || "other");
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
        return {
          checkpoint: cp.checkpoint,
          nearby_event_count: near.length,
          event_counts: eventCounts,
          fetch_count_total: cp.fetch_count_total,
          xhr_open_count_total: cp.xhr_open_count_total,
          xhr_send_count_total: cp.xhr_send_count_total,
          websocket_present: cp.websocket_present === true,
          websocket_constructor_count_total: cp.websocket_constructor_count_total,
          websocket_send_count_total: cp.websocket_send_count_total,
        };
      });
      const hasOnlyShellChanges =
        changedExpandedCarriers.length > 0 &&
        changedExpandedCarriers.every((c) => c.shell_like === true);
      const classification = (() => {
        if (!hasBackendishActivity) return "likely_no_backend_activity";
        if (hasBackendishActivity && hasOnlyShellChanges)
          return "likely_backend_activity_with_only_shell_update";
        if (hasBackendishActivity && changedExpandedCarriers.length === 0)
          return "likely_backend_activity_without_dom_identity_render";
        return "inconclusive";
      })();
      return {
        event_count_total: networkEventTimeline.length,
        checkpoints,
        per_checkpoint_bursts: byCheckpoint,
        changed_carrier_checkpoints: changedCarrierCheckpoints,
        burst_near_changed_carriers: burstNearChangedCarrier,
        has_backendish_activity: hasBackendishActivity,
        in_page_safe_signal_summary: {
          fetch_count_total: inPageNetFinalState.fetch_count_total,
          xhr_open_count_total: inPageNetFinalState.xhr_open_count_total,
          xhr_send_count_total: inPageNetFinalState.xhr_send_count_total,
          websocket_present: inPageNetFinalState.websocket_present,
          websocket_constructor_count_total: inPageNetFinalState.websocket_constructor_count_total,
          websocket_send_count_total: inPageNetFinalState.websocket_send_count_total,
          in_page_event_count_total: inPageEvents.length,
          per_checkpoint_bursts: inPageByCheckpoint,
          any_in_page_activity_observed:
            (inPageNetFinalState.fetch_count_total || 0) +
              (inPageNetFinalState.xhr_send_count_total || 0) +
              (inPageNetFinalState.websocket_send_count_total || 0) +
              (inPageNetFinalState.websocket_constructor_count_total || 0) >
            0,
          independent_transport_primitive: "websocket",
          independent_transport_present: inPageNetFinalState.websocket_present,
          independent_transport_count_total:
            Number(inPageNetFinalState.websocket_constructor_count_total || 0) +
            Number(inPageNetFinalState.websocket_send_count_total || 0),
        },
        behavior_classification: classification,
      };
    })();
    const targetCarrierKeys = [
      "product_name_child",
      "adjacent_col_xl_3_family",
    ];
    const targetCarrierTransitions = targetCarrierKeys.map((key) => {
      const seq = byCheckpoint.map((s) => ({
        checkpoint: s.checkpoint,
        marker: s.target_shell_carrier_state_markers?.[key] || { present: false },
      }));
      const presentSeq = seq.map((x) => x.marker.present === true);
      const loadingSeq = seq.map((x) => x.marker.keyword_presence?.loading === true);
      const pleaseWaitSeq = seq.map(
        (x) => x.marker.keyword_presence?.["please wait"] === true,
      );
      const searchingSeq = seq.map((x) => x.marker.keyword_presence?.searching === true);
      const noResultsSeq = seq.map((x) => x.marker.keyword_presence?.["no results"] === true);
      const emptySeq = seq.map((x) => x.marker.keyword_presence?.empty === true);
      const classSigSeq = seq.map((x) =>
        Array.isArray(x.marker.class_list_full) ? x.marker.class_list_full.join(" ") : "",
      );
      const classChangedAt = [];
      const textChangedAt = [];
      const visibilityChangedAt = [];
      const attrChangedAt = [];
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1].marker;
        const cur = seq[i].marker;
        if ((classSigSeq[i] || "") !== (classSigSeq[i - 1] || "")) {
          classChangedAt.push(seq[i].checkpoint);
        }
        if ((cur.local_text_short || "") !== (prev.local_text_short || "")) {
          textChangedAt.push(seq[i].checkpoint);
        }
        if ((cur.visible_flag || false) !== (prev.visible_flag || false)) {
          visibilityChangedAt.push(seq[i].checkpoint);
        }
        const prevAttr = JSON.stringify({
          aria: prev.aria_attrs || {},
          data: prev.data_attrs || {},
          role: prev.role_attr || null,
          disabled: prev.disabled_flag || false,
          hidden: prev.hidden_flag || false,
        });
        const curAttr = JSON.stringify({
          aria: cur.aria_attrs || {},
          data: cur.data_attrs || {},
          role: cur.role_attr || null,
          disabled: cur.disabled_flag || false,
          hidden: cur.hidden_flag || false,
        });
        if (prevAttr !== curAttr) attrChangedAt.push(seq[i].checkpoint);
      }
      return {
        carrier_label: key,
        per_checkpoint: seq.map((x) => ({
          checkpoint: x.checkpoint,
          present: x.marker.present === true,
          visible: x.marker.visible_flag === true,
          hidden: x.marker.hidden_flag === true,
          class_list_full: x.marker.class_list_full || [],
          role_attr: x.marker.role_attr || null,
          aria_attrs: x.marker.aria_attrs || {},
          data_attrs: x.marker.data_attrs || {},
          local_text_short: x.marker.local_text_short || "",
          keyword_presence: x.marker.keyword_presence || {},
        })),
        appears_disappears: presentSeq.includes(true) && presentSeq.includes(false),
        loading_seen: loadingSeq.some(Boolean) || pleaseWaitSeq.some(Boolean),
        searching_seen: searchingSeq.some(Boolean),
        no_results_seen: noResultsSeq.some(Boolean),
        empty_seen: emptySeq.some(Boolean),
        class_changed_at_checkpoints: classChangedAt,
        text_changed_at_checkpoints: textChangedAt,
        visibility_changed_at_checkpoints: visibilityChangedAt,
        attrs_changed_at_checkpoints: attrChangedAt,
      };
    });
    const loadingSeen = targetCarrierTransitions.some((c) => c.loading_seen);
    const emptySeen = targetCarrierTransitions.some(
      (c) => c.empty_seen || c.no_results_seen,
    );
    const appearsDisappears = targetCarrierTransitions.some((c) => c.appears_disappears);
    const anyAttrClassTextChanges = targetCarrierTransitions.some(
      (c) =>
        c.class_changed_at_checkpoints.length > 0 ||
        c.text_changed_at_checkpoints.length > 0 ||
        c.attrs_changed_at_checkpoints.length > 0,
    );
    const stateBehaviorClassification = (() => {
      if (loadingSeen && emptySeen) return "likely_empty_result_state";
      if (loadingSeen && !emptySeen) return "likely_loading_placeholder";
      if (!loadingSeen && anyAttrClassTextChanges && !emptySeen)
        return "likely_hidden_data_binding";
      if (appearsDisappears) return "likely_loading_placeholder";
      return "inconclusive";
    })();
    const stateTransitionSummary = {
      target_carriers: targetCarrierTransitions,
      marker_changes_observed: targetCarrierTransitions.map((c) => ({
        carrier_label: c.carrier_label,
        class_changed_at_checkpoints: c.class_changed_at_checkpoints,
        text_changed_at_checkpoints: c.text_changed_at_checkpoints,
        visibility_changed_at_checkpoints: c.visibility_changed_at_checkpoints,
        attrs_changed_at_checkpoints: c.attrs_changed_at_checkpoints,
      })),
      pattern_flags: {
        loading_to_resolved:
          loadingSeen &&
          targetCarrierTransitions.some(
            (c) =>
              c.loading_seen &&
              c.text_changed_at_checkpoints.length > 0 &&
              !c.empty_seen &&
              !c.no_results_seen,
          ),
        loading_to_empty: loadingSeen && emptySeen,
        idle_loading_idle:
          loadingSeen &&
          targetCarrierTransitions.some(
            (c) =>
              c.loading_seen &&
              c.visibility_changed_at_checkpoints.length > 0 &&
              c.class_changed_at_checkpoints.length > 0,
          ),
      },
      async_fetch_completed_suggested:
        loadingSeen &&
        targetCarrierTransitions.some((c) => c.text_changed_at_checkpoints.length > 0),
      data_received_but_not_rendered_suspected:
        !emptySeen && anyAttrClassTextChanges && !loadingSeen,
      ui_remained_empty_or_no_result_state: emptySeen,
      state_behavior_classification: stateBehaviorClassification,
    };
    return {
      scan_read_only_no_clicks: true,
      checkpoints: byCheckpoint.map((s) => ({
        checkpoint: s.checkpoint,
        mount_present: s.mount_present,
        family_count: s.family_count,
        any_family_looks_like_real_items: s.any_family_looks_like_real_items,
      })),
      family_deltas_over_time: familyDeltas,
      ever_transient_family_presence_detected: familyDeltas.some((f) => f.transient_presence),
      ever_family_looked_like_real_item_rows: everReal,
      timeline_mutation_signals: timelineMutationSignals,
      structural_container_fingerprints_by_checkpoint:
        structuralContainersByCheckpoint,
      structural_diff_summary: structuralDiffSummary,
      expanded_structural_fingerprints_by_checkpoint: expandedCarrierByCheckpoint,
      expanded_structural_diff_summary: expandedStructuralDiffSummary,
      state_transition_summary: stateTransitionSummary,
      network_event_correlation_summary: networkCorrelationSummary,
      labeling:
        "app_product_by_code_timeline_readonly_mutation_and_family_delta_scan_not_server_truth",
    };
  })();

  await page.evaluate(() => {
    try {
      window.__lk_app_product_by_code_timeline_observer?.disconnect?.();
    } catch {}
    const st = window.__lk_app_product_by_code_timeline_state;
    if (st && typeof st === "object") st.observer_active = false;
  });
  page.off("request", onRequest);
  page.off("response", onResponse);
  page.off("requestfailed", onRequestFailed);

  let pre2uListPack;

  try {
    pre2uListPack = await collectMiloPreCartBycodeListSurfaceReadonly(page, config);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_manual_parity_blocked",
        message: `MILO manual parity: pre-2U list snapshot failed: ${m}`,
        attributes: baseBlocked({ block_reason: `pre_2u_snapshot_error:${m}` }),
      }),
    );
    throw new Error(`MILO manual parity pre-2U snapshot failed: ${m}`);
  }

  const boundaryConclusionArtifact = (() => {
    const timeline = appProductByCodeTimelineReadonly || {};
    const stateSummary = timeline.state_transition_summary || {};
    const netSummary = timeline.network_event_correlation_summary || {};
    const inPageSummary = netSummary.in_page_safe_signal_summary || {};
    const noVisiblePre2uItemRow = pre2uListPack?.real_pre_cart_line_observed_heuristic !== true;
    const noFamilyIdentity =
      timeline.ever_family_looked_like_real_item_rows !== true &&
      timeline.ever_transient_family_presence_detected !== true;
    const noMeaningfulShellStateIdentity =
      stateSummary?.state_behavior_classification === "inconclusive" &&
      (stateSummary?.marker_changes_observed?.class_changes_total || 0) === 0 &&
      (stateSummary?.marker_changes_observed?.text_changes_total || 0) === 0 &&
      (stateSummary?.marker_changes_observed?.visibility_changes_total || 0) === 0 &&
      (stateSummary?.marker_changes_observed?.attribute_changes_total || 0) === 0;
    const noPlaywrightEvents = Number(netSummary?.event_count_total || 0) === 0;
    const noFetchXhrActivity =
      Number(inPageSummary?.fetch_count_total || 0) === 0 &&
      Number(inPageSummary?.xhr_send_count_total || 0) === 0;
    const noWebsocketActivity = Number(inPageSummary?.independent_transport_count_total || 0) === 0;
    const boundedNoEvidenceReached =
      noVisiblePre2uItemRow &&
      noFamilyIdentity &&
      noMeaningfulShellStateIdentity &&
      noPlaywrightEvents &&
      noFetchXhrActivity &&
      noWebsocketActivity;
    return {
      classification: boundedNoEvidenceReached
        ? "bounded_pre_2u_no_evidence_boundary_reached"
        : "inconclusive",
      proven_in_this_bounded_lane: [
        "no_automation_visible_pre_2u_item_row_or_card_family_observed",
        "no_stable_or_transient_pre_2u_identity_render_observed",
        "no_meaningful_shell_or_state_transition_exposing_identity",
        "no_observable_playwright_fetch_xhr_websocket_activity_in_bounded_windows",
      ],
      not_proven: [
        "not_proven_overall_application_never_uses_backend_or_network_activity",
        "not_proven_identity_never_exists_after_2u_or_cart_stage",
        "not_proven_broader_instrumentation_outside_this_lane_would_also_be_zero",
      ],
      approved_next_decision_options: [
        "conclude_pre_2u_probe_lane_and_stop",
        "redefine_evidence_threshold_for_validate_boundary_work",
        "shift_observation_boundary_to_post_2u_cart_stage_while_remaining_non_validate",
      ],
      compact_human_summary:
        boundedNoEvidenceReached
          ? "Bounded pre-2U lane reached a no-evidence boundary: no automation-visible identity render and no observable Playwright/fetch/XHR/WebSocket activity in monitored windows."
          : "Bounded pre-2U lane remains inconclusive and has not reached a deterministic no-evidence boundary.",
    };
  })();

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2l_milo_manual_parity_post_sequence_snapshot",
        message:
          "MILO manual parity: page checkpoint after click/type/blank before Phase 2u (read-only context)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2l_milo_manual_parity_findings",
      message:
        "MILO manual parity sequence complete; pre-2U read-only by-code list surface captured (DOM only)",
      attributes: {
        phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
        phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
        phase_2k_combined_gate_manifest: gateManifest,
        phase_2l_milo_manual_parity_policy_version:
          PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_POLICY_VERSION,
        field_order: fieldOrder,
        selector_code: codeSel,
        selector_qty: qtySel,
        test_code_length: String(testCode).length,
        test_quantity_length: String(testQuantity).length,
        test_code_redacted: "[length_only_not_value]",
        test_quantity_redacted: "[length_only_not_value]",
        interaction_model:
          fullKeyboardParityEnabled
            ? "click_code_press_sequentially_tab_press_sequentially_qty_tab_short_settle"
            : "click_field_press_sequentially_then_blank_corner_click_on_resolved_target",
        full_keyboard_parity_sequence_enabled: fullKeyboardParityEnabled,
        blank_click_target_resolved: blankTargetSel,
        blank_click_position: { x: blankClickX, y: blankClickY },
        settle_ms_after_blank_click: settleMs,
        post_blank_wait_for_text_readonly: postBlankWaitReadonly,
        network_guard_blocked_before_sequence: blockedBeforeSequence,
        network_guard_blocked_after_sequence: blockedAfterSequence,
        network_guard_delta_during_sequence,
        patron_like_visible_heuristic: patronSignals.patron_like_visible_heuristic,
        patron_or_anejo_visible_heuristic:
          patronSignals.patron_or_anejo_visible_heuristic,
        body_inner_text_head_after_manual_parity:
          patronSignals.body_inner_text_head_after_manual_parity,
        immediate_pre_2u_keyboard_parity_evidence:
          immediatePre2uKeyboardParityEvidence,
        expanded_pre_2u_readonly_surface_coverage:
          expandedPre2uReadonlySurfaceCoverage,
        app_product_by_code_render_mount_readonly:
          appProductByCodeRenderMountReadonly,
        app_product_by_code_timeline_readonly:
          appProductByCodeTimelineReadonly,
        pre_2u_probe_boundary_conclusion: boundaryConclusionArtifact,
        pre_2u_readonly_list_surface: {
          dom_summary: pre2uListPack.dom_summary,
          list_root_override_readonly: pre2uListPack.list_root_override_readonly,
          real_pre_cart_line_observed_heuristic:
            pre2uListPack.real_pre_cart_line_observed_heuristic,
          tenant_field_both_have_values_heuristic:
            pre2uListPack.tenant_field_both_have_values_heuristic,
        },
        mutation_risk_checks_used,
        labeling:
          "manual_parity_dom_observation_not_server_cart_or_inventory_truth",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2l_milo_manual_parity_complete",
    progressMessage:
      "MILO manual parity complete (replaces standard 2l fills for this run; pre-2U snapshot attached)",
  });

  const run_remained_fully_non_mutating =
    network_guard_delta_during_sequence === 0 ||
    network_guard_delta_during_sequence === null;

  return {
    phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
    phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
    combined_rehearsal_performed: true,
    fields_cleared_after: false,
    field_order: fieldOrder,
    run_remained_fully_non_mutating,
    network_guard_delta_during_fills: network_guard_delta_during_sequence,
    network_guard_delta_during_clear: null,
    mutation_risk_checks_used,
    mutation_risk_code_after_first_fill: null,
    mutation_risk_qty_after_first_fill: null,
    blur_used: false,
    milo_manual_parity_sequence_performed: true,
    phase_2l_milo_manual_parity_policy_version:
      PHASE_2L_MILO_MANUAL_PARITY_SEQUENCE_POLICY_VERSION,
    full_keyboard_parity_sequence_enabled: fullKeyboardParityEnabled,
    patron_like_visible_heuristic: patronSignals.patron_like_visible_heuristic,
    patron_or_anejo_visible_heuristic:
      patronSignals.patron_or_anejo_visible_heuristic,
    immediate_pre_2u_keyboard_parity_evidence:
      immediatePre2uKeyboardParityEvidence,
    expanded_pre_2u_readonly_surface_coverage:
      expandedPre2uReadonlySurfaceCoverage,
    app_product_by_code_render_mount_readonly:
      appProductByCodeRenderMountReadonly,
    app_product_by_code_timeline_readonly: appProductByCodeTimelineReadonly,
    pre_2u_probe_boundary_conclusion: boundaryConclusionArtifact,
    pre_2u_readonly_list_surface_pack: pre2uListPack,
    post_blank_wait_for_text_readonly: postBlankWaitReadonly,
  };
}

export const PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION = "lk-rpa-2l-milo-tab-1";

/**
 * Operator-gated MILO parity: focus tenant quantity field, send one Tab (MILO copy: tab from qty commits
 * line to product list). No validate, checkout, submit, or add-to-cart. Layer 2 delta must stay zero.
 */
export async function runPhase2lMiloPostFillTabFromQuantityParityStep({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  phase2lResult,
}) {
  if (config?.addByCodePhase2lMiloPostFillTabFromQuantity !== true) {
    return null;
  }

  await heartbeat({
    progressStage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_start",
    progressMessage:
      "Phase 2l MILO post-fill: operator-gated Tab from quantity (MILO on-page copy; no validate/cart)",
  });

  if (
    !phase2lResult ||
    phase2lResult.combined_rehearsal_performed !== true ||
    phase2lResult.run_remained_fully_non_mutating !== true
  ) {
    const err =
      "MILO Tab-from-quantity requires successful same-run Phase 2l with run_remained_fully_non_mutating=true";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_tab_from_qty_policy_version:
            PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
          performed: false,
          block_reason: "phase_2l_prerequisite_not_satisfied",
        },
      }),
    );
    throw new Error(err);
  }

  const qtySel =
    typeof config?.addByCodeQtyFieldSelector === "string"
      ? config.addByCodeQtyFieldSelector.trim()
      : "";

  if (!qtySel) {
    const err =
      "MILO Tab-from-quantity requires MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR (tenant quantity field)";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_tab_from_qty_policy_version:
            PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
          performed: false,
          block_reason: "missing_qty_field_selector",
        },
      }),
    );
    throw new Error(err);
  }

  const settleMs = Math.min(
    2000,
    Math.max(
      0,
      Number(config?.addByCodePhase2lMiloPostFillTabFromQuantitySettleMs ?? 500) ||
        0,
    ),
  );

  const qtyResolvedTab = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(
    page,
    qtySel,
    { mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null },
  );

  if (!qtyResolvedTab.ok) {
    const ambiguousQty =
      qtyResolvedTab.reason === "multiple_visible_quantity_controls_ambiguous" ||
      qtyResolvedTab.reason === "multiple_visible_quantity_spinbutton_ambiguous" ||
      qtyResolvedTab.reason === "multiple_visible_quantity_number_inputs_ambiguous";

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const err = ambiguousQty
      ? `MILO Tab-from-quantity: ambiguous quantity targets after fallback chain (${qtyResolvedTab.reason})`
      : `MILO Tab-from-quantity: quantity field could not be resolved (${qtyResolvedTab.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_tab_from_qty_policy_version:
            PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
          performed: false,
          selector_qty: qtySel,
          block_reason: ambiguousQty ? "quantity_ambiguous" : "quantity_resolution_failed",
          quantity_locator_resolution: qtyResolvedTab.reason,
          quantity_locator_strategy_trace: qtyResolvedTab.strategy_trace ?? null,
          quantity_locator_detail: qtyResolvedTab.detail ?? null,
          safe_mode_failure_forensics: safeModeFailureForensics,
        },
      }),
    );
    throw new Error(err);
  }

  const qtyLoc = qtyResolvedTab.loc;

  const qtyVis = await qtyLoc.isVisible().catch(() => false);

  if (!qtyVis) {
    const err = "MILO Tab-from-quantity: quantity field not visible";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_tab_from_qty_policy_version:
            PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
          performed: false,
          selector_qty: qtySel,
          quantity_locator_strategy: qtyResolvedTab.strategy ?? null,
          block_reason: "qty_not_visible",
        },
      }),
    );
    throw new Error(err);
  }

  const blockedBefore =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  try {
    await qtyLoc.focus({ timeout: 12_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_blocked",
        message: `MILO Tab-from-quantity: focus failed: ${m}`,
        attributes: {
          phase_2l_milo_post_fill_tab_from_qty_policy_version:
            PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
          performed: false,
          selector_qty: qtySel,
          block_reason: `focus_error:${m}`,
        },
      }),
    );
    throw new Error(`MILO Tab-from-quantity focus failed: ${m}`);
  }

  await new Promise((r) => setTimeout(r, 120));

  try {
    await page.keyboard.press("Tab");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_blocked",
        message: `MILO Tab-from-quantity: Tab key failed: ${m}`,
        attributes: {
          phase_2l_milo_post_fill_tab_from_qty_policy_version:
            PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
          performed: false,
          selector_qty: qtySel,
          block_reason: `tab_key_error:${m}`,
        },
      }),
    );
    throw new Error(`MILO Tab-from-quantity Tab failed: ${m}`);
  }

  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }

  const blockedAfter =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_step =
    blockedBefore != null && blockedAfter != null ? blockedAfter - blockedBefore : null;

  if (network_guard_delta_during_step != null && network_guard_delta_during_step > 0) {
    const err =
      "MILO Tab-from-quantity: Layer 2 network guard abort count increased during focus/Tab/settle window";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_tab_from_qty_policy_version:
            PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
          performed: true,
          selector_qty: qtySel,
          tab_press_count: 1,
          settle_ms_after_tab: settleMs,
          network_guard_blocked_before: blockedBefore,
          network_guard_blocked_after: blockedAfter,
          network_guard_delta_during_step,
          block_reason: "positive_layer2_abort_delta_during_tab_from_qty",
        },
      }),
    );
    throw new Error(err);
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_findings",
      message:
        "Phase 2l MILO post-fill: focus quantity + one Tab completed (MILO copy parity; not server list truth)",
      attributes: {
        phase_2l_milo_post_fill_tab_from_qty_policy_version:
          PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
        performed: true,
        selector_qty: qtySel,
        tab_press_count: 1,
        settle_ms_after_tab: settleMs,
        network_guard_blocked_before: blockedBefore,
        network_guard_blocked_after: blockedAfter,
        network_guard_delta_during_step,
        no_validate_no_checkout_no_submit: true,
        labeling:
          "dom_only_tab_commit_gesture_per_milo_instruction_not_inventory_proof",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2l_milo_post_fill_tab_from_qty_complete",
    progressMessage:
      "MILO Tab-from-quantity complete (one focus + one Tab; no validate/add-to-cart)",
  });

  return {
    phase_2l_milo_post_fill_tab_from_qty_policy_version:
      PHASE_2L_MILO_POST_FILL_TAB_FROM_QTY_POLICY_VERSION,
    performed: true,
    selector_qty: qtySel,
    tab_press_count: 1,
    settle_ms_after_tab: settleMs,
    network_guard_delta_during_step,
  };
}

export const PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION = "lk-rpa-2l-milo-commit-1";

/**
 * Operator-gated MILO manual-parity step after Phase 2l fills: blur active element, then one bounded
 * click on a non-field region (default `main` corner) to mimic "click empty whitespace". No validate,
 * checkout, submit, add-to-cart, or second field interaction. Hard-fails if Layer 2 abort count increases.
 */
export async function runPhase2lMiloPostFillClickAwayParityStep({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  phase2lResult,
}) {
  if (config?.addByCodePhase2lMiloPostFillClickAway !== true) {
    return null;
  }

  await heartbeat({
    progressStage: "mlcc_phase_2l_milo_post_fill_click_away_start",
    progressMessage:
      "Phase 2l MILO post-fill: operator-gated blur + safe click-away (manual parity; no validate/cart)",
  });

  if (
    !phase2lResult ||
    phase2lResult.combined_rehearsal_performed !== true ||
    phase2lResult.run_remained_fully_non_mutating !== true
  ) {
    const err =
      "MILO post-fill click-away requires successful same-run Phase 2l with run_remained_fully_non_mutating=true";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_click_away_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_click_away_policy_version:
            PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION,
          performed: false,
          block_reason: "phase_2l_prerequisite_not_satisfied",
        },
      }),
    );
    throw new Error(err);
  }

  const settleMs = Math.min(
    2000,
    Math.max(
      0,
      Number(config?.addByCodePhase2lMiloPostFillClickAwaySettleMs ?? 500) || 0,
    ),
  );

  let targetSel =
    typeof config?.addByCodePhase2lMiloPostFillClickAwayTargetSelector ===
      "string" && config.addByCodePhase2lMiloPostFillClickAwayTargetSelector.trim() !== ""
      ? config.addByCodePhase2lMiloPostFillClickAwayTargetSelector.trim()
      : "main";

  const blockedBefore =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  try {
    await page.evaluate(() => {
      const a = document.activeElement;
      if (a && typeof a.blur === "function") {
        a.blur();
      }
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_click_away_blocked",
        message: `MILO post-fill click-away: blur failed: ${m}`,
        attributes: {
          phase_2l_milo_post_fill_click_away_policy_version:
            PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION,
          performed: false,
          block_reason: `blur_eval_error:${m}`,
        },
      }),
    );
    throw new Error(`MILO post-fill click-away blur failed: ${m}`);
  }

  await new Promise((r) => setTimeout(r, 200));

  let loc = page.locator(targetSel).first();
  let n = await loc.count().catch(() => 0);

  if (n === 0 && targetSel !== "body") {
    targetSel = "body";
    loc = page.locator(targetSel).first();
    n = await loc.count().catch(() => 0);
  }

  if (n === 0) {
    const err = "MILO post-fill click-away: no element for click target (main/body missing)";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_click_away_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_click_away_policy_version:
            PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION,
          performed: false,
          block_reason: "click_target_no_match",
        },
      }),
    );
    throw new Error(err);
  }

  try {
    await loc.click({
      position: { x: 24, y: 24 },
      timeout: 12_000,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_click_away_blocked",
        message: `MILO post-fill click-away: click failed: ${m}`,
        attributes: {
          phase_2l_milo_post_fill_click_away_policy_version:
            PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION,
          performed: false,
          click_target_selector_resolved: targetSel,
          block_reason: `click_error:${m}`,
        },
      }),
    );
    throw new Error(`MILO post-fill click-away click failed: ${m}`);
  }

  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }

  const blockedAfter =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_step =
    blockedBefore != null && blockedAfter != null ? blockedAfter - blockedBefore : null;

  if (network_guard_delta_during_step != null && network_guard_delta_during_step > 0) {
    const err =
      "MILO post-fill click-away: Layer 2 network guard abort count increased during blur/click-away window";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_milo_post_fill_click_away_blocked",
        message: err,
        attributes: {
          phase_2l_milo_post_fill_click_away_policy_version:
            PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION,
          performed: true,
          blur_active_element: true,
          click_target_selector_resolved: targetSel,
          click_position: { x: 24, y: 24 },
          network_guard_blocked_before: blockedBefore,
          network_guard_blocked_after: blockedAfter,
          network_guard_delta_during_step,
          block_reason: "positive_layer2_abort_delta_during_click_away",
        },
      }),
    );
    throw new Error(err);
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2l_milo_post_fill_click_away_findings",
      message:
        "Phase 2l MILO post-fill: blur + one safe click-away completed (manual parity hypothesis; not server list truth)",
      attributes: {
        phase_2l_milo_post_fill_click_away_policy_version:
          PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION,
        performed: true,
        blur_active_element: true,
        click_target_selector_resolved: targetSel,
        click_position: { x: 24, y: 24 },
        settle_ms_after_click: settleMs,
        network_guard_blocked_before: blockedBefore,
        network_guard_blocked_after: blockedAfter,
        network_guard_delta_during_step,
        no_validate_no_checkout_no_submit: true,
        labeling:
          "dom_only_commit_gesture_may_help_materialize_pre_cart_row_not_inventory_proof",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2l_milo_post_fill_click_away_complete",
    progressMessage:
      "MILO post-fill click-away complete (one blur + one corner click; no validate/add-to-cart)",
  });

  return {
    phase_2l_milo_post_fill_click_away_policy_version:
      PHASE_2L_MILO_POST_FILL_CLICK_AWAY_POLICY_VERSION,
    performed: true,
    blur_active_element: true,
    click_target_selector_resolved: targetSel,
    click_position: { x: 24, y: 24 },
    settle_ms_after_click: settleMs,
    network_guard_delta_during_step,
  };
}

/**
 * Phase 2n: at most one bounded click on a tenant-listed add/apply-line candidate that passes Layer 2/3 and
 * Phase 2m-aligned eligibility. Requires a successful non-mutating Phase 2l result in the same run.
 * Does not validate, checkout, submit, or click any second control.
 */
export async function runAddByCodePhase2nAddApplyLineSingleClick({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  phase2lResult,
}) {
  const gateManifest = buildPhase2mAddApplyLineFutureGateManifest();

  await heartbeat({
    progressStage: "mlcc_phase_2n_add_apply_start",
    progressMessage:
      "Phase 2n: tightly gated single add/apply-line click (no validate/checkout/submit)",
  });

  const mutation_risk_checks_used = [
    `phase_2m_policy_version_${PHASE_2M_POLICY_VERSION}`,
    `phase_2n_policy_version_${PHASE_2N_ADD_APPLY_POLICY_VERSION}`,
    "phase_2m_add_apply_line_future_gate_manifest_echoed_in_evidence",
    "prerequisite_phase_2l_combined_rehearsal_succeeded_same_run",
    "prerequisite_phase_2l_run_remained_fully_non_mutating_layer2_delta_checks_on_2l",
    "tenant_selector_list_only_no_heuristic_guess_click_path",
    "layer_2_network_abort_counter_guardStats_blockedRequestCount_delta_zero_required_after_click",
    "layer_3_isProbeUiTextUnsafe_plus_evaluatePhase2nAddApplyCandidateEligibility",
    "at_most_one_playwright_click_in_this_phase",
    "no_validate_checkout_submit_or_second_apply_in_this_phase",
  ];

  if (
    !phase2lResult ||
    phase2lResult.combined_rehearsal_performed !== true ||
    phase2lResult.run_remained_fully_non_mutating !== true
  ) {
    const err =
      "Phase 2n requires a successful Phase 2l combined rehearsal in the same run with run_remained_fully_non_mutating=true (see Phase 2m prerequisites)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2n_add_apply_blocked",
        message: err,
        attributes: {
          phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
          phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
          phase_2m_add_apply_gate_manifest: gateManifest,
          add_apply_click_performed: false,
          block_reason: "phase_2l_prerequisite_not_satisfied",
          phase_2l_snapshot_for_gate: phase2lResult
            ? {
                combined_rehearsal_performed:
                  phase2lResult.combined_rehearsal_performed ?? null,
                run_remained_fully_non_mutating:
                  phase2lResult.run_remained_fully_non_mutating ?? null,
              }
            : null,
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        },
      }),
    );

    throw new Error(err);
  }

  const candidates = config.addByCodePhase2nAddApplyCandidateSelectors ?? [];
  const allowSubs = config.addByCodePhase2nTextAllowSubstrings ?? [];

  if (!Array.isArray(candidates) || candidates.length === 0) {
    const err =
      "Phase 2n requires MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS (non-empty tenant selector list)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2n_add_apply_blocked",
        message: err,
        attributes: {
          phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
          phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
          phase_2m_add_apply_gate_manifest: gateManifest,
          add_apply_click_performed: false,
          block_reason: "missing_or_empty_tenant_add_apply_selectors",
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        },
      }),
    );

    throw new Error(err);
  }

  const blocked_before_phase =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2n_pre_click_snapshot",
        message:
          "Phase 2n checkpoint before single add/apply-line click (policy + selector scan)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2n_pre_click_evidence",
      message:
        "Phase 2n pre-click: Phase 2m gate manifest; candidate evaluation only until one eligible control",
      attributes: {
        phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
        phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
        phase_2m_add_apply_gate_manifest: gateManifest,
        dry_run_safe_mode_expected: true,
        candidate_selectors_configured: candidates,
        text_allow_substrings_configured: allowSubs,
        network_guard_blocked_request_count_before:
          blocked_before_phase,
        mutation_risk_checks_used,
        mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        truthfulness_note:
          "this_phase_does_not_claim_server_cart_mutation_or_validate_readiness",
      },
    }),
  );

  const evaluations = [];

  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    const n = await loc.count().catch(() => 0);

    if (n === 0) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_selector_no_match",
      });
      continue;
    }

    const vis = await loc.isVisible().catch(() => false);

    if (!vis) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_not_visible",
      });
      continue;
    }

    const disabled = await loc.isDisabled().catch(() => false);

    if (disabled) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_disabled_control",
      });
      continue;
    }

    const row = await extractMutationBoundaryRowFromLocator(loc);
    const elig = evaluatePhase2nAddApplyCandidateEligibility(row, allowSubs);

    evaluations.push({
      selector: sel,
      visible: true,
      disabled: false,
      tag: row.tag,
      text_sample: (row.text ?? "").slice(0, 200),
      href_sample: String(row.href ?? "").slice(0, 200),
      ...elig,
    });
  }

  const firstEligible = evaluations.find((e) => e.eligible === true);

  if (!firstEligible) {
    const err =
      "Phase 2n: no eligible add/apply-line candidate (Layer 2/3 + mutation-boundary policy rejected all tenant selectors)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2n_add_apply_blocked",
        message: err,
        attributes: {
          phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
          phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
          phase_2m_add_apply_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          add_apply_click_performed: false,
          block_reason: "no_eligible_candidate",
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        },
      }),
    );

    throw new Error(err);
  }

  const blocked_immediately_before_click =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const clickLoc = page.locator(firstEligible.selector).first();

  try {
    await clickLoc.click({ timeout: 12_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2n_add_apply_blocked",
        message: `Phase 2n: click failed: ${m}`,
        attributes: {
          phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
          phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
          phase_2m_add_apply_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          selector_attempted: firstEligible.selector,
          add_apply_click_performed: false,
          block_reason: `click_error:${m}`,
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        },
      }),
    );

    throw new Error(`Phase 2n add/apply-line click failed: ${m}`);
  }

  await page
    .waitForLoadState("domcontentloaded", { timeout: 45_000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 600));

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2n_after_single_add_apply_click",
        message:
          "Phase 2n checkpoint after exactly one add/apply-line click (no further UI actions)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const blocked_after_click =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_click =
    blocked_immediately_before_click != null && blocked_after_click != null
      ? blocked_after_click - blocked_immediately_before_click
      : null;

  const no_new_blocked_downstream_requests =
    network_guard_delta_during_click === null ||
    network_guard_delta_during_click === 0;

  if (!no_new_blocked_downstream_requests) {
    const err = `Phase 2n: Layer 2 blocked request counter increased during click window (delta=${network_guard_delta_during_click}); hard-stop per Phase 2m`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2n_add_apply_blocked",
        message: err,
        attributes: {
          phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
          phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
          phase_2m_add_apply_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          selector_clicked: firstEligible.selector,
          add_apply_click_performed: true,
          network_guard_blocked_before_click: blocked_immediately_before_click,
          network_guard_blocked_after_click: blocked_after_click,
          network_guard_delta_during_click,
          block_reason: "positive_layer2_abort_delta_during_click",
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        },
      }),
    );

    throw new Error(err);
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2n_add_apply_findings",
      message:
        "Phase 2n: single add/apply-line click completed; no validate/checkout/submit in this phase",
      attributes: {
        phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
        phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
        phase_2m_add_apply_gate_manifest: gateManifest,
        candidate_evaluations: evaluations,
        add_apply_click_performed: true,
        click_count_this_phase: 1,
        selector_clicked: firstEligible.selector,
        network_guard_blocked_before_phase: blocked_before_phase,
        network_guard_blocked_immediately_before_click:
          blocked_immediately_before_click,
        network_guard_blocked_after_click: blocked_after_click,
        network_guard_delta_during_click,
        no_new_blocked_downstream_requests_observed:
          network_guard_delta_during_click === null
            ? null
            : network_guard_delta_during_click === 0,
        run_remained_within_safe_mode_no_validate_checkout_submit_phase:
          true,
        disclaimer_layer2_abort_observation:
          "zero_delta_on_client_blocked_request_counter_for_configured_patterns_does_not_prove_no_server_side_cart_or_line_change",
        disclaimer_browser_not_server_cart_truth:
          "browser_evidence_is_not_server_cart_truth",
        disclaimer_no_general_add_apply_safety_claim:
          "single_tenant_single_run_does_not_establish_general_add_apply_line_safety",
        disclaimer_no_validate_readiness:
          "this_phase_does_not_assess_readiness_for_validate_checkout_or_submit",
        typing_policy_phase_2n: "no_validate_no_checkout_no_submit_no_second_apply",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2n_add_apply_complete",
    progressMessage:
      "Phase 2n complete (one add/apply click only; downstream order steps out of scope)",
  });

  return {
    phase_2n_policy_version: PHASE_2N_ADD_APPLY_POLICY_VERSION,
    phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
    add_apply_click_performed: true,
    selector_clicked: firstEligible.selector,
    candidate_evaluations: evaluations,
    network_guard_delta_during_click,
    no_new_blocked_downstream_requests_observed:
      network_guard_delta_during_click === null
        ? null
        : network_guard_delta_during_click === 0,
    phase_2m_gate_manifest_version: gateManifest.version,
  };
}

/**
 * Phase 2u: MILO-specific guarded bulk-action click.
 * Exactly one click on an eligible tenant-listed bulk candidate, with Layer 2/3 guard checks.
 */
export async function runAddByCodePhase2uMiloBulkSkeleton({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  phase2lResult,
  prior2uDeterminismState = null,
  safeFlowShot = null,
}) {
  const gateManifest = buildPhase2uMiloBulkFutureGateManifest();
  const selectors = config.addByCodePhase2uMiloBulkCandidateSelectors ?? [];
  const allowSubs = config.addByCodePhase2uMiloBulkTextAllowSubstrings ?? [];

  const mutation_risk_checks_used = [
    `phase_2u_policy_version_${PHASE_2U_MILO_BULK_POLICY_VERSION}`,
    `phase_2u_exec_policy_version_${PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION}`,
    "phase_2u_gate_manifest_echoed_in_evidence",
    "prerequisite_phase_2l_success_same_run",
    "tenant_selector_list_only_no_heuristic_click_path",
    "layer_3_isProbeUiTextUnsafe_plus_evaluatePhase2uMiloBulkCandidateEligibility",
    "one_click_maximum_phase_2u",
    "layer_2_network_abort_counter_guardStats_blockedRequestCount_delta_zero_required_after_click",
    "no_validate_checkout_submit_finalize_in_phase_2u",
  ];

  await heartbeat({
    progressStage: "mlcc_phase_2u_milo_bulk_start",
    progressMessage:
      "Phase 2u: MILO guarded bulk-action click start (single click max; no validate/checkout/submit)",
  });

  if (
    !phase2lResult ||
    phase2lResult.combined_rehearsal_performed !== true ||
    phase2lResult.run_remained_fully_non_mutating !== true
  ) {
    const err =
      "Phase 2u requires successful same-run Phase 2l with run_remained_fully_non_mutating=true";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2u_milo_bulk_blocked",
        message: err,
        attributes: {
          phase_2u_exec_policy_version: PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION,
          phase_2u_policy_version: PHASE_2U_MILO_BULK_POLICY_VERSION,
          phase_2u_gate_manifest: gateManifest,
          click_performed: false,
          block_reason: "phase_2l_prerequisite_not_satisfied",
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  if (!Array.isArray(selectors) || selectors.length === 0) {
    const err =
      "Phase 2u requires MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS (non-empty tenant selector list)";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2u_milo_bulk_blocked",
        message: err,
        attributes: {
          phase_2u_exec_policy_version: PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION,
          phase_2u_policy_version: PHASE_2U_MILO_BULK_POLICY_VERSION,
          phase_2u_gate_manifest: gateManifest,
          click_performed: false,
          block_reason: "missing_or_empty_tenant_bulk_selectors",
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  const blocked_before_phase =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2u_milo_bulk_pre_click_snapshot",
        message:
          "Phase 2u pre-click checkpoint (MILO bulk-action candidate evaluation only)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const preClickObservation = await collectPhase2uReconciliationSnapshot(page);
  const preClickControlInventory = await collectMutationBoundaryControls(page, 60);
  const preClickControlsClassified = classifyBoundaryRows(preClickControlInventory, []);
  const preClickControlsSample = preClickControlsClassified.slice(0, 20);

  const evaluations = [];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const n = await loc.count().catch(() => 0);
    if (n === 0) {
      evaluations.push({ selector: sel, eligible: false, reason: "rejected_selector_no_match" });
      continue;
    }
    const vis = await loc.isVisible().catch(() => false);
    if (!vis) {
      evaluations.push({ selector: sel, eligible: false, reason: "rejected_not_visible" });
      continue;
    }
    const disabled = await loc.isDisabled().catch(() => false);
    if (disabled) {
      evaluations.push({ selector: sel, eligible: false, reason: "rejected_disabled_control" });
      continue;
    }
    const row = await extractMutationBoundaryRowFromLocator(loc);
    const elig = evaluatePhase2uMiloBulkCandidateEligibility(row, allowSubs);
    evaluations.push({
      selector: sel,
      visible: true,
      disabled: false,
      tag: row.tag,
      text_sample: (row.text ?? "").slice(0, 200),
      href_sample: String(row.href ?? "").slice(0, 200),
      ...elig,
    });
  }

  const firstEligible = evaluations.find((e) => e.eligible === true);
  if (!firstEligible) {
    const err = "Phase 2u: no eligible MILO bulk-action candidate";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2u_milo_bulk_blocked",
        message: err,
        attributes: {
          phase_2u_exec_policy_version: PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION,
          phase_2u_policy_version: PHASE_2U_MILO_BULK_POLICY_VERSION,
          phase_2u_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          click_performed: false,
          block_reason: "no_eligible_candidate",
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  const blocked_immediately_before_click =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const controlStartMs = Date.now();
  const controlEvents = [];
  const controlCheckpoints = [];
  const controlInPageCounters = [];
  const toBucket = (url, resourceType) => {
    const u = String(url || "").toLowerCase();
    const rt = String(resourceType || "").toLowerCase();
    if (u.includes("graphql")) return "graphql";
    if (u.includes("/api/") || u.includes("search") || u.includes("rest")) return "api";
    if (rt === "xhr") return "xhr";
    if (rt === "fetch") return "fetch";
    if (["script", "stylesheet", "image", "font", "media"].includes(rt)) return "asset";
    return "other";
  };
  const toStatusBucket = (status) => {
    const n = Number(status);
    if (!Number.isFinite(n) || n <= 0) return "unknown";
    if (n >= 200 && n < 300) return "2xx";
    if (n >= 300 && n < 400) return "3xx";
    if (n >= 400 && n < 500) return "4xx";
    if (n >= 500 && n < 600) return "5xx";
    return "unknown";
  };
  const readInPageCounter = async () =>
    page.evaluate(() => {
      const st = window.__lk_inpage_net_state || {};
      return {
        page_t_ms: Number.isFinite(Date.now() - Number(st.start_ms || Date.now()))
          ? Date.now() - Number(st.start_ms || Date.now())
          : 0,
        fetch_count_total: Number(st.fetch_count_total || 0),
        xhr_send_count_total: Number(st.xhr_send_count_total || 0),
        websocket_present: st.websocket_present === true,
        websocket_constructor_count_total: Number(st.websocket_constructor_count_total || 0),
        websocket_send_count_total: Number(st.websocket_send_count_total || 0),
      };
    });
  const pushControlCheckpoint = async (label) => {
    controlCheckpoints.push({ checkpoint: label, t_ms: Date.now() - controlStartMs });
    controlInPageCounters.push({
      checkpoint: label,
      ...(await readInPageCounter()),
    });
  };
  const onReq = (req) => {
    if (controlEvents.length >= 120) return;
    controlEvents.push({
      t_ms: Date.now() - controlStartMs,
      event: "request",
      bucket: toBucket(req.url(), req.resourceType?.()),
      method: String(req.method?.() || "").toUpperCase(),
      status_bucket: "unknown",
    });
  };
  const onRes = (res) => {
    if (controlEvents.length >= 120) return;
    const req = res.request?.();
    controlEvents.push({
      t_ms: Date.now() - controlStartMs,
      event: "response",
      bucket: toBucket(req?.url?.() || "", req?.resourceType?.()),
      method: String(req?.method?.() || "").toUpperCase(),
      status_bucket: toStatusBucket(res.status?.()),
    });
  };
  const onFail = (req) => {
    if (controlEvents.length >= 120) return;
    controlEvents.push({
      t_ms: Date.now() - controlStartMs,
      event: "request_failed",
      bucket: toBucket(req.url(), req.resourceType?.()),
      method: String(req.method?.() || "").toUpperCase(),
      status_bucket: "blocked",
    });
  };
  page.on("request", onReq);
  page.on("response", onRes);
  page.on("requestfailed", onFail);
  await pushControlCheckpoint("shortly_before_2u_click");

  const clickLoc = page.locator(firstEligible.selector).first();
  try {
    await pushControlCheckpoint("during_2u_click");
    await clickLoc.click({ timeout: 12_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2u_milo_bulk_blocked",
        message: `Phase 2u: click failed: ${m}`,
        attributes: {
          phase_2u_exec_policy_version: PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION,
          phase_2u_policy_version: PHASE_2U_MILO_BULK_POLICY_VERSION,
          phase_2u_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          selector_attempted: firstEligible.selector,
          click_performed: false,
          block_reason: `click_error:${m}`,
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(`Phase 2u MILO bulk click failed: ${m}`);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  await pushControlCheckpoint("shortly_after_2u_click");

  if (typeof safeFlowShot === "function") {
    await safeFlowShot("after_add_all_to_cart_click", "mlcc_after_add_to_cart.png");
  }

  page.off("request", onReq);
  page.off("response", onRes);
  page.off("requestfailed", onFail);

  const controlBurstByCheckpoint = controlCheckpoints.map((cp) => {
    const near = controlEvents.filter((e) => Math.abs((e.t_ms ?? 0) - cp.t_ms) <= 1200);
    const bucketCounts = {};
    const statusCounts = {};
    for (const ev of near) {
      bucketCounts[ev.bucket] = (bucketCounts[ev.bucket] || 0) + 1;
      statusCounts[ev.status_bucket] = (statusCounts[ev.status_bucket] || 0) + 1;
    }
    return {
      checkpoint: cp.checkpoint,
      nearby_event_count: near.length,
      request_buckets: bucketCounts,
      status_buckets: statusCounts,
    };
  });
  const pre2uEventCountFromTimeline =
    phase2lResult?.app_product_by_code_timeline_readonly?.network_event_correlation_summary
      ?.event_count_total ?? null;
  const pre2uInPageActivityCount =
    Number(
      phase2lResult?.app_product_by_code_timeline_readonly?.network_event_correlation_summary
        ?.in_page_safe_signal_summary?.fetch_count_total ?? 0,
    ) +
    Number(
      phase2lResult?.app_product_by_code_timeline_readonly?.network_event_correlation_summary
        ?.in_page_safe_signal_summary?.xhr_send_count_total ?? 0,
    );
  const pre2uInPageIndependentTransportCount = Number(
    phase2lResult?.app_product_by_code_timeline_readonly?.network_event_correlation_summary
      ?.in_page_safe_signal_summary?.independent_transport_count_total ?? 0,
  );
  const pre2uIndependentTransportPresent =
    phase2lResult?.app_product_by_code_timeline_readonly?.network_event_correlation_summary
      ?.in_page_safe_signal_summary?.independent_transport_present === true;
  const controlEventCount = controlEvents.length;
  const controlInPageFetchXhrCount = (() => {
    const first = controlInPageCounters[0] || {
      fetch_count_total: 0,
      xhr_send_count_total: 0,
    };
    const last = controlInPageCounters[controlInPageCounters.length - 1] || first;
    return Math.max(
      0,
      Number(last.fetch_count_total || 0) -
        Number(first.fetch_count_total || 0) +
        (Number(last.xhr_send_count_total || 0) -
          Number(first.xhr_send_count_total || 0)),
    );
  })();
  const controlInPageIndependentTransportCount = (() => {
    const first = controlInPageCounters[0] || {
      websocket_constructor_count_total: 0,
      websocket_send_count_total: 0,
    };
    const last = controlInPageCounters[controlInPageCounters.length - 1] || first;
    return Math.max(
      0,
      Number(last.websocket_constructor_count_total || 0) -
        Number(first.websocket_constructor_count_total || 0) +
        (Number(last.websocket_send_count_total || 0) -
          Number(first.websocket_send_count_total || 0)),
    );
  })();
  const controlIndependentTransportPresent = controlInPageCounters.some(
    (cp) => cp.websocket_present === true,
  );
  const hookSensitivityClassification =
    controlEventCount > 0 || controlInPageFetchXhrCount > 0
      ? "hooks_confirmed_working"
      : pre2uEventCountFromTimeline === 0
        ? "hooks_maybe_not_firing"
        : "inconclusive";
  const pageVsPlaywrightClassification =
    controlEventCount === 0 && controlInPageFetchXhrCount > 0
      ? "page_activity_confirmed_playwright_hooks_missed_it"
      : controlEventCount === 0 && controlInPageFetchXhrCount === 0
        ? "no_page_activity_observed_either"
        : "inconclusive";
  const independentTransportClassification =
    controlIndependentTransportPresent === false && pre2uIndependentTransportPresent === false
      ? "primitive_not_present"
      : controlInPageIndependentTransportCount > 0 || pre2uInPageIndependentTransportCount > 0
        ? "independent_transport_activity_confirmed"
        : controlIndependentTransportPresent === true || pre2uIndependentTransportPresent === true
          ? "no_independent_transport_activity_observed"
          : "inconclusive";
  const pre2uVsControlComparison =
    pre2uEventCountFromTimeline === 0 &&
    (controlEventCount > 0 || controlInPageFetchXhrCount > 0)
      ? "instrumentation-limited"
      : pre2uEventCountFromTimeline === 0 &&
          controlEventCount === 0 &&
          controlInPageFetchXhrCount === 0
        ? "still inconclusive"
        : "trustworthy";

  const postClickObservation = await collectPhase2uReconciliationSnapshot(page);
  const postClickControlInventory = await collectMutationBoundaryControls(page, 60);
  const postClickControlsClassified = classifyBoundaryRows(postClickControlInventory, []);
  const postClickControlsSample = postClickControlsClassified.slice(0, 20);
  const postClickReconciliationDiff = diffPhase2uReconciliationSnapshots(
    preClickObservation,
    postClickObservation,
  );

  const laneInputFingerprint = buildLaneInputFingerprintFor2uDeterminism(config);
  const addToCartDeterminismHardeningLane = buildAddToCartDeterminismHardeningLaneArtifact({
    clickPerformed: true,
    selectorClicked: firstEligible.selector,
    selectorList: selectors,
    candidateEvaluations: evaluations,
    reconciliationDiff: postClickReconciliationDiff,
    laneInputFingerprint,
    priorRunPersisted: prior2uDeterminismState,
    workerConfigForTwoPassHandoff: config,
  });

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2u_milo_bulk_after_single_click",
        message:
          "Phase 2u checkpoint after exactly one MILO bulk click (no further actions)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const blocked_after_click =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;
  const network_guard_delta_during_click =
    blocked_immediately_before_click != null && blocked_after_click != null
      ? blocked_after_click - blocked_immediately_before_click
      : null;
  const no_new_blocked_downstream_requests =
    network_guard_delta_during_click === null || network_guard_delta_during_click === 0;

  if (!no_new_blocked_downstream_requests) {
    const err = `Phase 2u: Layer 2 blocked request counter increased during click window (delta=${network_guard_delta_during_click}); hard-stop`;
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2u_milo_bulk_blocked",
        message: err,
        attributes: {
          phase_2u_exec_policy_version: PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION,
          phase_2u_policy_version: PHASE_2U_MILO_BULK_POLICY_VERSION,
          phase_2u_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          selector_clicked: firstEligible.selector,
          click_performed: true,
          network_guard_blocked_before_click: blocked_immediately_before_click,
          network_guard_blocked_after_click: blocked_after_click,
          network_guard_delta_during_click,
          block_reason: "positive_layer2_abort_delta_during_click",
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2u_milo_bulk_findings",
      message:
        "Phase 2u: single MILO bulk-action click completed; no validate/checkout/submit in this phase",
      attributes: {
        phase_2u_exec_policy_version: PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION,
        phase_2u_policy_version: PHASE_2U_MILO_BULK_POLICY_VERSION,
        phase_2u_gate_manifest: gateManifest,
        candidate_evaluations: evaluations,
        click_performed: true,
        click_count_this_phase: 1,
        selector_clicked: firstEligible.selector,
        network_guard_blocked_before_phase: blocked_before_phase,
        network_guard_blocked_immediately_before_click: blocked_immediately_before_click,
        network_guard_blocked_after_click: blocked_after_click,
        network_guard_delta_during_click,
        no_new_blocked_downstream_requests_observed:
          network_guard_delta_during_click === null
            ? null
            : network_guard_delta_during_click === 0,
        run_remained_within_safe_mode_no_validate_checkout_submit_phase: true,
        pre_click_observation: preClickObservation,
        immediate_pre_click_controls_sample: preClickControlsSample,
        immediate_pre_click_controls_sample_omitted: Math.max(
          0,
          preClickControlsClassified.length - preClickControlsSample.length,
        ),
        immediate_post_click_observation: postClickObservation,
        immediate_post_click_reconciliation_diff: postClickReconciliationDiff,
        immediate_post_click_controls_sample: postClickControlsSample,
        immediate_post_click_controls_sample_omitted: Math.max(
          0,
          postClickControlsClassified.length - postClickControlsSample.length,
        ),
        mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        instrumentation_sensitivity_control: {
          pre_2u_window_event_count: pre2uEventCountFromTimeline,
          pre_2u_window_in_page_fetch_xhr_count: pre2uInPageActivityCount,
          pre_2u_window_in_page_independent_transport_count:
            pre2uInPageIndependentTransportCount,
          control_window_event_count: controlEventCount,
          control_window_in_page_fetch_xhr_count: controlInPageFetchXhrCount,
          control_window_in_page_independent_transport_count:
            controlInPageIndependentTransportCount,
          control_window_checkpoints: controlCheckpoints,
          control_window_bursts: controlBurstByCheckpoint,
          control_window_in_page_counters: controlInPageCounters,
          playwright_event_count: controlEventCount,
          in_page_fetch_xhr_count: controlInPageFetchXhrCount,
          in_page_independent_transport_count: controlInPageIndependentTransportCount,
          page_vs_playwright_classification: pageVsPlaywrightClassification,
          independent_transport_primitive: "websocket",
          independent_transport_present:
            controlIndependentTransportPresent || pre2uIndependentTransportPresent,
          independent_transport_classification: independentTransportClassification,
          hook_sensitivity_classification: hookSensitivityClassification,
          pre_2u_vs_control_assessment: pre2uVsControlComparison,
        },
        typing_policy_phase_2u:
          "single_bulk_click_only_no_validate_no_checkout_no_submit_no_second_click",
        add_to_cart_determinism_hardening_non_validate: addToCartDeterminismHardeningLane,
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2u_milo_bulk_complete",
    progressMessage:
      "Phase 2u complete (one MILO bulk click only; downstream order steps out of scope)",
  });

  return {
    phase_2u_exec_policy_version: PHASE_2U_MILO_BULK_EXEC_POLICY_VERSION,
    phase_2u_policy_version: PHASE_2U_MILO_BULK_POLICY_VERSION,
    runtime_click_execution_enabled: true,
    click_performed: true,
    selector_clicked: firstEligible.selector,
    candidate_evaluations: evaluations,
    network_guard_delta_during_click,
    no_new_blocked_downstream_requests_observed:
      network_guard_delta_during_click === null
        ? null
        : network_guard_delta_during_click === 0,
    pre_click_observation: preClickObservation,
    immediate_post_click_observation: postClickObservation,
    immediate_post_click_reconciliation_diff: postClickReconciliationDiff,
    immediate_post_click_controls_sample: postClickControlsSample,
    instrumentation_sensitivity_control: {
      pre_2u_window_event_count: pre2uEventCountFromTimeline,
      pre_2u_window_in_page_fetch_xhr_count: pre2uInPageActivityCount,
      pre_2u_window_in_page_independent_transport_count: pre2uInPageIndependentTransportCount,
      control_window_event_count: controlEventCount,
      control_window_in_page_fetch_xhr_count: controlInPageFetchXhrCount,
      control_window_in_page_independent_transport_count: controlInPageIndependentTransportCount,
      control_window_checkpoints: controlCheckpoints,
      control_window_bursts: controlBurstByCheckpoint,
      control_window_in_page_counters: controlInPageCounters,
      playwright_event_count: controlEventCount,
      in_page_fetch_xhr_count: controlInPageFetchXhrCount,
      in_page_independent_transport_count: controlInPageIndependentTransportCount,
      page_vs_playwright_classification: pageVsPlaywrightClassification,
      independent_transport_primitive: "websocket",
      independent_transport_present:
        controlIndependentTransportPresent || pre2uIndependentTransportPresent,
      independent_transport_classification: independentTransportClassification,
      hook_sensitivity_classification: hookSensitivityClassification,
      pre_2u_vs_control_assessment: pre2uVsControlComparison,
    },
    phase_2u_gate_manifest_version: gateManifest.version,
    add_to_cart_determinism_hardening_non_validate: addToCartDeterminismHardeningLane,
  };
}

async function summarizePhase2oTenantFieldState(page, selector) {
  if (!selector || typeof selector !== "string" || !selector.trim()) {
    return { configured: false, observed: false };
  }

  const sel = selector.trim();
  const loc = page.locator(sel).first();
  const n = await loc.count().catch(() => 0);

  if (n === 0) {
    return {
      configured: true,
      selector_used: sel,
      observed: true,
      visible: false,
      match_count: 0,
    };
  }

  const visible = await loc.isVisible().catch(() => false);

  if (!visible) {
    return {
      configured: true,
      selector_used: sel,
      observed: true,
      visible: false,
      match_count: n,
    };
  }

  const dom_snapshot = await readFieldDomSnapshot(loc);

  return {
    configured: true,
    selector_used: sel,
    observed: true,
    visible: true,
    match_count: n,
    dom_snapshot,
  };
}

/**
 * Single read-only scrape for Phase 2o (no clicks). Exported for unit tests of diff helper inputs.
 */
export async function collectPhase2oReadOnlyObservationSnapshot(page, config) {
  const url = page.url();
  let title = null;

  try {
    const t = await page.title();

    title = t || null;
  } catch {
    title = null;
  }

  const ui_open_signals = await measureAddByCodeUiOpenSignals(page, config);
  const visibleInputs = await collectVisibleInputs(page);
  const visible_input_field_summary = classifyCodeAndQtyFields(visibleInputs);

  const tenant_code_field_state = await summarizePhase2oTenantFieldState(
    page,
    config.addByCodeCodeFieldSelector,
  );
  const tenant_quantity_field_state = await summarizePhase2oTenantFieldState(
    page,
    config.addByCodeQtyFieldSelector,
  );

  const add_apply_selector_states = [];
  const candidates = config.addByCodePhase2nAddApplyCandidateSelectors ?? [];

  for (const s of candidates) {
    const loc = page.locator(s).first();
    const n = await loc.count().catch(() => 0);
    const vis = n > 0 && (await loc.isVisible().catch(() => false));
    const dis = n > 0 ? await loc.isDisabled().catch(() => false) : null;
    const row = {
      selector: s,
      match_count: n,
      visible: vis,
      disabled: dis,
    };

    if (n > 0) {
      const r = await extractMutationBoundaryRowFromLocator(loc);

      row.text_sample = (r.text ?? "").slice(0, 200);
      row.tag = r.tag;
    }

    add_apply_selector_states.push(row);
  }

  const status_alert_and_live_region_samples = await page.evaluate(() => {
    const isVis = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      const st = window.getComputedStyle(el);

      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();

      return r.width >= 2 && r.height >= 2;
    };

    const out = [];
    const seen = new Set();

    const push = (channel, el) => {
      const txt = (el.innerText || el.textContent || "").trim().slice(0, 400);

      if (!txt) {
        return;
      }

      const key = `${channel}|${txt.slice(0, 100)}`;

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      out.push({ channel, text_sample: txt });
    };

    document
      .querySelectorAll("[role=\"alert\"]")
      .forEach((el) => push("role=alert", el));
    document
      .querySelectorAll("[aria-live=\"polite\"], [aria-live=\"assertive\"]")
      .forEach((el) => push("aria-live", el));

    for (const cls of [
      ".toast",
      ".Toast",
      ".notification",
      ".Notification",
      ".alert",
      ".Alert",
      ".snackbar",
      ".Snackbar",
    ]) {
      try {
        document.querySelectorAll(cls).forEach((el) => push(`class:${cls}`, el));
      } catch {
        /* ignore invalid selector environments */
      }
    }

    return out.slice(0, 24);
  });

  const body_text_digest = await page.evaluate(() => {
    const raw = document.body
      ? (document.body.innerText || "").replace(/\s+/g, " ").trim()
      : "";

    return {
      char_length: raw.length,
      head_snippet: raw.slice(0, 1200),
    };
  });

  const inferred_cart_or_line_text_clues = await page.evaluate(() => {
    const t = document.body
      ? (document.body.innerText || "").slice(0, 25_000)
      : "";
    const hits = [];
    const patterns = [
      /\d+\s*(lines?|line\s+items?|items?)\b/gi,
      /\(\s*\d+\s*\)\s*items?/gi,
      /items?\s+in\s+(your\s+)?cart/gi,
      /cart:\s*\d+/gi,
      /subtotal/gi,
    ];

    for (const re of patterns) {
      re.lastIndex = 0;
      let m;

      while ((m = re.exec(t)) && hits.length < 14) {
        hits.push(String(m[0]).slice(0, 120));
      }
    }

    return {
      regex_hits_visible_text_only: hits,
      heuristic_inference_not_inventory_or_server_cart_truth: true,
    };
  });

  return {
    captured_at: "read_only_phase_2o_snapshot",
    url,
    title,
    ui_open_signals,
    visible_input_field_summary,
    tenant_code_field_state,
    tenant_quantity_field_state,
    add_apply_selector_states,
    status_alert_and_live_region_samples,
    body_text_digest,
    inferred_cart_or_line_text_clues,
  };
}

/**
 * Read-only scrape after validate (Phase 2r): extends Phase 2o snapshot with validate control states
 * and an inferred visible scan for checkout/submit-adjacent labels (no clicks).
 */
export async function collectPhase2rPostValidateReadOnlyObservationSnapshot(
  page,
  config,
) {
  const base = await collectPhase2oReadOnlyObservationSnapshot(page, config);
  const validate_selector_states = [];
  const valCands = config.addByCodePhase2qValidateCandidateSelectors ?? [];

  for (const s of valCands) {
    const loc = page.locator(s).first();
    const n = await loc.count().catch(() => 0);
    const vis = n > 0 && (await loc.isVisible().catch(() => false));
    const dis = n > 0 ? await loc.isDisabled().catch(() => false) : null;
    const row = {
      selector: s,
      match_count: n,
      visible: vis,
      disabled: dis,
    };

    if (n > 0) {
      const r = await extractMutationBoundaryRowFromLocator(loc);

      row.text_sample = (r.text ?? "").slice(0, 200);
      row.tag = r.tag;
    }

    validate_selector_states.push(row);
  }

  const checkout_like_controls_inferred = await page.evaluate(() => {
    const isVis = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      const st = window.getComputedStyle(el);

      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();

      return r.width >= 2 && r.height >= 2;
    };

    const checkoutLikeRes = [
      /\bcheckout\b/i,
      /place\s*order/i,
      /submit\s*order/i,
      /complete\s*(order|purchase)/i,
      /confirm\s*order/i,
      /buy\s*now/i,
      /\bfinalize\b/i,
      /\bpurchase\b/i,
      /proceed\s+to\s+checkout/i,
      /continue\s+to\s+checkout/i,
    ];

    const matchesCheckoutLike = (text, href) => {
      const hay = `${text} ${href}`.toLowerCase();

      return checkoutLikeRes.some((re) => re.test(hay));
    };

    const samples = [];
    const seen = new Set();
    const selList = [
      "button",
      "a[href]",
      "[role=\"button\"]",
      "input[type=\"submit\"]",
      "input[type=\"button\"]",
    ];

    outer: for (const sel of selList) {
      let nodes;

      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }

      for (const el of nodes) {
        if (samples.length >= 24) {
          break outer;
        }

        if (!isVis(el)) {
          continue;
        }

        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        const inner = (el.innerText || el.textContent || "").trim();
        const aria = (el.getAttribute("aria-label") || "").trim();
        const title = (el.getAttribute("title") || "").trim();
        const text = (inner || aria || title).slice(0, 240);
        const href =
          tag === "a" ? String(el.getAttribute("href") || "").slice(0, 240) : "";

        if (!matchesCheckoutLike(text, href)) {
          continue;
        }

        const key = `${tag}|${text.slice(0, 60)}|${href.slice(0, 60)}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        const disabled =
          el.disabled === true ||
          String(el.getAttribute("aria-disabled") || "").toLowerCase() ===
            "true";

        samples.push({
          tag,
          text_sample: text.slice(0, 160),
          href_sample: href.slice(0, 200),
          visible: true,
          disabled,
          inferred_checkout_or_submit_adjacent_label_or_href: true,
        });
      }
    }

    return {
      samples,
      scan_is_visible_dom_text_and_href_heuristic_only: true,
      not_proof_of_safe_checkout_or_submit_readiness: true,
      no_controls_were_clicked: true,
    };
  });

  return {
    ...base,
    captured_at: "read_only_phase_2r_post_validate_snapshot",
    validate_selector_states,
    checkout_like_controls_inferred,
  };
}

/**
 * Phase 2o: read-only observation after post-click prerequisite (legacy 2n or MILO 2u variant).
 * No further clicks, validate, checkout, or submit.
 */
export async function runAddByCodePhase2oPostAddApplyObservation({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  phase2nResult,
  phase2uResult,
  post2uMiloMode = false,
}) {
  const gateManifest = buildPhase2mAddApplyLineFutureGateManifest();
  const postApplyLadder = buildPhase2mPostAddApplyLadder();
  const settleMs = config.addByCodePhase2oSettleMs ?? 500;

  await heartbeat({
    progressStage: "mlcc_phase_2o_observation_start",
    progressMessage:
      "Phase 2o: read-only post-add/apply observation (no clicks; no validate/checkout/submit)",
  });

  const mutation_risk_checks_used = [
    `phase_2m_policy_version_${PHASE_2M_POLICY_VERSION}`,
    `phase_2o_policy_version_${PHASE_2O_OBSERVATION_POLICY_VERSION}`,
    "read_only_no_mutation_clicks_no_second_add_apply",
    "layer_2_guardstats_blockedrequestcount_delta_zero_required_across_observation_window",
    post2uMiloMode
      ? "phase_2u_prerequisite_click_performed_true"
      : "phase_2n_prerequisite_add_apply_click_performed_true",
    "post_add_apply_ladder_step_echoed_from_phase_2m",
  ];

  if (post2uMiloMode && (!phase2uResult || phase2uResult.click_performed !== true)) {
    const err =
      "Phase 2o MILO post-2u variant requires Phase 2u to have completed with click_performed=true in the same run";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2o_observation_blocked",
        message: err,
        attributes: {
          phase_2o_policy_version: PHASE_2O_OBSERVATION_POLICY_VERSION,
          phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
          phase_2m_post_add_apply_ladder: postApplyLadder,
          post_click_observation_prerequisite_mode: "milo_post_2u",
          observation_performed: false,
          block_reason: "phase_2u_prerequisite_missing_or_no_click",
          phase_2u_snapshot_for_gate: phase2uResult
            ? { click_performed: phase2uResult.click_performed ?? null }
            : null,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  if (
    !post2uMiloMode &&
    (!phase2nResult || phase2nResult.add_apply_click_performed !== true)
  ) {
    const err =
      "Phase 2o requires Phase 2n to have completed with add_apply_click_performed=true in the same run";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2o_observation_blocked",
        message: err,
        attributes: {
          phase_2o_policy_version: PHASE_2O_OBSERVATION_POLICY_VERSION,
          phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
          phase_2m_post_add_apply_ladder: postApplyLadder,
          post_click_observation_prerequisite_mode: "legacy_post_2n",
          observation_performed: false,
          block_reason: "phase_2n_prerequisite_missing_or_no_click",
          phase_2n_snapshot_for_gate: phase2nResult
            ? {
                add_apply_click_performed:
                  phase2nResult.add_apply_click_performed ?? null,
              }
            : null,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const blocked_at_observation_start =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2o_pre_observation_snapshot",
        message:
          "Phase 2o pre-observation page snapshot (read-only; before settle window)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const observation_pre = await collectPhase2oReadOnlyObservationSnapshot(
    page,
    config,
  );

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2o_pre_observation_evidence",
      message:
        "Phase 2o pre-settle read-only DOM/status scrape (no clicks; not server cart truth)",
      attributes: {
        phase_2o_policy_version: PHASE_2O_OBSERVATION_POLICY_VERSION,
        phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
        phase_2m_add_apply_gate_manifest: gateManifest,
        post_click_observation_prerequisite_mode: post2uMiloMode
          ? "milo_post_2u"
          : "legacy_post_2n",
        ladder_step_post_add_apply_observation: postApplyLadder.steps?.[1] ?? null,
        settle_ms_configured: settleMs,
        observation_pre,
        network_guard_blocked_request_count_at_window_start:
          blocked_at_observation_start,
        mutation_risk_checks_used,
        disclaimer_dom_observation_only:
          "visible_text_and_field_snapshots_do_not_prove_server_cart_line_count_or_inventory_outcome",
        disclaimer_no_validate_readiness:
          "this_phase_does_not_assess_readiness_for_validate_checkout_or_submit",
      },
    }),
  );

  await new Promise((r) => setTimeout(r, settleMs));

  const blocked_after_settle =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_pre_scrape =
    blocked_at_observation_start != null && blocked_after_settle != null
      ? blocked_after_settle - blocked_at_observation_start
      : null;

  if (
    network_guard_delta_during_pre_scrape != null &&
    network_guard_delta_during_pre_scrape !== 0
  ) {
    const err = `Phase 2o: Layer 2 blocked request counter increased during observation window (delta=${network_guard_delta_during_pre_scrape} after pre-scrape/settle)`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2o_observation_blocked",
        message: err,
        attributes: {
          phase_2o_policy_version: PHASE_2O_OBSERVATION_POLICY_VERSION,
          post_click_observation_prerequisite_mode: post2uMiloMode
            ? "milo_post_2u"
            : "legacy_post_2n",
          observation_performed: false,
          observation_pre,
          block_reason: "positive_layer2_abort_delta_during_observation",
          network_guard_blocked_at_window_start: blocked_at_observation_start,
          network_guard_blocked_after_settle: blocked_after_settle,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2o_post_observation_snapshot",
        message:
          "Phase 2o post-settle snapshot (read-only; no further UI actions)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const observation_post = await collectPhase2oReadOnlyObservationSnapshot(
    page,
    config,
  );

  const blocked_at_observation_end =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_full_observation_window =
    blocked_at_observation_start != null && blocked_at_observation_end != null
      ? blocked_at_observation_end - blocked_at_observation_start
      : null;

  if (
    network_guard_delta_full_observation_window != null &&
    network_guard_delta_full_observation_window !== 0
  ) {
    const err = `Phase 2o: Layer 2 blocked request counter increased during full observation window (delta=${network_guard_delta_full_observation_window})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2o_observation_blocked",
        message: err,
        attributes: {
          phase_2o_policy_version: PHASE_2O_OBSERVATION_POLICY_VERSION,
          post_click_observation_prerequisite_mode: post2uMiloMode
            ? "milo_post_2u"
            : "legacy_post_2n",
          observation_performed: false,
          observation_pre,
          observation_post,
          block_reason: "positive_layer2_abort_delta_full_observation_window",
          network_guard_blocked_at_window_start: blocked_at_observation_start,
          network_guard_blocked_at_window_end: blocked_at_observation_end,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const observation_diff = diffPhase2oObservationSnapshots(
    observation_pre,
    observation_post,
  );

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2o_observation_findings",
      message:
        "Phase 2o read-only observation complete (no validate/checkout/submit; no additional add/apply)",
      attributes: {
        phase_2o_policy_version: PHASE_2O_OBSERVATION_POLICY_VERSION,
        phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
        phase_2m_post_add_apply_ladder: postApplyLadder,
        post_click_observation_prerequisite_mode: post2uMiloMode
          ? "milo_post_2u"
          : "legacy_post_2n",
        settle_ms_used: settleMs,
        observation_pre,
        observation_post,
        observation_diff,
        clicks_performed_this_phase: 0,
        network_guard_blocked_at_window_start: blocked_at_observation_start,
        network_guard_blocked_at_window_end: blocked_at_observation_end,
        network_guard_delta_full_observation_window,
        no_new_blocked_downstream_requests_observed:
          network_guard_delta_full_observation_window === null
            ? null
            : network_guard_delta_full_observation_window === 0,
        page_appears_changed_visible_dom_heuristic:
          observation_diff.any_heuristic_dom_or_signal_delta === true,
        mutation_risk_checks_used,
        disclaimer_observation_not_server_cart:
          "browser_visible_signals_do_not_prove_server_cart_or_line_items",
        disclaimer_regex_hits_are_inference_only:
          "inferred_cart_or_line_text_clues_are_heuristic_pattern_hits_on_visible_text_not_inventory_proof",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2o_observation_complete",
    progressMessage:
      "Phase 2o complete (read-only observation only; downstream validate/checkout/submit out of scope)",
  });

  return {
    phase_2o_policy_version: PHASE_2O_OBSERVATION_POLICY_VERSION,
    phase_2m_policy_version: PHASE_2M_POLICY_VERSION,
    post_click_observation_prerequisite_mode: post2uMiloMode
      ? "milo_post_2u"
      : "legacy_post_2n",
    observation_performed: true,
    settle_ms_used: settleMs,
    observation_diff,
    network_guard_delta_full_observation_window,
    no_new_blocked_downstream_requests_observed:
      network_guard_delta_full_observation_window === null
        ? null
        : network_guard_delta_full_observation_window === 0,
    page_appears_changed_visible_dom_heuristic:
      observation_diff.any_heuristic_dom_or_signal_delta === true,
  };
}

/**
 * Diff read-only snapshots of `document.body` direct children (bounded slots).
 * Runs in Node on JSON from `page.evaluate`; no browser APIs.
 */
export function computeBodyChildDeltaExplainer(preSnapshot, postSnapshot) {
  const base = {
    bounded_model: "body_direct_children_only_max_36_slots",
    labeling: "read_only_no_html_dump_no_clicks_post_2u_cart_navigation_timing",
  };
  const preSlots = preSnapshot?.body_direct_child_slots;
  const postSlots = postSnapshot?.body_direct_child_slots;
  if (!Array.isArray(preSlots) || !Array.isArray(postSlots)) {
    return {
      ...base,
      comparable: false,
      note: "missing_pre_or_post_body_child_snapshot",
      changed_items: [],
      summary: {
        changed_count: 0,
        any_likely_cart_result_relevant: false,
        dominant_relevance: null,
      },
    };
  }

  const relevanceFromSignals = (looksLike, cartMicro) => {
    const cm = cartMicro && typeof cartMicro === "object" ? cartMicro : {};
    const cartish =
      Number(cm.tr_two_td_visible || 0) >= 1 ||
      Number(cm.mat_row_visible || 0) >= 1 ||
      Number(cm.qty_input_visible || 0) >= 1 ||
      Number(cm.dollar_like_token_hits || 0) >= 1 ||
      cm.validate_button_text_visible === true ||
      cm.checkout_button_text_visible === true ||
      cm.place_order_button_text_visible === true;
    if (looksLike === "cart-like surface" || cartish) {
      return "likely_hidden_or_compact_cart_surface";
    }
    if (looksLike === "toast") {
      return "likely_notification_or_toast";
    }
    if (looksLike === "layout shell") {
      return "likely_irrelevant_layout_change";
    }
    if (looksLike === "overlay" && !cartish) {
      return "likely_irrelevant_layout_change";
    }
    if (
      looksLike === "portal" ||
      looksLike === "drawer" ||
      looksLike === "dialog" ||
      looksLike === "unknown"
    ) {
      return "inconclusive";
    }
    return "inconclusive";
  };

  const maxI = Math.max(preSlots.length, postSlots.length);
  const changed_items = [];

  for (let i = 0; i < maxI; i++) {
    const p = preSlots[i] ?? null;
    const q = postSlots[i] ?? null;

    if (p == null && q == null) {
      continue;
    }

    if (p == null && q != null) {
      if (q.non_html_element === true) {
        continue;
      }
      changed_items.push({
        change_kind: "added_at_slot",
        slot_index: i,
        dom_path_compact: q.dom_path_compact ?? null,
        tag: q.tag ?? null,
        class_sample: q.class_sample ?? null,
        id: q.id ?? null,
        text_head: q.text_head ?? "",
        text_length: q.text_length ?? 0,
        bounding_rect: q.bounding_rect ?? null,
        position: q.position ?? null,
        z_index: q.z_index ?? null,
        display_visibility_opacity: q.display_visibility_opacity ?? null,
        child_count: q.child_count ?? null,
        looks_like: q.looks_like ?? "unknown",
        cart_like_micro_signals: q.cart_like_micro_signals ?? null,
        relevance_heuristic: relevanceFromSignals(q.looks_like, q.cart_like_micro_signals),
      });
      continue;
    }

    if (p != null && q == null) {
      if (p.non_html_element === true) {
        continue;
      }
      changed_items.push({
        change_kind: "removed_at_slot",
        slot_index: i,
        pre_compact: {
          tag: p.tag ?? null,
          id: p.id ?? null,
          visible: p.visible === true,
          text_length: p.text_length ?? 0,
        },
        relevance_heuristic: "inconclusive",
      });
      continue;
    }

    if (p.non_html_element === true && q.non_html_element === true) {
      continue;
    }

    if (p.non_html_element !== q.non_html_element) {
      changed_items.push({
        change_kind: "slot_node_kind_changed",
        slot_index: i,
        relevance_heuristic: "inconclusive",
      });
      continue;
    }

    const tagP = p.tag ?? "";
    const tagQ = q.tag ?? "";
    const idP = p.id ?? "";
    const idQ = q.id ?? "";

    if (tagP !== tagQ || idP !== idQ) {
      changed_items.push({
        change_kind: "replaced_at_slot",
        slot_index: i,
        pre_tag: tagP || null,
        pre_id: idP || null,
        dom_path_compact: q.dom_path_compact ?? null,
        tag: tagQ || null,
        class_sample: q.class_sample ?? null,
        id: idQ || null,
        text_head: q.text_head ?? "",
        text_length: q.text_length ?? 0,
        bounding_rect: q.bounding_rect ?? null,
        position: q.position ?? null,
        z_index: q.z_index ?? null,
        display_visibility_opacity: q.display_visibility_opacity ?? null,
        child_count: q.child_count ?? null,
        looks_like: q.looks_like ?? "unknown",
        cart_like_micro_signals: q.cart_like_micro_signals ?? null,
        relevance_heuristic: relevanceFromSignals(q.looks_like, q.cart_like_micro_signals),
      });
      continue;
    }

    const visP = p.visible === true;
    const visQ = q.visible === true;

    if (!visP && visQ) {
      changed_items.push({
        change_kind: "newly_visible_at_slot",
        slot_index: i,
        dom_path_compact: q.dom_path_compact ?? null,
        tag: q.tag ?? null,
        class_sample: q.class_sample ?? null,
        id: q.id ?? null,
        text_head: q.text_head ?? "",
        text_length: q.text_length ?? 0,
        bounding_rect: q.bounding_rect ?? null,
        position: q.position ?? null,
        z_index: q.z_index ?? null,
        display_visibility_opacity: q.display_visibility_opacity ?? null,
        child_count: q.child_count ?? null,
        looks_like: q.looks_like ?? "unknown",
        cart_like_micro_signals: q.cart_like_micro_signals ?? null,
        relevance_heuristic: relevanceFromSignals(q.looks_like, q.cart_like_micro_signals),
      });
      continue;
    }

    if (visP && visQ) {
      const tLenP = Number(p.text_length || 0);
      const tLenQ = Number(q.text_length || 0);
      const cP = Number(p.child_count || 0);
      const cQ = Number(q.child_count || 0);
      const looksP = p.looks_like ?? "";
      const looksQ = q.looks_like ?? "";

      if (
        Math.abs(tLenP - tLenQ) > 40 ||
        cP !== cQ ||
        looksP !== looksQ ||
        (p.class_sample ?? "") !== (q.class_sample ?? "")
      ) {
        changed_items.push({
          change_kind: "materially_changed_at_slot",
          slot_index: i,
          dom_path_compact: q.dom_path_compact ?? null,
          tag: q.tag ?? null,
          class_sample: q.class_sample ?? null,
          id: q.id ?? null,
          text_head: q.text_head ?? "",
          text_length: q.text_length ?? 0,
          pre_text_length: tLenP,
          bounding_rect: q.bounding_rect ?? null,
          position: q.position ?? null,
          z_index: q.z_index ?? null,
          display_visibility_opacity: q.display_visibility_opacity ?? null,
          child_count: q.child_count ?? null,
          pre_child_count: cP,
          looks_like: q.looks_like ?? "unknown",
          cart_like_micro_signals: q.cart_like_micro_signals ?? null,
          relevance_heuristic: relevanceFromSignals(q.looks_like, q.cart_like_micro_signals),
        });
      }
    }
  }

  const anyLikelyCart = changed_items.some(
    (c) => c.relevance_heuristic === "likely_hidden_or_compact_cart_surface",
  );
  const anyInconclusive = changed_items.some((c) => c.relevance_heuristic === "inconclusive");

  return {
    ...base,
    comparable: true,
    pre_body_child_total: preSnapshot.body_child_total ?? null,
    post_body_child_total: postSnapshot.body_child_total ?? null,
    pre_truncated: preSnapshot.truncated === true,
    post_truncated: postSnapshot.truncated === true,
    changed_items,
    summary: {
      changed_count: changed_items.length,
      any_likely_cart_result_relevant: anyLikelyCart,
      any_inconclusive_changed_slots: anyInconclusive,
      dominant_relevance:
        changed_items.length === 0
          ? null
          : anyLikelyCart
            ? "likely_hidden_or_compact_cart_surface"
            : changed_items[changed_items.length - 1]?.relevance_heuristic ?? null,
    },
  };
}

/**
 * Classify MILO read-only cart discovery outcome from captured surface + validate scans (no clicks).
 * Exported for unit tests; keep aligned with evidence `cart_state_classification`.
 */
export function classifyMiloReadonlyCartDiscoveryState(
  cart_surface_state,
  validate_candidate_rows_visible,
  validate_shaped_full_dom,
) {
  const s = cart_surface_state && typeof cart_surface_state === "object" ? cart_surface_state : {};
  const vis = Array.isArray(validate_candidate_rows_visible)
    ? validate_candidate_rows_visible
    : [];
  const full = Array.isArray(validate_shaped_full_dom) ? validate_shaped_full_dom : [];

  if (vis.length > 0) {
    return {
      classification: "other",
      reason: "visible_validate_shaped_candidates_present",
      detail: { visible_candidate_count: vis.length },
    };
  }

  const line = s.line_items_likely_present_heuristic === true;
  const emptyHits = Array.isArray(s.empty_cart_phrase_hits) && s.empty_cart_phrase_hits.length > 0;
  const head = String(s.body_inner_text_head_snippet ?? "");
  const emptyishHead = /\bcart\s+is\s+empty\b|your\s+cart\s+is\s+empty\b|no\s+items?\b/i.test(
    head,
  );

  const shaped = full.filter((x) => x && x.validate_match_via);

  const visiblyInteractiveShaped = shaped.filter(
    (x) =>
      x.client_visible_for_interaction === true &&
      x.disabled_reported !== true &&
      x.hidden_by_style !== true &&
      x.offscreen_viewport !== true &&
      x.aria_hidden !== true,
  );

  if (!line && (emptyHits || emptyishHead)) {
    return {
      classification: "empty_cart_surface",
      reason: "empty_cart_signals_or_head_without_line_item_heuristic",
      detail: { empty_cart_phrase_hits: s.empty_cart_phrase_hits ?? [] },
    };
  }

  if (!line && shaped.length > 0) {
    return {
      classification: "validate_present_but_not_confidently_selectable",
      reason: "validate_shaped_in_dom_without_line_item_table_heuristic_mixed_state",
      detail: { validate_shaped_count: shaped.length },
    };
  }

  if (!line && shaped.length === 0) {
    return {
      classification: "empty_cart_surface",
      reason: "no_line_item_heuristic_and_no_validate_shaped_controls_in_full_dom_scan",
      detail: {
        data_row_heuristic_count: s.data_row_heuristic_count ?? null,
        tr_count_in_largest_tbody: s.tr_count_in_largest_tbody ?? null,
      },
    };
  }

  if (line && shaped.length === 0) {
    return {
      classification: "nonempty_cart_no_validate_visible",
      reason: "line_items_heuristic_but_no_validate_shaped_controls_matched_scan_patterns",
      detail: {
        data_row_heuristic_count: s.data_row_heuristic_count ?? null,
        tr_count_in_largest_tbody: s.tr_count_in_largest_tbody ?? null,
      },
    };
  }

  if (line && visiblyInteractiveShaped.length > 0) {
    return {
      classification: "validate_present_but_not_confidently_selectable",
      reason:
        "validate_shaped_visible_interactive_in_full_dom_but_zero_enriched_candidate_rows",
      detail: { validate_shaped_count: shaped.length },
    };
  }

  const badInteractive = shaped.some(
    (x) =>
      x.disabled_reported === true ||
      x.client_visible_for_interaction !== true ||
      x.hidden_by_style === true ||
      x.offscreen_viewport === true ||
      x.aria_hidden === true,
  );

  if (line && shaped.length > 0 && badInteractive) {
    return {
      classification: "validate_present_but_not_confidently_selectable",
      reason:
        "validate_shaped_nodes_exist_but_disabled_hidden_offscreen_or_not_client_visible",
      detail: { validate_shaped_count: shaped.length },
    };
  }

  if (line && shaped.length > 0) {
    return {
      classification: "other",
      reason: "line_items_and_validate_shaped_unexpected_residual",
      detail: { validate_shaped_count: shaped.length },
    };
  }

  return {
    classification: "other",
    reason: "unclassified_mixed_cart_signals",
    detail: {},
  };
}

const VALIDATE_BOUNDARY_POLICY_STANDARD_GUARDRAILS = [
  "Validate still not run automatically",
  "Checkout/submit/finalize remain blocked",
  "Any future 2V work requires explicit human approval",
  "No order placement allowed",
  "Existing safe-mode/network/UI guards remain mandatory",
];

/** Locked operational selection for validate-boundary policy artifact (policy-only; not 2V execution). */
export const SELECTED_VALIDATE_BOUNDARY_POLICY_OPTION =
  "keep_validate_blocked_under_current_evidence_rules";

/**
 * Policy/decision artifact only: does not authorize Validate (2V) or ordering.
 * Emitted when add-by-code probe runs; evidence reflects actual phase outputs when present.
 */
export function buildValidateBoundaryPolicyDecisionArtifact({
  phase2lResult,
  phase2oMiloReadonlyCartValidateDiscoveryResult,
  config,
}) {
  const pre2u =
    phase2lResult?.pre_2u_probe_boundary_conclusion &&
    typeof phase2lResult.pre_2u_probe_boundary_conclusion === "object"
      ? phase2lResult.pre_2u_probe_boundary_conclusion
      : null;
  const post2uLane = phase2oMiloReadonlyCartValidateDiscoveryResult
    ?.post_2u_non_validate_observation_lane;
  const post2u =
    phase2oMiloReadonlyCartValidateDiscoveryResult?.post_2u_probe_boundary_conclusion ||
    post2uLane?.post_2u_probe_boundary_conclusion ||
    null;

  const pre2uBoundary =
    pre2u?.classification === "bounded_pre_2u_no_evidence_boundary_reached";
  const post2uBoundary =
    post2u?.classification === "bounded_post_2u_no_evidence_boundary_reached";
  const bothNoEvidenceBoundaries = pre2uBoundary === true && post2uBoundary === true;
  const post2uLaneRan =
    phase2oMiloReadonlyCartValidateDiscoveryResult?.cart_validate_discovery_performed ===
    true;

  const currentEvidenceStatus = {
    pre_2u_boundary_classification: pre2u?.classification ?? null,
    post_2u_boundary_classification: post2u?.classification ?? null,
    post_2u_readonly_cart_lane_performed: post2uLaneRan,
    both_bounded_lanes_concluded_no_evidence_boundaries: bothNoEvidenceBoundaries,
    validate_boundary_evidence_threshold_not_met_under_current_rules:
      bothNoEvidenceBoundaries,
  };

  const selectedPolicyPrefix =
    `Current selected policy: ${SELECTED_VALIDATE_BOUNDARY_POLICY_OPTION} — Validate remains blocked under present evidence rules. `;

  const compactHumanSummary = bothNoEvidenceBoundaries
    ? `${selectedPolicyPrefix}Bounded pre-2U and post-2U non-validate lanes both concluded with no-evidence boundaries under current rules; a human validate-boundary policy decision remains recorded for audit, but operational default keeps Validate blocked. This artifact does not authorize Validate or ordering.`
    : post2uLaneRan
      ? `${selectedPolicyPrefix}Post-2U lane ran; boundary classifications may be partial or inconclusive—review pre_2u and post_2u boundary conclusions. Selected policy still keeps Validate blocked. This artifact does not authorize Validate or ordering.`
      : `${selectedPolicyPrefix}Post-2U read-only cart lane not present in this run output; pre-2U boundary state alone does not complete the dual-lane picture. Selected policy still keeps Validate blocked. This artifact does not authorize Validate or ordering.`;
  const laneClosureHandoff = {
    lane_status: "closed_under_current_policy",
    reason:
      "selected_policy_keeps_validate_blocked_under_present_evidence_rules",
    references: {
      pre_2u_boundary_classification: pre2u?.classification ?? null,
      post_2u_boundary_classification: post2u?.classification ?? null,
      validate_boundary_policy_classification:
        "validate_boundary_policy_decision_required",
      selected_policy_option: SELECTED_VALIDATE_BOUNDARY_POLICY_OPTION,
    },
    recommended_next_safe_engineering_lanes: [
      "add_to_cart_determinism_hardening_non_validate",
      "post_cart_reconciliation_mapping_non_validate",
      "broader_mlcc_feature_mapping_non_validate",
      "repo_antidrift_and_worker_docs_hardening",
    ],
    compact_human_handoff_summary:
      "Validate-boundary lane is closed under current policy. Continue only on non-validate engineering lanes with existing safety guardrails unchanged.",
  };

  return {
    classification: "validate_boundary_policy_decision_required",
    selected_policy_option: SELECTED_VALIDATE_BOUNDARY_POLICY_OPTION,
    labeling:
      "validate_boundary_policy_decision_artifact_not_permission_to_run_validate_or_order",
    current_evidence_status: {
      summary: [
        "both_bounded_pre_2u_and_post_2u_lanes_concluded_no_evidence_when_classifications_match",
        "current_evidence_threshold_for_validate_boundary_work_is_not_met_when_no_automation_visible_basis",
      ],
      ...currentEvidenceStatus,
    },
    current_blocker: {
      summary:
        "no_automation_visible_evidence_basis_currently_supports_validate_boundary_progression_under_present_rules",
      pre_2u_probe_boundary_reached: pre2uBoundary,
      post_2u_probe_boundary_reached: post2uBoundary,
    },
    policy_options: [
      {
        option_id: "keep_validate_blocked_under_current_evidence_rules",
        selected: true,
        guardrails: [...VALIDATE_BOUNDARY_POLICY_STANDARD_GUARDRAILS],
      },
      {
        option_id: "redefine_validate_boundary_evidence_threshold",
        selected: false,
        guardrails: [...VALIDATE_BOUNDARY_POLICY_STANDARD_GUARDRAILS],
      },
      {
        option_id: "authorize_a_separate_explicit_policy_review_before_any_future_2v_work",
        selected: false,
        guardrails: [...VALIDATE_BOUNDARY_POLICY_STANDARD_GUARDRAILS],
      },
    ],
    lane_closure_handoff: laneClosureHandoff,
    compact_human_summary: compactHumanSummary,
  };
}

/**
 * Read-only sample of operator-declared MILO list host (first Playwright match). No clicks.
 */
export async function sampleMiloPreCartListRootOverrideReadonly(page, cssSelector) {
  const sel = String(cssSelector ?? "").trim();
  const base = {
    list_root_override_selector: sel,
    list_root_override_playwright_match_count: 0,
    list_root_override_visible: false,
    list_root_override_populated_heuristic: false,
    scan_read_only_no_clicks: true,
    labeling:
      "list_root_override_visible_dom_only_not_server_list_or_inventory_truth",
  };

  if (!sel) {
    return base;
  }

  let loc;
  try {
    loc = page.locator(sel).first();
  } catch {
    return {
      ...base,
      list_root_override_error: "invalid_locator_selector",
    };
  }

  const n = await loc.count().catch(() => 0);

  base.list_root_override_playwright_match_count = n;

  if (n === 0) {
    return base;
  }

  base.list_root_override_visible = await loc.isVisible().catch(() => false);

  const evaluated = await loc.evaluate((rootEl) => {
    const compact = (s) => String(s || "").replace(/\s+/g, " ").trim();

    if (!(rootEl instanceof HTMLElement)) {
      return { list_root_override_eval_error: "not_html_element" };
    }

    const boilerplateRe =
      /CHOOSE LICENSE|ADA Contact|MLCC Contact|Online Liquor Ordering|Hours of Operation|Phone:\s*\(/i;

    const productishText = (t) => {
      const u = compact(t);

      if (u.length < 20) {
        return false;
      }

      if (boilerplateRe.test(u)) {
        return false;
      }

      if (/liquor code\s*quantity\s*add all/i.test(u)) {
        return false;
      }

      return /\d{3,6}/.test(u) && /[A-Za-z]{4,}/.test(u);
    };

    const isVisibleEl = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      const st = window.getComputedStyle(el);

      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();

      return r.width >= 2 && r.height >= 2;
    };

    const rootText = compact(rootEl.innerText || "");
    const rootHead = rootText.slice(0, 560);
    const itemSelectors = [
      "li",
      "article",
      "[class*=\"card\" i]",
      "[class*=\"product\" i]",
      "[class*=\"item\" i]",
      "[class*=\"list-group\" i]",
      ".mat-row",
      "[class*=\"mat-row\" i]",
      "mat-row",
      "[class*=\"cdk-row\" i]",
      "tbody tr",
      "[role=\"listitem\"]",
      "[role=\"row\"]",
    ];

    const itemLikeSamples = [];
    let itemLikeCount = 0;
    let matCdkRowLikeCount = 0;

    for (const itemSel of itemSelectors) {
      let nodes;

      try {
        nodes = rootEl.querySelectorAll(itemSel);
      } catch {
        continue;
      }

      for (const node of nodes) {
        if (!(node instanceof HTMLElement) || !isVisibleEl(node)) {
          continue;
        }

        const tag = node.tagName.toLowerCase();
        const cls =
          typeof node.className === "string"
            ? node.className.replace(/\s+/g, " ").trim().slice(0, 120)
            : "";

        if (/mat-row|cdk-row/i.test(cls) || tag === "mat-row") {
          matCdkRowLikeCount += 1;
        }

        const tx = compact(node.innerText || "").slice(0, 280);

        if (tx.length >= 12 && productishText(tx)) {
          itemLikeCount += 1;

          if (itemLikeSamples.length < 22) {
            itemLikeSamples.push({
              tag,
              class_sample: cls || null,
              text_sample: tx,
            });
          }
        }
      }
    }

    const statusNearRoot = [];

    for (const re of [
      /please wait[^.\n]{0,120}/gi,
      /add(?:ed|ing)?[^.\n]{0,80}/gi,
      /invalid[^.\n]{0,50}/gi,
      /not found[^.\n]{0,50}/gi,
    ]) {
      re.lastIndex = 0;
      let m;

      while ((m = re.exec(rootHead)) && statusNearRoot.length < 8) {
        const slice = m[0].trim().slice(0, 160);

        if (slice && !statusNearRoot.includes(slice)) {
          statusNearRoot.push(slice);
        }
      }
    }

    const populated =
      itemLikeCount >= 1 ||
      matCdkRowLikeCount >= 1 ||
      (rootText.length > 80 && productishText(rootText));

    return {
      list_root_override_tag: rootEl.tagName.toLowerCase(),
      list_root_override_id: rootEl.id || null,
      list_root_override_class_sample:
        typeof rootEl.className === "string"
          ? rootEl.className.replace(/\s+/g, " ").trim().slice(0, 200)
          : null,
      list_root_override_inner_text_length: rootText.length,
      list_root_override_inner_text_head_sample: rootHead,
      list_root_override_item_like_visible_count: itemLikeCount,
      list_root_override_mat_or_cdk_row_like_count: matCdkRowLikeCount,
      list_root_override_item_like_text_samples: itemLikeSamples,
      list_root_override_status_text_near_root: statusNearRoot,
      list_root_override_populated_heuristic: populated,
    };
  });

  return {
    ...base,
    ...evaluated,
    list_root_override_populated_heuristic:
      evaluated?.list_root_override_populated_heuristic === true,
  };
}

/**
 * Read-only MILO by-code surface immediately before read-only cart navigation.
 * Table/row/list heuristics, Bootstrap row sibling of `.search-container` (phase 2l anchor),
 * optional operator list-root override, and tenant field association (value length only); not server or cart truth.
 */
export async function collectMiloPreCartBycodeListSurfaceReadonly(page, config) {
  const codeFieldSelector =
    typeof config?.addByCodeCodeFieldSelector === "string"
      ? config.addByCodeCodeFieldSelector.trim()
      : "";

  const domSummary = await page.evaluate((tenantCodeSelector) => {
    const compact = (s) => String(s || "").replace(/\s+/g, " ").trim();
    let pathname = "";

    try {
      pathname = new URL(window.location.href).pathname.toLowerCase();
    } catch {
      pathname = "";
    }

    const bycode_canonical_path = pathname.includes("/milo/products/bycode");
    const mainEl = document.querySelector("main") || document.body;
    const tablesInMain = mainEl ? mainEl.querySelectorAll("table") : [];
    let tbody_count_in_main = 0;
    let tr_count_all_tbody_in_main = 0;
    let tr_count_in_largest_tbody = 0;
    let data_row_heuristic_count = 0;
    const tbodyRowTextSamples = [];

    for (const t of tablesInMain) {
      const tbodies = t.querySelectorAll("tbody");

      for (const tb of tbodies) {
        tbody_count_in_main += 1;
        const trs = tb.querySelectorAll("tr");
        const n = trs.length;

        tr_count_all_tbody_in_main += n;

        if (n > tr_count_in_largest_tbody) {
          tr_count_in_largest_tbody = n;
        }

        for (const tr of trs) {
          if (tr.querySelectorAll("td").length >= 2) {
            data_row_heuristic_count += 1;
            const txt = compact(tr.innerText || "").slice(0, 260);

            if (txt) {
              tbodyRowTextSamples.push(txt);
            }
          }
        }
      }
    }

    const chromeRowRe =
      /^liquor code\s*quantity\s*add all to cart\.?$/i;

    const productLikeTbodySamples = tbodyRowTextSamples.filter((t) => {
      const u = t.replace(/\s+/g, " ").trim();

      if (u.length < 12) {
        return false;
      }

      if (chromeRowRe.test(u)) {
        return false;
      }

      if (/^liquor code$/i.test(u)) {
        return false;
      }

      return true;
    });

    const bodyHead = compact(document.body?.innerText || "").slice(0, 2400);
    const statusPhrases = [];
    const patterns = [
      /please wait[^.\n]{0,140}/gi,
      /add(?:ed|ing)?[^.\n]{0,100}to (?:the |your )?(?:cart|product list)[^.\n]{0,80}/gi,
      /product list[^.\n]{0,100}/gi,
    ];

    for (const re of patterns) {
      re.lastIndex = 0;
      let m;

      while ((m = re.exec(bodyHead)) && statusPhrases.length < 12) {
        const slice = m[0].trim().slice(0, 200);

        if (slice && !statusPhrases.includes(slice)) {
          statusPhrases.push(slice);
        }
      }
    }

    const looseTrSamples = Array.from(
      document.querySelectorAll("table tr, [role='row']"),
    )
      .map((n) => compact(n.innerText || ""))
      .filter((t) => t.length >= 6)
      .slice(0, 28);

    const liSamples = Array.from(mainEl?.querySelectorAll("li") ?? [])
      .map((li) => compact(li.innerText || "").slice(0, 200))
      .filter((t) => t.length >= 15)
      .slice(0, 16);

    const boilerplateRe =
      /CHOOSE LICENSE|ADA Contact|MLCC Contact|Online Liquor Ordering|Hours of Operation|Phone:\s*\(/i;

    const productishText = (t) => {
      const u = compact(t);

      if (u.length < 20) {
        return false;
      }

      if (boilerplateRe.test(u)) {
        return false;
      }

      if (/liquor code\s*quantity\s*add all/i.test(u)) {
        return false;
      }

      return /\d{3,6}/.test(u) && /[A-Za-z]{4,}/.test(u);
    };

    const isVisibleEl = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      const st = window.getComputedStyle(el);

      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();

      return r.width >= 2 && r.height >= 2;
    };

    let codeFieldEl = null;

    if (tenantCodeSelector) {
      try {
        codeFieldEl = document.querySelector(tenantCodeSelector);
      } catch {
        codeFieldEl = null;
      }
    }

    const searchAnchor =
      codeFieldEl instanceof HTMLElement
        ? codeFieldEl.closest(".search-container")
        : null;

    const list_region_roots_meta = [];
    const listRegionRootElements = [];

    if (searchAnchor instanceof HTMLElement) {
      const row = searchAnchor.closest(".row");
      let searchColumn = null;

      if (row instanceof HTMLElement) {
        for (const c of row.children) {
          if (c instanceof HTMLElement && c.contains(searchAnchor)) {
            searchColumn = c;
            break;
          }
        }

        if (searchColumn) {
          for (const c of row.children) {
            if (c instanceof HTMLElement && c !== searchColumn) {
              listRegionRootElements.push({
                el: c,
                resolution: "bootstrap_row_sibling_column_of_search_container_row",
              });
            }
          }
        }
      }

      if (listRegionRootElements.length === 0 && row instanceof HTMLElement) {
        for (const c of row.children) {
          if (
            c instanceof HTMLElement &&
            !c.contains(searchAnchor) &&
            !searchAnchor.contains(c)
          ) {
            listRegionRootElements.push({
              el: c,
              resolution: "bootstrap_row_child_not_containing_search_anchor",
            });
          }
        }
      }

      let sib = row?.nextElementSibling ?? null;
      let hop = 0;

      while (sib instanceof HTMLElement && hop < 5 && listRegionRootElements.length < 4) {
        const tlen = compact(sib.innerText || "").length;

        if (tlen >= 60 && !sib.contains(searchAnchor)) {
          listRegionRootElements.push({
            el: sib,
            resolution: "main_flow_sibling_after_search_row",
          });
        }

        sib = sib.nextElementSibling;
        hop += 1;
      }
    }

    if (mainEl instanceof HTMLElement) {
      for (const r of mainEl.querySelectorAll(".row")) {
        if (!(r instanceof HTMLElement)) {
          continue;
        }

        if (r.querySelector(".search-container")) {
          continue;
        }

        const txt = compact(r.innerText || "");

        if (txt.length < 100) {
          continue;
        }

        listRegionRootElements.push({
          el: r,
          resolution: "main_row_without_search_container_min_text_100",
        });
      }
    }

    const seenRoot = new Set();

    for (const { el, resolution } of listRegionRootElements) {
      if (list_region_roots_meta.length >= 8) {
        break;
      }

      if (!(el instanceof HTMLElement) || seenRoot.has(el)) {
        continue;
      }

      seenRoot.add(el);
      const rootText = compact(el.innerText || "");
      const rootHead = rootText.slice(0, 520);
      const itemSelectors = [
        "li",
        "article",
        "[class*=\"card\" i]",
        "[class*=\"product\" i]",
        "[class*=\"item\" i]",
        "[class*=\"list-group\" i]",
        ".mat-row",
        "[class*=\"mat-row\" i]",
        "mat-row",
        "[class*=\"cdk-row\" i]",
        "tbody tr",
        "[role=\"listitem\"]",
      ];

      const itemLikeSamples = [];
      let itemLikeCount = 0;
      let matCdkRowLikeCount = 0;

      for (const sel of itemSelectors) {
        let nodes;

        try {
          nodes = el.querySelectorAll(sel);
        } catch {
          continue;
        }

        for (const n of nodes) {
          if (!(n instanceof HTMLElement) || !isVisibleEl(n)) {
            continue;
          }

          const tag = n.tagName.toLowerCase();
          const cls =
            typeof n.className === "string"
              ? n.className.replace(/\s+/g, " ").trim().slice(0, 120)
              : "";

          if (/mat-row|cdk-row|matRow/i.test(cls) || tag === "mat-row") {
            matCdkRowLikeCount += 1;
          }

          const tx = compact(n.innerText || "").slice(0, 280);

          if (tx.length >= 12 && productishText(tx)) {
            itemLikeCount += 1;

            if (itemLikeSamples.length < 18) {
              itemLikeSamples.push({
                tag,
                class_sample: cls || null,
                text_sample: tx,
              });
            }
          }
        }
      }

      const statusNearRoot = [];

      for (const re of [
        /please wait[^.\n]{0,120}/gi,
        /add(?:ed|ing)?[^.\n]{0,80}/gi,
        /invalid[^.\n]{0,50}/gi,
        /not found[^.\n]{0,50}/gi,
      ]) {
        re.lastIndex = 0;
        let m;

        while ((m = re.exec(rootHead)) && statusNearRoot.length < 6) {
          const slice = m[0].trim().slice(0, 160);

          if (slice && !statusNearRoot.includes(slice)) {
            statusNearRoot.push(slice);
          }
        }
      }

      list_region_roots_meta.push({
        list_region_resolution: resolution,
        root_tag: el.tagName.toLowerCase(),
        root_id: el.id || null,
        root_class_sample:
          typeof el.className === "string"
            ? el.className.replace(/\s+/g, " ").trim().slice(0, 200)
            : null,
        root_visible_inner_text_length: rootText.length,
        root_inner_text_head_sample: rootHead,
        item_like_visible_count_productish_heuristic: itemLikeCount,
        mat_or_cdk_row_like_visible_count: matCdkRowLikeCount,
        item_like_text_samples: itemLikeSamples,
        status_text_near_list_root: statusNearRoot,
        list_region_populated_heuristic:
          itemLikeCount >= 1 || matCdkRowLikeCount >= 1,
      });
    }

    const list_region_any_populated = list_region_roots_meta.some(
      (x) => x.list_region_populated_heuristic === true,
    );

    const list_row_likely_present_heuristic =
      productLikeTbodySamples.length >= 1 ||
      data_row_heuristic_count >= 1 ||
      tr_count_in_largest_tbody >= 2 ||
      list_region_any_populated === true;

    return {
      page_url: window.location.href,
      bycode_canonical_path,
      milo_list_container_hypothesis:
        "bootstrap_row_sibling_columns_of_search_container_or_following_sibling_blocks",
      tenant_code_selector_used_for_list_region: tenantCodeSelector || null,
      search_container_anchor_found: searchAnchor instanceof HTMLElement,
      list_region_root_count: list_region_roots_meta.length,
      list_region_roots_readonly: list_region_roots_meta.slice(0, 6),
      list_region_any_populated_heuristic: list_region_any_populated,
      table_count_in_main: tablesInMain.length,
      tbody_count_in_main,
      tr_count_all_tbody_in_main,
      tr_count_in_largest_tbody,
      data_row_heuristic_count,
      tbody_row_text_samples: tbodyRowTextSamples.slice(0, 20),
      product_like_tbody_row_samples: productLikeTbodySamples.slice(0, 12),
      product_like_tbody_row_count: productLikeTbodySamples.length,
      loose_tr_and_role_row_samples: looseTrSamples,
      list_like_li_text_samples: liSamples,
      status_or_feedback_text_samples: statusPhrases,
      list_row_likely_present_heuristic,
      scan_read_only_no_clicks: true,
      labeling:
        "pre_cart_bycode_visible_dom_only_not_server_list_or_inventory_truth",
    };
  }, codeFieldSelector);

  let tenant_code_field_state = null;
  let tenant_quantity_field_state = null;
  const codeSel = config?.addByCodeCodeFieldSelector;
  const qtySel = config?.addByCodeQtyFieldSelector;

  if (typeof codeSel === "string" && codeSel.trim() !== "") {
    try {
      const loc = page.locator(codeSel.trim()).first();

      if ((await loc.count().catch(() => 0)) > 0) {
        tenant_code_field_state = await readFieldDomSnapshot(loc);
      }
    } catch {
      tenant_code_field_state = { resolution_error: true };
    }
  }

  if (typeof qtySel === "string" && qtySel.trim() !== "") {
    try {
      const loc = page.locator(qtySel.trim()).first();

      if ((await loc.count().catch(() => 0)) > 0) {
        tenant_quantity_field_state = await readFieldDomSnapshot(loc);
      }
    } catch {
      tenant_quantity_field_state = { resolution_error: true };
    }
  }

  const hasCode = tenant_code_field_state?.has_value === true;
  const hasQty = tenant_quantity_field_state?.has_value === true;

  let listRootOverrideReadonly = null;
  const rootSel = config?.addByCodeMiloPreCartListRootSelector;

  if (typeof rootSel === "string" && rootSel.trim() !== "") {
    try {
      listRootOverrideReadonly = await sampleMiloPreCartListRootOverrideReadonly(
        page,
        rootSel.trim(),
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);

      listRootOverrideReadonly = {
        list_root_override_selector: rootSel.trim(),
        list_root_override_error: m,
        list_root_override_populated_heuristic: false,
        scan_read_only_no_clicks: true,
      };
    }
  }

  const overridePopulated =
    listRootOverrideReadonly?.list_root_override_populated_heuristic === true;

  return {
    dom_summary: domSummary,
    list_root_override_readonly: listRootOverrideReadonly,
    tenant_code_field_state,
    tenant_quantity_field_state,
    tenant_field_both_have_values_heuristic: hasCode && hasQty,
    real_pre_cart_line_observed_heuristic:
      domSummary.list_row_likely_present_heuristic === true || overridePopulated,
  };
}

/** Default read-only cart path probes (relative to `MLCC_LOGIN_URL` origin). Bounded list. */
export const MILO_READONLY_DEFAULT_CART_PATH_CANDIDATES = [
  "/milo/cart",
  "/cart",
  "/milo/order/cart",
];

/**
 * Optional JSON array of extra path strings (each must start with `/`), max 5 entries.
 * Used with MILCC_ADD_BY_CODE_PHASE_2O_MILO_READONLY_CART_DISCOVERY_PATH_CANDIDATES.
 */
export function parsePhase2oMiloReadonlyCartDiscoveryPathCandidates(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, paths: [] };
  }
  try {
    const j = JSON.parse(String(raw));
    if (!Array.isArray(j)) {
      return { ok: false, reason: "not_json_array" };
    }
    const out = [];
    for (const x of j) {
      if (typeof x !== "string" || !x.startsWith("/")) {
        return { ok: false, reason: "each_path_must_be_string_starting_with_slash" };
      }
      out.push(x.trim().slice(0, 240));
      if (out.length >= 5) {
        break;
      }
    }
    return { ok: true, paths: out };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

/**
 * Build up to 5 absolute cart URLs: optional explicit URL first, then defaults + tenant extra paths (deduped).
 */
export function buildMiloReadonlyCartDiscoveryCandidateUrls(
  loginBaseUrl,
  explicitFullUrl,
  extraPathCandidates,
) {
  let origin;

  try {
    origin = new URL(String(loginBaseUrl || "").trim()).origin;
  } catch {
    return [];
  }

  const seen = new Set();
  const out = [];

  const push = (href) => {
    if (typeof href !== "string" || !href.trim()) {
      return;
    }
    const u = href.trim();
    if (seen.has(u)) {
      return;
    }
    seen.add(u);
    out.push(u);
  };

  if (typeof explicitFullUrl === "string" && explicitFullUrl.trim() !== "") {
    push(explicitFullUrl.trim());
  }

  const extras = Array.isArray(extraPathCandidates) ? extraPathCandidates : [];

  for (const p of [...MILO_READONLY_DEFAULT_CART_PATH_CANDIDATES, ...extras]) {
    if (out.length >= 5) {
      break;
    }
    if (typeof p !== "string" || !p.startsWith("/")) {
      continue;
    }
    try {
      push(new URL(p, origin).href);
    } catch {
      continue;
    }
  }

  return out;
}

/** True if visible cart control text must not be clicked (order/checkout paths). */
export function miloSafeCartIconTextFailsOrderSafetyFilter(combinedText) {
  return /\b(submit|place\s*order|checkout|finalize)\b/i.test(String(combinedText || ""));
}

/** MILO cart: Angular outer div with routerLink to /cart (deterministic; no geometry/SVG/heuristics). */
const MILO_CART_DIV_LOCATOR_SELECTOR =
  'div[routerlink="/cart"], div[ng-reflect-router-link="/cart"]';

const CART_RUNTIME_TOP_RIGHT_SNAPSHOT_MAX = 15;
const CART_RUNTIME_TOP_RIGHT_SCAN_CAP = 600;
const CART_RUNTIME_TOP_RIGHT_PICK_POOL_MAX = 96;

/** Hybrid cart pick: location-widget DOM/text exclusion + account-anchor X min (see evaluateBoundedTopRightCartStep). */
export const MILO_HYBRID_CART_BOUNDED_TUNING_RUN_ID = "lk-milo-hybrid-loc-account-1";

/**
 * Bounded top-right region (same query + viewport band as snapshot): collect candidates, score for hybrid cart pick, optional single click.
 * No full-page scan; pick_pool capped. When performHybridClick is false, no navigation click is attempted.
 */
async function evaluateBoundedTopRightCartStep(page, { performHybridClick, routerlinkLocatorMatchCount }) {
  return page.evaluate(
    ({
      maxSnapshotRows,
      pickPoolMax,
      scanCap,
      performHybridClick: doHybrid,
      routerlinkLocatorMatchCount: rlCount,
      hybridTuningRunId,
      hybridAccountAnchorXTolerancePx,
    }) => {
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 720;
      const rightHalfMinX = vw * 0.5;
      const upperThirdMaxY = vh / 3;

      const orderSafetyFail = (t, h) =>
        /\b(submit|place\s*order|checkout|finalize)\b/i.test(String(t || "") + String(h || ""));

      const isVis = (el) => {
        if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) {
          return false;
        }
        const st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
          return false;
        }
        const r = el.getBoundingClientRect();
        return r.width >= 2 && r.height >= 2;
      };

      const compactDomPath = (node, maxDepth = 8) => {
        if (!(node instanceof Element)) {
          return "";
        }
        const out = [];
        let cur = node;
        let depth = 0;
        while (cur && depth < maxDepth) {
          const tag = String(cur.tagName || "").toLowerCase();
          if (!tag) {
            break;
          }
          let seg = tag;
          if (cur.id) {
            seg += `#${String(cur.id).slice(0, 48)}`;
            out.unshift(seg);
            break;
          }
          const cls = String(cur.className || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .join(".");
          if (cls) {
            seg += `.${cls.slice(0, 48)}`;
          }
          const parent = cur.parentElement;
          if (parent) {
            const sibs = Array.from(parent.children).filter((x) => x.tagName === cur.tagName);
            const idx = Math.max(1, sibs.indexOf(cur) + 1);
            seg += `:nth-of-type(${idx})`;
          }
          out.unshift(seg);
          cur = parent;
          depth += 1;
        }
        return out.join(" > ");
      };

      const baseFail = (note) => ({
        bounded_model:
          "bounded_top_right_cart_region_snapshot_and_optional_hybrid_click_same_tag_list_viewport_band",
        viewport: { width: vw, height: vh },
        candidates: [],
        hybrid_pick_pool_size: 0,
        hybrid_attempt: {
          perform_hybrid_click_requested: doHybrid,
          routerlink_locator_match_count: rlCount,
          attempted: false,
          clicked: false,
          skip_reason: note,
          winner: null,
          ranked_top_for_debug: [],
        },
      });

      let nodes = [];
      try {
        nodes = Array.from(
          document.querySelectorAll("div, span, a, button, fa-layers, fa-icon, svg"),
        );
      } catch {
        return {
          ...baseFail("query_selector_all_failed"),
          scan_note: "query_selector_all_failed",
        };
      }

      const pool = [];
      let scanned = 0;
      for (const el of nodes) {
        if (scanned >= scanCap) {
          break;
        }
        scanned += 1;
        if (!isVis(el)) {
          continue;
        }
        const r = el.getBoundingClientRect();
        const centerX = r.left + r.width / 2;
        const centerY = r.top + r.height / 2;
        if (centerX < rightHalfMinX || centerY > upperThirdMaxY) {
          continue;
        }
        const st = window.getComputedStyle(el);
        const tag_name = el.tagName ? el.tagName.toLowerCase() : "";
        const htmlRaw = (el.outerHTML || "").replace(/\s+/g, " ").trim();
        const text_snippet = (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        const aria = (el.getAttribute("aria-label") || "").trim();
        const titleAttr = (el.getAttribute("title") || "").trim();
        const has_shopping_cart_svg =
          (el instanceof SVGElement && el.getAttribute("data-icon") === "shopping-cart") ||
          !!el.querySelector('svg[data-icon="shopping-cart"]');
        const distTR = Math.hypot(vw - centerX, centerY);
        pool.push({
          el,
          tag_name,
          dom_path_compact: compactDomPath(el).slice(0, 260),
          outer_html_snippet: htmlRaw.slice(0, 240),
          routerlink: el.getAttribute("routerlink") || el.getAttribute("routerLink") || null,
          ng_reflect_router_link: el.getAttribute("ng-reflect-router-link") || null,
          tabindex: el.getAttribute("tabindex"),
          cursor_style: st.cursor || null,
          onclick_present: el.hasAttribute("onclick"),
          has_shopping_cart_svg,
          bounding_rect: {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            top: r.top,
            left: r.left,
          },
          text_snippet: text_snippet || null,
          aria_label: aria || null,
          title_attr: titleAttr || null,
          centerX,
          centerY,
          distTR,
        });
      }

      pool.sort((a, b) => a.distTR - b.distTR);
      if (pool.length > pickPoolMax) {
        const cartHeavy = (row) =>
          row.has_shopping_cart_svg ||
          /shopping-cart|fa-shopping-cart|fa-cart|cart-count|cart-counter/i.test(
            row.outer_html_snippet || "",
          ) ||
          /\b(cart|basket)\b/i.test(row.text_snippet || "") ||
          /\b(cart|basket)\b/i.test(`${row.aria_label || ""} ${row.title_attr || ""}`);
        const pri = pool.filter(cartHeavy).sort((a, b) => a.distTR - b.distTR);
        const rest = pool.filter((r) => !cartHeavy(r)).sort((a, b) => a.distTR - b.distTR);
        const seen = new Set();
        const merged = [];
        for (const r of pri) {
          if (merged.length >= pickPoolMax) {
            break;
          }
          if (!seen.has(r.el)) {
            seen.add(r.el);
            merged.push(r);
          }
        }
        for (const r of rest) {
          if (merged.length >= pickPoolMax) {
            break;
          }
          if (!seen.has(r.el)) {
            seen.add(r.el);
            merged.push(r);
          }
        }
        pool.length = 0;
        merged.forEach((r) => pool.push(r));
      }

      const acctRe =
        /\b(account|profile|sign\s*in|log\s*in|samkado|user|license\s*number|choose\s*license)\b/i;
      const acctCenters = pool
        .filter((row) => acctRe.test(`${row.text_snippet || ""} ${row.outer_html_snippet || ""}`))
        .map((row) => ({ x: row.centerX, y: row.centerY }));
      let acx = vw * 0.88;
      let acy = vh * 0.06;
      if (acctCenters.length > 0) {
        acx = acctCenters.reduce((s, c) => s + c.x, 0) / acctCenters.length;
        acy = acctCenters.reduce((s, c) => s + c.y, 0) / acctCenters.length;
      }

      const tolX =
        typeof hybridAccountAnchorXTolerancePx === "number" && Number.isFinite(hybridAccountAnchorXTolerancePx)
          ? hybridAccountAnchorXTolerancePx
          : 18;

      const hybridLocationWidgetEvidence = (row) => {
        const path = String(row.dom_path_compact || "").toLowerCase();
        const html = String(row.outer_html_snippet || "").toLowerCase();
        const textBlob = `${row.text_snippet || ""} ${row.aria_label || ""} ${row.title_attr || ""}`.toLowerCase();
        if (/app-location-widget/i.test(path) || /app-location-widget/i.test(html)) {
          return "location_widget_app_location_widget_token";
        }
        if (/location__container/i.test(path) || /location__container/i.test(html)) {
          return "location_widget_location_container_class";
        }
        if (/location__text/i.test(path) || /location__text/i.test(html)) {
          return "location_widget_location_text_class";
        }
        if (/choose\s*license\s*number/i.test(textBlob)) {
          return "location_widget_choose_license_number_text";
        }
        if (/map-marker-alt/i.test(html) || /map-marker-alt/i.test(path)) {
          return "location_widget_map_marker_alt_token";
        }
        return null;
      };

      const hybridExclusionReason = (row) => {
        const loc = hybridLocationWidgetEvidence(row);
        if (loc) {
          return loc;
        }
        if (row.centerX < acx - tolX) {
          return "left_of_account_anchor_x";
        }
        return null;
      };

      const scoreRow = (row) => {
        const html = (row.outer_html_snippet || "").toLowerCase();
        const text = (row.text_snippet || "").toLowerCase();
        const ariaT = (row.aria_label || "").toLowerCase();
        const titleT = (row.title_attr || "").toLowerCase();
        let cart_hints = 0;
        if (row.has_shopping_cart_svg) {
          cart_hints += 100;
        }
        const rl = `${row.routerlink || ""} ${row.ng_reflect_router_link || ""}`;
        if (rl.includes("/cart")) {
          cart_hints += 150;
        }
        if (/\bcart\b|\bbasket\b/i.test(text)) {
          cart_hints += 45;
        }
        if (/\bcart\b|\bbasket\b/i.test(ariaT + titleT)) {
          cart_hints += 35;
        }
        if (
          /shopping-cart|fa-shopping-cart|fa-cart|cart-count|cart-counter|cart_badge|cartbadge/.test(
            html,
          )
        ) {
          cart_hints += 40;
        }
        if (orderSafetyFail(row.text_snippet, row.outer_html_snippet)) {
          cart_hints = -10000;
        }

        let clickable_hints = 0;
        if (row.cursor_style === "pointer") {
          clickable_hints += 32;
        }
        const ti = row.tabindex;
        if (ti != null && String(ti).trim() !== "" && Number(ti) >= 0) {
          clickable_hints += 18;
        }
        if (row.onclick_present) {
          clickable_hints += 18;
        }
        if (row.tag_name === "a" || row.tag_name === "button") {
          clickable_hints += 28;
        }
        if (row.tag_name === "fa-icon" || row.tag_name === "fa-layers") {
          clickable_hints += 12;
        }

        const dist_account_px = Math.hypot(row.centerX - acx, row.centerY - acy);
        const dist_top_right_px = Math.round(row.distTR * 100) / 100;

        return {
          cart_hints,
          clickable_hints,
          dist_account_px: Math.round(dist_account_px * 100) / 100,
          dist_top_right_px,
        };
      };

      const qualifies = (row, sc) => {
        if (sc.cart_hints < 0) {
          return false;
        }
        if (row.has_shopping_cart_svg) {
          return sc.clickable_hints >= 12;
        }
        if (sc.cart_hints >= 100) {
          return sc.clickable_hints >= 18;
        }
        if (sc.cart_hints >= 80) {
          return sc.clickable_hints >= 22;
        }
        return sc.cart_hints >= 35 && sc.clickable_hints >= 30;
      };

      const ranked = pool.map((row) => {
        const hybrid_score_breakdown = scoreRow(row);
        return { row, hybrid_score_breakdown };
      });
      ranked.sort((A, B) => {
        const a = A.hybrid_score_breakdown;
        const b = B.hybrid_score_breakdown;
        if (b.cart_hints !== a.cart_hints) {
          return b.cart_hints - a.cart_hints;
        }
        if (b.clickable_hints !== a.clickable_hints) {
          return b.clickable_hints - a.clickable_hints;
        }
        if (a.dist_account_px !== b.dist_account_px) {
          return a.dist_account_px - b.dist_account_px;
        }
        return a.dist_top_right_px - b.dist_top_right_px;
      });

      const serializeCandidate = (rec, includeScores) => {
        const { row } = rec;
        const base = {
          tag_name: row.tag_name,
          dom_path_compact: row.dom_path_compact,
          outer_html_snippet: row.outer_html_snippet,
          routerlink: row.routerlink,
          ng_reflect_router_link: row.ng_reflect_router_link,
          tabindex: row.tabindex,
          cursor_style: row.cursor_style,
          onclick_present: row.onclick_present,
          has_shopping_cart_svg: row.has_shopping_cart_svg,
          bounding_rect: row.bounding_rect,
          text_snippet: row.text_snippet,
          aria_label: row.aria_label,
          title_attr: row.title_attr,
          distance_to_top_right_px: rec.hybrid_score_breakdown.dist_top_right_px,
        };
        return includeScores ? { ...base, hybrid_score_breakdown: rec.hybrid_score_breakdown } : base;
      };

      const snapshotRows = pool
        .map((row) => {
          const hybrid_score_breakdown = scoreRow(row);
          return { row, hybrid_score_breakdown };
        })
        .sort((a, b) => a.row.distTR - b.row.distTR)
        .slice(0, maxSnapshotRows)
        .map((rec) => serializeCandidate(rec, true));

      const rankedTop = ranked.slice(0, 8).map((rec) => {
        const parts = [
          `cart_hints=${rec.hybrid_score_breakdown.cart_hints}`,
          `clickable=${rec.hybrid_score_breakdown.clickable_hints}`,
          `dist_acct=${rec.hybrid_score_breakdown.dist_account_px}`,
          `dist_tr=${rec.hybrid_score_breakdown.dist_top_right_px}`,
        ];
        const locOrAnchorEx = hybridExclusionReason(rec.row);
        const orderFail = orderSafetyFail(rec.row.text_snippet, rec.row.outer_html_snippet);
        const qualifiesRow = qualifies(rec.row, rec.hybrid_score_breakdown);
        let exclusion_reason = locOrAnchorEx;
        if (!exclusion_reason && orderFail) {
          exclusion_reason = "order_safety_filter";
        }
        if (!exclusion_reason && !qualifiesRow) {
          exclusion_reason = "legacy_cart_clickable_qualification_failed";
        }
        return {
          tag_name: rec.row.tag_name,
          dom_path_compact: rec.row.dom_path_compact.slice(0, 120),
          hybrid_score_breakdown: rec.hybrid_score_breakdown,
          sort_key_summary: parts.join(";"),
          hybrid_eligible: !locOrAnchorEx && qualifiesRow && !orderFail,
          exclusion_reason: exclusion_reason || null,
          excluded: exclusion_reason != null,
        };
      });

      const hybrid_attempt = {
        hybrid_bounded_tuning_run_id: hybridTuningRunId,
        hybrid_account_anchor_x_tolerance_px: tolX,
        hybrid_location_widget_exclusion_patterns:
          "app-location-widget|location__container|location__text|choose_license_number_text|map-marker-alt",
        perform_hybrid_click_requested: doHybrid,
        routerlink_locator_match_count: rlCount,
        account_cluster_anchor_px: { x: Math.round(acx * 100) / 100, y: Math.round(acy * 100) / 100 },
        account_cluster_source:
          acctCenters.length > 0 ? "runtime_candidates_matching_account_profile_license_heuristic" : "viewport_upper_right_fallback",
        attempted: false,
        clicked: false,
        skip_reason: null,
        click_throw_message: null,
        winner: null,
        why_won: null,
        priority_order_used:
          "1_cart_hints_2_clickable_hints_3_dist_account_4_dist_top_right_within_bounded_pool_then_5_location_widget_exclusion_6_account_anchor_x_min",
        ranked_top_for_debug: rankedTop,
      };

      if (!doHybrid) {
        hybrid_attempt.skip_reason = rlCount > 0 ? null : "hybrid_not_requested";
        hybrid_attempt.note_when_skipped =
          rlCount > 0
            ? "routerlink_locator_match_count_gt_zero_playwright_click_used_instead"
            : "hybrid_disabled_unexpected_zero_routerlink_branch";
        return {
          bounded_model:
            "bounded_top_right_cart_region_snapshot_and_optional_hybrid_click_same_tag_list_viewport_band",
          viewport: { width: vw, height: vh },
          nodes_scanned: scanned,
          candidates: snapshotRows,
          hybrid_pick_pool_size: pool.length,
          hybrid_attempt,
        };
      }

      hybrid_attempt.attempted = true;
      if (pool.length === 0) {
        hybrid_attempt.skip_reason = "bounded_region_empty_no_candidates";
        return {
          bounded_model:
            "bounded_top_right_cart_region_snapshot_and_optional_hybrid_click_same_tag_list_viewport_band",
          viewport: { width: vw, height: vh },
          nodes_scanned: scanned,
          candidates: snapshotRows,
          hybrid_pick_pool_size: 0,
          hybrid_attempt,
        };
      }

      let bestRec = null;
      for (const rec of ranked) {
        const exR = hybridExclusionReason(rec.row);
        if (exR) {
          continue;
        }
        if (!qualifies(rec.row, rec.hybrid_score_breakdown)) {
          continue;
        }
        if (orderSafetyFail(rec.row.text_snippet, rec.row.outer_html_snippet)) {
          continue;
        }
        bestRec = rec;
        break;
      }

      if (!bestRec) {
        const topRaw = ranked[0];
        const topEx = topRaw ? hybridExclusionReason(topRaw.row) : null;
        const topQual = topRaw ? qualifies(topRaw.row, topRaw.hybrid_score_breakdown) : false;
        const topOrderFail = topRaw
          ? orderSafetyFail(topRaw.row.text_snippet, topRaw.row.outer_html_snippet)
          : false;
        hybrid_attempt.skip_reason = "bounded_hybrid_no_qualified_winner";
        hybrid_attempt.winner = null;
        hybrid_attempt.top_ranked_after_sort_unusable = topRaw
          ? {
              dom_path_compact: topRaw.row.dom_path_compact.slice(0, 160),
              tag_name: topRaw.row.tag_name,
              exclusion_reason: topEx,
              qualifies_legacy_cart_clickable: topQual,
              order_safety_fail: topOrderFail,
            }
          : null;
        return {
          bounded_model:
            "bounded_top_right_cart_region_snapshot_and_optional_hybrid_click_same_tag_list_viewport_band",
          viewport: { width: vw, height: vh },
          nodes_scanned: scanned,
          candidates: snapshotRows,
          hybrid_pick_pool_size: pool.length,
          hybrid_attempt,
        };
      }

      const best = bestRec.row;
      const bestSc = bestRec.hybrid_score_breakdown;

      try {
        best.el.click();
        hybrid_attempt.clicked = true;
        hybrid_attempt.winner = {
          tag_name: best.tag_name,
          dom_path_compact: best.dom_path_compact,
          outer_html_snippet: best.outer_html_snippet.slice(0, 200),
          text_snippet: best.text_snippet,
          aria_label: best.aria_label,
          title_attr: best.title_attr,
          has_shopping_cart_svg: best.has_shopping_cart_svg,
          routerlink: best.routerlink,
          ng_reflect_router_link: best.ng_reflect_router_link,
          bounding_rect: best.bounding_rect,
          hybrid_score_breakdown: bestSc,
        };
        const wParts = [];
        if (best.has_shopping_cart_svg) {
          wParts.push("shopping_cart_svg");
        }
        if (String(best.routerlink || best.ng_reflect_router_link || "").includes("/cart")) {
          wParts.push("routerlink_cart_attr_on_bounded_node");
        }
        if (/\bcart\b|\bbasket\b/i.test(`${best.text_snippet || ""} ${best.aria_label || ""}`)) {
          wParts.push("text_or_aria_cart_lexical");
        }
        if (/shopping-cart|fa-shopping-cart|fa-cart/i.test(best.outer_html_snippet || "")) {
          wParts.push("html_cart_icon_token");
        }
        wParts.push(`clickable_hints=${bestSc.clickable_hints}`);
        wParts.push(`nearest_account_cluster_px=${bestSc.dist_account_px}`);
        wParts.push(`dist_top_right_px=${bestSc.dist_top_right_px}`);
        wParts.push(
          `centerX=${Math.round(best.centerX * 100) / 100}>=account_anchor_x_minus_tol=${Math.round((acx - tolX) * 100) / 100}`,
        );
        wParts.push("passed_hybrid_location_widget_exclusion_and_account_anchor_x_eligibility");
        hybrid_attempt.why_won = `First hybrid-eligible candidate in bounded pool after ${hybrid_attempt.priority_order_used}: ${wParts.join(", ")}`;
      } catch (e) {
        hybrid_attempt.skip_reason = "bounded_hybrid_dom_click_threw";
        hybrid_attempt.click_throw_message = e instanceof Error ? e.message : String(e);
      }

      return {
        bounded_model:
          "bounded_top_right_cart_region_snapshot_and_optional_hybrid_click_same_tag_list_viewport_band",
        viewport: { width: vw, height: vh },
        nodes_scanned: scanned,
        candidates: snapshotRows,
        hybrid_pick_pool_size: pool.length,
        hybrid_attempt,
      };
    },
    {
      maxSnapshotRows: CART_RUNTIME_TOP_RIGHT_SNAPSHOT_MAX,
      pickPoolMax: CART_RUNTIME_TOP_RIGHT_PICK_POOL_MAX,
      scanCap: CART_RUNTIME_TOP_RIGHT_SCAN_CAP,
      performHybridClick,
      routerlinkLocatorMatchCount: routerlinkLocatorMatchCount,
      hybridTuningRunId: MILO_HYBRID_CART_BOUNDED_TUNING_RUN_ID,
      hybridAccountAnchorXTolerancePx: 18,
    },
  );
}

function buildCartClickDebugWithSnapshot(visibility, action) {
  return {
    cart_runtime_top_right_snapshot: visibility,
    cart_click_attempt: action,
    ...action,
  };
}

/** Bounded MILO cart-open intent router manifest (evidence correlation). */
export const MILO_OPEN_CART_INTENT_ROUTER_RUN_ID = "lk-milo-open-cart-intent-router-1";

const MILO_OPEN_CART_STRATEGY_ORDER = [
  "exact_routerlink_cart_div",
  "bounded_top_right_hybrid_cart_evidence",
  "bounded_route_goto_fallback",
];

/**
 * Compact read-only page fingerprint for cart-open verification (no clicks).
 * Fields align with downstream cart surface heuristics where possible.
 */
export async function captureMiloCartOpenPageFingerprint(page) {
  return page.evaluate(() => {
    const isVis = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    };

    const matchesValidateIntent = (inner, aria, title, valueAttr, href) => {
      const t = `${inner} ${aria} ${title} ${valueAttr}`.toLowerCase();
      if (/\bvalidate\b/i.test(t)) {
        return true;
      }
      const h = String(href ?? "").trim().toLowerCase();
      if (!h) {
        return false;
      }
      if (
        /checkout|order\/submit|place-order|submit-order|finalize|cart\/add|add-to-cart|addtocart/i.test(
          h,
        )
      ) {
        return false;
      }
      if (/\bvalidate\b|\/validate|validateorder|validate-order/i.test(h)) {
        return true;
      }
      return false;
    };

    const checkoutLike = (text, href) => {
      const hay = `${text} ${href}`.toLowerCase();
      return [
        /\bcheckout\b/i,
        /place\s*order/i,
        /submit\s*order/i,
        /complete\s*(order|purchase)/i,
        /confirm\s*order/i,
        /buy\s*now/i,
        /\bfinalize\b/i,
        /\bpurchase\b/i,
        /proceed\s+to\s+checkout/i,
        /continue\s+to\s+checkout/i,
      ].some((re) => re.test(hay));
    };

    const forbiddenLabel = (text) =>
      [/add\s*to\s*cart/i, /add\s*all/i, /update\s*cart/i].some((re) => re.test(String(text ?? "")));

    let tbodyTr2 = 0;
    for (const tr of document.querySelectorAll("tbody tr")) {
      if (isVis(tr) && tr.querySelectorAll("td").length >= 2) {
        tbodyTr2 += 1;
      }
    }
    let matCdk = 0;
    for (const el of document.querySelectorAll(
      "mat-row, [class*=\"mat-row\" i], [class*=\"cdk-row\" i]",
    )) {
      if (isVis(el)) {
        matCdk += 1;
      }
    }
    const cart_like_row_count_heuristic = Math.max(tbodyTr2, matCdk);

    const rawBody = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const major_text_head = rawBody.slice(0, 400);

    const navbarBits = [];
    const navSelectors = ['mat-toolbar', "header", '[role="banner"]', "nav"];
    for (const sel of navSelectors) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of nodes) {
        if (!(el instanceof HTMLElement) || !isVis(el)) {
          continue;
        }
        const r = el.getBoundingClientRect();
        if (r.top > 140) {
          continue;
        }
        const t = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 100);
        if (t) {
          navbarBits.push(`${sel}:${t.slice(0, 72)}`);
        }
        if (navbarBits.length >= 10) {
          break;
        }
      }
      if (navbarBits.length >= 10) {
        break;
      }
    }
    const navbar_region_summary = navbarBits.join(" | ").slice(0, 480);

    let validate_shaped_visible_count = 0;
    const selList = [
      "button",
      "a[href]",
      "[role=\"button\"]",
      "input[type=\"submit\"]",
      "input[type=\"button\"]",
    ];
    domscan: for (const sel of selList) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of nodes) {
        if (!(el instanceof HTMLElement) || !isVis(el)) {
          continue;
        }
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        const inner = (el.innerText || el.textContent || "").trim();
        const aria = (el.getAttribute("aria-label") || "").trim();
        const title = (el.getAttribute("title") || "").trim();
        const valAttr = tag === "input" ? String(el.value || "").trim() : "";
        const href = tag === "a" ? String(el.getAttribute("href") || "").trim() : "";
        const primaryText = inner || aria || title || valAttr;
        if (forbiddenLabel(primaryText) || checkoutLike(primaryText, href)) {
          continue;
        }
        if (matchesValidateIntent(inner, aria, title, valAttr, href)) {
          validate_shaped_visible_count += 1;
        }
        if (validate_shaped_visible_count >= 48) {
          break domscan;
        }
      }
    }

    const deliveryGroupingSignals = [
      { label: "delivery", re: /\bdelivery\b/i },
      { label: "pickup", re: /\bpickup\b/i },
      { label: "date", re: /\b(date|scheduled|schedule|window)\b/i },
      { label: "grouping", re: /\b(group|route|stop|driver|address)\b/i },
    ];
    const delivery_grouping_hits = deliveryGroupingSignals
      .filter((s) => s.re.test(rawBody))
      .map((s) => s.label);
    const delivery_grouping_visible = delivery_grouping_hits.length > 0;

    return {
      capture_model: "milo_cart_open_compact_fingerprint_v1",
      page_url: window.location.href,
      document_title: document.title || null,
      major_text_head,
      navbar_region_summary,
      cart_like_row_count_heuristic,
      validate_shaped_visible_count,
      delivery_grouping_visible,
      delivery_grouping_hits,
    };
  });
}

export function verifyMiloCartOpenAttempt({ preFp, postFp, postUrl }) {
  const urlOk = typeof postUrl === "string" && postUrl.includes("/cart");
  if (urlOk) {
    return {
      verified: true,
      via: "url_includes_cart",
      reason: "post_action_url_includes_cart_path_segment",
    };
  }
  if (!preFp || !postFp) {
    return {
      verified: false,
      via: null,
      reason: "missing_pre_or_post_fingerprint",
    };
  }
  const rowPre = Number(preFp.cart_like_row_count_heuristic || 0);
  const rowPost = Number(postFp.cart_like_row_count_heuristic || 0);
  const valPre = Number(preFp.validate_shaped_visible_count || 0);
  const valPost = Number(postFp.validate_shaped_visible_count || 0);
  const rowDelta = rowPost - rowPre;
  const valDelta = valPost - valPre;
  const delPre = preFp.delivery_grouping_visible === true;
  const delPost = postFp.delivery_grouping_visible === true;

  if (rowDelta >= 1 || valDelta >= 1 || (!delPre && delPost)) {
    return {
      verified: true,
      via: "fingerprint_cart_like_progression",
      reason: "cart_surface_fingerprint_shifted_in_cart_like_direction_vs_pre_action",
      fingerprint_delta_summary: {
        cart_like_row_count_delta: rowDelta,
        validate_shaped_visible_delta: valDelta,
        delivery_grouping_emerged: !delPre && delPost,
      },
    };
  }

  const titlePost = String(postFp.document_title || "").toLowerCase();
  const titlePre = String(preFp.document_title || "").toLowerCase();
  const cartLex = /\bcart\b|\bbasket\b/i;
  if (cartLex.test(titlePost) && !cartLex.test(titlePre)) {
    return {
      verified: true,
      via: "fingerprint_cart_like_progression",
      reason: "document_title_gained_cart_or_basket_lexeme_vs_pre_action",
    };
  }

  return {
    verified: false,
    via: null,
    reason: "url_not_cart_and_no_bounded_positive_fingerprint_delta_vs_pre_action",
    fingerprint_delta_summary: {
      cart_like_row_count_delta: rowDelta,
      validate_shaped_visible_delta: valDelta,
      delivery_grouping_emerged: !delPre && delPost,
    },
  };
}

/**
 * Safe cart navigation (MILO): layered open_cart intent router — exact routerlink div, bounded
 * top-right hybrid with cart evidence, then optional bounded route goto only after UI paths fail
 * verification. Per-strategy pre/post fingerprints and explicit UI vs route success flags.
 * No validate/checkout/submit/finalize clicks.
 */
export async function runMiloSafeHeaderCartIconClickReadonly({
  page,
  settleMs,
  guardStats,
  evidenceCollected,
  buildEvidence,
  safeFlowShot = null,
  cartRouteFallbackUrls = null,
}) {
  const preUrl = page.url();
  const routerRunId = MILO_OPEN_CART_INTENT_ROUTER_RUN_ID;
  const fallbackUrlsBounded = Array.isArray(cartRouteFallbackUrls)
    ? cartRouteFallbackUrls.filter((u) => typeof u === "string" && u.trim() !== "").slice(0, 5)
    : [];

  let visibilityPayload = null;
  const openCartAttempts = [];
  let ui_cart_open_attempted = false;
  let ui_cart_open_succeeded = false;
  let fallback_route_probe_used = false;
  let winningStrategy = null;
  let clickResolution = null;
  let postSettleUrl = preUrl;
  let locator_match_count = 0;
  let url_before = preUrl;
  let cart_click_debug = null;
  let cart_icon_navigation_debug = null;
  let postSuccessFingerprint = null;

  const readBlocked = () =>
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const settleAfterNavigation = async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await new Promise((res) => setTimeout(res, settleMs));
  };

  const waitForCartUrl = async () => {
    try {
      await page.waitForURL((u) => u.href.includes("/cart"), { timeout: 10_000 });
    } catch {
      /* settled below */
    }
  };

  const assertLayer2Quiet = async (blockedBeforeAttempt, clickResolutionLabel) => {
    const blockedAfter = readBlocked();
    const delta =
      blockedBeforeAttempt != null && blockedAfter != null
        ? blockedAfter - blockedBeforeAttempt
        : null;
    if (delta !== null && delta !== 0) {
      const msg = `MILO safe cart icon: Layer 2 blocked request counter changed after cart-open action (delta=${delta})`;
      const safeModeFailureForensics =
        await collectSafeModeFailureEvidencePack(page, {
          screenshotMaxBytes: 200_000,
          excerptMaxChars: 12_000,
        }).catch(() => ({ page_available: false, forensics_error: true }));

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_milo_safe_cart_icon_blocked_layer2",
          message: msg,
          attributes: {
            click_resolution: clickResolutionLabel,
            pre_navigation_url: preUrl,
            post_click_url: page.url(),
            cart_runtime_top_right_snapshot: visibilityPayload,
            cart_click_debug,
            cart_icon_navigation_debug,
            milo_open_cart_intent_router: {
              run_id: routerRunId,
              strategy_order: MILO_OPEN_CART_STRATEGY_ORDER,
              attempts: openCartAttempts,
              ui_cart_open_attempted,
              ui_cart_open_succeeded,
              fallback_route_probe_used,
            },
            network_guard_blocked_before_click: blockedBeforeAttempt,
            network_guard_blocked_after_click: blockedAfter,
            network_guard_delta: delta,
            safe_mode_failure_forensics: safeModeFailureForensics,
          },
        }),
      );
      const layer2Err = new Error(msg);
      layer2Err.mlcc_safe_cart_output_plumbing = {
        cart_runtime_top_right_snapshot: visibilityPayload,
        cart_click_debug,
        cart_icon_navigation_debug,
        click_resolution: clickResolutionLabel,
      };
      throw layer2Err;
    }
    return delta;
  };

  const cartLoc = page.locator(MILO_CART_DIV_LOCATOR_SELECTOR);
  locator_match_count = await cartLoc.count().catch(() => 0);
  url_before = page.url();

  const pushAttempt = (row) => {
    openCartAttempts.push(row);
  };

  /** A — exact direct cart control */
  if (locator_match_count > 0) {
    ui_cart_open_attempted = true;
    const blockedBeforeA = readBlocked();
    const preActionFp = await captureMiloCartOpenPageFingerprint(page).catch(() => null);
    const boundedPackA = await evaluateBoundedTopRightCartStep(page, {
      performHybridClick: false,
      routerlinkLocatorMatchCount: locator_match_count,
    }).catch(() => ({
      bounded_model: "bounded_top_right_cart_step_evaluate_failed",
      viewport: null,
      candidates: [],
      hybrid_pick_pool_size: 0,
      hybrid_attempt: {
        perform_hybrid_click_requested: false,
        routerlink_locator_match_count: locator_match_count,
        attempted: false,
        clicked: false,
        skip_reason: "bounded_cart_step_evaluate_failed",
        winner: null,
        ranked_top_for_debug: [],
      },
      scan_note: "snapshot_evaluate_failed",
    }));
    visibilityPayload = boundedPackA;

    let clickError = null;
    let clickPerformed = false;
    try {
      await cartLoc.first().click({ force: true, timeout: 12_000 });
      clickPerformed = true;
      if (typeof safeFlowShot === "function") {
        await safeFlowShot("after_safe_cart_click_attempt", "mlcc_after_safe_cart_click.png");
      }
    } catch (reason) {
      clickError = reason instanceof Error ? reason.message : String(reason);
    }

    await waitForCartUrl();
    await settleAfterNavigation();
    postSettleUrl = page.url();
    const postFp = await captureMiloCartOpenPageFingerprint(page).catch(() => null);
    const verification = clickPerformed
      ? verifyMiloCartOpenAttempt({
          preFp: preActionFp,
          postFp,
          postUrl: postSettleUrl,
        })
      : {
          verified: false,
          via: null,
          reason: "playwright_click_threw_before_navigation",
        };

    const deltaA = await assertLayer2Quiet(
      blockedBeforeA,
      "milo_open_cart_strategy_a_exact_routerlink",
    );

    pushAttempt({
      strategy: MILO_OPEN_CART_STRATEGY_ORDER[0],
      target_summary: `${MILO_CART_DIV_LOCATOR_SELECTOR} count=${locator_match_count} first()`,
      ui_cart_open_attempted: true,
      ui_cart_open_succeeded: verification.verified === true,
      verification,
      pre_action_fingerprint: preActionFp,
      post_action_fingerprint: postFp,
      click_performed: clickPerformed,
      click_error: clickError,
      fallback_proceeded: verification.verified !== true,
      network_guard_delta: deltaA,
    });

    if (verification.verified === true) {
      ui_cart_open_succeeded = true;
      winningStrategy = MILO_OPEN_CART_STRATEGY_ORDER[0];
      clickResolution = "milo_div_routerlink_cart_direct_minimal";
      postSuccessFingerprint = postFp;
    }
  }

  /** B — bounded top-right hybrid (only when A did not verify) */
  if (!ui_cart_open_succeeded) {
    ui_cart_open_attempted = true;
    const blockedBeforeB = readBlocked();
    const preActionFpB = await captureMiloCartOpenPageFingerprint(page).catch(() => null);
    const boundedPackB = await evaluateBoundedTopRightCartStep(page, {
      performHybridClick: true,
      routerlinkLocatorMatchCount: locator_match_count,
    }).catch(() => ({
      bounded_model: "bounded_top_right_cart_step_evaluate_failed",
      viewport: null,
      candidates: [],
      hybrid_pick_pool_size: 0,
      hybrid_attempt: {
        perform_hybrid_click_requested: true,
        routerlink_locator_match_count: locator_match_count,
        attempted: false,
        clicked: false,
        skip_reason: "bounded_cart_step_evaluate_failed",
        winner: null,
        ranked_top_for_debug: [],
      },
      scan_note: "snapshot_evaluate_failed",
    }));
    visibilityPayload = boundedPackB;
    const hybridMetaB = boundedPackB.hybrid_attempt || {};
    const usedHybridRuntimeClick = hybridMetaB.clicked === true;

    if (usedHybridRuntimeClick && typeof safeFlowShot === "function") {
      await safeFlowShot("after_safe_cart_click_attempt", "mlcc_after_safe_cart_click.png");
    }

    await waitForCartUrl();
    await settleAfterNavigation();
    postSettleUrl = page.url();
    const postFpB = await captureMiloCartOpenPageFingerprint(page).catch(() => null);

    let verificationB;
    if (!usedHybridRuntimeClick) {
      const skipReason =
        hybridMetaB.skip_reason ||
        (hybridMetaB.attempted ? "bounded_hybrid_no_qualified_winner" : "hybrid_not_attempted");
      verificationB = {
        verified: false,
        via: null,
        reason: `bounded_hybrid_did_not_perform_dom_click:${skipReason}`,
      };
    } else {
      verificationB = verifyMiloCartOpenAttempt({
        preFp: preActionFpB,
        postFp: postFpB,
        postUrl: postSettleUrl,
      });
    }

    const deltaB = await assertLayer2Quiet(
      blockedBeforeB,
      "milo_open_cart_strategy_b_bounded_hybrid",
    );

    const winnerSummary = hybridMetaB.winner
      ? `${hybridMetaB.winner.tag_name} ${(hybridMetaB.winner.dom_path_compact || "").slice(0, 140)}`
      : null;

    pushAttempt({
      strategy: MILO_OPEN_CART_STRATEGY_ORDER[1],
      target_summary: winnerSummary || "bounded_top_right_pool_no_winner",
      ui_cart_open_attempted: true,
      ui_cart_open_succeeded: verificationB.verified === true,
      verification: verificationB,
      pre_action_fingerprint: preActionFpB,
      post_action_fingerprint: postFpB,
      hybrid_attempt: hybridMetaB,
      fallback_proceeded: verificationB.verified !== true && fallbackUrlsBounded.length > 0,
      network_guard_delta: deltaB,
    });

    if (verificationB.verified === true) {
      ui_cart_open_succeeded = true;
      winningStrategy = MILO_OPEN_CART_STRATEGY_ORDER[1];
      clickResolution = "milo_bounded_top_right_hybrid_scored_cart_click";
      postSuccessFingerprint = postFpB;
    }
  }

  /** C — bounded route goto only after UI verification failed */
  if (!ui_cart_open_succeeded && fallbackUrlsBounded.length > 0) {
    fallback_route_probe_used = true;
    let routeVerified = false;
    for (let i = 0; i < fallbackUrlsBounded.length; i++) {
      const href = fallbackUrlsBounded[i];
      const blockedBeforeC = readBlocked();
      const preActionFpC = await captureMiloCartOpenPageFingerprint(page).catch(() => null);
      let gotoOk = false;
      let gotoErr = null;
      try {
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45_000 });
        gotoOk = true;
      } catch (ge) {
        gotoErr = ge instanceof Error ? ge.message : String(ge);
      }
      await waitForCartUrl();
      await settleAfterNavigation();
      postSettleUrl = page.url();
      const postFpC = await captureMiloCartOpenPageFingerprint(page).catch(() => null);
      const verificationC = gotoOk
        ? verifyMiloCartOpenAttempt({
            preFp: preActionFpC,
            postFp: postFpC,
            postUrl: postSettleUrl,
          })
        : {
            verified: false,
            via: null,
            reason: "page_goto_threw",
            goto_error: gotoErr,
          };

      const deltaC = await assertLayer2Quiet(
        blockedBeforeC,
        "milo_open_cart_strategy_c_route_goto",
      );

      const moreUrls = i < fallbackUrlsBounded.length - 1;
      pushAttempt({
        strategy: MILO_OPEN_CART_STRATEGY_ORDER[2],
        target_summary: `goto ${href}`,
        ui_cart_open_attempted: false,
        ui_cart_open_succeeded: false,
        route_goto_fallback_attempt: true,
        verification: verificationC,
        pre_action_fingerprint: preActionFpC,
        post_action_fingerprint: postFpC,
        fallback_proceeded: verificationC.verified !== true && moreUrls,
        goto_ok: gotoOk,
        goto_error: gotoErr,
        network_guard_delta: deltaC,
      });

      if (verificationC.verified === true) {
        routeVerified = true;
        winningStrategy = MILO_OPEN_CART_STRATEGY_ORDER[2];
        clickResolution = "milo_bounded_cart_route_goto_fallback";
        postSuccessFingerprint = postFpC;
        break;
      }
    }
    if (!routeVerified) {
      postSettleUrl = page.url();
    }
  }

  const hybridMetaFinal = visibilityPayload?.hybrid_attempt || {};
  const actionBase = {
    intent: "open_cart",
    run_id: routerRunId,
    strategy_order: MILO_OPEN_CART_STRATEGY_ORDER,
    winning_strategy: winningStrategy,
    locator_selector: MILO_CART_DIV_LOCATOR_SELECTOR,
    locator_match_count,
    url_before,
    hybrid_attempt: hybridMetaFinal,
    hybrid_chosen_candidate_summary: hybridMetaFinal.winner ?? null,
    hybrid_why_won: hybridMetaFinal.why_won ?? null,
    ui_cart_open_attempted,
    ui_cart_open_succeeded,
    fallback_route_probe_used,
    open_cart_strategy_attempts: openCartAttempts,
  };

  const reached_cart_page = postSettleUrl.includes("/cart");
  const navigation_detected = postSettleUrl !== url_before;
  const performed = winningStrategy != null;
  const real_ui_cart_click_succeeded = ui_cart_open_succeeded === true;

  cart_icon_navigation_debug = {
    url_before_click: url_before,
    url_after_click: postSettleUrl,
    navigation_detected,
    cart_page_reached: reached_cart_page,
    real_ui_cart_click_succeeded,
    ui_cart_open_attempted,
    ui_cart_open_succeeded,
    fallback_route_probe_used,
  };

  cart_click_debug = buildCartClickDebugWithSnapshot(visibilityPayload, {
    ...actionBase,
    url_after: postSettleUrl,
    skip_reason: performed ? null : "open_cart_intent_router_exhausted",
    click_performed: ui_cart_open_succeeded,
    navigation_detected,
    reached_cart_page,
    click_error: null,
  });

  const networkDeltaFinal = readBlocked();

  if (!performed) {
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_milo_open_cart_intent_router_exhausted",
        message:
          "MILO open_cart intent router: all strategies failed verification (read-only; no validate/checkout/submit)",
        attributes: {
          pre_navigation_url: preUrl,
          no_validate_checkout_submit_finalize: true,
          milo_open_cart_intent_router: {
            run_id: routerRunId,
            strategy_order: MILO_OPEN_CART_STRATEGY_ORDER,
            attempts: openCartAttempts,
            ui_cart_open_attempted,
            ui_cart_open_succeeded,
            fallback_route_probe_used,
            post_success_fingerprint: postSuccessFingerprint,
          },
          cart_runtime_top_right_snapshot: visibilityPayload,
          cart_click_debug,
        },
      }),
    );
    return {
      performed: false,
      pre_url: preUrl,
      error_reason: "open_cart_intent_router_exhausted",
      skip_reason: "open_cart_intent_router_exhausted",
      cart_runtime_top_right_snapshot: visibilityPayload,
      cart_click_debug,
      cart_icon_navigation_debug,
      real_ui_cart_click_succeeded: false,
      ui_cart_open_attempted,
      ui_cart_open_succeeded: false,
      fallback_route_probe_used,
      milo_open_cart_intent_router: {
        run_id: routerRunId,
        strategy_order: MILO_OPEN_CART_STRATEGY_ORDER,
        attempts: openCartAttempts,
      },
    };
  }

  if (typeof safeFlowShot === "function") {
    await safeFlowShot("after_cart_navigation_settle", "mlcc_cart_settled.png");
  }

  const blockedAfterSuccess =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;
  const deltaSummary =
    openCartAttempts.length > 0
      ? openCartAttempts[openCartAttempts.length - 1].network_guard_delta
      : null;

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_milo_safe_cart_icon_clicked",
      message:
        winningStrategy === MILO_OPEN_CART_STRATEGY_ORDER[2]
          ? "MILO open_cart: bounded route goto fallback succeeded after UI strategies did not verify (read-only)"
          : winningStrategy === MILO_OPEN_CART_STRATEGY_ORDER[1]
            ? "MILO open_cart: bounded top-right hybrid scored click verified (wait/settle)"
            : "MILO open_cart: div[routerlink|ng-reflect=\"/cart\"].first() verified (wait/settle)",
      attributes: {
        click_resolution: clickResolution,
        pre_navigation_url: preUrl,
        post_click_url: postSettleUrl,
        cart_runtime_top_right_snapshot: visibilityPayload,
        cart_click_debug,
        cart_icon_navigation_debug,
        settle_ms_after_click_used: settleMs,
        network_guard_blocked_after_success: blockedAfterSuccess,
        network_guard_delta_last_strategy: deltaSummary,
        no_validate_checkout_submit_finalize: true,
        milo_open_cart_intent_router: {
          run_id: routerRunId,
          strategy_order: MILO_OPEN_CART_STRATEGY_ORDER,
          attempts: openCartAttempts,
          ui_cart_open_attempted,
          ui_cart_open_succeeded,
          fallback_route_probe_used,
          winning_strategy: winningStrategy,
          post_success_fingerprint: postSuccessFingerprint,
        },
      },
    }),
  );

  return {
    performed: true,
    pre_url: preUrl,
    post_click_url: postSettleUrl,
    click_resolution: clickResolution,
    cart_runtime_top_right_snapshot: visibilityPayload,
    cart_click_debug,
    cart_icon_navigation_debug,
    network_guard_delta_during_safe_cart_icon: deltaSummary,
    real_ui_cart_click_succeeded,
    ui_cart_open_attempted,
    ui_cart_open_succeeded,
    fallback_route_probe_used,
    milo_open_cart_intent_router: {
      run_id: routerRunId,
      strategy_order: MILO_OPEN_CART_STRATEGY_ORDER,
      attempts: openCartAttempts,
      winning_strategy: winningStrategy,
    },
  };
}


function scoreMiloReadonlyCartRouteAttempt(rawScan) {
  if (!rawScan || typeof rawScan !== "object") {
    return 0;
  }
  const s = rawScan.cart_surface_state && typeof rawScan.cart_surface_state === "object"
    ? rawScan.cart_surface_state
    : {};
  let sc = 0;
  sc += Math.min(90, Number(s.data_row_heuristic_count || 0) * 12);
  if (s.line_items_likely_present_heuristic === true) {
    sc += 40;
  }
  sc += Math.min(28, Number(s.document_wide_tbody_tr_two_td_visible_count || 0) * 4);
  sc += Math.min(28, Number(s.document_wide_mat_or_cdk_row_visible_count || 0) * 4);
  const tops = s.body_wide_cart_like_top_candidates;
  if (Array.isArray(tops) && tops.length > 0) {
    sc += Math.min(28, Number(tops[0]?.cart_like_composite_score || 0));
  }
  const visVal = Array.isArray(rawScan.validate_shaped_full_dom)
    ? rawScan.validate_shaped_full_dom.filter(
        (x) => x && x.client_visible_for_interaction === true,
      ).length
    : 0;
  sc += visVal * 14;
  if (Array.isArray(rawScan.identity_probe_hits_post_2u) && rawScan.identity_probe_hits_post_2u.length > 0) {
    sc += 12;
  }
  if (rawScan.delivery_grouping_visible === true) {
    sc += 15;
  }
  return sc;
}

/**
 * MILO-only: after successful 2o (MILO post-2u), navigate read-only to cart and scan visible DOM for
 * validate-shaped controls. No validate/checkout/submit/finalize clicks.
 */
export async function runMiloReadonlyPost2oCartValidateDiscovery({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  phase2oResult,
  safeFlowShot = null,
}) {
  const settleMs = config.addByCodePhase2oMiloReadonlyCartValidateDiscoverySettleMs ?? 600;

  await heartbeat({
    progressStage: "mlcc_milo_readonly_cart_validate_discovery_start",
    progressMessage:
      "MILO read-only cart navigation for validate selector discovery (no validate/checkout/submit click)",
  });

  if (
    !phase2oResult ||
    phase2oResult.observation_performed !== true ||
    phase2oResult.post_click_observation_prerequisite_mode !== "milo_post_2u"
  ) {
    const err =
      "MILO cart validate discovery requires same-run Phase 2o MILO post-2u with observation_performed=true";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_milo_readonly_cart_validate_discovery_blocked",
        message: err,
        attributes: {
          cart_validate_discovery_performed: false,
          block_reason: "phase_2o_milo_prerequisite_not_satisfied",
        },
      }),
    );
    throw new Error(err);
  }

  if (phase2oResult.no_new_blocked_downstream_requests_observed === false) {
    const err =
      "MILO cart validate discovery requires Phase 2o no_new_blocked_downstream_requests_observed !== false";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_milo_readonly_cart_validate_discovery_blocked",
        message: err,
        attributes: {
          cart_validate_discovery_performed: false,
          block_reason: "phase_2o_layer2_prerequisite_failed",
        },
      }),
    );
    throw new Error(err);
  }

  const urlCandidates = buildMiloReadonlyCartDiscoveryCandidateUrls(
    config.loginUrl,
    config.addByCodePhase2oMiloReadonlyCartValidateDiscoveryUrl,
    config.addByCodePhase2oMiloReadonlyCartDiscoveryPathCandidates,
  );

  if (urlCandidates.length === 0) {
    const err =
      "MILO cart validate discovery: could not derive any read-only cart candidate URL from MLCC_LOGIN_URL";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_milo_readonly_cart_validate_discovery_blocked",
        message: err,
        attributes: {
          cart_validate_discovery_performed: false,
          block_reason: "cart_url_candidate_list_empty",
        },
      }),
    );
    throw new Error(err);
  }

  const url_before_navigation = page.url();

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_milo_readonly_cart_validate_discovery_pre_goto_snapshot",
        message:
          "MILO read-only validate discovery: checkpoint before cart navigation (no user-order clicks)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const preCartBycodeListPack =
    await collectMiloPreCartBycodeListSurfaceReadonly(page, config);

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_milo_pre_readonly_cart_bycode_list_surface",
      message:
        "MILO read-only: by-code list/row surface before cart navigation (no clicks; visible DOM heuristics only)",
      attributes: {
        ...preCartBycodeListPack.dom_summary,
        tenant_code_field_state: preCartBycodeListPack.tenant_code_field_state,
        tenant_quantity_field_state:
          preCartBycodeListPack.tenant_quantity_field_state,
        tenant_field_both_have_values_heuristic:
          preCartBycodeListPack.tenant_field_both_have_values_heuristic,
        real_pre_cart_line_observed_heuristic:
          preCartBycodeListPack.real_pre_cart_line_observed_heuristic,
        milo_list_root_override_readonly:
          preCartBycodeListPack.list_root_override_readonly,
        phase_2l_test_code_length:
          typeof config?.addByCodePhase2lTestCode === "string"
            ? config.addByCodePhase2lTestCode.length
            : null,
        phase_2l_test_quantity_length:
          typeof config?.addByCodePhase2lTestQuantity === "string"
            ? config.addByCodePhase2lTestQuantity.length
            : null,
      },
    }),
  );

  const readonlyCartRouteProbeAttempts = [];
  let winningBundle = null;
  let bestRouteScore = -1;

  const safeCartIconRouteIndex =
    config.addByCodePhase2oMiloSafeCartIconClick === true &&
    config.addByCodePhase2oMiloSafeCartIconClickApproved === true
      ? 0
      : null;
  const realUiCartLifecycle = { attempted: false, succeeded: false };

  const navigationTasks = [];
  if (
    config.addByCodePhase2oMiloSafeCartIconClick === true &&
    config.addByCodePhase2oMiloSafeCartIconClickApproved === true
  ) {
    navigationTasks.push({ kind: "safe_cart_icon" });
  }
  for (const u of urlCandidates) {
    navigationTasks.push({ kind: "goto", cartUrl: u });
  }

  routeloop: for (let routeIdx = 0; routeIdx < navigationTasks.length; routeIdx++) {
    const task = navigationTasks[routeIdx];
    const blocked_before_attempt =
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null;

    let cartUrl = null;
    let navigation_method = "goto";
    let safe_cart_icon_click_resolution = null;
    let lastSafeCartIconRealUiSuccess = false;
    let safeCartIconOutputBundle = null;

    if (task.kind === "goto") {
      cartUrl = task.cartUrl;
      try {
        await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (ge) {
        readonlyCartRouteProbeAttempts.push({
          attempt_index: routeIdx,
          navigation_method: "goto",
          cart_url: cartUrl,
          goto_ok: false,
          goto_error: ge instanceof Error ? ge.message : String(ge),
        });
        continue;
      }
    } else {
      navigation_method = "safe_cart_icon_click";
      realUiCartLifecycle.attempted = true;
      let iconRes;
      try {
        iconRes = await runMiloSafeHeaderCartIconClickReadonly({
          page,
          settleMs,
          guardStats,
          evidenceCollected,
          buildEvidence,
          safeFlowShot,
          cartRouteFallbackUrls: urlCandidates,
        });
      } catch (ie) {
        const plumbing =
          ie && typeof ie === "object" && ie.mlcc_safe_cart_output_plumbing
            ? ie.mlcc_safe_cart_output_plumbing
            : null;
        readonlyCartRouteProbeAttempts.push({
          attempt_index: routeIdx,
          navigation_method,
          cart_url: page.url(),
          goto_ok: false,
          cart_icon_layer2_abort: true,
          fatal_error: ie instanceof Error ? ie.message : String(ie),
          real_ui_cart_click_succeeded_on_attempt: false,
          ...(plumbing
            ? {
                cart_runtime_top_right_snapshot: plumbing.cart_runtime_top_right_snapshot,
                cart_click_debug: plumbing.cart_click_debug,
              }
            : {}),
        });
        throw ie;
      }
      safeCartIconOutputBundle = {
        cart_runtime_top_right_snapshot: iconRes.cart_runtime_top_right_snapshot ?? null,
        cart_click_debug: iconRes.cart_click_debug ?? null,
        milo_open_cart_intent_router: iconRes.milo_open_cart_intent_router ?? null,
        ui_cart_open_attempted: iconRes.ui_cart_open_attempted === true,
        ui_cart_open_succeeded: iconRes.ui_cart_open_succeeded === true,
        fallback_route_probe_used: iconRes.fallback_route_probe_used === true,
      };
      lastSafeCartIconRealUiSuccess = iconRes.real_ui_cart_click_succeeded === true;
      if (iconRes.performed && iconRes.real_ui_cart_click_succeeded === true) {
        realUiCartLifecycle.succeeded = true;
      }
      if (!iconRes.performed) {
        readonlyCartRouteProbeAttempts.push({
          attempt_index: routeIdx,
          navigation_method,
          cart_url: page.url(),
          goto_ok: false,
          cart_icon_skip_reason: iconRes.error_reason ?? "not_performed",
          real_ui_cart_click_succeeded_on_attempt: false,
          real_ui_cart_click_failed_or_skipped: true,
          ...safeCartIconOutputBundle,
        });
        continue;
      }
      cartUrl =
        typeof iconRes.post_click_url === "string" && iconRes.post_click_url.length > 0
          ? iconRes.post_click_url
          : page.url();
      safe_cart_icon_click_resolution = iconRes.click_resolution ?? null;
    }

  /**
   * SYNC NOTE: quick fingerprint shape must match buildCartQuickFingerprint inside cart rawScan evaluate.
   * Body-child snapshot shape must match buildBodyDirectChildExplainerSnapshot in that same evaluate.
   * Captures early DOM (drawers/portals may still be mounting).
   */
  const cart_quick_fingerprint_after_goto = await page.evaluate(() => {
    const isVis = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    };

    const getZIndex = (el) => {
      if (!(el instanceof HTMLElement)) return 0;
      const z = window.getComputedStyle(el).zIndex;
      if (z === "auto") return 0;
      const n = parseInt(z, 10);
      return Number.isFinite(n) ? n : 0;
    };

    const compactDomPath = (el, maxDepth = 5) => {
      if (!(el instanceof Element)) return "";
      const out = [];
      let cur = el;
      let depth = 0;
      while (cur && depth < maxDepth) {
        const tag = String(cur.tagName || "").toLowerCase();
        if (!tag) break;
        let seg = tag;
        if (cur.id) {
          seg += `#${String(cur.id).slice(0, 36)}`;
          out.unshift(seg);
          break;
        }
        const cls = String(cur.className || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .join(".");
        if (cls) seg += `.${cls.slice(0, 48)}`;
        const parent = cur.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter((x) => x.tagName === cur.tagName);
          const idx = Math.max(1, sibs.indexOf(cur) + 1);
          seg += `:nth-of-type(${idx})`;
        }
        out.unshift(seg);
        cur = parent;
        depth += 1;
      }
      return out.join(" > ");
    };

    const cartLikeMicroForElement = (root) => {
      if (!(root instanceof HTMLElement)) return {};
      let trTwoTd = 0;
      for (const tr of root.querySelectorAll("tr")) {
        if (isVis(tr) && tr.querySelectorAll("td").length >= 2) trTwoTd += 1;
      }
      let matRow = 0;
      let cdkRow = 0;
      for (const el of root.querySelectorAll(
        "mat-row, [class*=\"mat-row\" i], [class*=\"cdk-row\" i]",
      )) {
        if (!isVis(el)) continue;
        const cls = String(el.className || "");
        if (el.tagName.toLowerCase() === "mat-row" || /mat-row/i.test(cls)) matRow += 1;
        else cdkRow += 1;
      }
      let qtyInputs = 0;
      for (const inp of root.querySelectorAll("input")) {
        if (!(inp instanceof HTMLElement) || !isVis(inp)) continue;
        const ty = String(inp.getAttribute("type") || "").toLowerCase();
        const hint = `${inp.name} ${inp.id} ${inp.className}`.toLowerCase();
        if (ty === "number" || /qty|quantity|amount/.test(hint)) qtyInputs += 1;
      }
      const text = (root.innerText || "").replace(/\s+/g, " ").trim();
      const dollarHits = (text.match(/\$\s*\d|\b\d+\.\d{2}\b/g) || []).length;
      let validateBtn = false;
      let checkoutBtn = false;
      let placeOrderBtn = false;
      for (const el of root.querySelectorAll(
        "button, a[href], [role=\"button\"], input[type=\"submit\"], input[type=\"button\"]",
      )) {
        if (!isVis(el)) continue;
        const inner = String(
          el.innerText || el.textContent || el.getAttribute("value") || "",
        ).toLowerCase();
        if (/\bvalidate\b/.test(inner)) validateBtn = true;
        if (/\bcheckout\b|continue\s+to\s+checkout/i.test(inner)) checkoutBtn = true;
        if (/place\s*order|submit\s*order/i.test(inner)) placeOrderBtn = true;
      }
      return {
        tr_two_td_visible: trTwoTd,
        mat_row_visible: matRow,
        cdk_row_visible: cdkRow,
        qty_input_visible: qtyInputs,
        dollar_like_token_hits: dollarHits,
        validate_button_text_visible: validateBtn,
        checkout_button_text_visible: checkoutBtn,
        place_order_button_text_visible: placeOrderBtn,
      };
    };

    const looksLikeBodyDirectChild = (el) => {
      if (!(el instanceof HTMLElement)) return "unknown";
      const tag = el.tagName.toLowerCase();
      const cls = String(el.className || "").toLowerCase();
      const id = String(el.id || "").toLowerCase();
      const role = String(el.getAttribute("role") || "").toLowerCase();
      const th = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();
      const sig = `${tag} ${cls} ${id} ${role} ${th}`;
      if (/toast|snackbar|snack-bar|mat-snack|notification/.test(sig)) return "toast";
      if (/cdk-overlay-backdrop/.test(cls)) return "overlay";
      if (/cdk-overlay-container/.test(cls)) return "portal";
      if (/cdk-overlay-pane/.test(cls)) return "portal";
      if (role === "dialog" || /mat-dialog|modal|dialog/.test(sig)) return "dialog";
      if (/drawer|sidenav|mat-drawer|offcanvas/.test(sig)) return "drawer";
      if (/overlay/.test(cls) && /backdrop|mask|scrim/.test(sig)) return "overlay";
      if (
        /app-root|router-outlet|shell|layout|mat-toolbar|mat-sidenav-container|milo-/.test(sig) &&
        el.children.length >= 1
      ) {
        return "layout shell";
      }
      const micro = cartLikeMicroForElement(el);
      if (
        micro.tr_two_td_visible >= 1 ||
        micro.mat_row_visible >= 1 ||
        micro.qty_input_visible >= 1 ||
        micro.dollar_like_token_hits >= 1
      ) {
        return "cart-like surface";
      }
      return "unknown";
    };

    const buildBodyDirectChildExplainerSnapshot = () => {
      const list = document.body.children;
      const maxSlots = 36;
      const body_direct_child_slots = [];
      const n = list.length;
      for (let i = 0; i < Math.min(n, maxSlots); i++) {
        const node = list[i];
        if (!(node instanceof HTMLElement)) {
          body_direct_child_slots.push({
            slot_index: i,
            non_html_element: true,
            visible: false,
          });
          continue;
        }
        const st = window.getComputedStyle(node);
        const r = node.getBoundingClientRect();
        const visible = isVis(node);
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        const looks_like = looksLikeBodyDirectChild(node);
        const cart_like_micro_signals = cartLikeMicroForElement(node);
        body_direct_child_slots.push({
          slot_index: i,
          dom_path_compact: compactDomPath(node).slice(0, 260),
          tag: node.tagName.toLowerCase(),
          id: node.id ? String(node.id).slice(0, 120) : null,
          class_sample:
            typeof node.className === "string"
              ? node.className.replace(/\s+/g, " ").trim().slice(0, 160)
              : null,
          visible,
          text_head: text.slice(0, 200),
          text_length: text.length,
          bounding_rect: {
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          },
          position: st.position,
          z_index: getZIndex(node),
          display_visibility_opacity: {
            display: st.display,
            visibility: st.visibility,
            opacity: st.opacity,
          },
          child_count: node.children.length,
          looks_like,
          cart_like_micro_signals,
        });
      }
      return {
        body_direct_child_slots,
        body_child_total: n,
        truncated: n > maxSlots,
        capture_phase: "after_goto_domcontentloaded",
      };
    };

    let tbodyTr2 = 0;
    for (const tr of document.querySelectorAll("tbody tr")) {
      if (isVis(tr) && tr.querySelectorAll("td").length >= 2) tbodyTr2 += 1;
    }
    let matRowVis = 0;
    for (const el of document.querySelectorAll(
      "mat-row, [class*=\"mat-row\" i], [class*=\"cdk-row\" i]",
    )) {
      if (isVis(el)) matRowVis += 1;
    }
    let roleDialog = 0;
    for (const el of document.querySelectorAll("[role=\"dialog\"], [aria-modal=\"true\"]")) {
      if (isVis(el)) roleDialog += 1;
    }
    let cdkPane = 0;
    for (const el of document.querySelectorAll(".cdk-overlay-pane, .cdk-global-overlay-wrapper")) {
      if (isVis(el)) cdkPane += 1;
    }
    let fixedLarge = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement) || fixedLarge >= 40) break;
      const st = window.getComputedStyle(el);
      if (st.position !== "fixed" && st.position !== "absolute") continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 80 && isVis(el)) fixedLarge += 1;
    }
    let bodyDirVis = 0;
    for (const c of document.body.children) {
      if (c instanceof HTMLElement && isVis(c)) bodyDirVis += 1;
    }
    return {
      capture_phase: "after_goto_domcontentloaded",
      page_url: window.location.href,
      visible_body_direct_child_count: bodyDirVis,
      tbody_tr_two_td_visible_count: tbodyTr2,
      mat_or_cdk_row_visible_count: matRowVis,
      role_dialog_or_modal_visible_count: roleDialog,
      cdk_overlay_pane_like_visible_count: cdkPane,
      fixed_or_absolute_large_visible_count: fixedLarge,
      body_direct_child_explainer_snapshot: buildBodyDirectChildExplainerSnapshot(),
    };
  });

  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, settleMs));

  const blocked_after_nav =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_cart_navigation =
    blocked_before_attempt != null && blocked_after_nav != null
      ? blocked_after_nav - blocked_before_attempt
      : null;

  if (
    network_guard_delta_during_cart_navigation != null &&
    network_guard_delta_during_cart_navigation !== 0
  ) {
    const err = `MILO cart validate discovery: Layer 2 blocked request counter changed during read-only cart navigation (delta=${network_guard_delta_during_cart_navigation})`;
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_milo_readonly_cart_validate_discovery_blocked",
        message: err,
        attributes: {
          cart_validate_discovery_performed: false,
          cart_url_attempted: cartUrl,
          url_before_navigation,
          url_after_navigation: page.url(),
          block_reason: "positive_layer2_abort_delta_during_readonly_cart_navigation",
          network_guard_blocked_before_navigation: blocked_before_attempt,
          network_guard_blocked_after_navigation: blocked_after_nav,
        },
      }),
    );
    throw new Error(err);
  }

  const rawScan = await page.evaluate((cartQuickFingerprintAfterGoto) => {
    const isVis = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      const st = window.getComputedStyle(el);

      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();

      return r.width >= 2 && r.height >= 2;
    };

    const buildCartQuickFingerprint = () => {
      let tbodyTr2 = 0;
      for (const tr of document.querySelectorAll("tbody tr")) {
        if (isVis(tr) && tr.querySelectorAll("td").length >= 2) tbodyTr2 += 1;
      }
      let matRowVis = 0;
      for (const el of document.querySelectorAll(
        "mat-row, [class*=\"mat-row\" i], [class*=\"cdk-row\" i]",
      )) {
        if (isVis(el)) matRowVis += 1;
      }
      let roleDialog = 0;
      for (const el of document.querySelectorAll("[role=\"dialog\"], [aria-modal=\"true\"]")) {
        if (isVis(el)) roleDialog += 1;
      }
      let cdkPane = 0;
      for (const el of document.querySelectorAll(".cdk-overlay-pane, .cdk-global-overlay-wrapper")) {
        if (isVis(el)) cdkPane += 1;
      }
      let fixedLarge = 0;
      for (const el of document.querySelectorAll("body *")) {
        if (!(el instanceof HTMLElement) || fixedLarge >= 40) break;
        const st = window.getComputedStyle(el);
        if (st.position !== "fixed" && st.position !== "absolute") continue;
        const r = el.getBoundingClientRect();
        if (r.width >= 120 && r.height >= 80 && isVis(el)) fixedLarge += 1;
      }
      let bodyDirVis = 0;
      for (const c of document.body.children) {
        if (c instanceof HTMLElement && isVis(c)) bodyDirVis += 1;
      }
      return {
        capture_phase: "post_networkidle_and_settle",
        page_url: window.location.href,
        visible_body_direct_child_count: bodyDirVis,
        tbody_tr_two_td_visible_count: tbodyTr2,
        mat_or_cdk_row_visible_count: matRowVis,
        role_dialog_or_modal_visible_count: roleDialog,
        cdk_overlay_pane_like_visible_count: cdkPane,
        fixed_or_absolute_large_visible_count: fixedLarge,
      };
    };

    const diffCartQuickFingerprints = (pre, post) => {
      if (!pre || !post) {
        return {
          comparable: false,
          note: "missing_pre_or_post_fingerprint",
        };
      }
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const d = (a, b) => num(b) - num(a);
      return {
        comparable: true,
        tbody_tr_two_td_visible_delta: d(
          pre.tbody_tr_two_td_visible_count,
          post.tbody_tr_two_td_visible_count,
        ),
        mat_or_cdk_row_visible_delta: d(
          pre.mat_or_cdk_row_visible_count,
          post.mat_or_cdk_row_visible_count,
        ),
        role_dialog_visible_delta: d(
          pre.role_dialog_or_modal_visible_count,
          post.role_dialog_or_modal_visible_count,
        ),
        cdk_overlay_pane_visible_delta: d(
          pre.cdk_overlay_pane_like_visible_count,
          post.cdk_overlay_pane_like_visible_count,
        ),
        fixed_or_absolute_large_delta: d(
          pre.fixed_or_absolute_large_visible_count,
          post.fixed_or_absolute_large_visible_count,
        ),
        body_direct_child_visible_delta: d(
          pre.visible_body_direct_child_count,
          post.visible_body_direct_child_count,
        ),
        new_overlay_or_dialog_activity_suggested:
          d(
            pre.cdk_overlay_pane_like_visible_count,
            post.cdk_overlay_pane_like_visible_count,
          ) > 0 ||
          d(pre.role_dialog_or_modal_visible_count, post.role_dialog_or_modal_visible_count) > 0,
        new_line_like_rows_suggested:
          d(pre.tbody_tr_two_td_visible_count, post.tbody_tr_two_td_visible_count) > 0 ||
          d(pre.mat_or_cdk_row_visible_count, post.mat_or_cdk_row_visible_count) > 0,
      };
    };

    const getZIndex = (el) => {
      if (!(el instanceof HTMLElement)) return 0;
      const z = window.getComputedStyle(el).zIndex;
      if (z === "auto") return 0;
      const n = parseInt(z, 10);
      return Number.isFinite(n) ? n : 0;
    };

    const layoutSignalsForElement = (el) => {
      if (!(el instanceof HTMLElement)) {
        return null;
      }
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        position: st.position,
        z_index: getZIndex(el),
        display: st.display,
        visibility: st.visibility,
        opacity: st.opacity,
        bounding_rect: {
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right,
        },
      };
    };

    const cartLikeSignalsForContainer = (root) => {
      if (!(root instanceof HTMLElement)) return null;
      const text = (root.innerText || "").replace(/\s+/g, " ").trim();
      let trTwoTd = 0;
      for (const tr of root.querySelectorAll("tr")) {
        if (isVis(tr) && tr.querySelectorAll("td").length >= 2) trTwoTd += 1;
      }
      let matRow = 0;
      let cdkRow = 0;
      for (const el of root.querySelectorAll(
        "mat-row, [class*=\"mat-row\" i], [class*=\"cdk-row\" i]",
      )) {
        if (!isVis(el)) continue;
        const cls = String(el.className || "");
        if (el.tagName.toLowerCase() === "mat-row" || /mat-row/i.test(cls)) matRow += 1;
        else cdkRow += 1;
      }
      let qtyInputs = 0;
      for (const inp of root.querySelectorAll("input")) {
        if (!(inp instanceof HTMLElement) || !isVis(inp)) continue;
        const ty = String(inp.getAttribute("type") || "").toLowerCase();
        const hint = `${inp.name} ${inp.id} ${inp.className}`.toLowerCase();
        if (ty === "number" || /qty|quantity|amount/.test(hint)) qtyInputs += 1;
      }
      let removeHits = 0;
      for (const el of root.querySelectorAll("button, a, [role=\"button\"]")) {
        if (!isVis(el)) continue;
        const tx = String(el.innerText || el.textContent || "").toLowerCase();
        if (/\b(remove|delete|trash)\b/.test(tx)) removeHits += 1;
      }
      const dollarHits = (text.match(/\$\s*\d|\b\d+\.\d{2}\b/g) || []).length;
      const productishBulk =
        text.length > 30 && /\d{3,6}/.test(text) && /[A-Za-z]{4,}/.test(text);
      let validateBtn = false;
      let checkoutBtn = false;
      let placeOrderBtn = false;
      for (const el of root.querySelectorAll(
        "button, a[href], [role=\"button\"], input[type=\"submit\"], input[type=\"button\"]",
      )) {
        if (!isVis(el)) continue;
        const inner = String(
          el.innerText || el.textContent || el.getAttribute("value") || "",
        ).toLowerCase();
        if (/\bvalidate\b/.test(inner)) validateBtn = true;
        if (/\bcheckout\b|continue\s+to\s+checkout/i.test(inner)) checkoutBtn = true;
        if (/place\s*order|submit\s*order/i.test(inner)) placeOrderBtn = true;
      }
      return {
        tr_two_td_visible: trTwoTd,
        mat_row_visible: matRow,
        cdk_row_visible: cdkRow,
        qty_input_visible: qtyInputs,
        remove_or_delete_control_hits: removeHits,
        dollar_like_token_hits: dollarHits,
        productish_text_bulk_heuristic: productishBulk,
        validate_button_text_visible: validateBtn,
        checkout_button_text_visible: checkoutBtn,
        place_order_button_text_visible: placeOrderBtn,
        inner_text_length: text.length,
        inner_text_head_sample: text.slice(0, 220),
      };
    };

    const compactDomPath = (el, maxDepth = 6) => {
      if (!(el instanceof Element)) return "";
      const out = [];
      let cur = el;
      let depth = 0;
      while (cur && depth < maxDepth) {
        const tag = String(cur.tagName || "").toLowerCase();
        if (!tag) break;
        let seg = tag;
        if (cur.id) {
          seg += `#${String(cur.id).slice(0, 36)}`;
          out.unshift(seg);
          break;
        }
        const cls = String(cur.className || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .join(".");
        if (cls) seg += `.${cls.slice(0, 48)}`;
        const parent = cur.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter((x) => x.tagName === cur.tagName);
          const idx = Math.max(1, sibs.indexOf(cur) + 1);
          seg += `:nth-of-type(${idx})`;
        }
        out.unshift(seg);
        cur = parent;
        depth += 1;
      }
      return out.join(" > ");
    };

    const looksLikeBodyDirectChild = (el) => {
      if (!(el instanceof HTMLElement)) return "unknown";
      const tag = el.tagName.toLowerCase();
      const cls = String(el.className || "").toLowerCase();
      const id = String(el.id || "").toLowerCase();
      const role = String(el.getAttribute("role") || "").toLowerCase();
      const th = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();
      const sig = `${tag} ${cls} ${id} ${role} ${th}`;
      if (/toast|snackbar|snack-bar|mat-snack|notification/.test(sig)) return "toast";
      if (/cdk-overlay-backdrop/.test(cls)) return "overlay";
      if (/cdk-overlay-container/.test(cls)) return "portal";
      if (/cdk-overlay-pane/.test(cls)) return "portal";
      if (role === "dialog" || /mat-dialog|modal|dialog/.test(sig)) return "dialog";
      if (/drawer|sidenav|mat-drawer|offcanvas/.test(sig)) return "drawer";
      if (/overlay/.test(cls) && /backdrop|mask|scrim/.test(sig)) return "overlay";
      if (
        /app-root|router-outlet|shell|layout|mat-toolbar|mat-sidenav-container|milo-/.test(sig) &&
        el.children.length >= 1
      ) {
        return "layout shell";
      }
      const micro = cartLikeSignalsForContainer(el);
      if (
        micro &&
        (micro.tr_two_td_visible >= 1 ||
          micro.mat_row_visible >= 1 ||
          micro.qty_input_visible >= 1 ||
          micro.dollar_like_token_hits >= 1)
      ) {
        return "cart-like surface";
      }
      return "unknown";
    };

    const buildBodyDirectChildExplainerSnapshot = () => {
      const list = document.body.children;
      const maxSlots = 36;
      const body_direct_child_slots = [];
      const n = list.length;
      for (let i = 0; i < Math.min(n, maxSlots); i++) {
        const node = list[i];
        if (!(node instanceof HTMLElement)) {
          body_direct_child_slots.push({
            slot_index: i,
            non_html_element: true,
            visible: false,
          });
          continue;
        }
        const st = window.getComputedStyle(node);
        const r = node.getBoundingClientRect();
        const visible = isVis(node);
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        const looks_like = looksLikeBodyDirectChild(node);
        const cartSig = cartLikeSignalsForContainer(node);
        const cart_like_micro_signals = {
          tr_two_td_visible: cartSig.tr_two_td_visible,
          mat_row_visible: cartSig.mat_row_visible,
          cdk_row_visible: cartSig.cdk_row_visible,
          qty_input_visible: cartSig.qty_input_visible,
          dollar_like_token_hits: cartSig.dollar_like_token_hits,
          validate_button_text_visible: cartSig.validate_button_text_visible,
          checkout_button_text_visible: cartSig.checkout_button_text_visible,
          place_order_button_text_visible: cartSig.place_order_button_text_visible,
        };
        body_direct_child_slots.push({
          slot_index: i,
          dom_path_compact: compactDomPath(node).slice(0, 260),
          tag: node.tagName.toLowerCase(),
          id: node.id ? String(node.id).slice(0, 120) : null,
          class_sample:
            typeof node.className === "string"
              ? node.className.replace(/\s+/g, " ").trim().slice(0, 160)
              : null,
          visible,
          text_head: text.slice(0, 200),
          text_length: text.length,
          bounding_rect: {
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          },
          position: st.position,
          z_index: getZIndex(node),
          display_visibility_opacity: {
            display: st.display,
            visibility: st.visibility,
            opacity: st.opacity,
          },
          child_count: node.children.length,
          looks_like,
          cart_like_micro_signals,
        });
      }
      return {
        body_direct_child_slots,
        body_child_total: n,
        truncated: n > maxSlots,
        capture_phase: "post_networkidle_and_settle",
      };
    };

    const cart_quick_fingerprint_post_settle = buildCartQuickFingerprint();
    const post_2u_dom_progression = diffCartQuickFingerprints(
      cartQuickFingerprintAfterGoto,
      cart_quick_fingerprint_post_settle,
    );
    const body_direct_child_explainer_snapshot_post_settle = buildBodyDirectChildExplainerSnapshot();

    const visibilityReport = (el) => {
      if (!(el instanceof HTMLElement)) {
        return {
          client_visible_for_interaction: false,
          hidden_by_style: true,
          offscreen_viewport: true,
          computed_display: null,
          computed_visibility: null,
          computed_opacity: null,
          bounding_rect: null,
          aria_hidden: false,
        };
      }

      const st = window.getComputedStyle(el);
      const hiddenByStyle =
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const offscreen =
        r.bottom < -80 ||
        r.top > vh + 80 ||
        r.right < -80 ||
        r.left > vw + 80;

      return {
        client_visible_for_interaction: isVis(el),
        hidden_by_style: hiddenByStyle,
        offscreen_viewport: offscreen,
        computed_display: st.display,
        computed_visibility: st.visibility,
        computed_opacity: st.opacity,
        bounding_rect: {
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right,
        },
        aria_hidden: String(el.getAttribute("aria-hidden") || "").toLowerCase() === "true",
      };
    };

    const checkoutLikeRes = [
      /\bcheckout\b/i,
      /place\s*order/i,
      /submit\s*order/i,
      /complete\s*(order|purchase)/i,
      /confirm\s*order/i,
      /buy\s*now/i,
      /\bfinalize\b/i,
      /\bpurchase\b/i,
      /proceed\s+to\s+checkout/i,
      /continue\s+to\s+checkout/i,
    ];

    const matchesCheckoutLike = (text, href) => {
      const hay = `${text} ${href}`.toLowerCase();

      return checkoutLikeRes.some((re) => re.test(hay));
    };

    const forbiddenLabelRes = [
      /add\s*to\s*cart/i,
      /add\s*all/i,
      /update\s*cart/i,
    ];

    const forbiddenLabel = (text) => {
      const t = String(text ?? "").trim();

      return forbiddenLabelRes.some((re) => re.test(t));
    };

    const matchesValidateIntent = (inner, aria, title, valueAttr, href) => {
      const t = `${inner} ${aria} ${title} ${valueAttr}`.toLowerCase();

      if (/\bvalidate\b/i.test(t)) {
        return { ok: true, via: "visible_or_aria_or_title_text" };
      }

      const h = String(href ?? "").trim().toLowerCase();

      if (!h) {
        return { ok: false };
      }

      if (
        /checkout|order\/submit|place-order|submit-order|finalize|cart\/add|add-to-cart|addtocart/i.test(
          h,
        )
      ) {
        return { ok: false };
      }

      if (/\bvalidate\b|\/validate|validateorder|validate-order/i.test(h)) {
        return { ok: true, via: "href_validate_shaped" };
      }

      return { ok: false };
    };

    const mainEl = document.querySelector("main") || document.body;
    const rawBodyFull = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const body_inner_text_head_snippet = rawBodyFull.slice(0, 2500);

    const emptyPhraseRes = [
      { label: "your_cart_is_empty", re: /your\s+cart\s+is\s+empty/i },
      { label: "cart_is_empty", re: /\bcart\s+is\s+empty\b/i },
      { label: "no_items_in_cart", re: /no\s+items?\s+in\s+your\s+cart/i },
      { label: "nothing_in_cart", re: /nothing\s+in\s+your\s+cart/i },
      { label: "shopping_cart_empty", re: /shopping\s+cart\s+is\s+empty/i },
    ];

    const empty_cart_phrase_hits = [];

    for (const { label, re } of emptyPhraseRes) {
      if (re.test(rawBodyFull)) {
        empty_cart_phrase_hits.push(label);
      }
    }

    const tablesInMain = mainEl ? mainEl.querySelectorAll("table") : [];
    let tbody_count_in_main = 0;
    let tr_count_all_tbody_in_main = 0;
    let tr_count_in_largest_tbody = 0;
    let data_row_heuristic_count = 0;

    for (const t of tablesInMain) {
      const tbodies = t.querySelectorAll("tbody");

      for (const tb of tbodies) {
        tbody_count_in_main += 1;
        const trs = tb.querySelectorAll("tr");
        const n = trs.length;

        tr_count_all_tbody_in_main += n;

        if (n > tr_count_in_largest_tbody) {
          tr_count_in_largest_tbody = n;
        }

        for (const tr of trs) {
          if (tr.querySelectorAll("td").length >= 2) {
            data_row_heuristic_count += 1;
          }
        }
      }
    }

    const li_count_in_main = mainEl ? mainEl.querySelectorAll("li").length : 0;

    const subtotal_like_text_samples = [];
    const subRe =
      /\b(subtotal|order\s+total|total\s*:|estimated\s+total|cart\s+total)\b[^.\n]{0,100}/gi;

    let sm;

    while ((sm = subRe.exec(rawBodyFull)) && subtotal_like_text_samples.length < 10) {
      subtotal_like_text_samples.push(sm[0].trim().slice(0, 160));
    }

    let cart_action_region_context = null;
    const cartish =
      (mainEl &&
        (mainEl.querySelector(
          "[class*=\"cart\" i], [id*=\"cart\" i], [data-cart], table",
        ) ||
          null)) ||
      mainEl;

    if (cartish instanceof HTMLElement) {
      cart_action_region_context = {
        tag: cartish.tagName.toLowerCase(),
        id: cartish.id || null,
        dom_path: compactDomPath(cartish),
        class_sample:
          typeof cartish.className === "string"
            ? cartish.className.replace(/\s+/g, " ").trim().slice(0, 200)
            : null,
        inner_text_head: (cartish.innerText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1400),
      };
    }

    let document_wide_tbody_tr_two_td_visible = 0;
    for (const tr of document.querySelectorAll("tbody tr")) {
      if (isVis(tr) && tr.querySelectorAll("td").length >= 2) {
        document_wide_tbody_tr_two_td_visible += 1;
      }
    }

    let document_wide_mat_or_cdk_row_visible = 0;
    for (const el of document.querySelectorAll(
      "mat-row, [class*=\"mat-row\" i], [class*=\"cdk-row\" i]",
    )) {
      if (isVis(el)) {
        document_wide_mat_or_cdk_row_visible += 1;
      }
    }

    const bodyWideRootSeen = new Set();
    const bodyWideCollected = [];
    const addBodyWideRoot = (el, sourceLabel) => {
      if (!(el instanceof HTMLElement) || bodyWideRootSeen.has(el)) {
        return;
      }
      if (!isVis(el)) {
        return;
      }
      bodyWideRootSeen.add(el);
      bodyWideCollected.push({ el, sourceLabel });
    };

    for (const c of document.body.children) {
      addBodyWideRoot(c, "body_direct_child");
    }

    const portalSelectors = [
      ".cdk-overlay-container > *",
      ".cdk-overlay-pane",
      ".cdk-global-overlay-wrapper",
      "mat-dialog-container",
      ".mat-drawer.mat-drawer-opened",
      "mat-sidenav",
      "[role=\"dialog\"]",
      "[aria-modal=\"true\"]",
      ".modal.show",
      ".modal.in",
      ".offcanvas.show",
      "aside",
      "[class*=\"drawer\" i]",
      "[class*=\"sidenav\" i]",
    ];

    for (const sel of portalSelectors) {
      let nodes;

      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }

      for (const n of nodes) {
        addBodyWideRoot(n, `query:${String(sel).slice(0, 56)}`);
      }
    }

    let elevatedAdded = 0;
    let elevatedScanIter = 0;

    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement)) {
        continue;
      }

      elevatedScanIter += 1;

      if (elevatedScanIter > 5000 || elevatedAdded >= 120) {
        break;
      }

      const st = window.getComputedStyle(el);

      if (st.position !== "fixed" && st.position !== "absolute") {
        continue;
      }

      if (getZIndex(el) < 100) {
        continue;
      }

      const r = el.getBoundingClientRect();

      if (r.width < 100 || r.height < 60) {
        continue;
      }

      if (!isVis(el)) {
        continue;
      }

      addBodyWideRoot(el, "fixed_or_absolute_z_index_ge_100_min_area");
      elevatedAdded += 1;
    }

    const body_wide_cart_like_candidates = [];
    let bodyWideBestCartLikeScore = 0;

    for (const { el, sourceLabel } of bodyWideCollected.slice(0, 42)) {
      const sig = cartLikeSignalsForContainer(el);

      if (!sig) {
        continue;
      }

      const layout = layoutSignalsForElement(el);
      const cartLikeScore =
        sig.tr_two_td_visible * 3 +
        sig.mat_row_visible * 3 +
        sig.cdk_row_visible * 2 +
        sig.qty_input_visible * 2 +
        sig.remove_or_delete_control_hits +
        Math.min(3, sig.dollar_like_token_hits) +
        (sig.productish_text_bulk_heuristic ? 2 : 0) +
        (sig.validate_button_text_visible ? 3 : 0);

      if (cartLikeScore > bodyWideBestCartLikeScore) {
        bodyWideBestCartLikeScore = cartLikeScore;
      }

      body_wide_cart_like_candidates.push({
        source_label: sourceLabel,
        dom_path_sample: compactDomPath(el).slice(0, 220),
        layout,
        cart_like_signals: sig,
        cart_like_composite_score: cartLikeScore,
      });
    }

    body_wide_cart_like_candidates.sort(
      (a, b) => b.cart_like_composite_score - a.cart_like_composite_score,
    );

    const bodyWideSuggestsLines =
      bodyWideBestCartLikeScore >= 4 ||
      body_wide_cart_like_candidates.some((c) => c.cart_like_composite_score >= 4);

    const merged_data_row_heuristic_count = Math.max(
      data_row_heuristic_count,
      document_wide_tbody_tr_two_td_visible,
      document_wide_mat_or_cdk_row_visible,
    );

    const mainScopedLineItems =
      data_row_heuristic_count >= 1 || tr_count_in_largest_tbody >= 2;
    const line_items_likely_present_heuristic =
      mainScopedLineItems ||
      document_wide_tbody_tr_two_td_visible >= 1 ||
      document_wide_mat_or_cdk_row_visible >= 1 ||
      bodyWideSuggestsLines;

    const cart_surface_state = {
      body_text_char_length: rawBodyFull.length,
      body_inner_text_head_snippet,
      table_count_in_main: tablesInMain.length,
      tbody_count_in_main,
      tr_count_all_tbody_in_main,
      tr_count_in_largest_tbody,
      data_row_heuristic_count: merged_data_row_heuristic_count,
      main_only_data_row_heuristic_count: data_row_heuristic_count,
      document_wide_tbody_tr_two_td_visible_count: document_wide_tbody_tr_two_td_visible,
      document_wide_mat_or_cdk_row_visible_count: document_wide_mat_or_cdk_row_visible,
      li_count_in_main,
      empty_cart_phrase_hits,
      subtotal_like_text_samples,
      cart_action_region_context,
      line_items_likely_present_heuristic,
      body_wide_cart_like_top_candidates: body_wide_cart_like_candidates.slice(0, 14),
      post_2u_dom_progression,
      cart_quick_fingerprint_post_settle,
      post_2u_cart_scan_scope:
        "document_body_main_tables_plus_overlays_portals_fixed_high_z_readonly",
      scan_read_only_no_scroll_no_click: true,
    };
    const identityProbeTerms = ["Patron", "Anejo", "2458", "375ml", "General Wine"];
    const identity_probe_hits_post_2u = identityProbeTerms.filter((t) =>
      rawBodyFull.toLowerCase().includes(t.toLowerCase()),
    );
    const identity_text_samples_post_2u = [];
    for (const t of identityProbeTerms) {
      const idx = rawBodyFull.toLowerCase().indexOf(t.toLowerCase());
      if (idx >= 0) {
        identity_text_samples_post_2u.push(
          rawBodyFull.slice(Math.max(0, idx - 48), Math.min(rawBodyFull.length, idx + 120)),
        );
      }
      if (identity_text_samples_post_2u.length >= 6) break;
    }
    const deliveryGroupingSignals = [
      { label: "delivery", re: /\bdelivery\b/i },
      { label: "pickup", re: /\bpickup\b/i },
      { label: "date", re: /\b(date|scheduled|schedule|window)\b/i },
      { label: "grouping", re: /\b(group|route|stop|driver|address)\b/i },
    ];
    const delivery_grouping_hits = deliveryGroupingSignals
      .filter((s) => s.re.test(rawBodyFull))
      .map((s) => s.label);
    const delivery_grouping_visible = delivery_grouping_hits.length > 0;
    const classifyCandidateType = (el) => {
      const tag = String(el.tagName || "").toLowerCase();
      const cls = String(el.className || "").toLowerCase();
      const id = String(el.id || "").toLowerCase();
      const sig = `${tag} ${cls} ${id}`;
      if (/drawer|offcanvas/.test(sig)) return "drawer";
      if (/overlay|modal|dialog/.test(sig)) return "overlay";
      if (/sidebar|right|rail|aside/.test(sig) || tag === "aside") return "sidebar";
      if (/panel|container|cart/.test(sig)) return "panel";
      if (/summary|subtotal|total/.test(sig)) return "summary";
      if (tag === "table" || /\btable\b/.test(sig)) return "table";
      if (tag === "ul" || tag === "ol" || /\blist\b/.test(sig)) return "list";
      return "other";
    };
    const candidateSeedSelectors = [
      "main",
      "[role='main']",
      "[id*='cart' i]",
      "[class*='cart' i]",
      "[class*='summary' i]",
      "[class*='drawer' i]",
      "[class*='sidebar' i]",
      "[class*='panel' i]",
      "aside",
      "[role='dialog']",
      ".modal",
      "table",
      "ul",
      "ol",
    ];
    const candidateNodeSet = new Set();
    for (const sel of candidateSeedSelectors) {
      let found;
      try {
        found = document.querySelectorAll(sel);
      } catch {
        found = [];
      }
      for (const n of found) {
        if (!(n instanceof HTMLElement)) continue;
        candidateNodeSet.add(n);
      }
    }
    const post_2u_surface_candidates = [];
    const candidateSeenByPath = new Set();
    for (const node of candidateNodeSet) {
      if (post_2u_surface_candidates.length >= 24) break;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const domPath = compactDomPath(node);
      if (!domPath || candidateSeenByPath.has(domPath)) continue;
      candidateSeenByPath.add(domPath);
      const nodeVisible = isVis(node);
      const trDataRowCount = Array.from(node.querySelectorAll("tr")).filter(
        (tr) => tr.querySelectorAll("td").length >= 2,
      ).length;
      const liCount = node.querySelectorAll("li").length;
      const lineItemHeuristicCount = trDataRowCount + (liCount >= 2 ? 1 : 0);
      let validateVisible = false;
      const validateNodes = node.querySelectorAll(
        "button, a[href], [role='button'], input[type='submit'], input[type='button']",
      );
      for (const el of validateNodes) {
        if (!(el instanceof HTMLElement)) continue;
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        const inner = (el.innerText || el.textContent || "").trim();
        const aria = (el.getAttribute("aria-label") || "").trim();
        const title = (el.getAttribute("title") || "").trim();
        const valAttr = tag === "input" ? String(el.value || "").trim() : "";
        const href = tag === "a" ? String(el.getAttribute("href") || "").trim() : "";
        const vm = matchesValidateIntent(inner, aria, title, valAttr, href);
        if (vm.ok && isVis(el)) {
          validateVisible = true;
          break;
        }
      }
      const localIdentityHits = identityProbeTerms.filter((t) =>
        text.toLowerCase().includes(t.toLowerCase()),
      );
      const localDeliveryHits = deliveryGroupingSignals
        .filter((s) => s.re.test(text))
        .map((s) => s.label);
      const score =
        (nodeVisible ? 2 : 0) +
        Math.min(4, lineItemHeuristicCount) * 2 +
        (validateVisible ? 3 : 0) +
        Math.min(3, localIdentityHits.length) * 2 +
        Math.min(2, localDeliveryHits.length);
      post_2u_surface_candidates.push({
        dom_path: domPath,
        visible: nodeVisible,
        candidate_type_guess: classifyCandidateType(node),
        line_item_heuristic_count: lineItemHeuristicCount,
        validate_shaped_control_visible: validateVisible,
        delivery_grouping_hits: localDeliveryHits,
        product_identity_term_hits: localIdentityHits,
        looks_more_promising_than_current_surface: false,
        score,
      });
    }
    post_2u_surface_candidates.sort((a, b) => b.score - a.score);
    const rankedSurfaceCandidates = post_2u_surface_candidates.slice(0, 10);
    const currentSurfacePath = cart_action_region_context?.dom_path || null;
    const currentSurfaceRank = rankedSurfaceCandidates.find(
      (c) => c.dom_path === currentSurfacePath,
    );
    const best = rankedSurfaceCandidates[0] || null;
    const currentScore = Number(currentSurfaceRank?.score || 0);
    for (const c of rankedSurfaceCandidates) {
      c.looks_more_promising_than_current_surface = Number(c.score || 0) > currentScore;
    }
    const nearTopCount = rankedSurfaceCandidates.filter(
      (c) => best && c.score >= best.score - 1,
    ).length;
    const remapClassification = (() => {
      if (!best) return "post_2u_no_better_surface_found";
      if (best.dom_path !== currentSurfacePath && best.score > currentScore)
        return "post_2u_cart_surface_remapped_to_better_candidate";
      if (nearTopCount >= 3 && best.score > 0) return "post_2u_multiple_ambiguous_surfaces";
      return "post_2u_current_surface_still_best_but_empty";
    })();
    const post_2u_surface_remap = {
      remap_classification: remapClassification,
      current_surface_dom_path: currentSurfacePath,
      current_surface_score: currentScore,
      ranked_candidates: rankedSurfaceCandidates,
      top_candidate: best,
      current_surface_still_best:
        best != null && best.dom_path === currentSurfacePath && best.score >= currentScore,
    };

    const selList = [
      "button",
      "a[href]",
      "[role=\"button\"]",
      "input[type=\"submit\"]",
      "input[type=\"button\"]",
    ];

    const validate_shaped_full_dom = [];

    domscan: for (const sel of selList) {
      let nodes;

      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }

      for (const el of nodes) {
        if (!(el instanceof HTMLElement)) {
          continue;
        }

        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        const inner = (el.innerText || el.textContent || "").trim();
        const aria = (el.getAttribute("aria-label") || "").trim();
        let lbText = "";
        const lb = el.getAttribute("aria-labelledby");

        if (lb) {
          for (const id of lb.split(/\s+/)) {
            const ref = document.getElementById(id);

            if (ref) {
              lbText += `${(ref.innerText || ref.textContent || "").trim()} `;
            }
          }
        }

        lbText = lbText.trim();
        const title = (el.getAttribute("title") || "").trim();
        const valAttr = tag === "input" ? String(el.value || "").trim() : "";
        const href = tag === "a" ? String(el.getAttribute("href") || "").trim() : "";
        const primaryText = inner || aria || title || valAttr;

        if (forbiddenLabel(primaryText)) {
          continue;
        }

        if (matchesCheckoutLike(primaryText, href)) {
          continue;
        }

        const vm = matchesValidateIntent(inner, aria, title, valAttr, href);

        if (!vm.ok) {
          continue;
        }

        const disabled =
          el.disabled === true ||
          String(el.getAttribute("aria-disabled") || "").toLowerCase() === "true";

        let css_selector_hint = null;

        if (el.id) {
          try {
            css_selector_hint = `#${CSS.escape(el.id)}`;
          } catch {
            css_selector_hint = null;
          }
        }

        const vr = visibilityReport(el);

        validate_shaped_full_dom.push({
          tag,
          text_sample: primaryText.slice(0, 200),
          inner_text_sample: inner.slice(0, 200),
          aria_label: aria || null,
          aria_labelledby_ids: lb || null,
          aria_labelledby_resolved_text_sample: lbText.slice(0, 200) || null,
          title: title || null,
          href_sample: href.slice(0, 240),
          disabled_reported: disabled,
          validate_match_via: vm.via,
          css_selector_hint,
          ...vr,
        });

        if (validate_shaped_full_dom.length >= 40) {
          break domscan;
        }
      }
    }

    const candidates = [];
    const seen = new Set();

    outer: for (const sel of selList) {
      let nodes;

      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }

      for (const el of nodes) {
        if (candidates.length >= 24) {
          break outer;
        }

        if (!isVis(el)) {
          continue;
        }

        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        const inner = (el.innerText || el.textContent || "").trim();
        const aria = (el.getAttribute("aria-label") || "").trim();
        let lbText = "";
        const lb = el.getAttribute("aria-labelledby");

        if (lb) {
          for (const id of lb.split(/\s+/)) {
            const ref = document.getElementById(id);

            if (ref) {
              lbText += `${(ref.innerText || ref.textContent || "").trim()} `;
            }
          }
        }

        lbText = lbText.trim();
        const title = (el.getAttribute("title") || "").trim();
        const valAttr = tag === "input" ? String(el.value || "").trim() : "";
        const href = tag === "a" ? String(el.getAttribute("href") || "").trim() : "";
        const role = (el.getAttribute("role") || "").trim();

        const primaryText = inner || aria || title || valAttr;

        if (forbiddenLabel(primaryText)) {
          continue;
        }

        if (matchesCheckoutLike(primaryText, href)) {
          continue;
        }

        const vm = matchesValidateIntent(inner, aria, title, valAttr, href);

        if (!vm.ok) {
          continue;
        }

        const disabled =
          el.disabled === true ||
          String(el.getAttribute("aria-disabled") || "").toLowerCase() === "true";

        let css_selector_hint = null;

        if (el.id) {
          try {
            css_selector_hint = `#${CSS.escape(el.id)}`;
          } catch {
            css_selector_hint = null;
          }
        }

        let container_context = null;
        const root =
          el.closest(
            "main, [role=\"main\"], form, table, .cart, [class*=\"cart\" i], .cdk-overlay-pane, [class*=\"cdk-overlay\" i], mat-dialog-container, [role=\"dialog\"]",
          ) || el.parentElement;

        if (root instanceof HTMLElement) {
          container_context = {
            tag: root.tagName.toLowerCase(),
            id: root.id || null,
            class_sample:
              typeof root.className === "string"
                ? root.className.replace(/\s+/g, " ").trim().slice(0, 160)
                : null,
          };
        }

        const key = `${tag}|${primaryText.slice(0, 60)}|${href.slice(0, 60)}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        candidates.push({
          tag,
          text_sample: primaryText.slice(0, 200),
          inner_text_sample: inner.slice(0, 200),
          aria_label: aria || null,
          aria_labelledby_ids: lb || null,
          aria_labelledby_resolved_text_sample: lbText.slice(0, 200) || null,
          title: title || null,
          role: role || null,
          value_attr: valAttr || null,
          href_sample: href.slice(0, 240),
          disabled_reported: disabled,
          validate_match_via: vm.via,
          css_selector_hint,
          container_context,
        });
      }
    }

    return {
      candidates,
      cart_surface_state,
      identity_probe_hits_post_2u,
      identity_text_samples_post_2u,
      delivery_grouping_hits,
      delivery_grouping_visible,
      post_2u_surface_remap,
      validate_shaped_full_dom,
      cart_quick_fingerprint_pre_settle: cartQuickFingerprintAfterGoto,
      cart_quick_fingerprint_post_settle,
      post_2u_dom_progression,
      body_direct_child_explainer_snapshot_post_settle,
      scan_heuristic_readonly_no_clicks: true,
      page_url: window.location.href,
      page_title: document.title || null,
    };
  }, cart_quick_fingerprint_after_goto);

  const body_child_delta_explainer = computeBodyChildDeltaExplainer(
    cart_quick_fingerprint_after_goto?.body_direct_child_explainer_snapshot,
    rawScan.body_direct_child_explainer_snapshot_post_settle,
  );
  rawScan.cart_surface_state = {
    ...rawScan.cart_surface_state,
    body_child_delta_explainer,
  };

    const routeScore = scoreMiloReadonlyCartRouteAttempt(rawScan);
    const sfc = rawScan.cart_surface_state || {};
    readonlyCartRouteProbeAttempts.push({
      attempt_index: routeIdx,
      navigation_method,
      cart_url: cartUrl,
      goto_ok: true,
      ...(safe_cart_icon_click_resolution
        ? { safe_cart_icon_click_resolution }
        : {}),
      ...(navigation_method === "safe_cart_icon_click" && safeCartIconOutputBundle
        ? safeCartIconOutputBundle
        : {}),
      ...(navigation_method === "safe_cart_icon_click"
        ? {
            real_ui_cart_click_succeeded_on_attempt: lastSafeCartIconRealUiSuccess,
            real_ui_cart_click_failed_or_skipped: !lastSafeCartIconRealUiSuccess,
          }
        : {
            real_ui_cart_click_succeeded_on_attempt: false,
            real_ui_cart_click_failed_or_skipped: false,
          }),
      route_score: routeScore,
      cart_row_count_heuristic: sfc.data_row_heuristic_count ?? 0,
      line_items_likely_present_heuristic: sfc.line_items_likely_present_heuristic === true,
      identity_probe_hit_count: Array.isArray(rawScan.identity_probe_hits_post_2u)
        ? rawScan.identity_probe_hits_post_2u.length
        : 0,
      validate_shaped_visible_interactive_count: Array.isArray(rawScan.validate_shaped_full_dom)
        ? rawScan.validate_shaped_full_dom.filter(
            (x) => x && x.client_visible_for_interaction === true,
          ).length
        : 0,
      delivery_grouping_visible: rawScan.delivery_grouping_visible === true,
      page_url_after_scan: rawScan.page_url ?? null,
      body_child_delta_summary: body_child_delta_explainer.summary ?? null,
    });
    if (routeScore > bestRouteScore) {
      bestRouteScore = routeScore;
      winningBundle = {
        routeIdx,
        cartUrl,
        cart_quick_fingerprint_after_goto,
        rawScan,
        body_child_delta_explainer,
        blocked_before_attempt,
        blocked_after_nav,
        network_guard_delta_during_cart_navigation,
      };
    }
    const strongStop =
      routeScore >= 78 ||
      (sfc.line_items_likely_present_heuristic === true &&
        Number(sfc.data_row_heuristic_count || 0) >= 1) ||
      (Array.isArray(rawScan.validate_shaped_full_dom) &&
        rawScan.validate_shaped_full_dom.some((x) => x && x.client_visible_for_interaction === true));
    if (strongStop) {
      break routeloop;
    }
  }

  if (!winningBundle) {
    const err = `MILO cart validate discovery: no successful read-only cart route attempt (${readonlyCartRouteProbeAttempts.length} tries)`;
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_milo_readonly_cart_validate_discovery_blocked",
        message: err,
        attributes: {
          cart_validate_discovery_performed: false,
          block_reason: "all_cart_route_attempts_exhausted",
          readonly_cart_route_probe_attempts: readonlyCartRouteProbeAttempts,
        },
      }),
    );
    throw new Error(err);
  }

  const cartUrl = winningBundle.cartUrl;
  const cart_quick_fingerprint_after_goto = winningBundle.cart_quick_fingerprint_after_goto;
  const rawScan = winningBundle.rawScan;
  const body_child_delta_explainer = winningBundle.body_child_delta_explainer;
  const blocked_before = winningBundle.blocked_before_attempt;
  const blocked_after_nav = winningBundle.blocked_after_nav;
  const network_guard_delta_during_cart_navigation =
    winningBundle.network_guard_delta_during_cart_navigation;
  const safeCartNavAttempt = readonlyCartRouteProbeAttempts.find(
    (a) => a && a.navigation_method === "safe_cart_icon_click",
  );
  const safeCartSnapshotMirror = safeCartNavAttempt?.cart_runtime_top_right_snapshot ?? null;
  const safeCartClickDebugMirror = safeCartNavAttempt?.cart_click_debug ?? null;
  const readonly_cart_route_probe = {
    bounded_model:
      "read_only_safe_cart_icon_optional_then_goto_max_5_urls_no_validate_checkout_submit_finalize",
    safe_cart_icon_first_task_enabled:
      config.addByCodePhase2oMiloSafeCartIconClick === true &&
      config.addByCodePhase2oMiloSafeCartIconClickApproved === true,
    candidate_urls: urlCandidates,
    attempts: readonlyCartRouteProbeAttempts,
    cart_runtime_top_right_snapshot: safeCartSnapshotMirror,
    cart_click_debug: safeCartClickDebugMirror,
    winning_attempt_index: winningBundle.routeIdx,
    winning_cart_url: cartUrl,
    winning_route_score: bestRouteScore,
    real_ui_cart_click: {
      configured: safeCartIconRouteIndex !== null,
      attempted: realUiCartLifecycle.attempted,
      succeeded: realUiCartLifecycle.succeeded,
      cart_runtime_top_right_snapshot: safeCartSnapshotMirror,
      cart_click_debug: safeCartClickDebugMirror,
    },
    winning_route_used_real_ui_cart_click:
      safeCartIconRouteIndex !== null && winningBundle.routeIdx === safeCartIconRouteIndex,
  };

  rawScan.cart_surface_state = {
    ...rawScan.cart_surface_state,
    readonly_cart_route_probe,
  };

  const enriched = [];

  for (const row of rawScan.candidates) {
    const copy = { ...row };

    if (row.css_selector_hint) {
      const loc = page.locator(row.css_selector_hint).first();
      const n = await loc.count().catch(() => 0);

      copy.playwright_match_count = n;
      copy.playwright_visible = n > 0 && (await loc.isVisible().catch(() => false));

      try {
        const br = await extractMutationBoundaryRowFromLocator(loc);

        copy.phase_2q_eligibility_preview = evaluatePhase2qValidateCandidateEligibility(br, []);
      } catch {
        copy.phase_2q_eligibility_preview = null;
      }
    } else {
      copy.playwright_match_count = null;
      copy.playwright_visible = null;
      copy.phase_2q_eligibility_preview = null;
    }

    enriched.push(copy);
  }

  const cartStateClass = classifyMiloReadonlyCartDiscoveryState(
    rawScan.cart_surface_state,
    enriched,
    rawScan.validate_shaped_full_dom,
  );
  const validateHeuristicBodyWide =
    Array.isArray(rawScan.cart_surface_state?.body_wide_cart_like_top_candidates) &&
    rawScan.cart_surface_state.body_wide_cart_like_top_candidates.some(
      (c) => c?.cart_like_signals?.validate_button_text_visible === true,
    );
  const visibleValidateSurface =
    enriched.some((r) => r.playwright_visible === true) ||
    rawScan.validate_shaped_full_dom.some((r) => r.client_visible_for_interaction === true) ||
    validateHeuristicBodyWide;
  const cartRowCount = Number(rawScan?.cart_surface_state?.data_row_heuristic_count || 0);
  const nonEmptyCartHeuristic =
    cartStateClass.classification !== "empty_cart_surface" || cartRowCount > 0;
  const post2uLaneClassification = (() => {
    if (visibleValidateSurface) return "post_2u_validate_surface_visible";
    if (nonEmptyCartHeuristic && (rawScan.identity_probe_hits_post_2u || []).length > 0)
      return "post_2u_identity_visible";
    if (nonEmptyCartHeuristic) return "post_2u_cart_nonempty_but_identity_partial";
    return "post_2u_still_no_evidence";
  })();
  const remapForBoundary = rawScan.post_2u_surface_remap || {};
  const remapNoBetterSurface =
    remapForBoundary.remap_classification === "post_2u_no_better_surface_found" ||
    (Array.isArray(remapForBoundary.ranked_candidates) &&
      remapForBoundary.ranked_candidates.length === 0);
  const boundedPost2uNoEvidenceBoundaryReached =
    cartStateClass.classification === "empty_cart_surface" &&
    cartRowCount === 0 &&
    visibleValidateSurface !== true &&
    rawScan.delivery_grouping_visible !== true &&
    remapNoBetterSurface === true;
  const post2uProbeBoundaryConclusion = {
    classification: boundedPost2uNoEvidenceBoundaryReached
      ? "bounded_post_2u_no_evidence_boundary_reached"
      : "inconclusive",
    proven_in_this_bounded_post_2u_lane: boundedPost2uNoEvidenceBoundaryReached
      ? [
          "no_visible_nonempty_cart_line_evidence_observed",
          "no_visible_validate_surface_observed",
          "no_visible_delivery_grouping_date_evidence_observed",
          "no_better_visible_post_2u_cart_result_surface_found_in_bounded_remap_pass",
        ]
      : [],
    not_proven: [
      "not_proven_2u_never_changes_state_outside_this_bounded_observation_lane",
      "not_proven_broader_or_later_post_2u_observation_would_also_remain_empty",
      "not_proven_validate_boundary_work_impossible_under_redefined_evidence_threshold",
      "not_proven_identity_never_exists_deeper_in_later_cart_stage_behavior",
    ],
    approved_next_decision_options: [
      "conclude_post_2u_non_validate_probe_lane_and_stop",
      "redefine_evidence_threshold_for_validate_boundary_work",
      "shift_to_explicit_validate_boundary_policy_decision_without_new_evidence",
    ],
    compact_human_summary: boundedPost2uNoEvidenceBoundaryReached
      ? "Bounded post-2U non-validate lane reached a no-evidence boundary: no non-empty cart-line heuristics, no visible validate-shaped surface, no delivery/grouping/date signals, and no better cart/result surface in the bounded remap pass."
      : "Bounded post-2U non-validate lane did not satisfy all no-evidence boundary predicates in this run; classification remains inconclusive for formal post-2U closure.",
  };
  const post2uNonValidateObservationLane = {
    lane_name: "post_2u_non_validate_observation_lane",
    classification: post2uLaneClassification,
    cart_row_count_heuristic: cartRowCount,
    visible_identity_terms: rawScan.identity_probe_hits_post_2u || [],
    identity_text_samples: rawScan.identity_text_samples_post_2u || [],
    validate_surface_visible: visibleValidateSurface,
    delivery_grouping_visible: rawScan.delivery_grouping_visible === true,
    delivery_grouping_hits: rawScan.delivery_grouping_hits || [],
    post_2u_surface_remap: rawScan.post_2u_surface_remap || null,
    post_2u_probe_boundary_conclusion: post2uProbeBoundaryConclusion,
    cart_state_classification: cartStateClass.classification,
    cart_state_classification_reason: cartStateClass.reason,
    cart_state_classification_detail: cartStateClass.detail ?? null,
    validate_body_wide_button_text_heuristic: validateHeuristicBodyWide,
    post_2u_dom_progression: rawScan.post_2u_dom_progression ?? null,
    body_child_delta_explainer: body_child_delta_explainer,
    readonly_cart_route_probe: readonly_cart_route_probe,
    scan_read_only_no_clicks: true,
  };

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_milo_readonly_cart_validate_discovery_findings",
      message:
        "MILO read-only cart route probe: bounded URL list + cart surface scan (no validate/checkout click)",
      attributes: {
        cart_url_navigated: cartUrl,
        readonly_cart_route_probe: readonly_cart_route_probe,
        url_before_navigation,
        url_after_navigation: page.url(),
        settle_ms_after_load_used: settleMs,
        network_guard_blocked_before_navigation: blocked_before,
        network_guard_blocked_after_navigation: blocked_after_nav,
        network_guard_delta_during_cart_navigation,
        cart_quick_fingerprint_after_goto: cart_quick_fingerprint_after_goto,
        cart_quick_fingerprint_post_settle: rawScan.cart_quick_fingerprint_post_settle ?? null,
        post_2u_dom_progression: rawScan.post_2u_dom_progression ?? null,
        body_child_delta_explainer: body_child_delta_explainer,
        cart_surface_state: rawScan.cart_surface_state,
        post_2u_non_validate_observation_lane: post2uNonValidateObservationLane,
        validate_shaped_full_dom: rawScan.validate_shaped_full_dom,
        cart_state_classification: cartStateClass.classification,
        cart_state_classification_reason: cartStateClass.reason,
        cart_state_classification_detail: cartStateClass.detail ?? null,
        validate_candidate_rows: enriched,
        raw_dom_scan_meta: {
          page_url: rawScan.page_url,
          page_title: rawScan.page_title,
          scan_heuristic_readonly_no_clicks: rawScan.scan_heuristic_readonly_no_clicks,
        },
        disclaimer:
          "candidates_are_visible_dom_heuristics_only_not_operator_approval_for_phase_2v_execution",
        disclaimer_cart_structure:
          "table_tr_and_li_counts_are_read_only_heuristics_not_server_cart_inventory_proof",
      },
    }),
  );

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_milo_readonly_cart_validate_discovery_post_load_snapshot",
        message:
          "MILO cart surface after read-only navigation (validate discovery only; no validate click)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  await heartbeat({
    progressStage: "mlcc_milo_readonly_cart_validate_discovery_complete",
    progressMessage:
      "MILO cart validate discovery complete (read-only; no validate/checkout/submit)",
  });

  return {
    cart_validate_discovery_performed: true,
    cart_url_navigated: cartUrl,
    validate_candidate_count: enriched.length,
    url_after_navigation: page.url(),
    network_guard_delta_during_cart_navigation,
    cart_state_classification: cartStateClass.classification,
    cart_state_classification_reason: cartStateClass.reason,
    cart_state_classification_detail: cartStateClass.detail ?? null,
    post_2u_non_validate_observation_lane: post2uNonValidateObservationLane,
    post_2u_probe_boundary_conclusion: post2uProbeBoundaryConclusion,
    pre_cart_bycode_list_surface_readonly:
      preCartBycodeListPack.dom_summary,
    real_pre_cart_line_observed_heuristic:
      preCartBycodeListPack.real_pre_cart_line_observed_heuristic,
    tenant_field_both_have_values_heuristic:
      preCartBycodeListPack.tenant_field_both_have_values_heuristic,
    milo_list_root_override_readonly:
      preCartBycodeListPack.list_root_override_readonly,
    list_root_override_populated_heuristic:
      preCartBycodeListPack.list_root_override_readonly
        ?.list_root_override_populated_heuristic === true,
    readonly_cart_route_probe: readonly_cart_route_probe,
    cart_runtime_top_right_snapshot: safeCartSnapshotMirror,
    cart_click_debug: safeCartClickDebugMirror,
  };
}

/**
 * Ordered scope kinds for validate click resolution (main → dialog → tenant boundary → page).
 * @type {readonly string[]}
 */
export const MLCC_PROBE_VALIDATE_LOCATOR_FALLBACK_STRATEGY_ORDER = [
  "main_scoped",
  "dialog_scoped",
  "mutation_boundary_scoped",
  "global_scoped",
];

/**
 * @param {import('playwright').Locator} rootLocator
 * @param {string} selector
 * @param {string} scopeLabel
 */
async function resolveMlccProbeSingleVisibleValidateInRoot(
  rootLocator,
  selector,
  scopeLabel,
) {
  const inner = rootLocator.locator(selector);
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    return {
      outcome: "ok",
      scopeLabel,
      loc: inner.nth(visibleIndices[0]),
      n,
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

/**
 * Strict priority chain for validate / validate-adjacent clicks: main → dialogs → optional
 * mutation-boundary root → global (with multi-visible safe abort). Same policy module as Phase 2q/2v.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {{ mutationBoundaryRootSelector?: string | null }} [options]
 */
export async function resolveMlccProbeValidateClickLocatorWithFallbackChain(
  page,
  selector,
  options = {},
) {
  const strategy_trace = [];
  const boundaryRaw = options?.mutationBoundaryRootSelector;
  const boundarySel =
    boundaryRaw != null && String(boundaryRaw).trim()
      ? String(boundaryRaw).trim()
      : null;

  const mainRoot = page.locator("main, [role='main']").first();
  const mainRes = await resolveMlccProbeSingleVisibleValidateInRoot(
    mainRoot,
    selector,
    "main_scoped",
  );
  strategy_trace.push({ step: "main_scoped", ...mainRes });

  if (mainRes.outcome === "ambiguous") {
    return {
      ok: false,
      reason: "multiple_visible_validate_controls_ambiguous",
      detail: {
        scope: mainRes.scopeLabel,
        n: mainRes.n,
        visible_count: mainRes.visible_count,
        visible_indices: mainRes.visible_indices,
      },
      strategy_trace,
    };
  }

  if (mainRes.outcome === "ok") {
    return {
      ok: true,
      loc: mainRes.loc,
      resolution: mainRes.scopeLabel,
      strategy_trace,
    };
  }

  const dialogCount = await page.locator('[role="dialog"]').count().catch(() => 0);
  const dialogOkHits = [];

  for (let d = 0; d < Math.min(dialogCount, 6); d++) {
    const dlg = page.locator('[role="dialog"]').nth(d);
    const label = `dialog_${d}`;
    const dr = await resolveMlccProbeSingleVisibleValidateInRoot(
      dlg,
      selector,
      label,
    );
    strategy_trace.push({ step: label, ...dr });

    if (dr.outcome === "ambiguous") {
      return {
        ok: false,
        reason: "multiple_visible_validate_controls_ambiguous",
        detail: {
          scope: dr.scopeLabel,
          n: dr.n,
          visible_count: dr.visible_count,
          visible_indices: dr.visible_indices,
        },
        strategy_trace,
      };
    }

    if (dr.outcome === "ok") {
      dialogOkHits.push({ loc: dr.loc, scopeLabel: dr.scopeLabel });
    }
  }

  if (dialogOkHits.length > 1) {
    return {
      ok: false,
      reason: "multiple_dialog_validate_targets_ambiguous",
      detail: {
        dialog_single_hit_count: dialogOkHits.length,
        scopes: dialogOkHits.map((h) => h.scopeLabel),
      },
      strategy_trace,
    };
  }

  if (dialogOkHits.length === 1) {
    return {
      ok: true,
      loc: dialogOkHits[0].loc,
      resolution: dialogOkHits[0].scopeLabel,
      strategy_trace,
    };
  }

  if (boundarySel) {
    const boundaryRoot = page.locator(boundarySel).first();
    const br = await resolveMlccProbeSingleVisibleValidateInRoot(
      boundaryRoot,
      selector,
      "mutation_boundary_scoped",
    );
    strategy_trace.push({ step: "mutation_boundary_scoped", ...br });

    if (br.outcome === "ambiguous") {
      return {
        ok: false,
        reason: "multiple_visible_validate_controls_ambiguous",
        detail: {
          scope: br.scopeLabel,
          n: br.n,
          visible_count: br.visible_count,
          visible_indices: br.visible_indices,
        },
        strategy_trace,
      };
    }

    if (br.outcome === "ok") {
      return {
        ok: true,
        loc: br.loc,
        resolution: br.scopeLabel,
        strategy_trace,
      };
    }
  }

  const global = page.locator(selector);
  const gCount = await global.count().catch(() => 0);

  if (gCount <= 0) {
    return {
      ok: false,
      reason: "no_match",
      detail: { gCount: 0 },
      strategy_trace,
    };
  }

  const visibleIndices = [];
  const cap = Math.min(gCount, 8);

  for (let i = 0; i < cap; i++) {
    const nth = global.nth(i);
    if (await nth.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  strategy_trace.push({
    step: "global_scoped",
    outcome:
      visibleIndices.length > 1
        ? "ambiguous"
        : visibleIndices.length === 1
          ? "ok"
          : "no_visible",
    gCount,
    visible_count: visibleIndices.length,
  });

  if (visibleIndices.length > 1) {
    return {
      ok: false,
      reason: "multiple_visible_validate_controls_ambiguous",
      detail: {
        scope: "global_scoped",
        gCount,
        visible_count: visibleIndices.length,
        visible_indices: visibleIndices,
      },
      strategy_trace,
    };
  }

  if (visibleIndices.length === 1) {
    return {
      ok: true,
      loc: global.nth(visibleIndices[0]),
      resolution: "global_scoped",
      strategy_trace,
    };
  }

  return {
    ok: true,
    loc: global.first(),
    resolution: "global_scoped_no_visible_in_scan_cap_fallback",
    strategy_trace,
  };
}

/**
 * Ordered scope kinds for quantity fill resolution (mirrors validate: main → dialogs → boundary → document).
 * @type {readonly string[]}
 */
export const MLCC_PROBE_QUANTITY_LOCATOR_FALLBACK_STRATEGY_ORDER = [
  "main_scoped",
  "dialog_scoped",
  "mutation_boundary_scoped",
  "global_html_scoped",
];

async function resolveMlccProbeSingleVisibleQuantityTenantInRoot(
  rootLocator,
  selector,
  scopeLabel,
) {
  const inner = rootLocator.locator(selector);
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    const loc = inner.nth(visibleIndices[0]);
    const snap = await readFieldDomSnapshot(loc);
    const surf = phase2jQuantityDomSnapshotAllowed(snap);
    if (!surf.ok) {
      return {
        outcome: "surface_rejected",
        scopeLabel,
        n,
        surface_reason: surf.reason,
      };
    }
    return {
      outcome: "ok",
      scopeLabel,
      loc,
      n,
      strategy: "tenant_css",
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

async function tryResolveQuantitySpinbuttonSingleVisibleInRoot(rootLocator, scopeLabel) {
  const inner = rootLocator.getByRole("spinbutton");
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    const loc = inner.nth(visibleIndices[0]);
    const snap = await readFieldDomSnapshot(loc);
    const surf = phase2jQuantityDomSnapshotAllowed(snap);
    if (!surf.ok) {
      return {
        outcome: "surface_rejected",
        scopeLabel,
        n,
        surface_reason: surf.reason,
      };
    }
    return {
      outcome: "ok",
      scopeLabel,
      loc,
      n,
      strategy: "spinbutton_role_fallback",
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

async function tryResolveQuantityNumberInputSingleVisibleInRoot(rootLocator, scopeLabel) {
  const inner = rootLocator.locator('input[type="number"]');
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    const loc = inner.nth(visibleIndices[0]);
    const snap = await readFieldDomSnapshot(loc);
    const surf = phase2jQuantityDomSnapshotAllowed(snap);
    if (!surf.ok) {
      return {
        outcome: "surface_rejected",
        scopeLabel,
        n,
        surface_reason: surf.reason,
      };
    }
    return {
      outcome: "ok",
      scopeLabel,
      loc,
      n,
      strategy: "number_type_fallback",
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

async function tryAllQuantityStrategiesInRoot(rootLocator, tenantSelector, scopePrefix) {
  const trace = [];

  const t1 = await resolveMlccProbeSingleVisibleQuantityTenantInRoot(
    rootLocator,
    tenantSelector,
    `${scopePrefix}_tenant_css`,
  );
  trace.push({ step: `${scopePrefix}_tenant_css`, ...t1 });
  if (t1.outcome === "ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "multiple_visible_quantity_controls_ambiguous",
      detail: { scope: t1.scopeLabel, strategy: "tenant_css", ...t1 },
      trace,
    };
  }
  if (t1.outcome === "ok") {
    return {
      ok: true,
      loc: t1.loc,
      resolution: t1.scopeLabel,
      strategy: t1.strategy,
      trace,
    };
  }

  const t2 = await tryResolveQuantitySpinbuttonSingleVisibleInRoot(
    rootLocator,
    `${scopePrefix}_spinbutton`,
  );
  trace.push({ step: `${scopePrefix}_spinbutton_fallback`, ...t2 });
  if (t2.outcome === "ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "multiple_visible_quantity_spinbutton_ambiguous",
      detail: { scope: t2.scopeLabel, ...t2 },
      trace,
    };
  }
  if (t2.outcome === "ok") {
    return {
      ok: true,
      loc: t2.loc,
      resolution: t2.scopeLabel,
      strategy: t2.strategy,
      trace,
    };
  }

  const t3 = await tryResolveQuantityNumberInputSingleVisibleInRoot(
    rootLocator,
    `${scopePrefix}_number_input`,
  );
  trace.push({ step: `${scopePrefix}_number_type_fallback`, ...t3 });
  if (t3.outcome === "ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "multiple_visible_quantity_number_inputs_ambiguous",
      detail: { scope: t3.scopeLabel, ...t3 },
      trace,
    };
  }
  if (t3.outcome === "ok") {
    return {
      ok: true,
      loc: t3.loc,
      resolution: t3.scopeLabel,
      strategy: t3.strategy,
      trace,
    };
  }

  return { ok: false, ambiguous: false, reason: "no_match_in_root", trace };
}

/**
 * Multi-strategy quantity field resolution: tenant CSS per scope, then spinbutton role, then single visible
 * `input[type=number]` (Phase 2j surface allowlist). Mirrors validate fallback scoping (main → dialogs → boundary → html).
 *
 * @param {import('playwright').Page} page
 * @param {string} tenantSelector
 * @param {{ mutationBoundaryRootSelector?: string | null }} [options]
 */
export async function resolveMlccProbeQuantityFillLocatorWithFallbackChain(
  page,
  tenantSelector,
  options = {},
) {
  const sel = String(tenantSelector ?? "").trim();
  const strategy_trace = [];
  if (!sel) {
    return {
      ok: false,
      reason: "empty_tenant_quantity_selector",
      strategy_trace,
    };
  }

  const boundaryRaw = options?.mutationBoundaryRootSelector;
  const boundarySel =
    boundaryRaw != null && String(boundaryRaw).trim()
      ? String(boundaryRaw).trim()
      : null;

  const mainRoot = page.locator("main, [role='main']").first();
  const rMain = await tryAllQuantityStrategiesInRoot(mainRoot, sel, "main");
  strategy_trace.push(...rMain.trace);
  if (rMain.ok) {
    return {
      ok: true,
      loc: rMain.loc,
      resolution: rMain.resolution,
      strategy: rMain.strategy,
      strategy_trace,
    };
  }
  if (rMain.ambiguous) {
    return {
      ok: false,
      reason: rMain.reason,
      detail: rMain.detail,
      strategy_trace,
    };
  }

  const dialogCount = await page.locator('[role="dialog"]').count().catch(() => 0);

  for (let d = 0; d < Math.min(dialogCount, 6); d++) {
    const dlg = page.locator('[role="dialog"]').nth(d);
    const rDlg = await tryAllQuantityStrategiesInRoot(dlg, sel, `dialog_${d}`);
    strategy_trace.push(...rDlg.trace);
    if (rDlg.ok) {
      return {
        ok: true,
        loc: rDlg.loc,
        resolution: rDlg.resolution,
        strategy: rDlg.strategy,
        strategy_trace,
      };
    }
    if (rDlg.ambiguous) {
      return {
        ok: false,
        reason: rDlg.reason,
        detail: rDlg.detail,
        strategy_trace,
      };
    }
  }

  if (boundarySel) {
    const boundaryRoot = page.locator(boundarySel).first();
    const rB = await tryAllQuantityStrategiesInRoot(boundaryRoot, sel, "mutation_boundary");
    strategy_trace.push(...rB.trace);
    if (rB.ok) {
      return {
        ok: true,
        loc: rB.loc,
        resolution: rB.resolution,
        strategy: rB.strategy,
        strategy_trace,
      };
    }
    if (rB.ambiguous) {
      return {
        ok: false,
        reason: rB.reason,
        detail: rB.detail,
        strategy_trace,
      };
    }
  }

  const htmlRoot = page.locator("html").first();
  const rGlob = await tryAllQuantityStrategiesInRoot(htmlRoot, sel, "global_html");
  strategy_trace.push(...rGlob.trace);
  if (rGlob.ok) {
    return {
      ok: true,
      loc: rGlob.loc,
      resolution: rGlob.resolution,
      strategy: rGlob.strategy,
      strategy_trace,
    };
  }
  if (rGlob.ambiguous) {
    return {
      ok: false,
      reason: rGlob.reason,
      detail: rGlob.detail,
      strategy_trace,
    };
  }

  return {
    ok: false,
    reason: "no_resolvable_quantity_field",
    strategy_trace,
  };
}

/**
 * Ordered scope kinds for code-field fill resolution (mirrors quantity / validate).
 * @type {readonly string[]}
 */
export const MLCC_PROBE_CODE_FIELD_LOCATOR_FALLBACK_STRATEGY_ORDER = [
  "main_scoped",
  "dialog_scoped",
  "mutation_boundary_scoped",
  "global_html_scoped",
];

async function resolveMlccProbeSingleVisibleCodeTenantInRoot(
  rootLocator,
  selector,
  scopeLabel,
) {
  const inner = rootLocator.locator(selector);
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    const loc = inner.nth(visibleIndices[0]);
    const snap = await readFieldDomSnapshot(loc);
    const surf = phase2lCodeFieldDomSnapshotAllowed(snap);
    if (!surf.ok) {
      return {
        outcome: "surface_rejected",
        scopeLabel,
        n,
        surface_reason: surf.reason,
      };
    }
    return {
      outcome: "ok",
      scopeLabel,
      loc,
      n,
      strategy: "tenant_css",
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

async function tryResolveCodePlaceholderSingleVisibleInRoot(rootLocator, scopeLabel) {
  const inner = rootLocator.getByPlaceholder(
    /search\s*by\s*code|product\s*code|enter\s*code|sku|lookup\s*code/i,
  );
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    const loc = inner.nth(visibleIndices[0]);
    const snap = await readFieldDomSnapshot(loc);
    const surf = phase2lCodeFieldDomSnapshotAllowed(snap);
    if (!surf.ok) {
      return {
        outcome: "surface_rejected",
        scopeLabel,
        n,
        surface_reason: surf.reason,
      };
    }
    return {
      outcome: "ok",
      scopeLabel,
      loc,
      n,
      strategy: "placeholder_regex_fallback",
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

async function tryResolveCodeComboboxRoleSingleVisibleInRoot(rootLocator, scopeLabel) {
  const inner = rootLocator.getByRole("combobox", {
    name: /code|by\s*code|product|sku|search/i,
  });
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    const loc = inner.nth(visibleIndices[0]);
    const snap = await readFieldDomSnapshot(loc);
    const surf = phase2lCodeFieldDomSnapshotAllowed(snap);
    if (!surf.ok) {
      return {
        outcome: "surface_rejected",
        scopeLabel,
        n,
        surface_reason: surf.reason,
      };
    }
    return {
      outcome: "ok",
      scopeLabel,
      loc,
      n,
      strategy: "combobox_role_fallback",
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

async function tryResolveCodeTextboxRoleSingleVisibleInRoot(rootLocator, scopeLabel) {
  const inner = rootLocator.getByRole("textbox", {
    name: /search\s*by\s*code|product\s*code|by\s*code|sku|item\s*code/i,
  });
  const n = await inner.count().catch(() => 0);

  if (n <= 0) {
    return { outcome: "no_match", scopeLabel, n: 0 };
  }

  const visibleIndices = [];
  const cap = Math.min(n, 8);

  for (let i = 0; i < cap; i++) {
    const loc = inner.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length > 1) {
    return {
      outcome: "ambiguous",
      scopeLabel,
      n,
      visible_count: visibleIndices.length,
      visible_indices: visibleIndices,
    };
  }

  if (visibleIndices.length === 1) {
    const loc = inner.nth(visibleIndices[0]);
    const snap = await readFieldDomSnapshot(loc);
    const surf = phase2lCodeFieldDomSnapshotAllowed(snap);
    if (!surf.ok) {
      return {
        outcome: "surface_rejected",
        scopeLabel,
        n,
        surface_reason: surf.reason,
      };
    }
    return {
      outcome: "ok",
      scopeLabel,
      loc,
      n,
      strategy: "textbox_role_fallback",
    };
  }

  return { outcome: "no_visible", scopeLabel, n };
}

async function tryAllCodeStrategiesInRoot(rootLocator, tenantSelector, scopePrefix) {
  const trace = [];

  const t1 = await resolveMlccProbeSingleVisibleCodeTenantInRoot(
    rootLocator,
    tenantSelector,
    `${scopePrefix}_tenant_css`,
  );
  trace.push({ step: `${scopePrefix}_tenant_css`, ...t1 });
  if (t1.outcome === "ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "multiple_visible_code_tenant_ambiguous",
      detail: { scope: t1.scopeLabel, strategy: "tenant_css", ...t1 },
      trace,
    };
  }
  if (t1.outcome === "ok") {
    return {
      ok: true,
      loc: t1.loc,
      resolution: t1.scopeLabel,
      strategy: t1.strategy,
      trace,
    };
  }

  const t2 = await tryResolveCodePlaceholderSingleVisibleInRoot(
    rootLocator,
    `${scopePrefix}_placeholder`,
  );
  trace.push({ step: `${scopePrefix}_placeholder_fallback`, ...t2 });
  if (t2.outcome === "ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "multiple_visible_code_placeholder_ambiguous",
      detail: { scope: t2.scopeLabel, ...t2 },
      trace,
    };
  }
  if (t2.outcome === "ok") {
    return {
      ok: true,
      loc: t2.loc,
      resolution: t2.scopeLabel,
      strategy: t2.strategy,
      trace,
    };
  }

  const t3 = await tryResolveCodeComboboxRoleSingleVisibleInRoot(
    rootLocator,
    `${scopePrefix}_combobox`,
  );
  trace.push({ step: `${scopePrefix}_combobox_role_fallback`, ...t3 });
  if (t3.outcome === "ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "multiple_visible_code_combobox_ambiguous",
      detail: { scope: t3.scopeLabel, ...t3 },
      trace,
    };
  }
  if (t3.outcome === "ok") {
    return {
      ok: true,
      loc: t3.loc,
      resolution: t3.scopeLabel,
      strategy: t3.strategy,
      trace,
    };
  }

  const t4 = await tryResolveCodeTextboxRoleSingleVisibleInRoot(
    rootLocator,
    `${scopePrefix}_textbox`,
  );
  trace.push({ step: `${scopePrefix}_textbox_role_fallback`, ...t4 });
  if (t4.outcome === "ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "multiple_visible_code_textbox_ambiguous",
      detail: { scope: t4.scopeLabel, ...t4 },
      trace,
    };
  }
  if (t4.outcome === "ok") {
    return {
      ok: true,
      loc: t4.loc,
      resolution: t4.scopeLabel,
      strategy: t4.strategy,
      trace,
    };
  }

  return { ok: false, ambiguous: false, reason: "no_match_in_root", trace };
}

/**
 * Multi-strategy code-field resolution: tenant CSS per scope, then placeholder regex, then combobox/textbox roles
 * (Phase 2l surface allowlist). Scopes mirror quantity: main → dialogs → mutation boundary → document.
 *
 * @param {import('playwright').Page} page
 * @param {string} tenantSelector
 * @param {{ mutationBoundaryRootSelector?: string | null }} [options]
 */
export async function resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(
  page,
  tenantSelector,
  options = {},
) {
  const sel = String(tenantSelector ?? "").trim();
  const strategy_trace = [];
  if (!sel) {
    return {
      ok: false,
      reason: "empty_tenant_code_field_selector",
      strategy_trace,
    };
  }

  const boundaryRaw = options?.mutationBoundaryRootSelector;
  const boundarySel =
    boundaryRaw != null && String(boundaryRaw).trim()
      ? String(boundaryRaw).trim()
      : null;

  const mainRoot = page.locator("main, [role='main']").first();
  const rMain = await tryAllCodeStrategiesInRoot(mainRoot, sel, "main");
  strategy_trace.push(...rMain.trace);
  if (rMain.ok) {
    return {
      ok: true,
      loc: rMain.loc,
      resolution: rMain.resolution,
      strategy: rMain.strategy,
      strategy_trace,
    };
  }
  if (rMain.ambiguous) {
    return {
      ok: false,
      reason: rMain.reason,
      detail: rMain.detail,
      strategy_trace,
    };
  }

  const dialogCount = await page.locator('[role="dialog"]').count().catch(() => 0);

  for (let d = 0; d < Math.min(dialogCount, 6); d++) {
    const dlg = page.locator('[role="dialog"]').nth(d);
    const rDlg = await tryAllCodeStrategiesInRoot(dlg, sel, `dialog_${d}`);
    strategy_trace.push(...rDlg.trace);
    if (rDlg.ok) {
      return {
        ok: true,
        loc: rDlg.loc,
        resolution: rDlg.resolution,
        strategy: rDlg.strategy,
        strategy_trace,
      };
    }
    if (rDlg.ambiguous) {
      return {
        ok: false,
        reason: rDlg.reason,
        detail: rDlg.detail,
        strategy_trace,
      };
    }
  }

  if (boundarySel) {
    const boundaryRoot = page.locator(boundarySel).first();
    const rB = await tryAllCodeStrategiesInRoot(boundaryRoot, sel, "mutation_boundary");
    strategy_trace.push(...rB.trace);
    if (rB.ok) {
      return {
        ok: true,
        loc: rB.loc,
        resolution: rB.resolution,
        strategy: rB.strategy,
        strategy_trace,
      };
    }
    if (rB.ambiguous) {
      return {
        ok: false,
        reason: rB.reason,
        detail: rB.detail,
        strategy_trace,
      };
    }
  }

  const htmlRoot = page.locator("html").first();
  const rGlob = await tryAllCodeStrategiesInRoot(htmlRoot, sel, "global_html");
  strategy_trace.push(...rGlob.trace);
  if (rGlob.ok) {
    return {
      ok: true,
      loc: rGlob.loc,
      resolution: rGlob.resolution,
      strategy: rGlob.strategy,
      strategy_trace,
    };
  }
  if (rGlob.ambiguous) {
    return {
      ok: false,
      reason: rGlob.reason,
      detail: rGlob.detail,
      strategy_trace,
    };
  }

  return {
    ok: false,
    reason: "no_resolvable_code_field",
    strategy_trace,
  };
}

/**
 * Phase 2q: at most one bounded validate click; optional read-only post-validate scrape (no further clicks).
 * No checkout, submit, or order finalization.
 */
export async function runAddByCodePhase2qBoundedValidateSingleClick({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  phase2nResult,
  phase2oResult,
}) {
  const gateManifest = buildPhase2pValidateFutureGateManifest();
  const postValidateLadder = buildPhase2pPostValidateLadder();
  const postObserveMs = config.addByCodePhase2qPostValidateObserveSettleMs ?? 400;

  await heartbeat({
    progressStage: "mlcc_phase_2q_validate_start",
    progressMessage:
      "Phase 2q: tightly gated single validate click (no checkout/submit/finalize)",
  });

  const mutation_risk_checks_used = [
    `phase_2p_policy_version_${PHASE_2P_POLICY_VERSION}`,
    `phase_2q_policy_version_${PHASE_2Q_VALIDATE_POLICY_VERSION}`,
    "phase_2p_validate_future_gate_manifest_echoed_in_evidence",
    "phase_2p_post_validate_ladder_echoed_in_evidence",
    "prerequisite_phase_2n_add_apply_click_performed_true_same_run",
    "prerequisite_phase_2o_success_or_operator_explicit_waiver_when_2o_disabled",
    "tenant_validate_selector_list_only_no_heuristic_only_path",
    "layer_2_abort_counter_delta_zero_for_full_declared_phase_window_including_post_readonly_scrape",
    "layer_3_evaluatePhase2qValidateCandidateEligibility",
    "at_most_one_validate_click_in_this_phase_zero_additional_playwright_clicks",
    "optional_read_only_post_validate_snapshot_via_collectPhase2oReadOnlyObservationSnapshot_no_clicks",
    "no_checkout_submit_finalize_or_second_validate_in_this_phase",
  ];

  if (!phase2nResult || phase2nResult.add_apply_click_performed !== true) {
    const err =
      "Phase 2q requires Phase 2n to have completed with add_apply_click_performed=true in the same run";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: err,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
          phase_2p_validate_gate_manifest: gateManifest,
          phase_2p_post_validate_ladder: postValidateLadder,
          validate_click_performed: false,
          block_reason: "phase_2n_prerequisite_not_satisfied",
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        },
      }),
    );

    throw new Error(err);
  }

  if (config.addByCodePhase2o === true) {
    if (!phase2oResult || phase2oResult.observation_performed !== true) {
      const err =
        "Phase 2q requires Phase 2o to have completed with observation_performed=true when MLCC_ADD_BY_CODE_PHASE_2O is enabled";

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2q_validate_blocked",
          message: err,
          attributes: {
            phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
            phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
            phase_2p_validate_gate_manifest: gateManifest,
            validate_click_performed: false,
            block_reason: "phase_2o_prerequisite_not_satisfied",
            mutation_risk_checks_used,
            mandatory_disclaimers: gateManifest.mandatory_disclaimers,
          },
        }),
      );

      throw new Error(err);
    }

    if (phase2oResult.no_new_blocked_downstream_requests_observed === false) {
      const err =
        "Phase 2q requires Phase 2o no_new_blocked_downstream_requests_observed !== false when 2o is enabled";

      evidenceCollected.push(
        buildEvidence({
          kind: "mlcc_add_by_code_probe",
          stage: "mlcc_phase_2q_validate_blocked",
          message: err,
          attributes: {
            phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
            validate_click_performed: false,
            block_reason: "phase_2o_layer2_prerequisite_failed",
            mutation_risk_checks_used,
            mandatory_disclaimers: gateManifest.mandatory_disclaimers,
          },
        }),
      );

      throw new Error(err);
    }
  } else if (config.addByCodePhase2qOperatorAcceptsMissing2o !== true) {
    const err =
      "Phase 2q when Phase 2o is disabled requires MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true (explicit tenant acknowledgment per Phase 2p)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: err,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          validate_click_performed: false,
          block_reason: "missing_operator_acceptance_for_skipped_phase_2o",
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        },
      }),
    );

    throw new Error(err);
  }

  const candidates = config.addByCodePhase2qValidateCandidateSelectors ?? [];
  const allowSubs = config.addByCodePhase2qTextAllowSubstrings ?? [];

  if (!Array.isArray(candidates) || candidates.length === 0) {
    const err =
      "Phase 2q requires MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS (non-empty tenant selector list)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: err,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          validate_click_performed: false,
          block_reason: "missing_tenant_validate_selectors",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const blocked_at_phase_start =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2q_pre_validate_snapshot",
        message:
          "Phase 2q checkpoint before single validate click (policy + selector scan)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2q_pre_validate_evidence",
      message:
        "Phase 2q pre-click: Phase 2p gate manifest; validate candidate evaluation only until one eligible control",
      attributes: {
        phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
        phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
        phase_2p_validate_gate_manifest: gateManifest,
        phase_2p_post_validate_ladder: postValidateLadder,
        dry_run_safe_mode_expected: true,
        candidate_selectors_configured: candidates,
        text_allow_substrings_configured: allowSubs,
        post_validate_observe_settle_ms: postObserveMs,
        network_guard_blocked_request_count_at_phase_start:
          blocked_at_phase_start,
        mutation_risk_checks_used,
        mandatory_disclaimers: gateManifest.mandatory_disclaimers,
        truthfulness_note:
          "this_phase_does_not_claim_backend_order_truth_or_checkout_readiness",
      },
    }),
  );

  const evaluations = [];

  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    const n = await loc.count().catch(() => 0);

    if (n === 0) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_selector_no_match",
      });
      continue;
    }

    const vis = await loc.isVisible().catch(() => false);

    if (!vis) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_not_visible",
      });
      continue;
    }

    const disabled = await loc.isDisabled().catch(() => false);

    if (disabled) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_disabled_control",
      });
      continue;
    }

    const row = await extractMutationBoundaryRowFromLocator(loc);
    const elig = evaluatePhase2qValidateCandidateEligibility(row, allowSubs);

    evaluations.push({
      selector: sel,
      visible: true,
      disabled: false,
      tag: row.tag,
      text_sample: (row.text ?? "").slice(0, 200),
      href_sample: String(row.href ?? "").slice(0, 200),
      ...elig,
    });
  }

  const firstEligible = evaluations.find((e) => e.eligible === true);

  if (!firstEligible) {
    const err =
      "Phase 2q: no eligible validate candidate (Layer 2/3 + mutation-boundary policy rejected all tenant selectors)";

    const safeModeFailureForensicsNoCand =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: err,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          candidate_evaluations: evaluations,
          validate_click_performed: false,
          block_reason: "no_eligible_candidate",
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
          safe_mode_failure_forensics: safeModeFailureForensicsNoCand,
        },
      }),
    );

    throw new Error(err);
  }

  const resolved = await resolveMlccProbeValidateClickLocatorWithFallbackChain(
    page,
    firstEligible.selector,
    {
      mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null,
    },
  );

  const ambiguousResolution =
    !resolved.ok &&
    (resolved.reason === "multiple_visible_validate_controls_ambiguous" ||
      resolved.reason === "multiple_dialog_validate_targets_ambiguous");

  if (ambiguousResolution) {
    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const msg = `Phase 2q: ambiguous validate targets after fallback chain; refusing click (${firstEligible.selector})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: msg,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          candidate_evaluations: evaluations,
          validate_click_performed: false,
          block_reason: resolved.reason,
          phase_2q_click_locator_resolution: resolved.detail ?? null,
          phase_2q_validate_locator_strategy_trace: resolved.strategy_trace ?? null,
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
          safe_mode_failure_forensics: safeModeFailureForensics,
        },
      }),
    );

    throw new Error(msg);
  }

  if (!resolved.ok) {
    const safeModeFailureForensicsRes =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const msg = `Phase 2q: validate locator resolution failed (${resolved.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: msg,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          candidate_evaluations: evaluations,
          validate_click_performed: false,
          block_reason: resolved.reason,
          selector_attempted: firstEligible.selector,
          phase_2q_click_locator_resolution: resolved.detail ?? null,
          phase_2q_validate_locator_strategy_trace: resolved.strategy_trace ?? null,
          mutation_risk_checks_used,
          mandatory_disclaimers: gateManifest.mandatory_disclaimers,
          safe_mode_failure_forensics: safeModeFailureForensicsRes,
        },
      }),
    );

    throw new Error(msg);
  }

  const clickLoc = resolved.loc;

  try {
    await clickLoc.click({ timeout: 12_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: `Phase 2q: validate click failed: ${m}`,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          candidate_evaluations: evaluations,
          selector_attempted: firstEligible.selector,
          phase_2q_click_locator_resolution: resolved.resolution,
          phase_2q_validate_locator_strategy_trace: resolved.strategy_trace ?? null,
          validate_click_performed: false,
          block_reason: `click_error:${m}`,
          mutation_risk_checks_used,
          safe_mode_failure_forensics: safeModeFailureForensics,
        },
      }),
    );

    throw new Error(`Phase 2q validate click failed: ${m}`);
  }

  await page
    .waitForLoadState("domcontentloaded", { timeout: 45_000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 600));

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2q_after_validate_click",
        message:
          "Phase 2q checkpoint after exactly one validate click (no checkout/submit)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const blocked_after_click =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_through_click =
    blocked_at_phase_start != null && blocked_after_click != null
      ? blocked_after_click - blocked_at_phase_start
      : null;

  if (
    network_guard_delta_through_click != null &&
    network_guard_delta_through_click !== 0
  ) {
    const err = `Phase 2q: Layer 2 blocked request counter increased during validate click window (delta=${network_guard_delta_through_click})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: err,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          candidate_evaluations: evaluations,
          selector_clicked: firstEligible.selector,
          validate_click_performed: true,
          network_guard_blocked_at_phase_start: blocked_at_phase_start,
          network_guard_blocked_after_click: blocked_after_click,
          block_reason: "positive_layer2_abort_delta_during_validate_click",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  let post_validate_read_only_snapshot = null;

  if (postObserveMs > 0) {
    await new Promise((r) => setTimeout(r, postObserveMs));
    post_validate_read_only_snapshot =
      await collectPhase2oReadOnlyObservationSnapshot(page, config);

    if (typeof buildStepEvidence === "function") {
      evidenceCollected.push(
        await buildStepEvidence({
          page,
          stage: "mlcc_phase_2q_post_validate_readonly_snapshot",
          message:
            "Phase 2q read-only post-validate scrape (no clicks; not checkout)",
          kind: "mlcc_add_by_code_probe",
          buildEvidence,
          config,
        }),
      );
    }
  }

  const blocked_at_phase_end =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_full_phase_window =
    blocked_at_phase_start != null && blocked_at_phase_end != null
      ? blocked_at_phase_end - blocked_at_phase_start
      : null;

  if (
    network_guard_delta_full_phase_window != null &&
    network_guard_delta_full_phase_window !== 0
  ) {
    const err = `Phase 2q: Layer 2 blocked request counter increased over full validate phase window including post-readonly scrape (delta=${network_guard_delta_full_phase_window})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: err,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          candidate_evaluations: evaluations,
          selector_clicked: firstEligible.selector,
          validate_click_performed: true,
          post_validate_read_only_snapshot_present: post_validate_read_only_snapshot != null,
          network_guard_blocked_at_phase_start: blocked_at_phase_start,
          network_guard_blocked_at_phase_end: blocked_at_phase_end,
          block_reason: "positive_layer2_abort_delta_full_phase_window",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2q_validate_findings",
      message:
        "Phase 2q: single validate click completed; no checkout/submit/finalize in this phase",
      attributes: {
        phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
        phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
        phase_2p_validate_gate_manifest: gateManifest,
        phase_2p_post_validate_ladder: postValidateLadder,
        candidate_evaluations: evaluations,
        validate_click_performed: true,
        click_count_this_phase: 1,
        selector_clicked: firstEligible.selector,
        playwright_clicks_after_validate: 0,
        post_validate_observe_settle_ms_used: postObserveMs,
        post_validate_read_only_snapshot:
          post_validate_read_only_snapshot,
        network_guard_blocked_at_phase_start: blocked_at_phase_start,
        network_guard_blocked_after_click: blocked_after_click,
        network_guard_blocked_at_phase_end: blocked_at_phase_end,
        network_guard_delta_full_phase_window,
        no_new_blocked_downstream_requests_observed:
          network_guard_delta_full_phase_window === null
            ? null
            : network_guard_delta_full_phase_window === 0,
        run_remained_without_checkout_submit_finalize_phase: true,
        disclaimer_layer2_abort_observation:
          "zero_delta_on_client_blocked_request_counter_for_configured_patterns_does_not_prove_no_backend_order_mutation",
        disclaimer_browser_not_backend_order_truth:
          "visible_messages_and_dom_do_not_prove_backend_order_inventory_or_checkout_safety",
        disclaimer_no_general_validate_safety_claim:
          "single_tenant_single_run_does_not_establish_general_validate_safety",
        disclaimer_no_checkout_readiness:
          "this_phase_does_not_assess_readiness_for_checkout_or_submit",
        typing_policy_phase_2q:
          "no_checkout_no_submit_no_finalize_no_second_validate",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2q_validate_complete",
    progressMessage:
      "Phase 2q complete (one validate click only; checkout/submit/finalize out of scope)",
  });

  return {
    phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
    phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
    validate_click_performed: true,
    selector_clicked: firstEligible.selector,
    candidate_evaluations: evaluations,
    network_guard_delta_full_phase_window,
    no_new_blocked_downstream_requests_observed:
      network_guard_delta_full_phase_window === null
        ? null
        : network_guard_delta_full_phase_window === 0,
    post_validate_read_only_snapshot_present:
      post_validate_read_only_snapshot != null,
    phase_2p_gate_manifest_version: gateManifest.version,
  };
}

/**
 * Phase 2r: read-only observation after Phase 2q validate click. Zero Playwright clicks.
 * No checkout, submit, finalize, or second validate.
 */
export async function runAddByCodePhase2rPostValidateObservation({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  phase2qResult,
}) {
  const gateManifest = buildPhase2pValidateFutureGateManifest();
  const postValidateLadder = buildPhase2pPostValidateLadder();
  const settleMs = config.addByCodePhase2rSettleMs ?? 600;

  await heartbeat({
    progressStage: "mlcc_phase_2r_observation_start",
    progressMessage:
      "Phase 2r: read-only post-validate observation (no clicks; no checkout/submit/finalize)",
  });

  const mutation_risk_checks_used = [
    `phase_2p_policy_version_${PHASE_2P_POLICY_VERSION}`,
    `phase_2r_policy_version_${PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION}`,
    "read_only_zero_playwright_clicks_after_validate",
    "layer_2_guardstats_blockedrequestcount_delta_zero_required_across_observation_window",
    "phase_2q_prerequisite_validate_click_performed_true",
    "post_validate_ladder_step_echoed_from_phase_2p",
    "inferred_checkout_like_scan_visible_dom_only_not_clicked",
  ];

  if (!phase2qResult || phase2qResult.validate_click_performed !== true) {
    const err =
      "Phase 2r requires Phase 2q to have completed with validate_click_performed=true in the same run";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2r_observation_blocked",
        message: err,
        attributes: {
          phase_2r_policy_version: PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION,
          phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
          phase_2p_validate_gate_manifest: gateManifest,
          phase_2p_post_validate_ladder: postValidateLadder,
          observation_performed: false,
          block_reason: "phase_2q_prerequisite_missing_or_no_validate_click",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  if (phase2qResult.no_new_blocked_downstream_requests_observed === false) {
    const err =
      "Phase 2r requires Phase 2q no_new_blocked_downstream_requests_observed !== false (Layer 2 prerequisite from validate phase)";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2r_observation_blocked",
        message: err,
        attributes: {
          phase_2r_policy_version: PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION,
          observation_performed: false,
          block_reason: "phase_2q_layer2_prerequisite_failed",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const blocked_at_observation_start =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2r_pre_observation_snapshot",
        message:
          "Phase 2r pre-observation snapshot after validate (read-only; before settle window)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const observation_pre =
    await collectPhase2rPostValidateReadOnlyObservationSnapshot(page, config);

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2r_pre_observation_evidence",
      message:
        "Phase 2r pre-settle read-only scrape after validate (no clicks; DOM/status/inferred checkout-adjacent scan only)",
      attributes: {
        phase_2r_policy_version: PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION,
        phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
        phase_2p_validate_gate_manifest: gateManifest,
        ladder_step_post_validate_observation:
          postValidateLadder.steps?.find((s) => s.id === "post_validate_observation") ??
          null,
        settle_ms_configured: settleMs,
        observation_pre,
        phase_2q_selector_used: phase2qResult.selector_clicked ?? null,
        network_guard_blocked_request_count_at_window_start:
          blocked_at_observation_start,
        mutation_risk_checks_used,
        disclaimer_dom_observation_only:
          "visible_text_field_and_control_samples_do_not_prove_backend_order_cart_or_inventory_truth",
        disclaimer_no_checkout_submit_readiness:
          "inferred_checkout_like_controls_are_visible_text_heuristic_only_not_safe_to_click_or_submit",
        disclaimer_inferred_labels:
          "checkout_like_scan_is_pattern_match_on_visible_dom_not_authorization_to_proceed",
      },
    }),
  );

  await new Promise((r) => setTimeout(r, settleMs));

  const blocked_after_settle =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_during_pre_scrape =
    blocked_at_observation_start != null && blocked_after_settle != null
      ? blocked_after_settle - blocked_at_observation_start
      : null;

  if (
    network_guard_delta_during_pre_scrape != null &&
    network_guard_delta_during_pre_scrape !== 0
  ) {
    const err = `Phase 2r: Layer 2 blocked request counter increased during observation window (delta=${network_guard_delta_during_pre_scrape} after pre-scrape/settle)`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2r_observation_blocked",
        message: err,
        attributes: {
          phase_2r_policy_version: PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION,
          observation_performed: false,
          observation_pre,
          block_reason: "positive_layer2_abort_delta_during_observation",
          network_guard_blocked_at_window_start: blocked_at_observation_start,
          network_guard_blocked_after_settle: blocked_after_settle,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2r_post_observation_snapshot",
        message:
          "Phase 2r post-settle snapshot (read-only; no checkout/submit clicks)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const observation_post =
    await collectPhase2rPostValidateReadOnlyObservationSnapshot(page, config);

  const blocked_at_observation_end =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const network_guard_delta_full_observation_window =
    blocked_at_observation_start != null && blocked_at_observation_end != null
      ? blocked_at_observation_end - blocked_at_observation_start
      : null;

  if (
    network_guard_delta_full_observation_window != null &&
    network_guard_delta_full_observation_window !== 0
  ) {
    const err = `Phase 2r: Layer 2 blocked request counter increased during full observation window (delta=${network_guard_delta_full_observation_window})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2r_observation_blocked",
        message: err,
        attributes: {
          phase_2r_policy_version: PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION,
          observation_performed: false,
          observation_pre,
          observation_post,
          block_reason: "positive_layer2_abort_delta_full_observation_window",
          network_guard_blocked_at_window_start: blocked_at_observation_start,
          network_guard_blocked_at_window_end: blocked_at_observation_end,
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const observation_diff = diffPhase2rPostValidateObservationSnapshots(
    observation_pre,
    observation_post,
  );

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2r_observation_findings",
      message:
        "Phase 2r read-only post-validate observation complete (no checkout/submit/finalize; no second validate)",
      attributes: {
        phase_2r_policy_version: PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION,
        phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
        phase_2p_post_validate_ladder: postValidateLadder,
        settle_ms_used: settleMs,
        observation_pre,
        observation_post,
        observation_diff,
        clicks_performed_this_phase: 0,
        network_guard_blocked_at_window_start: blocked_at_observation_start,
        network_guard_blocked_at_window_end: blocked_at_observation_end,
        network_guard_delta_full_observation_window,
        no_new_blocked_downstream_requests_observed:
          network_guard_delta_full_observation_window === null
            ? null
            : network_guard_delta_full_observation_window === 0,
        page_appears_changed_visible_dom_heuristic:
          observation_diff.any_heuristic_dom_or_signal_delta === true,
        mutation_risk_checks_used,
        disclaimer_observation_not_server_order_truth:
          "browser_visible_signals_do_not_prove_server_order_line_items_or_validate_outcome",
        disclaimer_checkout_like_inference_only:
          "checkout_like_controls_inferred_are_regex_visible_text_hits_not_proof_controls_are_safe_or_enabled_for_real_checkout",
        disclaimer_no_submit_readiness:
          "this_phase_does_not_assess_submit_finalize_or_purchase_readiness",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2r_observation_complete",
    progressMessage:
      "Phase 2r complete (read-only post-validate only; checkout/submit/finalize out of scope)",
  });

  return {
    phase_2r_policy_version: PHASE_2R_POST_VALIDATE_OBSERVATION_POLICY_VERSION,
    phase_2p_policy_version: PHASE_2P_POLICY_VERSION,
    observation_performed: true,
    settle_ms_used: settleMs,
    observation_diff,
    network_guard_delta_full_observation_window,
    no_new_blocked_downstream_requests_observed:
      network_guard_delta_full_observation_window === null
        ? null
        : network_guard_delta_full_observation_window === 0,
    page_appears_changed_visible_dom_heuristic:
      observation_diff.any_heuristic_dom_or_signal_delta === true,
  };
}

async function extractFieldLabelsAndHintsReadonly(locator) {
  return locator.evaluate((el) => {
    const out = {
      associated_labels: [],
      aria_label: null,
      describedby_texts: [],
    };
    const al = el.getAttribute("aria-label");
    out.aria_label = al && al.trim() ? al.trim().slice(0, 500) : null;
    const id = el.id;
    if (id && typeof id === "string") {
      try {
        document.querySelectorAll(`label[for="${CSS.escape(id)}"]`).forEach((lb) => {
          const t = (lb.innerText || lb.textContent || "").trim().slice(0, 400);
          if (t) out.associated_labels.push(t);
        });
      } catch {
        /* ignore */
      }
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const rid of labelledBy.trim().split(/\s+/)) {
        if (!rid) continue;
        const node = document.getElementById(rid);
        if (node) {
          const t = (node.innerText || node.textContent || "").trim().slice(0, 400);
          if (t) out.associated_labels.push(`(aria-labelledby ${rid}) ${t}`);
        }
      }
    }
    const describedby = el.getAttribute("aria-describedby");
    if (describedby) {
      for (const rid of describedby.trim().split(/\s+/)) {
        if (!rid) continue;
        const node = document.getElementById(rid);
        if (node) {
          const t = (node.innerText || node.textContent || "").trim().slice(0, 400);
          if (t) out.describedby_texts.push({ id: rid, text: t });
        }
      }
    }
    return out;
  });
}

async function collectHelpErrorValidationTextNearFieldReadonly(locator) {
  return locator.evaluate((el) => {
    const out = [];
    const seen = new Set();
    const addText = (source, text) => {
      const t = text.replace(/\s+/g, " ").trim().slice(0, 350);
      if (t.length < 2) return;
      const key = `${source}|${t.slice(0, 100)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ source, text_sample: t });
    };
    const scanRoot = (root) => {
      if (!(root instanceof HTMLElement)) return;
      const sel = [
        '[role="alert"]',
        '[role="status"]',
        "small",
        ".invalid-feedback",
        ".form-text",
        ".help-block",
        '[class*="error"]',
        '[class*="help"]',
        '[class*="hint"]',
      ].join(",");
      try {
        root.querySelectorAll(sel).forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          const st = window.getComputedStyle(n);
          if (st.display === "none" || st.visibility === "hidden") return;
          const raw = (n.innerText || n.textContent || "").trim();
          if (!raw) return;
          const cls =
            typeof n.className === "string" && n.className
              ? n.className.split(/\s+/).slice(0, 2).join(".")
              : "";
          addText(`${n.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`, raw);
        });
      } catch {
        /* ignore */
      }
    };
    let cur = el.parentElement;
    for (let depth = 0; depth < 3 && cur; depth++) {
      scanRoot(cur);
      cur = cur.parentElement;
    }
    return out.slice(0, 14);
  });
}

/**
 * Read-only control inventory inside a bounded DOM root near the code field (form, role=search, .search-container, or parent).
 * No clicks, no typing.
 */
async function collectMutationBoundaryControlsFromBycodeFieldLocator(
  codeLocator,
  maxElements,
) {
  return codeLocator.evaluate((el, max) => {
    const cap = Math.min(Math.max(max, 1), 150);
    const root =
      el.closest("form") ||
      el.closest('[role="search"]') ||
      el.closest(".search-container") ||
      el.parentElement;
    if (!root) {
      return [];
    }
    const selectors = [
      "button",
      "a[href]",
      "[role=\"button\"]",
      "input[type=\"submit\"]",
      "input[type=\"button\"]",
      "input[type=\"reset\"]",
    ];
    const seen = new Set();
    const out = [];

    const isVisibleEl = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const st = window.getComputedStyle(node);
      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }
      const r = node.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    };

    const buildInteractiveRow = (node) => {
      const tag = node.tagName.toLowerCase();
      let type = null;
      if (node instanceof HTMLInputElement) type = node.type || "text";
      const text = (
        node.innerText ||
        (node instanceof HTMLInputElement ? node.value : "") ||
        node.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .slice(0, 200);
      let href = null;
      if (node instanceof HTMLAnchorElement) href = node.href || null;
      const idRaw =
        node.id && String(node.id).trim() ? String(node.id).trim() : null;
      let css_selector_hint = null;
      if (idRaw) {
        try {
          css_selector_hint = `#${CSS.escape(idRaw)}`;
        } catch {
          css_selector_hint = null;
        }
      }
      const al = node.getAttribute("aria-label");
      const aria_label_attr =
        al && al.trim() ? al.trim().slice(0, 200) : null;
      const alb = node.getAttribute("aria-labelledby");
      const aria_labelledby_attr =
        alb && alb.trim() ? alb.trim().slice(0, 200) : null;
      const tt = node.getAttribute("title");
      const title_attr = tt && tt.trim() ? tt.trim().slice(0, 200) : null;
      let value_attr = null;
      if (node instanceof HTMLInputElement) {
        value_attr = (node.value || "").slice(0, 200) || null;
      }
      let disabled_reported = false;
      if (
        node instanceof HTMLButtonElement ||
        node instanceof HTMLInputElement ||
        node instanceof HTMLSelectElement
      ) {
        disabled_reported = Boolean(node.disabled);
      }
      if (node.getAttribute("aria-disabled") === "true") {
        disabled_reported = true;
      }
      return {
        tag,
        type,
        role: node.getAttribute("role"),
        text,
        href,
        id: idRaw,
        name: node.getAttribute("name"),
        className:
          typeof node.className === "string"
            ? node.className.slice(0, 120)
            : null,
        css_selector_hint,
        aria_label_attr,
        aria_labelledby_attr,
        title_attr,
        value_attr,
        disabled_reported,
      };
    };

    const tryAdd = (node) => {
      if (!(node instanceof HTMLElement)) return;
      if (!isVisibleEl(node)) return;
      if (seen.has(node)) return;
      if (out.length >= cap) return;
      seen.add(node);
      out.push(buildInteractiveRow(node));
    };

    for (const sel of selectors) {
      try {
        if (root instanceof HTMLElement && root.matches(sel)) {
          tryAdd(root);
        }
      } catch {
        /* invalid matches() */
      }
      root.querySelectorAll(sel).forEach((n) => tryAdd(n));
    }
    return out;
  }, maxElements);
}

/**
 * Read-only structural pack for MILO /milo/products/bycode (and similar) after Phase 2c navigation.
 */
async function collectBycodeSurfaceBoundaryPackReadonly(page, config) {
  let pageUrl = "";
  try {
    pageUrl = page.url();
  } catch {
    pageUrl = "";
  }
  let pathname = "";
  try {
    pathname = new URL(pageUrl).pathname.toLowerCase();
  } catch {
    pathname = "";
  }
  const bycode_canonical_path = pathname.includes("/milo/products/bycode");

  const visibleInputs = await collectVisibleInputs(page);
  const fieldInfo = classifyCodeAndQtyFields(visibleInputs);
  const codeRes = await resolveCodeFieldLocatorPhase2c(
    page,
    config.addByCodeCodeFieldSelector ?? null,
    fieldInfo,
  );
  const qtyRes = await resolveFieldLocator(
    page,
    config.addByCodeQtyFieldSelector ?? null,
    fieldInfo.quantity_field_hints,
  );

  const code_field = {
    resolved: !!(codeRes.locator && codeRes.matched),
    resolution: {
      source: codeRes.source,
      selector_used: codeRes.selector_used,
      matched: codeRes.matched,
    },
    dom_snapshot: null,
    bounding_client_rect: null,
    labels_and_descriptions: null,
  };

  if (codeRes.locator && codeRes.matched) {
    code_field.dom_snapshot = await readFieldDomSnapshot(codeRes.locator);
    code_field.bounding_client_rect = await codeRes.locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        left: r.left,
      };
    });
    code_field.labels_and_descriptions =
      await extractFieldLabelsAndHintsReadonly(codeRes.locator);
  }

  const quantity_field = {
    resolved: !!(qtyRes.locator && qtyRes.matched),
    distinct_from_code_field: null,
    note: null,
    resolution: qtyRes.locator
      ? {
          source: qtyRes.source,
          selector_used: qtyRes.selector_used,
          matched: qtyRes.matched,
        }
      : null,
    dom_snapshot: null,
    bounding_client_rect: null,
    labels_and_descriptions: null,
  };

  if (qtyRes.locator && qtyRes.matched) {
    const qSnap = await readFieldDomSnapshot(qtyRes.locator);
    quantity_field.dom_snapshot = qSnap;
    const cid = code_field.dom_snapshot?.id ?? null;
    const qid = qSnap?.id ?? null;
    if (cid && qid && cid === qid) {
      quantity_field.distinct_from_code_field = false;
      quantity_field.note = "same_dom_id_as_code_field_heuristic_duplicate";
    } else {
      quantity_field.distinct_from_code_field = true;
      quantity_field.bounding_client_rect = await qtyRes.locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          top: r.top,
          left: r.left,
        };
      });
      quantity_field.labels_and_descriptions =
        await extractFieldLabelsAndHintsReadonly(qtyRes.locator);
    }
  }

  let container_chain = [];
  let form_summary = null;
  let structure_hints = {};

  if (codeRes.locator && codeRes.matched) {
    const chainData = await codeRes.locator.evaluate((el) => {
      const chain = [];
      let cur = el;
      for (let i = 0; i < 8 && cur; i++) {
        chain.push({
          tag: cur.tagName.toLowerCase(),
          id: cur.id || null,
          className:
            typeof cur.className === "string"
              ? cur.className.slice(0, 160)
              : null,
          role: cur.getAttribute("role"),
        });
        cur = cur.parentElement;
      }
      const form = el.closest("form");
      let fs = null;
      if (form instanceof HTMLFormElement) {
        fs = {
          id: form.id || null,
          className:
            typeof form.className === "string"
              ? form.className.slice(0, 160)
              : null,
          method: (form.method || "get").toLowerCase(),
          action: (form.getAttribute("action") || "").slice(0, 320) || null,
        };
      }
      const table = el.closest("table");
      const dialog = el.closest('[role="dialog"],dialog');
      const ul = el.closest("ul,ol");
      return {
        container_chain: chain,
        form_summary: fs,
        inside_table: !!table,
        inside_role_dialog: !!dialog,
        list_ancestor_tag: ul ? ul.tagName.toLowerCase() : null,
      };
    });
    container_chain = chainData.container_chain;
    form_summary = chainData.form_summary;
    structure_hints = {
      inside_table: chainData.inside_table,
      inside_role_dialog: chainData.inside_role_dialog,
      list_ancestor_tag: chainData.list_ancestor_tag,
    };
  }

  let surrounding_controls_code_field = null;
  if (codeRes.locator && codeRes.matched) {
    const raw = await collectSurroundingControlsReadonly(codeRes.locator);
    surrounding_controls_code_field = {
      ...raw,
      controls: raw.controls.map((c) => ({
        ...c,
        ...markControlRiskObserved(c.text_or_value),
      })),
    };
  }

  const help_error_validation_text_samples =
    codeRes.locator && codeRes.matched
      ? await collectHelpErrorValidationTextNearFieldReadonly(codeRes.locator)
      : [];

  const boundaryPack = {
    page_url: pageUrl,
    bycode_canonical_path,
    code_field,
    quantity_field,
    container_chain,
    form_summary,
    structure_hints,
    surrounding_controls_code_field,
    help_error_validation_text_samples,
    typing_policy:
      "read_only_no_keystrokes_boundary_pack_for_phase_2d_2e_observed_only",
    cart_mutation: "none",
  };

  return {
    boundaryPack,
    codeFieldLocator: codeRes.locator && codeRes.matched ? codeRes.locator : null,
  };
}

async function collectMutationBoundaryControls(page, maxElements) {
  return page.evaluate((max) => {
    const cap = Math.min(Math.max(max, 1), 150);
    const selectors = [
      "button",
      "a[href]",
      "[role=\"button\"]",
      "input[type=\"submit\"]",
      "input[type=\"button\"]",
      "input[type=\"reset\"]",
    ];
    const seen = new Set();
    const out = [];

    const isVisibleEl = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      const st = window.getComputedStyle(el);

      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();

      return r.width >= 2 && r.height >= 2;
    };

    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (out.length >= cap) {
          return;
        }

        if (!(el instanceof HTMLElement)) {
          return;
        }

        if (!isVisibleEl(el)) {
          return;
        }

        if (seen.has(el)) {
          return;
        }

        seen.add(el);

        const tag = el.tagName.toLowerCase();
        let type = null;

        if (el instanceof HTMLInputElement) {
          type = el.type || "text";
        }

        const text = (
          el.innerText ||
          (el instanceof HTMLInputElement ? el.value : "") ||
          el.getAttribute("aria-label") ||
          ""
        )
          .trim()
          .slice(0, 200);

        let href = null;

        if (el instanceof HTMLAnchorElement) {
          href = el.href || null;
        }

        const idRaw =
          el.id && String(el.id).trim() ? String(el.id).trim() : null;
        let css_selector_hint = null;
        if (idRaw) {
          try {
            css_selector_hint = `#${CSS.escape(idRaw)}`;
          } catch {
            css_selector_hint = null;
          }
        }
        const al = el.getAttribute("aria-label");
        const aria_label_attr =
          al && al.trim() ? al.trim().slice(0, 200) : null;
        const alb = el.getAttribute("aria-labelledby");
        const aria_labelledby_attr =
          alb && alb.trim() ? alb.trim().slice(0, 200) : null;
        const tt = el.getAttribute("title");
        const title_attr = tt && tt.trim() ? tt.trim().slice(0, 200) : null;
        let value_attr = null;
        if (el instanceof HTMLInputElement) {
          value_attr = (el.value || "").slice(0, 200) || null;
        }
        let disabled_reported = false;
        if (
          el instanceof HTMLButtonElement ||
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement
        ) {
          disabled_reported = Boolean(el.disabled);
        }
        if (el.getAttribute("aria-disabled") === "true") {
          disabled_reported = true;
        }

        out.push({
          tag,
          type,
          role: el.getAttribute("role"),
          text,
          href,
          id: idRaw,
          name: el.getAttribute("name"),
          className:
            typeof el.className === "string"
              ? el.className.slice(0, 120)
              : null,
          css_selector_hint,
          aria_label_attr,
          aria_labelledby_attr,
          title_attr,
          value_attr,
          disabled_reported,
        });
      });
    }

    return out;
  }, maxElements);
}

async function collectMutationBoundaryControlsInRoot(
  page,
  rootSelector,
  maxElements,
) {
  const loc = page.locator(rootSelector).first();
  const handle = await loc.elementHandle();

  if (!handle) {
    return [];
  }

  return handle.evaluate((root, max) => {
    const cap = Math.min(Math.max(max, 1), 150);
    const selectors = [
      "button",
      "a[href]",
      "[role=\"button\"]",
      "input[type=\"submit\"]",
      "input[type=\"button\"]",
      "input[type=\"reset\"]",
    ];
    const seen = new Set();
    const out = [];

    const isVisibleEl = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      const st = window.getComputedStyle(el);

      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) === 0
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();

      return r.width >= 2 && r.height >= 2;
    };

    const tryAdd = (el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }

      if (!isVisibleEl(el)) {
        return;
      }

      if (seen.has(el)) {
        return;
      }

      if (out.length >= cap) {
        return;
      }

      seen.add(el);

      const tag = el.tagName.toLowerCase();
      let type = null;

      if (el instanceof HTMLInputElement) {
        type = el.type || "text";
      }

      const text = (
        el.innerText ||
        (el instanceof HTMLInputElement ? el.value : "") ||
        el.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .slice(0, 200);

      let href = null;

      if (el instanceof HTMLAnchorElement) {
        href = el.href || null;
      }

      const idRaw = el.id && String(el.id).trim() ? String(el.id).trim() : null;
      let css_selector_hint = null;
      if (idRaw) {
        try {
          css_selector_hint = `#${CSS.escape(idRaw)}`;
        } catch {
          css_selector_hint = null;
        }
      }
      const al = el.getAttribute("aria-label");
      const aria_label_attr =
        al && al.trim() ? al.trim().slice(0, 200) : null;
      const alb = el.getAttribute("aria-labelledby");
      const aria_labelledby_attr =
        alb && alb.trim() ? alb.trim().slice(0, 200) : null;
      const tt = el.getAttribute("title");
      const title_attr = tt && tt.trim() ? tt.trim().slice(0, 200) : null;
      let value_attr = null;
      if (el instanceof HTMLInputElement) {
        value_attr = (el.value || "").slice(0, 200) || null;
      }
      let disabled_reported = false;
      if (
        el instanceof HTMLButtonElement ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement
      ) {
        disabled_reported = Boolean(el.disabled);
      }
      if (el.getAttribute("aria-disabled") === "true") {
        disabled_reported = true;
      }

      out.push({
        tag,
        type,
        role: el.getAttribute("role"),
        text,
        href,
        id: idRaw,
        name: el.getAttribute("name"),
        className:
          typeof el.className === "string"
            ? el.className.slice(0, 120)
            : null,
        css_selector_hint,
        aria_label_attr,
        aria_labelledby_attr,
        title_attr,
        value_attr,
        disabled_reported,
      });
    };

    for (const sel of selectors) {
      try {
        if (root instanceof HTMLElement && root.matches(sel)) {
          tryAdd(root);
        }
      } catch {
        // invalid selector for matches
      }

      root.querySelectorAll(sel).forEach((el) => tryAdd(el));
    }

    return out;
  }, maxElements);
}

function classifyBoundaryRows(raw, tenantHints) {
  return raw.map((row) => {
    const classified = classifyMutationBoundaryControl(row);
    const { classification, rationale, uncertain_detail } = classified;

    const tenant = applyTenantAdvisoryForUncertain(
      row,
      classification,
      tenantHints,
    );

    return {
      ...row,
      classification,
      rationale,
      ...(uncertain_detail != null ? { uncertain_detail } : {}),
      ...tenant,
    };
  });
}

/**
 * Phase 2d: read-only scan of interactive controls; heuristic safe / unsafe / uncertain buckets.
 * On canonical by-code route with resolvable code field, prefers bounded scan near that field (after Phase 2c nav).
 * No clicks, no typing, no cart mutation.
 */
export async function runAddByCodePhase2dMutationBoundaryMap({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  maxControls = 100,
}) {
  await heartbeat({
    progressStage: "mlcc_mutation_boundary_map_start",
    progressMessage:
      "Phase 2d: by-code surface boundary pack + mutation scan (read-only; no clicks)",
  });

  const { boundaryPack: bycode_surface_boundary_pack, codeFieldLocator } =
    await collectBycodeSurfaceBoundaryPackReadonly(page, config ?? {});

  let raw = [];
  let mutation_scan_scope =
    "visible_buttons_links_role_button_submit_like_inputs_full_page_capped";

  if (codeFieldLocator) {
    const scoped = await collectMutationBoundaryControlsFromBycodeFieldLocator(
      codeFieldLocator,
      maxControls,
    );
    if (scoped.length > 0) {
      raw = scoped;
      mutation_scan_scope =
        "bycode_field_bounded_root_form_or_search_container_or_parent";
    }
  }

  if (raw.length === 0) {
    raw = await collectMutationBoundaryControls(page, maxControls);
    mutation_scan_scope =
      raw.length > 0
        ? "full_page_fallback_after_empty_bounded_scan"
        : mutation_scan_scope;
  }

  const mutation_boundary_controls = classifyBoundaryRows(raw, []);

  const safe_controls_seen = mutation_boundary_controls.filter(
    (c) => c.classification === "safe_informational",
  );

  const blocked_controls_seen = mutation_boundary_controls.filter(
    (c) => c.classification === "unsafe_mutation_likely",
  );

  const uncertain_controls_seen = mutation_boundary_controls.filter(
    (c) => c.classification === "uncertain",
  );

  const uncertain_review_examples = uncertain_controls_seen.slice(0, 15).map(
    (c) => ({
      text: c.text,
      tag: c.tag,
      type: c.type,
      id: c.id,
      uncertain_detail: c.uncertain_detail ?? null,
    }),
  );

  const layer3_ui_guard_text_match_count = raw.filter((row) => {
    const p = isProbeUiTextUnsafe(String(row.text ?? "").trim());

    return p.unsafe === true;
  }).length;

  const phase_2d_bycode_surface_boundary_success =
    bycode_surface_boundary_pack.bycode_canonical_path === true &&
    bycode_surface_boundary_pack.code_field.resolved === true;

  const phase_2d_boundary_mapping_success = true;

  const EVIDENCE_MUTATION_CONTROL_CAP = 40;
  const mutation_boundary_controls_sample = mutation_boundary_controls.slice(
    0,
    EVIDENCE_MUTATION_CONTROL_CAP,
  );

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_mutation_boundary_map_findings",
      message:
        "Phase 2d mutation boundary + by-code surface pack (heuristic control classification; read-only)",
      attributes: {
        page_url: bycode_surface_boundary_pack.page_url,
        bycode_canonical_path: bycode_surface_boundary_pack.bycode_canonical_path,
        mutation_scan_scope,
        bycode_surface_boundary_pack,
        scan_scope_interactive_controls:
          "visible_buttons_links_role_button_submit_like_inputs_capped",
        scan_count: mutation_boundary_controls.length,
        max_controls: maxControls,
        mutation_boundary_controls_sample,
        mutation_boundary_controls_omitted:
          Math.max(0, mutation_boundary_controls.length - mutation_boundary_controls_sample.length),
        safe_controls_seen_count: safe_controls_seen.length,
        blocked_controls_seen_count: blocked_controls_seen.length,
        uncertain_controls_seen_count: uncertain_controls_seen.length,
        uncertain_review_examples,
        network_guard_blocked_request_count:
          guardStats && typeof guardStats.blockedRequestCount === "number"
            ? guardStats.blockedRequestCount
            : null,
        layer3_ui_guard_text_match_count,
        phase_2d_boundary_mapping_success,
        phase_2d_bycode_surface_boundary_success,
        disclaimer:
          "classifications_are_heuristic_ambiguity_remains_possible_do_not_infer_cart_safety",
        typing_policy_phase_2d: "no_product_code_or_quantity_typing",
        cart_mutation: "none",
      },
    }),
  );

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_mutation_boundary_phase_2d_after_scan",
        message:
          "Phase 2d: step snapshot after bounded/full mutation-boundary read-only scan",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  await heartbeat({
    progressStage: "mlcc_mutation_boundary_map_complete",
    progressMessage:
      "Phase 2d boundary map complete (no validate/add-to-cart/checkout/submit)",
  });

  return {
    scan_count: mutation_boundary_controls.length,
    safe_count: safe_controls_seen.length,
    unsafe_count: blocked_controls_seen.length,
    uncertain_count: uncertain_controls_seen.length,
    mutation_scan_scope,
    phase_2d_boundary_mapping_success,
    phase_2d_bycode_surface_boundary_success,
    bycode_surface_boundary_pack_summary: {
      page_url: bycode_surface_boundary_pack.page_url,
      bycode_canonical_path: bycode_surface_boundary_pack.bycode_canonical_path,
      code_field_resolved: bycode_surface_boundary_pack.code_field.resolved,
      quantity_field_resolved: bycode_surface_boundary_pack.quantity_field.resolved,
      quantity_distinct_from_code:
        bycode_surface_boundary_pack.quantity_field.distinct_from_code_field,
    },
  };
}

/**
 * Phase 2e: scoped mutation-boundary map (add-by-code area) with safe fallback to broad scan.
 * Tenant root selector when set; else bounded scan from resolved by-code field (canonical MILO path);
 * else full page. Tenant uncertain hints are advisory only. No clicks, no typing, no cart mutation.
 */
export async function runAddByCodePhase2eMutationBoundaryMap({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  maxControls = 100,
}) {
  await heartbeat({
    progressStage: "mlcc_mutation_boundary_phase_2e_start",
    progressMessage:
      "Phase 2e: by-code surface pack + scoped mutation-boundary map (read-only)",
  });

  const { boundaryPack: bycode_surface_boundary_pack, codeFieldLocator } =
    await collectBycodeSurfaceBoundaryPackReadonly(page, config);

  const rootSel = config.mutationBoundaryRootSelector;
  const tenantHints = config.mutationBoundaryUncertainHints ?? [];

  let raw = [];
  let scoped_root_selector_configured = Boolean(
    rootSel && typeof rootSel === "string",
  );
  let scoped_root_matched_visible = false;
  let fallback_to_broad_scan = false;
  let scope_status = "no_root_selector_configured";
  let mutation_scan_scope =
    "visible_buttons_links_role_button_submit_like_inputs_full_page_capped";

  if (scoped_root_selector_configured) {
    const loc = page.locator(rootSel).first();
    const n = await loc.count().catch(() => 0);

    if (n === 0) {
      scope_status = "root_selector_zero_matches";
      fallback_to_broad_scan = true;
    } else {
      const vis = await loc.isVisible().catch(() => false);

      if (!vis) {
        scope_status = "root_not_visible";
        fallback_to_broad_scan = true;
      } else {
        scope_status = "scoped_scan_active_tenant_root";
        scoped_root_matched_visible = true;
        mutation_scan_scope = "tenant_mutation_boundary_root_selector";
        raw = await collectMutationBoundaryControlsInRoot(
          page,
          rootSel,
          maxControls,
        );
        if (raw.length === 0) {
          fallback_to_broad_scan = true;
          scope_status = "tenant_root_matched_but_no_interactive_controls_in_scope";
        }
      }
    }
  } else if (codeFieldLocator) {
    scope_status = "auto_scoped_from_resolved_bycode_field";
    scoped_root_matched_visible = true;
    mutation_scan_scope =
      "bycode_field_bounded_root_form_or_search_container_or_parent";
    raw = await collectMutationBoundaryControlsFromBycodeFieldLocator(
      codeFieldLocator,
      maxControls,
    );
    if (raw.length === 0) {
      fallback_to_broad_scan = true;
      scope_status =
        "auto_bycode_bounded_empty_fallback_full_page";
    }
  } else {
    fallback_to_broad_scan = true;
    scope_status = "no_tenant_root_no_code_field_full_page";
  }

  let full_page_fallback_used = false;

  if (fallback_to_broad_scan && raw.length === 0) {
    raw = await collectMutationBoundaryControls(page, maxControls);
    full_page_fallback_used = true;
    mutation_scan_scope =
      scoped_root_selector_configured && !scoped_root_matched_visible
        ? "full_page_fallback_after_tenant_root_failed"
        : mutation_scan_scope ===
            "bycode_field_bounded_root_form_or_search_container_or_parent"
          ? "full_page_fallback_after_empty_bounded_scan"
          : "full_page_no_scoped_root";
  }

  const mutation_boundary_controls = classifyBoundaryRows(raw, tenantHints);

  const safe_controls_seen = mutation_boundary_controls.filter(
    (c) => c.classification === "safe_informational",
  );

  const blocked_controls_seen = mutation_boundary_controls.filter(
    (c) => c.classification === "unsafe_mutation_likely",
  );

  const uncertain_controls_seen = mutation_boundary_controls.filter(
    (c) => c.classification === "uncertain",
  );

  const uncertain_review_examples = uncertain_controls_seen.slice(0, 15).map(
    (c) => ({
      text: c.text,
      tag: c.tag,
      type: c.type,
      id: c.id,
      uncertain_detail: c.uncertain_detail ?? null,
      tenant_advisory_label: c.tenant_advisory_label ?? null,
    }),
  );

  const layer3_ui_guard_text_match_count = raw.filter((row) => {
    const p = isProbeUiTextUnsafe(String(row.text ?? "").trim());

    return p.unsafe === true;
  }).length;

  const phase_2e_bycode_surface_boundary_success =
    bycode_surface_boundary_pack.bycode_canonical_path === true &&
    bycode_surface_boundary_pack.code_field.resolved === true;

  const phase_2e_boundary_mapping_success = true;

  const EVIDENCE_MUTATION_CONTROL_CAP_2E = 40;
  const mutation_boundary_controls_sample_2e = mutation_boundary_controls.slice(
    0,
    EVIDENCE_MUTATION_CONTROL_CAP_2E,
  );

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_mutation_boundary_phase_2e_findings",
      message:
        "Phase 2e scoped mutation boundary + by-code surface pack (heuristic; read-only)",
      attributes: {
        page_url: bycode_surface_boundary_pack.page_url,
        bycode_canonical_path: bycode_surface_boundary_pack.bycode_canonical_path,
        mutation_scan_scope,
        bycode_surface_boundary_pack,
        scoped_root_selector: rootSel ?? null,
        scoped_root_selector_configured,
        scoped_root_matched_visible,
        fallback_to_broad_scan: full_page_fallback_used,
        scope_status,
        tenant_uncertain_hints_count: tenantHints.length,
        scan_count: mutation_boundary_controls.length,
        max_controls: maxControls,
        total_controls_in_scan: mutation_boundary_controls.length,
        safe_count: safe_controls_seen.length,
        unsafe_count: blocked_controls_seen.length,
        uncertain_count: uncertain_controls_seen.length,
        mutation_boundary_controls_sample: mutation_boundary_controls_sample_2e,
        mutation_boundary_controls_omitted: Math.max(
          0,
          mutation_boundary_controls.length - mutation_boundary_controls_sample_2e.length,
        ),
        uncertain_review_examples,
        network_guard_blocked_request_count:
          guardStats && typeof guardStats.blockedRequestCount === "number"
            ? guardStats.blockedRequestCount
            : null,
        layer3_ui_guard_text_match_count,
        phase_2e_boundary_mapping_success,
        phase_2e_bycode_surface_boundary_success,
        disclaimer:
          "classifications_are_heuristic_ambiguity_remains_possible_do_not_infer_cart_safety",
        typing_policy_phase_2e: "no_product_code_or_quantity_typing",
        cart_mutation: "none",
      },
    }),
  );

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_mutation_boundary_phase_2e_after_scan",
        message:
          "Phase 2e: step snapshot after scoped/full mutation-boundary read-only scan",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  await heartbeat({
    progressStage: "mlcc_mutation_boundary_phase_2e_complete",
    progressMessage:
      "Phase 2e complete (no validate/add-to-cart/checkout/submit)",
  });

  return {
    scan_count: mutation_boundary_controls.length,
    safe_count: safe_controls_seen.length,
    unsafe_count: blocked_controls_seen.length,
    uncertain_count: uncertain_controls_seen.length,
    scoped_root_matched_visible,
    fallback_to_broad_scan: full_page_fallback_used,
    scope_status,
    mutation_scan_scope,
    phase_2e_boundary_mapping_success,
    phase_2e_bycode_surface_boundary_success,
    bycode_surface_boundary_pack_summary: {
      page_url: bycode_surface_boundary_pack.page_url,
      bycode_canonical_path: bycode_surface_boundary_pack.bycode_canonical_path,
      code_field_resolved: bycode_surface_boundary_pack.code_field.resolved,
      quantity_field_resolved: bycode_surface_boundary_pack.quantity_field.resolved,
      quantity_distinct_from_code:
        bycode_surface_boundary_pack.quantity_field.distinct_from_code_field,
    },
  };
}

/**
 * Phase 2f: at most one bounded click on a tenant-listed candidate that passes Layer 3 + boundary gates.
 * Verifies add-by-code UI signals post-click; no typing, no validate/checkout/submit/cart mutation paths added.
 */
export async function runAddByCodePhase2fSafeOpenConfirm({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
}) {
  await heartbeat({
    progressStage: "mlcc_phase_2f_safe_open_start",
    progressMessage:
      "Phase 2f: bounded safe-open confirmation (tenant candidates; max one click)",
  });

  const allowSubs = config.addByCodeSafeOpenTextAllowSubstrings ?? [];
  const candidates = config.addByCodeSafeOpenCandidateSelectors ?? [];

  const blocked_before =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const before = await measureAddByCodeUiOpenSignals(page, config);

  const scoped_root_reused_for_verification = Boolean(
    config.mutationBoundaryRootSelector,
  );

  const evaluations = [];

  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    const n = await loc.count().catch(() => 0);

    if (n === 0) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_selector_no_match",
      });
      continue;
    }

    const vis = await loc.isVisible().catch(() => false);

    if (!vis) {
      evaluations.push({
        selector: sel,
        eligible: false,
        reason: "rejected_not_visible",
      });
      continue;
    }

    const row = await extractMutationBoundaryRowFromLocator(loc);
    const elig = evaluatePhase2fOpenCandidateEligibility(row, allowSubs);

    evaluations.push({
      selector: sel,
      visible: true,
      tag: row.tag,
      text_sample: (row.text ?? "").slice(0, 200),
      href_sample: String(row.href ?? "").slice(0, 200),
      ...elig,
    });
  }

  let click_performed = false;
  let selector_clicked = null;
  let skip_click_reason = null;

  if (before.open_signal) {
    skip_click_reason = "ui_open_signals_already_present_before_phase_2f";
  } else {
    const firstEligible = evaluations.find((e) => e.eligible === true);

    if (!firstEligible) {
      skip_click_reason = "no_eligible_candidate_all_rejected_or_ineligible";
    } else {
      const loc = page.locator(firstEligible.selector).first();

      await loc.click({ timeout: 12_000 });
      click_performed = true;
      selector_clicked = firstEligible.selector;
      await page
        .waitForLoadState("domcontentloaded", { timeout: 45_000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (typeof buildStepEvidence === "function" && click_performed) {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2f_after_safe_open_click",
        message:
          "Phase 2f checkpoint after at-most-one bounded safe-open click (no typing)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const blocked_after =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  const after = await measureAddByCodeUiOpenSignals(page, config);

  const network_guard_delta =
    blocked_before != null && blocked_after != null
      ? blocked_after - blocked_before
      : null;

  const no_new_network_blocks =
    network_guard_delta === null || network_guard_delta === 0;

  const ui_open_success = after.open_signal === true;

  let recommend_tenant_safe_open_selector = null;
  let recommendation_strength = "none";

  if (ui_open_success && no_new_network_blocks) {
    if (click_performed && selector_clicked) {
      recommend_tenant_safe_open_selector = selector_clicked;
      recommendation_strength = "strong";
    } else if (before.open_signal) {
      recommendation_strength =
        "observational_ui_already_open_no_phase_2f_click_to_confirm_selector";
    }
  } else if (click_performed && ui_open_success && !no_new_network_blocks) {
    recommendation_strength = "weak_opened_but_network_guard_blocked_requests";
  }

  const tenant_safe_open_confirmed =
    click_performed && ui_open_success && no_new_network_blocks;

  const expected_ui_state_after_phase_2f =
    ui_open_success && no_new_network_blocks;

  const ui_was_already_open_before_phase_2f = before.open_signal === true;

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2f_safe_open_findings",
      message:
        "Phase 2f safe-open confirmation (bounded click; no cart mutation)",
      attributes: {
        candidate_selectors_configured: candidates,
        candidate_evaluations: evaluations,
        click_performed,
        selector_clicked,
        skip_click_reason,
        ui_signals_before: {
          open_signal: before.open_signal,
          code_field_detected: before.code_field_detected,
          tenant_code_field_visible: before.tenant_code_field_visible,
          scoped_root_visible: before.scoped_root_visible,
        },
        ui_signals_after: {
          open_signal: after.open_signal,
          code_field_detected: after.code_field_detected,
          tenant_code_field_visible: after.tenant_code_field_visible,
          scoped_root_visible: after.scoped_root_visible,
        },
        scoped_root_reused_for_verification: scoped_root_reused_for_verification,
        scoped_root_selector: config.mutationBoundaryRootSelector ?? null,
        network_guard_blocked_before: blocked_before,
        network_guard_blocked_after: blocked_after,
        network_guard_delta,
        no_new_blocked_requests_during_phase:
          network_guard_delta === null ? null : network_guard_delta === 0,
        tenant_safe_open_confirmed,
        expected_ui_state_after_phase_2f,
        ui_was_already_open_before_phase_2f,
        recommend_tenant_safe_open_selector,
        recommendation_strength,
        text_allow_substrings_configured: allowSubs,
        typing_policy_phase_2f: "no_product_code_or_quantity_typing",
        cart_mutation: "none",
        disclaimer:
          "confirmation_uses_visible_dom_signals_and_client_network_abort_counts_not_proof_of_server_cart_state",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2f_safe_open_complete",
    progressMessage:
      "Phase 2f complete (no validate/add-to-cart/checkout/submit)",
  });

  return {
    tenant_safe_open_confirmed,
    expected_ui_state_after_phase_2f,
    ui_was_already_open_before_phase_2f,
    click_performed,
    selector_clicked,
    skip_click_reason,
    recommendation_strength,
    recommend_tenant_safe_open_selector,
    candidate_evaluations: evaluations,
    scoped_root_reused_for_verification,
    ui_open_success,
    no_new_network_blocks,
    network_guard_delta,
  };
}

/**
 * Phase 2v (MILO successor): one bounded validate click after same-run 2u + MILO post-2u 2o lane.
 * Uses the same validate locator fallback chain as Phase 2q; no checkout/submit/finalize.
 */
export async function runAddByCodePhase2vMiloValidateSingleClick({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  buildStepEvidence,
  phase2uResult,
  phase2oResult,
}) {
  const gateManifest = buildPhase2vMiloValidateFutureGateManifest();
  const postObserveMs = 400;

  await heartbeat({
    progressStage: "mlcc_phase_2v_milo_validate_start",
    progressMessage:
      "Phase 2v MILO successor start (single validate click max; no checkout/submit/finalize)",
  });

  const mutation_risk_checks_used = [
    `phase_2v_policy_version_${PHASE_2V_MILO_VALIDATE_POLICY_VERSION}`,
    `phase_2v_exec_policy_version_${PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION}`,
    "prerequisite_phase_2u_click_performed_true_same_run",
    "prerequisite_phase_2o_milo_post_2u_observation_performed_true_same_run",
    "tenant_validate_selector_list_only_no_heuristic_only_path",
    "layer_3_evaluatePhase2qValidateCandidateEligibility",
    "one_validate_click_maximum_phase_2v",
    "layer_2_delta_zero_required_through_click_and_full_phase_window",
    "no_checkout_submit_finalize_in_phase_2v",
  ];

  const prerequisites = {
    same_run_phase_2u_click_performed:
      phase2uResult?.click_performed === true,
    same_run_phase_2o_milo_post_2u_observation_performed:
      phase2oResult?.observation_performed === true &&
      phase2oResult?.post_click_observation_prerequisite_mode === "milo_post_2u",
  };

  if (!prerequisites.same_run_phase_2u_click_performed) {
    const err = "Phase 2v requires same-run Phase 2u click_performed=true";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: err,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          validate_click_performed: false,
          block_reason: "phase_2u_prerequisite_not_satisfied",
          prerequisites,
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  if (!prerequisites.same_run_phase_2o_milo_post_2u_observation_performed) {
    const err =
      "Phase 2v requires same-run MILO Phase 2o observation with post_click_observation_prerequisite_mode=milo_post_2u";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: err,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          validate_click_performed: false,
          block_reason: "phase_2o_milo_post_2u_prerequisite_not_satisfied",
          prerequisites,
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  if (phase2oResult?.no_new_blocked_downstream_requests_observed === false) {
    const err =
      "Phase 2v requires Phase 2o no_new_blocked_downstream_requests_observed !== false";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: err,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          validate_click_performed: false,
          block_reason: "phase_2o_layer2_prerequisite_failed",
          prerequisites,
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  const candidates = config.addByCodePhase2vMiloValidateSelectors ?? [];
  const allowSubs = config.addByCodePhase2vMiloValidateTextAllowSubstrings ?? [];

  if (!Array.isArray(candidates) || candidates.length === 0) {
    const err =
      "Phase 2v requires MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_SELECTORS (non-empty tenant selector list)";
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: err,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          validate_click_performed: false,
          block_reason: "missing_tenant_validate_selectors",
          prerequisites,
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  const blocked_at_phase_start =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2v_pre_validate_snapshot",
        message:
          "Phase 2v checkpoint before single MILO validate click (policy + selector scan)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const evaluations = [];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    const n = await loc.count().catch(() => 0);
    if (n === 0) {
      evaluations.push({ selector: sel, eligible: false, reason: "rejected_selector_no_match" });
      continue;
    }
    const vis = await loc.isVisible().catch(() => false);
    if (!vis) {
      evaluations.push({ selector: sel, eligible: false, reason: "rejected_not_visible" });
      continue;
    }
    const disabled = await loc.isDisabled().catch(() => false);
    if (disabled) {
      evaluations.push({ selector: sel, eligible: false, reason: "rejected_disabled_control" });
      continue;
    }
    const row = await extractMutationBoundaryRowFromLocator(loc);
    const elig = evaluatePhase2qValidateCandidateEligibility(row, allowSubs);
    evaluations.push({
      selector: sel,
      visible: true,
      disabled: false,
      tag: row.tag,
      text_sample: (row.text ?? "").slice(0, 200),
      href_sample: String(row.href ?? "").slice(0, 200),
      ...elig,
    });
  }

  const firstEligible = evaluations.find((e) => e.eligible === true);
  if (!firstEligible) {
    const err = "Phase 2v: no eligible MILO validate candidate";

    const safeModeFailureForensics2vNoCand =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: err,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          validate_click_performed: false,
          block_reason: "no_eligible_candidate",
          prerequisites,
          mutation_risk_checks_used,
          safe_mode_failure_forensics: safeModeFailureForensics2vNoCand,
        },
      }),
    );
    throw new Error(err);
  }

  const resolved2v = await resolveMlccProbeValidateClickLocatorWithFallbackChain(
    page,
    firstEligible.selector,
    {
      mutationBoundaryRootSelector: config.mutationBoundaryRootSelector ?? null,
    },
  );

  const ambiguous2v =
    !resolved2v.ok &&
    (resolved2v.reason === "multiple_visible_validate_controls_ambiguous" ||
      resolved2v.reason === "multiple_dialog_validate_targets_ambiguous");

  if (ambiguous2v) {
    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const msg = `Phase 2v: ambiguous MILO validate targets after fallback chain; refusing click (${firstEligible.selector})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: msg,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          validate_click_performed: false,
          block_reason: resolved2v.reason,
          phase_2v_click_locator_resolution: resolved2v.detail ?? null,
          phase_2v_validate_locator_strategy_trace: resolved2v.strategy_trace ?? null,
          prerequisites,
          mutation_risk_checks_used,
          safe_mode_failure_forensics: safeModeFailureForensics,
        },
      }),
    );

    throw new Error(msg);
  }

  if (!resolved2v.ok) {
    const safeModeFailureForensics2vRes =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    const msg = `Phase 2v: validate locator resolution failed (${resolved2v.reason})`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: msg,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          validate_click_performed: false,
          block_reason: resolved2v.reason,
          selector_attempted: firstEligible.selector,
          phase_2v_click_locator_resolution: resolved2v.detail ?? null,
          phase_2v_validate_locator_strategy_trace: resolved2v.strategy_trace ?? null,
          prerequisites,
          mutation_risk_checks_used,
          safe_mode_failure_forensics: safeModeFailureForensics2vRes,
        },
      }),
    );

    throw new Error(msg);
  }

  const clickLoc = resolved2v.loc;

  try {
    await clickLoc.click({ timeout: 12_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    const safeModeFailureForensics =
      await collectSafeModeFailureEvidencePack(page, {
        screenshotMaxBytes: 200_000,
        excerptMaxChars: 12_000,
        htmlExcerptMaxChars: 8_000,
      }).catch(() => ({ page_available: false, forensics_error: true }));

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: `Phase 2v: validate click failed: ${m}`,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          selector_attempted: firstEligible.selector,
          phase_2v_click_locator_resolution: resolved2v.resolution,
          phase_2v_validate_locator_strategy_trace: resolved2v.strategy_trace ?? null,
          validate_click_performed: false,
          block_reason: `click_error:${m}`,
          prerequisites,
          mutation_risk_checks_used,
          safe_mode_failure_forensics: safeModeFailureForensics,
        },
      }),
    );
    throw new Error(`Phase 2v validate click failed: ${m}`);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2v_after_validate_click",
        message:
          "Phase 2v checkpoint after exactly one MILO validate click (no checkout/submit)",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  const blocked_after_click =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;
  const network_guard_delta_through_click =
    blocked_at_phase_start != null && blocked_after_click != null
      ? blocked_after_click - blocked_at_phase_start
      : null;
  if (network_guard_delta_through_click != null && network_guard_delta_through_click !== 0) {
    const err = `Phase 2v: Layer 2 blocked request counter increased during validate click window (delta=${network_guard_delta_through_click})`;
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: err,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          selector_clicked: firstEligible.selector,
          validate_click_performed: true,
          block_reason: "positive_layer2_abort_delta_during_validate_click",
          network_guard_blocked_at_phase_start: blocked_at_phase_start,
          network_guard_blocked_after_click: blocked_after_click,
          prerequisites,
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  await new Promise((r) => setTimeout(r, postObserveMs));
  const post_validate_read_only_snapshot =
    await collectPhase2oReadOnlyObservationSnapshot(page, config);

  const blocked_at_phase_end =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;
  const network_guard_delta_full_phase_window =
    blocked_at_phase_start != null && blocked_at_phase_end != null
      ? blocked_at_phase_end - blocked_at_phase_start
      : null;
  if (
    network_guard_delta_full_phase_window != null &&
    network_guard_delta_full_phase_window !== 0
  ) {
    const err = `Phase 2v: Layer 2 blocked request counter increased over full validate phase window (delta=${network_guard_delta_full_phase_window})`;
    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2v_milo_validate_blocked",
        message: err,
        attributes: {
          phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
          phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
          phase_2v_gate_manifest: gateManifest,
          candidate_evaluations: evaluations,
          selector_clicked: firstEligible.selector,
          validate_click_performed: true,
          post_validate_read_only_snapshot_present: true,
          block_reason: "positive_layer2_abort_delta_full_phase_window",
          network_guard_blocked_at_phase_start: blocked_at_phase_start,
          network_guard_blocked_at_phase_end: blocked_at_phase_end,
          prerequisites,
          mutation_risk_checks_used,
        },
      }),
    );
    throw new Error(err);
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2v_milo_validate_findings",
      message:
        "Phase 2v: single MILO validate click completed; no checkout/submit/finalize in this phase",
      attributes: {
        phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
        phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
        phase_2v_gate_manifest: gateManifest,
        candidate_evaluations: evaluations,
        prerequisites,
        validate_click_performed: true,
        click_count_this_phase: 1,
        selector_clicked: firstEligible.selector,
        post_validate_observe_settle_ms_used: postObserveMs,
        post_validate_read_only_snapshot,
        network_guard_blocked_at_phase_start: blocked_at_phase_start,
        network_guard_blocked_after_click: blocked_after_click,
        network_guard_blocked_at_phase_end: blocked_at_phase_end,
        network_guard_delta_full_phase_window,
        no_new_blocked_downstream_requests_observed:
          network_guard_delta_full_phase_window === null
            ? null
            : network_guard_delta_full_phase_window === 0,
        run_remained_without_checkout_submit_finalize_phase: true,
        mandatory_disclaimers: gateManifest.mandatory_disclaimers,
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2v_milo_validate_complete",
    progressMessage:
      "Phase 2v complete (one MILO validate click max; checkout/submit/finalize out of scope)",
  });

  return {
    phase_2v_policy_version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
    phase_2v_exec_policy_version: PHASE_2V_MILO_VALIDATE_EXEC_POLICY_VERSION,
    phase_reached: true,
    runtime_execution_enabled: true,
    validate_click_performed: true,
    design_only_blocked: false,
    selector_clicked: firstEligible.selector,
    candidate_evaluations: evaluations,
    network_guard_delta_full_phase_window,
    no_new_blocked_downstream_requests_observed:
      network_guard_delta_full_phase_window === null
        ? null
        : network_guard_delta_full_phase_window === 0,
    prerequisites,
  };
}

/**
 * Phase 2w (MILO successor) inert runtime skeleton.
 * Design-only: emits structured blocked evidence; performs no post-validate execution.
 */
export async function runAddByCodePhase2wMiloPostValidateInertSkeleton({
  heartbeat,
  buildEvidence,
  evidenceCollected,
  phase2vResult,
}) {
  await heartbeat({
    progressStage: "mlcc_phase_2w_milo_post_validate_start",
    progressMessage:
      "Phase 2w MILO successor reached (design-only inert skeleton; no post-validate runtime execution)",
  });

  const prerequisites = {
    same_run_phase_2v_reached: phase2vResult?.phase_reached === true,
    same_run_phase_2v_validate_click_performed:
      phase2vResult?.validate_click_performed === true,
  };

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2w_milo_post_validate_design_only_blocked",
      message:
        "Phase 2w reached but intentionally blocked by design-only runtime policy (no post-validate execution in current worker)",
      attributes: {
        phase_reached: true,
        runtime_execution_enabled: false,
        post_validate_observation_performed: false,
        prerequisites,
        required_future_guards: [
          "zero_clicks_post_validate_observation_window",
          "layer_2_delta_zero_for_observation_window",
          "checkout_submit_finalize_remain_out_of_scope",
        ],
        required_future_evidence: [
          "observation_pre",
          "observation_post",
          "observation_diff",
          "validate_selector_states",
          "inferred_checkout_like_controls_inferred_not_clicked",
        ],
        mandatory_disclaimer:
          "design_only_phase_no_post_validate_runtime_execution_checkout_submit_finalize_out_of_scope",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2w_milo_post_validate_complete",
    progressMessage:
      "Phase 2w inert skeleton complete (design-only blocked; no post-validate execution)",
  });

  return {
    phase_reached: true,
    runtime_execution_enabled: false,
    post_validate_observation_performed: false,
    design_only_blocked: true,
    prerequisites,
  };
}

/** Disk run-folder + milestone naming + run summary helpers (worker writes; re-export for auditors). */
export {
  MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME,
  buildMlccSafeFlowMilestoneDiskFilename,
  buildMlccSafeFlowRunOutputDir,
  buildMlccSafeFlowRunSummaryPayload,
  countMlccSafeFlowMilestoneScreenshots,
  tallyMlccEvidenceEntriesByKind,
  writeMlccSafeFlowRunSummaryJson,
} from "./mlcc-browser-evidence.js";
