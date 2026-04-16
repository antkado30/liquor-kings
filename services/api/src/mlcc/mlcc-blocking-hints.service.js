/**
 * Read-only MLCC blocking hints: expand `missing_mlcc_item_id` readiness lines with
 * bottle + catalog context. No mapping fixes — classification + exact code match only.
 */

import { serializeMlccExecutionReadiness } from "./mlcc-execution-readiness-serialize.js";
import { evaluateMlccExecutionReadinessForSubmittedCart } from "../services/cart-execution-payload.service.js";
import { getSubmittedCartById, getCartItemsDetailed } from "../services/cart.service.js";
import { fetchMlccItemsByExactCodes } from "./mlcc-catalog-by-code.repository.js";
import { deriveProposedFixFromBlockingHint } from "./mlcc-blocking-hint-proposed-fix.js";

/** Max catalog rows returned per blocking hint (operator scan). */
export const MLCC_HINT_CANDIDATE_CAP = 5;

/**
 * Trim-only normalization for catalog lookup (no fuzzy transforms).
 * @param {unknown} raw
 * @returns {string | null} null when blank after trim
 */
export function normalizeMlccCodeForHints(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/**
 * Plausible bottle MLCC code for exact `mlcc_items.code` lookup: alnum + hyphen, bounded length.
 * @param {string | null} normalized
 * @returns {boolean}
 */
export function isMlccCodeFormatPlausibleForCatalogLookup(normalized) {
  if (normalized == null) return false;
  return /^[0-9A-Za-z-]{1,32}$/.test(normalized);
}

/**
 * @param {Record<string, unknown>} row — mlcc_items row
 */
export function mapMlccItemRowToCandidate(row) {
  return {
    mlcc_item_id: row.id != null ? String(row.id) : null,
    code: row.code != null ? String(row.code) : null,
    brand_name: row.name != null ? String(row.name) : null,
    size: row.size_ml != null ? String(row.size_ml) : null,
    proof: row.abv != null ? String(row.abv) : null,
    pack: null,
  };
}

/**
 * DB-free: classify using pre-fetched catalog rows for this code (exact match bucket).
 *
 * @param {{ normalizedCode: string | null; catalogRows: Record<string, unknown>[] }} args
 * @returns {{ hint_status: string; candidate_count: number; candidates: ReturnType<typeof mapMlccItemRowToCandidate>[] }}
 */
export function classifyCatalogHintForNormalizedCode({ normalizedCode, catalogRows }) {
  const rows = Array.isArray(catalogRows) ? catalogRows : [];

  if (normalizedCode == null) {
    return { hint_status: "blank_code", candidate_count: 0, candidates: [] };
  }
  if (!isMlccCodeFormatPlausibleForCatalogLookup(normalizedCode)) {
    return { hint_status: "bad_code_format", candidate_count: 0, candidates: [] };
  }

  const n = rows.length;
  if (n === 0) {
    return { hint_status: "no_catalog_match", candidate_count: 0, candidates: [] };
  }
  if (n === 1) {
    const candidates = [mapMlccItemRowToCandidate(rows[0])].slice(0, MLCC_HINT_CANDIDATE_CAP);
    return {
      hint_status: "exact_catalog_match_found",
      candidate_count: 1,
      candidates,
    };
  }
  const capped = rows
    .slice(0, MLCC_HINT_CANDIDATE_CAP)
    .map((r) => mapMlccItemRowToCandidate(r));
  return {
    hint_status: "multiple_catalog_matches",
    candidate_count: n,
    candidates: capped,
  };
}

/**
 * @param {unknown} item — cart_items row from getCartItemsDetailed
 * @returns {Record<string, unknown> | null}
 */
export function pickBottleFromCartItemRow(item) {
  const b = item?.bottles;
  if (Array.isArray(b)) return b[0] ?? null;
  return b ?? null;
}

/**
 * @param {unknown[]} items
 * @returns {Map<string, unknown>}
 */
export function indexCartItemsById(items) {
  const m = new Map();
  for (const row of items ?? []) {
    if (row?.id != null) m.set(String(row.id), row);
  }
  return m;
}

/**
 * Group catalog rows by exact `code` string (matches DB column).
 *
 * @param {Record<string, unknown>[]} rows
 * @returns {Map<string, Record<string, unknown>[]>}
 */
export function groupMlccCatalogRowsByCode(rows) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const map = new Map();
  for (const r of rows ?? []) {
    const c = r?.code != null ? String(r.code) : "";
    if (!c) continue;
    const list = map.get(c) ?? [];
    list.push(r);
    map.set(c, list);
  }
  return map;
}

