/**
 * Phase 2b: non-mutating add-by-code UI mapping. No typing, validate, checkout, or submit.
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

/**
 * Install route handler on browser context (call after newContext, before newPage).
 */
export async function installMlccSafetyNetworkGuards(context) {
  await context.route("**/*", (route) => {
    const req = route.request();
    const { block, reason } = shouldBlockHttpRequest(req.url(), req.method());

    if (block) {
      return route.abort("blockedbyclient");
    }

    return route.continue();
  });
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
        opened_via: openedVia,
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
  };
}
