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

  if (!addByCodeUiReached) {
    await tryOpenFromConfiguredSelector();

    visibleInputs = await collectVisibleInputs(page);
    fieldInfo = classifyCodeAndQtyFields(visibleInputs);
    addByCodeUiReached = fieldInfo.code_field_detected;
  }

  if (!addByCodeUiReached && !stopReason) {
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