/**
 * Build one hint row for a serialized blocking line (missing_mlcc_item_id only).
 *
 * @param {{
 *   line: Record<string, unknown>;
 *   cartItemRow: unknown;
 *   catalogByCode: Map<string, Record<string, unknown>[]>;
 * }} args
 */
export function buildMlccBlockingHintRow({ line, cartItemRow, catalogByCode }) {
  const bottle = pickBottleFromCartItemRow(cartItemRow);
  const cart_item_id =
    line.cartItemId != null ? String(line.cartItemId) : line.cart_item_id != null ? String(line.cart_item_id) : null;
  const bottle_id =
    line.bottleId != null ? String(line.bottleId) : line.bottle_id != null ? String(line.bottle_id) : null;
  const reason = line.reason != null ? String(line.reason) : "missing_mlcc_item_id";

  const bottle_name = bottle?.name != null ? String(bottle.name) : null;
  const bottle_mlcc_code = bottle?.mlcc_code != null ? String(bottle.mlcc_code) : null;
  const normalized_mlcc_code = normalizeMlccCodeForHints(bottle_mlcc_code);

  const catalogRows =
    normalized_mlcc_code != null && catalogByCode.has(normalized_mlcc_code)
      ? catalogByCode.get(normalized_mlcc_code)
      : [];

  const { hint_status, candidate_count, candidates } = classifyCatalogHintForNormalizedCode({
    normalizedCode: normalized_mlcc_code,
    catalogRows: catalogRows ?? [],
  });

  const row = {
    cart_item_id,
    bottle_id,
    reason,
    bottle_name,
    bottle_mlcc_code,
    normalized_mlcc_code,
    hint_status,
    candidate_count,
    candidates,
  };
  row.proposed_fix = deriveProposedFixFromBlockingHint(row);
  return row;
}

/**
 * Pure expansion given serialized readiness + cart line items + catalog rows keyed by code.
 *
 * @param {{
 *   readiness: { blocking_lines?: unknown[] | null };
 *   items: unknown[];
 *   catalogRows: Record<string, unknown>[];
 * }} args
 * @returns {Record<string, unknown>[]}
 */
export function buildMlccBlockingHintsFromReadinessAndItems({
  readiness,
  items,
  catalogRows,
}) {
  const lines = Array.isArray(readiness?.blocking_lines) ? readiness.blocking_lines : [];
  const byItem = indexCartItemsById(items);
  const catalogByCode = groupMlccCatalogRowsByCode(catalogRows);

  const hints = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    if (line.reason !== "missing_mlcc_item_id") continue;
    const cartItemId =
      line.cartItemId != null ? String(line.cartItemId) : line.cart_item_id != null ? String(line.cart_item_id) : null;
    const cartItemRow = cartItemId ? byItem.get(cartItemId) : undefined;
    hints.push(
      buildMlccBlockingHintRow({
        line: /** @type {Record<string, unknown>} */ (line),
        cartItemRow,
        catalogByCode,
      }),
    );
  }
  return hints;
}

/**
 * Collect normalized codes that need a catalog IN query (plausible format only).
 *
 * @param {unknown[]} items
 * @param {unknown[]} blockingLines
 * @returns {string[]}
 */
