/**
 * Scanner home — surfaces actionable items as "smart cards" on the
 * scanner's main screen (task #63, 2026-06-02 late).
 *
 * Cards (priority-sorted, capped):
 *   1. Price-book staleness (only when > 14 days old) — nudges Tony
 *      to set up the cron-job.org daily ping OR run the manual update.
 *   2. Price changes in the last 7 days for products the store has
 *      ordered or has bottles for. Surfaces "Tito's 750ml — price
 *      changed 2 days ago" so the owner can re-tag the shelf.
 *   3. Reorder suggestions based on same-day-of-week pattern in
 *      milo_order_confirmations history (Tony's weekly Thursday
 *      rhythm). Surfaces "You usually order this on Thursdays — add?"
 *
 * Each card carries a `productCode` when tappable, letting the
 * scanner navigate to the ProductCard for one-tap-add.
 *
 * Soft fail: if any source query errors, that card category is
 * dropped from the response but the others still return. Scanner
 * home shouldn't go dark because one query was slow.
 */

import express from "express";
import supabaseDefault from "../config/supabase.js";

const router = express.Router();

const MAX_CARDS_RETURNED = 8;
const PRICE_CHANGE_LOOKBACK_DAYS = 7;
const REORDER_HISTORY_DAYS = 28;
const REORDER_RECENT_DAYS = 5; // don't suggest things you JUST ordered
const STALENESS_THRESHOLD_DAYS = 14;

/**
 * Format an ISO timestamp into a short "N day(s) ago" string.
 * Caps at 30 days, then returns the date itself.
 */
function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? "" : "s"} ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Card for "your price book is stale" — only fires when the most recent
 * mlcc_price_book_runs entry is older than STALENESS_THRESHOLD_DAYS.
 */
async function buildStalenessCard(supabase) {
  try {
    const { data, error } = await supabase
      .from("mlcc_price_book_runs")
      .select("completed_at, source_url")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.completed_at) return null;
    const days = Math.floor(
      (Date.now() - new Date(data.completed_at).getTime()) / 86_400_000,
    );
    if (days < STALENESS_THRESHOLD_DAYS) return null;
    return {
      id: `stale-${data.completed_at}`,
      kind: "price_book_stale",
      title: `Price book is ${days} days old`,
      body: "Set up the daily cron-job.org ping or run the manual price-book update so your shelf prices stay in sync with MLCC.",
      productCode: null,
      priority: 90,
      createdAt: data.completed_at,
    };
  } catch (err) {
    console.warn(`[home] staleness card failed (continuing): ${err?.message}`);
    return null;
  }
}

/**
 * Cards for "this SKU's MLCC price changed recently." Filtered to
 * products the store cares about (recently ordered OR in bottles).
 */
async function buildPriceChangeCards(supabase, storeId) {
  try {
    // Set of codes the store has interacted with — recent confirmations
    // OR existing bottles rows. We union them in JS to avoid a complex
    // PostgREST OR query.
    const sinceIso = new Date(
      Date.now() - REORDER_HISTORY_DAYS * 86_400_000,
    ).toISOString();
    const interestingCodes = new Set();
    try {
      const { data: orders } = await supabase
        .from("milo_order_confirmations")
        .select("line_items")
        .eq("store_id", storeId)
        .gte("placed_at", sinceIso);
      for (const order of orders ?? []) {
        for (const li of Array.isArray(order.line_items) ? order.line_items : []) {
          const code = li?.liquorCode;
          if (typeof code === "string" && code) interestingCodes.add(code);
        }
      }
    } catch (e) {
      console.warn(`[home] order history for price-change failed: ${e?.message}`);
    }
    try {
      const { data: bottles } = await supabase
        .from("bottles")
        .select("mlcc_code")
        .eq("store_id", storeId)
        .eq("is_active", true);
      for (const b of bottles ?? []) {
        if (b?.mlcc_code) interestingCodes.add(String(b.mlcc_code));
      }
    } catch (e) {
      console.warn(`[home] bottles lookup for price-change failed: ${e?.message}`);
    }

    if (interestingCodes.size === 0) return [];

    // Look up changed prices.
    const changeSince = new Date(
      Date.now() - PRICE_CHANGE_LOOKBACK_DAYS * 86_400_000,
    ).toISOString();
    const { data: changed, error } = await supabase
      .from("mlcc_items")
      .select(
        "code, name, bottle_size_label, bottle_size_ml, licensee_price, min_shelf_price, price_changed_at",
      )
      .in("code", [...interestingCodes].slice(0, 500))
      .gte("price_changed_at", changeSince)
      .order("price_changed_at", { ascending: false });
    if (error || !Array.isArray(changed)) return [];

    return changed.slice(0, 5).map((row) => {
      const size =
        row.bottle_size_label ?? `${row.bottle_size_ml ?? "?"} mL`;
      const price = row.min_shelf_price ?? row.licensee_price;
      const priceStr = price != null ? `$${Number(price).toFixed(2)}` : "—";
      return {
        id: `price-${row.code}-${row.price_changed_at}`,
        kind: "price_change",
        title: `${row.name} (${size}) price changed`,
        body: `New ${row.min_shelf_price != null ? "shelf" : "licensee"} price ${priceStr} — updated ${timeAgo(row.price_changed_at)}. Consider re-tagging the shelf.`,
        productCode: row.code,
        priority: 60,
        createdAt: row.price_changed_at,
      };
    });
  } catch (err) {
    console.warn(`[home] price-change cards failed (continuing): ${err?.message}`);
    return [];
  }
}

