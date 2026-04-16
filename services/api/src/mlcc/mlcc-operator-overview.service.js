/**
 * Composes MLCC readiness dashboard counts + mapping backlog summary for one operator payload.
 * Read-only — reuses dashboard/backload pipelines; does not change existing route behavior.
 */

import { getBlockingHintsForSubmittedCart } from "./mlcc-blocking-hints.service.js";
import {
  aggregateMlccMappingBacklog,
  buildBacklogSummaryFromItems,
  dominantProposedFixActionFromBreakdown,
} from "./mlcc-mapping-backlog.service.js";
import {
  buildMlccDashboardCounts,
  DASHBOARD_CANDIDATE_FETCH_LIMIT,
  loadSubmittedCartsWithMlccRows,
  mapRowToMlccReadinessDashboardCart,
  sortMlccDashboardCartsForTriage,
} from "../services/cart-submitted-mlcc-feed.service.js";

export const OVERVIEW_CART_LIMIT_DEFAULT = 5;
export const OVERVIEW_CART_LIMIT_MAX = 20;

/**
 * @param {Record<string, unknown>} [query]
 * @returns {{ cartLimit: number; backlogLimit: number }}
 */
export function parseOperatorOverviewLimits(query) {
  let cartLimit = Number.parseInt(String(query?.cart_limit ?? ""), 10);
  let backlogLimit = Number.parseInt(String(query?.backlog_limit ?? ""), 10);
  if (!Number.isFinite(cartLimit) || cartLimit < 1) {
    cartLimit = OVERVIEW_CART_LIMIT_DEFAULT;
  }
  if (!Number.isFinite(backlogLimit) || backlogLimit < 1) {
    backlogLimit = OVERVIEW_CART_LIMIT_DEFAULT;
  }
  cartLimit = Math.min(OVERVIEW_CART_LIMIT_MAX, cartLimit);
  backlogLimit = Math.min(OVERVIEW_CART_LIMIT_MAX, backlogLimit);
  return { cartLimit, backlogLimit };
}

/**
 * @param {Record<string, unknown>} c — row from {@link mapRowToMlccReadinessDashboardCart}
 */
export function toCompactTopBlockedCart(c) {
  return {
    cart_id: c.cart_id,
    created_at: c.created_at ?? null,
    updated_at: c.updated_at ?? null,
    placed_at: c.placed_at ?? null,
    validation_status: c.validation_status ?? null,
    execution_status: c.execution_status ?? null,
    mlcc_execution_summary: c.mlcc_execution_summary,
    blocking_preview: c.blocking_preview,
  };
}

/**
 * @param {Record<string, unknown>} it — backlog aggregate item
 */
export function toCompactTopBacklogBottle(it) {
  const breakdown = it?.proposed_fix_breakdown;
  return {
    bottle_id: it.bottle_id,
    bottle_name: it.bottle_name ?? null,
    bottle_mlcc_code: it.bottle_mlcc_code ?? null,
    normalized_mlcc_code: it.normalized_mlcc_code ?? null,
    blocking_hint_count: it.blocking_hint_count,
    affected_cart_count: it.affected_cart_count,
    dominant_proposed_fix_action: dominantProposedFixActionFromBreakdown(
      /** @type {Record<string, unknown>} */ (breakdown),
    ),
    sample_candidates: Array.isArray(it.sample_candidates) ? it.sample_candidates : [],
  };
}

/**
 * Blocked carts first (same sort as dashboard), then take first `cartLimit`.
 *
 * @param {unknown[]} mappedDashboardCarts
 * @param {number} cartLimit
 */
export function pickTopBlockedCartsForOverview(mappedDashboardCarts, cartLimit) {
  const sorted = sortMlccDashboardCartsForTriage(mappedDashboardCarts);
  return sorted
    .filter((c) => c?.mlcc_execution_summary?.blocked === true)
    .slice(0, cartLimit)
    .map((c) => toCompactTopBlockedCart(/** @type {Record<string, unknown>} */ (c)));
}

/**
 * Backlog items are already sorted by aggregate.
 *
 * @param {unknown[]} backlogItems
 * @param {number} backlogLimit
 */
export function pickTopBacklogBottlesForOverview(backlogItems, backlogLimit) {
  return (backlogItems ?? [])
    .slice(0, backlogLimit)
    .map((it) => toCompactTopBacklogBottle(/** @type {Record<string, unknown>} */ (it)));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} storeId
 * @param {Record<string, unknown>} [query]
 * @returns {Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }>}
 */
export async function loadMlccOperatorOverview(supabase, storeId, query = {}) {
  const { cartLimit, backlogLimit } = parseOperatorOverviewLimits(query);

  const { ok, error, rows } = await loadSubmittedCartsWithMlccRows(supabase, storeId, {
    limit: DASHBOARD_CANDIDATE_FETCH_LIMIT,
  });

  if (!ok) {
    return { ok: false, error: error ?? "load_failed" };
  }

  const mappedAll = rows.map((row) => mapRowToMlccReadinessDashboardCart(row));
  const counts = buildMlccDashboardCounts(mappedAll);

  const hintsWithMeta = [];
  for (const row of rows) {
    const cartId = String(row.id);
    const seen_at = row.updated_at ?? row.created_at ?? "";
    const { hints } = await getBlockingHintsForSubmittedCart(supabase, storeId, cartId);
    for (const h of hints) {
      hintsWithMeta.push({
        ...h,
        cart_id: cartId,
        seen_at: seen_at != null ? String(seen_at) : "",
      });
    }
  }

  const { counts: backlogCounts, items: backlogItems } = aggregateMlccMappingBacklog(
    hintsWithMeta,
    { scanned_carts: rows.length },
  );
  const backlog_summary = buildBacklogSummaryFromItems(
    backlogItems,
    backlogCounts.total_blocking_hints,
  );

  const top_blocked_carts = pickTopBlockedCartsForOverview(mappedAll, cartLimit);
  const top_backlog_bottles = pickTopBacklogBottlesForOverview(backlogItems, backlogLimit);

  return {
    ok: true,
    body: {
      ok: true,
      store_id: storeId,
      generated_at: new Date().toISOString(),
      limits: { cart_limit: cartLimit, backlog_limit: backlogLimit },
      readiness_dashboard: {
        counts,
        filters: {
          blocked_only: false,
          status_code: null,
          description:
            "Counts are over the same evaluated cart set as GET mlcc-readiness-dashboard (no blocked_only/status_code filter).",
        },
        load_scope: { max_carts_evaluated: DASHBOARD_CANDIDATE_FETCH_LIMIT },
      },
      backlog_summary,
      top_blocked_carts,
      top_backlog_bottles,
    },
  };
}
