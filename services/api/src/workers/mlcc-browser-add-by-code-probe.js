/**
 * Phase 2b: non-mutating add-by-code UI mapping. No typing, validate, checkout, or submit.
 * Phase 2c: tenant selector hardening + read-only field inspection; optional guarded focus/blur (no code/qty typing).
 * Layer 2: network guards. Layer 3: blocked UI text before any probe click.
 */

/** Clicks matching these labels are never performed during the probe. */
export const MLCC_PROBE_UNSAFE_UI_TEXT = [
  /add\s*to\s*cart/i,
  /add\s*all/i,
  /checkout/i,
  /submit(\s*order)?/i,
  /place\s*order/i,
  /validate/i,
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
      /\/validate/i,
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

    const text = (el.innerText || el.textContent || "").trim().slice(0, 300);

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