export function collectCatalogLookupCodesFromBlockingContext(items, blockingLines) {
  const byItem = indexCartItemsById(items);
  const out = new Set();
  for (const line of blockingLines ?? []) {
    if (!line || typeof line !== "object" || line.reason !== "missing_mlcc_item_id") continue;
    const cartItemId =
      line.cartItemId != null ? String(line.cartItemId) : line.cart_item_id != null ? String(line.cart_item_id) : null;
    const row = cartItemId ? byItem.get(cartItemId) : undefined;
    const bottle = pickBottleFromCartItemRow(row);
    const norm = normalizeMlccCodeForHints(bottle?.mlcc_code ?? null);
    if (norm != null && isMlccCodeFormatPlausibleForCatalogLookup(norm)) {
      out.add(norm);
    }
  }
  return [...out];
}

/**
 * Full read-only flow for GET mlcc-blocking-hints: same cart + readiness rules as history detail.
 *
 * @returns {Promise<{ statusCode: number; body: Record<string, unknown> }>}
 */
export async function fetchMlccBlockingHintsPayload(supabase, storeId, cartId) {
  const base = {
    store_id: storeId,
    cart_id: cartId,
  };

  const { data: submittedCart, error: cartError } = await getSubmittedCartById(
    supabase,
    storeId,
    cartId,
  );

  if (cartError) {
    return {
      statusCode: 404,
      body: { ok: false, blocked: true, error: "cart_not_found" },
    };
  }
  if (!submittedCart) {
    return {
      statusCode: 404,
      body: { ok: false, blocked: true, error: "cart_not_found" },
    };
  }

  const { data: items, error: itemsError } = await getCartItemsDetailed(supabase, submittedCart.id);
  if (itemsError) {
    return {
      statusCode: 500,
      body: { ok: false, ...base, ready: false, error: itemsError.message, message: null, blocking_hints: [] },
    };
  }

  const evalResult = await evaluateMlccExecutionReadinessForSubmittedCart(supabase, storeId, cartId);
  const readiness = serializeMlccExecutionReadiness(evalResult);

  if (evalResult.statusCode !== 200) {
    return {
      statusCode: evalResult.statusCode,
      body: {
        ok: false,
        ...base,
        ready: false,
        error: readiness.error,
        message: readiness.message,
        blocking_hints: [],
      },
    };
  }

  if (readiness.ready === true) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        ...base,
        ready: true,
        error: null,
        message: null,
        blocking_hints: [],
      },
    };
  }

  const blockingLines = Array.isArray(readiness.blocking_lines) ? readiness.blocking_lines : [];
  const codes = collectCatalogLookupCodesFromBlockingContext(items ?? [], blockingLines);
  const { rows: catalogRows, error: catErr } = await fetchMlccItemsByExactCodes(supabase, codes);
  if (catErr) {
    const msg =
      typeof catErr.message === "string" ? catErr.message : "mlcc_catalog_lookup_failed";
    return {
      statusCode: 500,
      body: {
        ok: false,
        ...base,
        ready: false,
        error: msg,
        message: null,
        blocking_hints: [],
      },
    };
  }

  const blocking_hints = buildMlccBlockingHintsFromReadinessAndItems({
    readiness,
    items: items ?? [],
    catalogRows,
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      ...base,
      ready: false,
      error: readiness.error,
      message: readiness.message,
      blocking_hints,
    },
  };
}

/**
 * Read-only: blocking hints array for one submitted cart (reuses {@link fetchMlccBlockingHintsPayload}).
 *
 * @returns {Promise<{ ok: boolean; ready: boolean; hints: Record<string, unknown>[] }>}
 */
export async function getBlockingHintsForSubmittedCart(supabase, storeId, cartId) {
  const { statusCode, body } = await fetchMlccBlockingHintsPayload(supabase, storeId, cartId);
  if (statusCode !== 200) {
    return { ok: false, ready: false, hints: [] };
  }
  return {
    ok: body.ok === true,
    ready: body.ready === true,
    hints: Array.isArray(body.blocking_hints) ? body.blocking_hints : [],
  };
}
