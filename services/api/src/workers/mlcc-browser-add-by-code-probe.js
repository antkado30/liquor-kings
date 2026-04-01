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
} from "./mlcc-phase-2m-policy.js";
import {
  PHASE_2P_POLICY_VERSION,
  buildPhase2pPostValidateLadder,
  buildPhase2pValidateFutureGateManifest,
} from "./mlcc-phase-2p-policy.js";

/** Clicks matching these labels are never performed during the probe. */
export const MLCC_PROBE_UNSAFE_UI_TEXT = [
  /add\s*to\s*cart/i,
  /add\s*all/i,
  /checkout/i,
  /submit(\s*order)?/i,
  /place\s*order/i,
  /update\s*cart/i,
  /buy\s*now/i,
  /purchase/i,
  /complete\s*order/i,
  /confirm\s*order/i,
  /finalize/i,
];

/**
 * Layer 2: block likely order/cart mutation requests. Conservative; may be tuned per MLCC tenant.
 */
export function shouldBlockHttpRequest(url, method) {
  const m = String(method ?? "GET").toUpperCase();
  const u = String(url ?? "").toLowerCase();

  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(m);
  if (mutation) {
    const patterns = [
      /\/checkout/i,
      /\/cart\/add/i,
      /\/cart\/update/i,
      /\/cart\/line/i,
      /\/order\/submit/i,
      /\/order\/place/i,
      /place-order/i,
      /submit-order/i,
      /\/finalize/i,
      /addtocart/i,
      /add-to-cart/i,
      /\/order\/create/i,
    ];
    for (const re of patterns) {
      if (re.test(u)) {
        return { block: true, reason: `mutation_url:${re}` };
      }
    }
  }

  if (m === "GET") {
    const getPatterns = [/addtocart/i, /add-to-cart/i, /\/cart\/add/i];
    for (const re of getPatterns) {
      if (re.test(u)) {
        return { block: true, reason: `get_url:${re}` };
      }
    }
  }

  return { block: false };
}

/**
 * Layer 3: blocklist for any probe navigation click (button/link text).
 */
