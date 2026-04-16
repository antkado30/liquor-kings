/**
 * MLCC-oriented quantity snap helpers and dry-run mapping-confidence checks.
 * Used by tests and the MLCC browser dry-run worker only — no API surface change.
 */

/**
 * Snap a positive integer quantity to tenant/SKU-specific pack rules where known.
 * Unknown MLCC codes: identity (no snap beyond integer validation upstream).
 *
 * @param {string | number | null | undefined} mlccCodeRaw
 * @param {number} quantity
 * @returns {{ ok: true, mlcc_code: string, requested: number, snapped: number, rule: string, step: number } | { ok: false, reason: string, mlcc_code: string, requested: number }}
 */
export function snapQuantityForMlccSku(mlccCodeRaw, quantity) {
  const requested = Number(quantity);
  if (!Number.isInteger(requested) || requested <= 0) {
    return {
      ok: false,
      reason: "quantity_must_be_positive_integer",
      mlcc_code: String(mlccCodeRaw ?? "").trim(),
      requested,
    };
  }

  const mlcc_code = String(mlccCodeRaw ?? "").trim();

  // Explicit regression SKUs (pack ceilings — provable in unit tests).
  if (mlcc_code === "7127") {
    const step = 6;
    const snapped = Math.ceil(requested / step) * step;
    return {
      ok: true,
      mlcc_code,
      requested,
      snapped,
      step,
      rule: "ceil_multiple_of_6",
    };
  }

  if (mlcc_code === "4101") {
    const step = 4;
    const snapped = Math.ceil(requested / step) * step;
    return {
      ok: true,
      mlcc_code,
      requested,
      snapped,
      step,
      rule: "ceil_multiple_of_4",
    };
  }

  return {
    ok: true,
    mlcc_code: mlcc_code || "unknown",
    requested,
    snapped: requested,
    step: 1,
    rule: "unknown_sku_no_special_snap",
  };
}

/**
 * Dry-run / SAFE MODE: block when any line has mapping confidence explicitly "unknown".
 * Missing field defaults to "confirmed" so legacy payloads without mapping metadata still run.
 * "inferred" lines are allowed but returned for upstream logging / evidence.
 *
 * @param {{ items?: unknown[] }} payload
 * @returns {{
 *   ok: boolean,
 *   unknown_items: Array<Record<string, unknown>>,
 *   inferred_items: Array<Record<string, unknown>>,
 *   message?: string,
 * }}
 */
export function evaluateDryRunMappingConfidenceGuard(payload) {
  const items = payload?.items;
  if (!Array.isArray(items)) {
    return { ok: true, unknown_items: [], inferred_items: [], skipped: true };
  }

  const unknown_items = [];
  const inferred_items = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const raw =
      item.mappingconfidence ??
      item.mappingConfidence ??
      (item.bottle && typeof item.bottle === "object"
        ? item.bottle.mappingconfidence ?? item.bottle.mappingConfidence
        : undefined);

    const norm =
      raw == null || String(raw).trim() === ""
        ? "confirmed"
        : String(raw).trim().toLowerCase();

    const row = {
      cartItemId: item.cartItemId ?? null,
      bottleId: item.bottleId ?? null,
      mlcc_code:
        item.bottle && typeof item.bottle === "object"
          ? item.bottle.mlcc_code ?? null
          : null,
      mappingconfidence: norm,
    };

    if (norm === "unknown") {
      unknown_items.push(row);
    } else if (norm === "inferred") {
      inferred_items.push(row);
    }
  }

  if (unknown_items.length > 0) {
    return {
      ok: false,
      unknown_items,
      inferred_items,
      message: `Dry-run blocked: ${unknown_items.length} item(s) have mappingconfidence=unknown`,
    };
  }

  return {
    ok: true,
    unknown_items,
    inferred_items,
  };
}
