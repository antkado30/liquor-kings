/**
 * Submitted carts + MLCC readiness rows (shared by GET /cart/:storeId/history and dashboard feed).
 */
import { evaluateMlccExecutionReadinessForSubmittedCart } from "./cart-execution-payload.service.js";
import {
  deriveBlockingPreview,
  deriveMlccExecutionSummaryFromReadiness,
} from "../mlcc/mlcc-execution-readiness-summary.js";
import { serializeMlccExecutionReadiness } from "../mlcc/mlcc-execution-readiness-serialize.js";

const DEFAULT_LIMIT = 20;

/** Max submitted carts to load + evaluate for the MLCC dashboard (counts = this full set, before filters/response limit). */
export const DASHBOARD_CANDIDATE_FETCH_LIMIT = 100;

const DASHBOARD_RESPONSE_LIMIT_DEFAULT = 20;
const DASHBOARD_RESPONSE_LIMIT_MAX = 100;

/**
 * @param {Record<string, unknown>} query — req.query
 * @returns {{ blockedOnly: boolean; statusCode: string | null; limit: number }}
 */
export function parseMlccDashboardQueryParams(query) {
  const raw = query?.blocked_only;
  const blockedOnly =
    raw === "1" ||
    raw === 1 ||
    String(raw ?? "").toLowerCase() === "true";

  const rawStatus = query?.status_code;
  const statusCode =
    typeof rawStatus === "string" && rawStatus.trim().length > 0
      ? rawStatus.trim()
      : null;

  let limit = Number.parseInt(String(query?.limit ?? ""), 10);
  if (!Number.isFinite(limit) || limit < 1) {
    limit = DASHBOARD_RESPONSE_LIMIT_DEFAULT;
  }
  limit = Math.min(DASHBOARD_RESPONSE_LIMIT_MAX, limit);

  return { blockedOnly, statusCode, limit };
}

/**
 * Counts over the evaluated dashboard candidate set (same length as mapped carts passed in).
 * Does not apply blocked_only / status_code / response limit — see route comment.
 *
 * @param {Array<{ mlcc_execution_summary?: { status_code?: string; blocked?: boolean } }>} mappedCarts
 */
export function buildMlccDashboardCounts(mappedCarts) {
  /** @type {Record<string, number>} */
  const by_status_code = {};
  let blocked_carts = 0;
  let ready_carts = 0;

  for (const c of mappedCarts) {
    const summary = c.mlcc_execution_summary;
    const sc =
      summary && typeof summary.status_code === "string"
        ? summary.status_code
        : "unknown";
    by_status_code[sc] = (by_status_code[sc] ?? 0) + 1;
    if (summary?.blocked === true) blocked_carts += 1;
    if (sc === "ready") ready_carts += 1;
  }

  return {
    total_carts: mappedCarts.length,
    blocked_carts,
    ready_carts,
    by_status_code,
  };
}

/**
 * @param {unknown[]} mappedCarts
 * @param {{ blockedOnly: boolean; statusCode: string | null }} filters
 */
export function filterMlccDashboardCarts(mappedCarts, filters) {
  let out = mappedCarts;
  if (filters.blockedOnly) {
    out = out.filter((c) => c?.mlcc_execution_summary?.blocked === true);
  }
  if (filters.statusCode != null) {
    out = out.filter(
      (c) => c?.mlcc_execution_summary?.status_code === filters.statusCode,
    );
  }
  return out;
}

/**
 * Blocked first, then newest first (updated_at, then created_at).
 *
 * @param {unknown[]} mappedCarts
 */
export function sortMlccDashboardCartsForTriage(mappedCarts) {
  return [...mappedCarts].sort((a, b) => {
    const ab = a?.mlcc_execution_summary?.blocked === true ? 0 : 1;
    const bb = b?.mlcc_execution_summary?.blocked === true ? 0 : 1;
    if (ab !== bb) return ab - bb;
    const ta = String(a?.updated_at ?? a?.created_at ?? "");
    const tb = String(b?.updated_at ?? b?.created_at ?? "");
    return tb.localeCompare(ta);
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} storeId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string; rows: [] }>}
 */
export async function loadSubmittedCartsWithMlccRows(supabase, storeId, opts = {}) {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const { data: carts, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "submitted")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (cartError) {
    return { ok: false, error: cartError.message, rows: [] };
  }

  if (!carts?.length) {
    return { ok: true, rows: [] };
  }

  const cartIds = carts.map((c) => c.id);

  const { data: items, error: itemsError } = await supabase
    .from("cart_items")
    .select("id, cart_id")
    .in("cart_id", cartIds);

  if (itemsError) {
    return { ok: false, error: itemsError.message, rows: [] };
  }

  const itemCountByCartId = {};
  for (const row of items ?? []) {
    itemCountByCartId[row.cart_id] = (itemCountByCartId[row.cart_id] ?? 0) + 1;
  }

  const historyWithItemCounts = carts.map((cart) => ({
    ...cart,
    itemCount: itemCountByCartId[cart.id] ?? 0,
  }));

  const rows = await Promise.all(
    historyWithItemCounts.map(async (cart) => {
      const readinessEval = await evaluateMlccExecutionReadinessForSubmittedCart(
        supabase,
        storeId,
        cart.id,
      );
      const mlcc_execution_readiness =
        serializeMlccExecutionReadiness(readinessEval);
      return {
        ...cart,
        mlcc_execution_readiness,
        mlcc_execution_summary:
          deriveMlccExecutionSummaryFromReadiness(mlcc_execution_readiness),
      };
    }),
  );

  return { ok: true, rows };
}

/**
 * @param {Record<string, unknown>} row — one element from {@link loadSubmittedCartsWithMlccRows}
 * @param {{ previewLimit?: number }} [opts]
 */
export function mapRowToMlccReadinessDashboardCart(row, opts = {}) {
  const previewLimit = opts.previewLimit ?? 3;
  const readiness = row.mlcc_execution_readiness;
  return {
    cart_id: row.id,
    store_id: row.store_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    placed_at: row.placed_at ?? null,
    validation_status: row.validation_status ?? null,
    execution_status: row.execution_status ?? null,
    item_count: Number(row.itemCount ?? 0),
    mlcc_execution_summary: row.mlcc_execution_summary,
    blocking_preview: deriveBlockingPreview(readiness, previewLimit),
  };
}