export function isProbeUiTextUnsafe(text) {
  if (text == null || typeof text !== "string") {
    return { unsafe: false };
  }

  const t = text.trim();

  for (const re of MLCC_PROBE_UNSAFE_UI_TEXT) {
    if (re.test(t)) {
      return { unsafe: true, matched: re.toString() };
    }
  }

  return { unsafe: false };
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
 * Install route handler on browser context (call after newContext, before newPage).
 * @param {import('playwright').BrowserContext} context
 * @param {{ blockedRequestCount?: number } | null} [statsRef] — optional; increments when a request is aborted
 */
export async function installMlccSafetyNetworkGuards(context, statsRef) {
  await context.route("**/*", (route) => {
    const req = route.request();
    const { block, reason } = shouldBlockHttpRequest(req.url(), req.method());

    if (block) {
      if (
        statsRef &&
        typeof statsRef === "object" &&
        typeof statsRef.blockedRequestCount === "number"
      ) {
        statsRef.blockedRequestCount += 1;
      }

      return route.abort("blockedbyclient");
    }

    return route.continue();
  });
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

    if (el instanceof HTMLSelectElement) {
      const val = el.value || "";

      return {
        tagName: tag,
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
        type,
        readOnly: !!el.readOnly,
        disabled: !!el.disabled,
        value_length: val.length,
        has_value: val.length > 0,
        autocomplete: el.getAttribute("autocomplete"),
        inputmode: el.getAttribute("inputmode"),
      };
    }

    return { tagName: tag, unsupported: true };
  });
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
  phase2bFieldInfo,
}) {
  await heartbeat({
    progressStage: "mlcc_add_by_code_phase_2c_start",
    progressMessage:
      "Phase 2c: selector hardening + read-only field inspection (no typing; no cart mutation)",
  });

  const visibleInputs = await collectVisibleInputs(page);
  const fieldInfo =
    phase2bFieldInfo ?? classifyCodeAndQtyFields(visibleInputs);

  const tenantEnv = {
    code_field: Boolean(config.addByCodeCodeFieldSelector),
    quantity_field: Boolean(config.addByCodeQtyFieldSelector),
    entry: Boolean(config.addByCodeEntrySelector),
  };

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

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_add_by_code_phase_2c_findings",
      message:
        "Phase 2c selector hardening (tenant env preferred; heuristic advisory only)",
      attributes: {
        tenant_env_selectors_provided: tenantEnv,
        tenant_selectors_note:
          "explicit_env_selectors_recommended_when_heuristic_is_advisory_only",
        code_field: codeInspect,
        quantity_field: qtyInspect,
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

  return {
    code_field: codeInspect,
    quantity_field: qtyInspect,
    tenant_env_selectors_provided: tenantEnv,
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
  const fieldInfo =
    phase2bFieldInfo ?? classifyCodeAndQtyFields(visibleInputs);

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

export const PHASE_2H_REAL_CODE_POLICY_VERSION = "lk-rpa-2h-1";

const PHASE_2H_TEST_CODE_MAX_LEN = 64;

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

export const PHASE_2L_COMBINED_POLICY_VERSION = "lk-rpa-2l-1";

/** Phase 2n: one bounded add/apply-line click; aligns with mlcc-phase-2m-policy.js gate manifest. */
export const PHASE_2N_ADD_APPLY_POLICY_VERSION = "lk-rpa-2n-1";

/** Phase 2o: read-only DOM / status observation after Phase 2n; no clicks, no validate/checkout/submit. */
export const PHASE_2O_OBSERVATION_POLICY_VERSION = "lk-rpa-2o-1";

/** Phase 2q: one bounded validate click; aligns with mlcc-phase-2p-policy.js gate manifest. */
export const PHASE_2Q_VALIDATE_POLICY_VERSION = "lk-rpa-2q-1";

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

function phase2hCodeFieldDomSnapshotAllowed(snap) {
  if (!snap || snap.unsupported) {
    return { ok: false, reason: "unsupported_or_missing_snapshot" };
  }

  const t = String(snap.type || "").toLowerCase();

  if (t === "select") {
    return { ok: false, reason: "select_element_not_allowed_code_field" };
  }

  if (t === "number") {
    return {
      ok: false,
      reason: "input_type_number_rejected_code_field_phase_2l",
    };
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

  const loc = page.locator(codeSel).first();
  const n = await loc.count().catch(() => 0);

  if (n === 0) {
    const err = "Phase 2h: code field selector matched no elements";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "selector_zero_matches",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const visible = await loc.isVisible().catch(() => false);

  if (!visible) {
    const err = "Phase 2h: code field not visible";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "field_not_visible",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

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

  if (typeLower === "number") {
    const err =
      "Phase 2h: input type=number rejected (quantity-like); use a text-like code field selector";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          dom_snapshot_before: snapBefore,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "input_type_number_rejected",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
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
          dom_snapshot_before: snapBefore,
          real_code_typing_performed: false,
          quantity_field_touched: false,
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
    const err = `Phase 2h: extended mutation risk blocked: ${mutation_risk.block_reasons.join("|")}`;

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2h_real_code_blocked",
        message: err,
        attributes: {
          phase_2h_policy_version: PHASE_2H_REAL_CODE_POLICY_VERSION,
          selector_used: codeSel,
          dom_snapshot_before: snapBefore,
          mutation_risk,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: "extended_mutation_risk",
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
          dom_snapshot_before: snapBefore,
          mutation_risk,
          real_code_typing_performed: false,
          quantity_field_touched: false,
          block_reason: `fill_error:${m}`,
          mutation_risk_checks_used,
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
          test_code_length: testCode.length,
          test_code_redacted: "[length_only_not_value]",
          dom_snapshot_before: snapBefore,
          dom_snapshot_after_type: snapAfterType,
          mutation_risk,
          mutation_risk_checks_used,
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
          test_code_length: testCode.length,
          dom_snapshot_after_type: snapAfterType,
          real_code_typing_performed: true,
          quantity_field_touched: false,
          field_cleared_after: false,
          clear_error: m,
          run_remained_fully_non_mutating: false,
          mutation_risk_checks_used,
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
        test_code_length: testCode.length,
        test_code_redacted: "[length_only_not_value]",
        dom_snapshot_before: snapBefore,
        dom_snapshot_after_type: snapAfterType,
        dom_snapshot_after_clear: snapAfterClear,
        mutation_risk,
        mutation_risk_checks_used,
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
    mutation_risk_checks_used,
    mutation_risk,
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

  const loc = page.locator(qtySel.trim()).first();
  const n = await loc.count().catch(() => 0);

  if (n === 0) {
    const err = "Phase 2j: quantity field selector matched no elements";

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
          block_reason: "selector_zero_matches",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

  const visible = await loc.isVisible().catch(() => false);

  if (!visible) {
    const err = "Phase 2j: quantity field not visible";

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
          block_reason: "field_not_visible",
          mutation_risk_checks_used,
        },
      }),
    );

    throw new Error(err);
  }

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
    "code_dom_surface_same_family_as_phase_2h_not_number",
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

  const codeLoc = page.locator(codeSel.trim()).first();
  const qtyLoc = page.locator(qtySel.trim()).first();

  const codeN = await codeLoc.count().catch(() => 0);
  const qtyN = await qtyLoc.count().catch(() => 0);

  if (codeN === 0 || qtyN === 0) {
    const err = "Phase 2l: code or quantity selector matched no elements";

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2l_combined_blocked",
        message: err,
        attributes: baseBlockedAttrs({
          selector_code: codeSel.trim(),
          selector_qty: qtySel.trim(),
          code_match_count: codeN,
          qty_match_count: qtyN,
          block_reason: "selector_zero_matches",
        }),
      }),
    );

    throw new Error(err);
  }

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
          block_reason: "field_not_visible",
        }),
      }),
    );

    throw new Error(err);
  }

  const snapCodeBefore = await readFieldDomSnapshot(codeLoc);
  const snapQtyBefore = await readFieldDomSnapshot(qtyLoc);

  const codeSurface = phase2hCodeFieldDomSnapshotAllowed(snapCodeBefore);
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

  let run_remained_fully_non_mutating = true;
  let network_guard_delta_during_clear = null;
  const clearStepDeltas = [];

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

  const blockedAfterClear =
    guardStats && typeof guardStats.blockedRequestCount === "number"
      ? guardStats.blockedRequestCount
      : null;

  network_guard_delta_during_clear =
    blockedAfterFills != null && blockedAfterClear != null
      ? blockedAfterClear - blockedAfterFills
      : null;

  if (
    network_guard_delta_during_clear != null &&
    network_guard_delta_during_clear > 0
  ) {
    run_remained_fully_non_mutating = false;
  }

  const snapCodeAfterClear = await readFieldDomSnapshot(codeLoc);
  const snapQtyAfterClear = await readFieldDomSnapshot(qtyLoc);

  if (typeof buildStepEvidence === "function") {
    evidenceCollected.push(
      await buildStepEvidence({
        page,
        stage: "mlcc_phase_2l_post_clear_snapshot",
        message: "Phase 2l checkpoint after reverse-order clear fills",
        kind: "mlcc_add_by_code_probe",
        buildEvidence,
        config,
      }),
    );
  }

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_phase_2l_combined_findings",
      message:
        "Phase 2l combined rehearsal complete (truthful; no add line; no cart mutation path)",
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
        fields_cleared_after: true,
        run_remained_fully_non_mutating,
        interaction_method: allowBlur
          ? "two_fills_reverse_clear_optional_blur_last_field_no_enter_no_clicks"
          : "two_fills_reverse_clear_no_blur_no_enter_no_clicks",
        disclaimer:
          "observed_no_new_layer2_aborts_during_declared_fill_and_clear_steps_on_this_run_only_does_not_prove_general_combined_safety_or_server_cart_state_not_ready_for_add_line",
      },
    }),
  );

  await heartbeat({
    progressStage: "mlcc_phase_2l_combined_complete",
    progressMessage:
      "Phase 2l complete (combined fill+clear; no validate/add-line/checkout/submit)",
  });

  return {
    phase_2l_policy_version: PHASE_2L_COMBINED_POLICY_VERSION,
    phase_2k_policy_version: PHASE_2K_POLICY_VERSION,
    combined_rehearsal_performed: true,
    fields_cleared_after: true,
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
 * Phase 2o: read-only observation after Phase 2n click. No further clicks, validate, checkout, or submit.
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
    "phase_2n_prerequisite_add_apply_click_performed_true",
    "post_add_apply_ladder_step_echoed_from_phase_2m",
  ];

  if (!phase2nResult || phase2nResult.add_apply_click_performed !== true) {
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
        },
      }),
    );

    throw new Error(err);
  }

  const clickLoc = page.locator(firstEligible.selector).first();

  try {
    await clickLoc.click({ timeout: 12_000 });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);

    evidenceCollected.push(
      buildEvidence({
        kind: "mlcc_add_by_code_probe",
        stage: "mlcc_phase_2q_validate_blocked",
        message: `Phase 2q: validate click failed: ${m}`,
        attributes: {
          phase_2q_policy_version: PHASE_2Q_VALIDATE_POLICY_VERSION,
          candidate_evaluations: evaluations,
          selector_attempted: firstEligible.selector,
          validate_click_performed: false,
          block_reason: `click_error:${m}`,
          mutation_risk_checks_used,
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

        out.push({
          tag,
          type,
          role: el.getAttribute("role"),
          text,
          href,
          id: el.id || null,
          name: el.getAttribute("name"),
          className:
            typeof el.className === "string"
              ? el.className.slice(0, 120)
              : null,
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

      out.push({
        tag,
        type,
        role: el.getAttribute("role"),
        text,
        href,
        id: el.id || null,
        name: el.getAttribute("name"),
        className:
          typeof el.className === "string"
            ? el.className.slice(0, 120)
            : null,
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
 * No clicks, no typing, no cart mutation.
 */
export async function runAddByCodePhase2dMutationBoundaryMap({
  page,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  maxControls = 100,
}) {
  await heartbeat({
    progressStage: "mlcc_mutation_boundary_map_start",
    progressMessage:
      "Phase 2d: mapping pre-mutation control boundary (read-only scan; no clicks)",
  });

  const raw = await collectMutationBoundaryControls(page, maxControls);

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

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_mutation_boundary_map_findings",
      message:
        "Phase 2d mutation boundary (heuristic classification; not proof of runtime behavior)",
      attributes: {
        scan_scope:
          "visible_buttons_links_role_button_submit_like_inputs_capped",
        scan_count: mutation_boundary_controls.length,
        max_controls: maxControls,
        mutation_boundary_controls,
        safe_controls_seen,
        blocked_controls_seen,
        uncertain_controls_seen,
        uncertain_review_examples,
        network_guard_blocked_request_count:
          guardStats && typeof guardStats.blockedRequestCount === "number"
            ? guardStats.blockedRequestCount
            : null,
        layer3_ui_guard_text_match_count,
        disclaimer:
          "classifications_are_heuristic_ambiguity_remains_possible_do_not_infer_cart_safety",
        typing_policy_phase_2d: "no_product_code_or_quantity_typing",
        cart_mutation: "none",
      },
    }),
  );

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
  };
}

/**
 * Phase 2e: scoped mutation-boundary map (add-by-code area) with safe fallback to broad scan.
 * Tenant uncertain hints are advisory only. No clicks, no typing, no cart mutation.
 */
export async function runAddByCodePhase2eMutationBoundaryMap({
  page,
  config,
  heartbeat,
  buildEvidence,
  evidenceCollected,
  guardStats,
  maxControls = 100,
}) {
  await heartbeat({
    progressStage: "mlcc_mutation_boundary_phase_2e_start",
    progressMessage:
      "Phase 2e: scoped mutation-boundary map (read-only; fallback to broad if needed)",
  });

  const rootSel = config.mutationBoundaryRootSelector;
  const tenantHints = config.mutationBoundaryUncertainHints ?? [];

  let raw = [];
  let scoped_root_selector_configured = Boolean(
    rootSel && typeof rootSel === "string",
  );
  let scoped_root_matched_visible = false;
  let fallback_to_broad_scan = false;
  let scope_status = "no_root_selector_configured";

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
        scope_status = "scoped_scan_active";
        scoped_root_matched_visible = true;
        raw = await collectMutationBoundaryControlsInRoot(
          page,
          rootSel,
          maxControls,
        );
      }
    }
  } else {
    fallback_to_broad_scan = true;
  }

  if (fallback_to_broad_scan) {
    raw = await collectMutationBoundaryControls(page, maxControls);
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

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_add_by_code_probe",
      stage: "mlcc_mutation_boundary_phase_2e_findings",
      message:
        "Phase 2e scoped mutation boundary (heuristic; not proof of behavior)",
      attributes: {
        scoped_root_selector: rootSel ?? null,
        scoped_root_selector_configured,
        scoped_root_matched_visible,
        fallback_to_broad_scan,
        scope_status,
        tenant_uncertain_hints_count: tenantHints.length,
        scan_count: mutation_boundary_controls.length,
        max_controls: maxControls,
        total_controls_in_scan: mutation_boundary_controls.length,
        safe_count: safe_controls_seen.length,
        unsafe_count: blocked_controls_seen.length,
        uncertain_count: uncertain_controls_seen.length,
        mutation_boundary_controls,
        safe_controls_seen,
        blocked_controls_seen,
        uncertain_controls_seen,
        uncertain_review_examples,
        network_guard_blocked_request_count:
          guardStats && typeof guardStats.blockedRequestCount === "number"
            ? guardStats.blockedRequestCount
            : null,
        layer3_ui_guard_text_match_count,
        disclaimer:
          "classifications_are_heuristic_ambiguity_remains_possible_do_not_infer_cart_safety",
        typing_policy_phase_2e: "no_product_code_or_quantity_typing",
        cart_mutation: "none",
      },
    }),
  );

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
    fallback_to_broad_scan,
    scope_status,
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