/**
 * Cards for "you usually order this on this day-of-week." Looks at
 * past confirmations from same DOW, surfaces line items not already
 * in the user's current cart (we can't see the local cart from the
 * server, so we just show suggestions; user decides).
 */
async function buildReorderCards(supabase, storeId) {
  try {
    const today = new Date();
    const todayDow = today.getDay();
    const sinceIso = new Date(
      Date.now() - REORDER_HISTORY_DAYS * 86_400_000,
    ).toISOString();
    const cutoffIso = new Date(
      Date.now() - REORDER_RECENT_DAYS * 86_400_000,
    ).toISOString();
    const { data, error } = await supabase
      .from("milo_order_confirmations")
      .select("line_items, placed_at")
      .eq("store_id", storeId)
      .gte("placed_at", sinceIso)
      .lt("placed_at", cutoffIso)
      .order("placed_at", { ascending: false })
      .limit(40);
    if (error || !Array.isArray(data) || data.length === 0) return [];

    // Group line items by code, sum quantities, count occurrences.
    const summary = new Map();
    for (const order of data) {
      const dow = new Date(order.placed_at).getDay();
      // Same-DOW signal — strongest predictor of weekly reorders.
      if (dow !== todayDow) continue;
      for (const li of Array.isArray(order.line_items) ? order.line_items : []) {
        const code = li?.liquorCode;
        if (typeof code !== "string" || !code) continue;
        const key = code;
        const prev = summary.get(key);
        if (prev) {
          prev.totalQty += Number(li.quantity ?? 0);
          prev.occurrences += 1;
          prev.lastPlacedAt = prev.lastPlacedAt > order.placed_at
            ? prev.lastPlacedAt
            : order.placed_at;
        } else {
          summary.set(key, {
            code,
            name: li.productName ?? code,
            totalQty: Number(li.quantity ?? 0),
            occurrences: 1,
            lastPlacedAt: order.placed_at,
            unitPrice: li.unitPrice ?? null,
          });
        }
      }
    }

    // Rank by occurrences DESC then totalQty DESC. Show top 3.
    const ranked = [...summary.values()]
      .sort(
        (a, b) =>
          b.occurrences - a.occurrences || b.totalQty - a.totalQty,
      )
      .slice(0, 3);

    return ranked.map((r) => ({
      id: `reorder-${r.code}`,
      kind: "reorder_suggestion",
      title: `Reorder ${r.name}?`,
      body: `You've ordered this on ${r.occurrences > 1 ? `${r.occurrences} recent ${dowName(todayDow)}s` : `the last ${dowName(todayDow)}`} (avg ${Math.round(r.totalQty / r.occurrences)} bottles).`,
      productCode: r.code,
      priority: 50 + Math.min(20, r.occurrences * 5),
      createdAt: r.lastPlacedAt,
    }));
  } catch (err) {
    console.warn(`[home] reorder cards failed (continuing): ${err?.message}`);
    return [];
  }
}

function dowName(dow) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow] ?? "day";
}

/**
 * GET /home/smart-cards
 * Returns: { ok, cards: [...] }
 */
router.get("/smart-cards", async (req, res) => {
  const storeId = req.resolvedStore?.id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  const supabase = supabaseDefault;
  const [staleness, priceChanges, reorders] = await Promise.all([
    buildStalenessCard(supabase),
    buildPriceChangeCards(supabase, storeId),
    buildReorderCards(supabase, storeId),
  ]);
  const cards = [
    ...(staleness ? [staleness] : []),
    ...priceChanges,
    ...reorders,
  ]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_CARDS_RETURNED);
  return res.json({ ok: true, cards });
});

export default router;
