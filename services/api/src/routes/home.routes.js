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
      // 2026-06-14 full-app sweep: ingestor writes status="complete"/
      // "complete_with_errors" (no "d") — this was "completed", which never
      // matched, so this card NEVER fired no matter how stale the price book
      // got. Silent failure of the staleness check itself.
      .in("status", ["complete", "complete_with_errors"])
      // kind='full' (2026-07-12): a 40-row New Item Price List ingest is
      // NOT "the catalog is fresh" — staleness measures full books only.
      .eq("kind", "full")
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
    // These two lookups are independent — fetch them concurrently.
    const [ordersResult, bottlesResult] = await Promise.allSettled([
      supabase
        .from("milo_order_confirmations")
        .select("line_items")
        .eq("store_id", storeId)
        .gte("placed_at", sinceIso),
      supabase
        .from("bottles")
        .select("mlcc_code")
        .eq("store_id", storeId)
        .eq("is_active", true),
    ]);
    if (ordersResult.status === "fulfilled") {
      for (const order of ordersResult.value.data ?? []) {
        for (const li of Array.isArray(order.line_items) ? order.line_items : []) {
          const code = li?.liquorCode;
          if (typeof code === "string" && code) interestingCodes.add(code);
        }
      }
    } else {
      console.warn(
        `[home] order history for price-change failed: ${ordersResult.reason?.message}`,
      );
    }
    if (bottlesResult.status === "fulfilled") {
      for (const b of bottlesResult.value.data ?? []) {
        if (b?.mlcc_code) interestingCodes.add(String(b.mlcc_code));
      }
    } else {
      console.warn(
        `[home] bottles lookup for price-change failed: ${bottlesResult.reason?.message}`,
      );
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
  const storeId = req.store_id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  const supabase = supabaseDefault;
  const [staleness, priceChanges, reorders, storeMeta] = await Promise.all([
    buildStalenessCard(supabase),
    buildPriceChangeCards(supabase, storeId),
    buildReorderCards(supabase, storeId),
    /*
     * Persistent activation state (task #88, 2026-06-06). Returns a
     * tiny per-store metadata blob the scanner needs to decide
     * whether to nudge the user to verify their MLCC connection.
     * Lives in the smart-cards response so we don't add a fresh
     * round-trip on home load — the scanner already calls this on
     * mount.
     */
    loadStoreVerificationMeta(supabase, storeId),
  ]);
  const cards = [
    ...(staleness ? [staleness] : []),
    ...priceChanges,
    ...reorders,
  ]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_CARDS_RETURNED);
  return res.json({ ok: true, cards, store_meta: storeMeta });
});

async function loadStoreVerificationMeta(supabase, storeId) {
  const { data, error } = await supabase
    .from("stores")
    .select(
      "store_name, liquor_license, mlcc_credentials_last_verified_at, allow_order_submission",
    )
    .eq("id", storeId)
    .single();
  if (error || !data) {
    return {
      store_name: null,
      liquor_license: null,
      mlcc_credentials_last_verified_at: null,
      allow_order_submission: false,
    };
  }
  return {
    /*
     * Surface the store's name + license # to the scanner so the
     * pre-submit verification modal (task #89, 2026-06-06) can show
     * the user "you're about to send this to Colony Party Store
     * (430342)" — catches the rare-but-catastrophic "wrong store"
     * mistake as part of the integrity-doctrine check. RLS guarantees
     * the caller is a member of this store, so leaking the name is
     * a no-op privacy-wise.
     */
    store_name: data.store_name ?? null,
    liquor_license: data.liquor_license ?? null,
    mlcc_credentials_last_verified_at:
      data.mlcc_credentials_last_verified_at ?? null,
    /*
     * AUDIT #15b (2026-06-13): "is this store armed for real orders right
     * now" — the SAME two-part gate execution-worker.js checks before the
     * final MLCC submit click (global LK_ALLOW_ORDER_SUBMISSION=yes AND this
     * store's allow_order_submission=true). Surfacing it here lets the
     * scanner tell the user UP FRONT, before they sit through the ~2-minute
     * RPA run, that Submit will only run as a cart/pricing preview and won't
     * place a real order. Tony's call (2026-06-13): be completely transparent
     * about this for trust + liability reasons — no surprise dry-runs.
     */
    allow_order_submission:
      process.env.LK_ALLOW_ORDER_SUBMISSION !== "no" &&
      data.allow_order_submission === true,
  };
}

/* ─── Dad analytics dashboard (task #77, 2026-06-06) ─────────────── */

/**
 * GET /home/analytics
 *
 * One-shot dashboard: this week's spend, last week's spend, top SKUs,
 * ADA breakdown, biggest movers, total bottles ordered. Powered by
 * milo_order_confirmations (the persisted post-submit confirmations
 * from #41). Single endpoint so the scanner can paint the dashboard
 * with one fetch on home open.
 *
 * Time ranges (Eastern):
 *   - This week: Monday 00:00 → now
 *   - Last week: previous Monday 00:00 → previous Sunday 23:59
 *   - All-time top SKUs: last 90 days
 *
 * Empty-state friendly: if a store has zero orders, returns zeroed
 * structures rather than nulls so the scanner UI can render cleanly.
 */
router.get("/analytics", async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  try {
    const supabase = supabaseDefault;

    /*
     * Eastern-aware week boundaries. JavaScript's Date arithmetic is
     * UTC, so to find "this Monday Eastern" we shift through the
     * America/New_York calendar via Intl + manual math.
     */
    const now = new Date();
    const easternToday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const todayDow =
      dowMap[easternToday.find((p) => p.type === "weekday")?.value] ?? 0;
    // Monday is week start in retail. Days back to Monday = (todayDow === 0 ? 6 : todayDow - 1).
    const daysToMonday = todayDow === 0 ? 6 : todayDow - 1;
    const thisWeekStart = new Date(now.getTime() - daysToMonday * 86_400_000);
    thisWeekStart.setUTCHours(4, 0, 0, 0); // ~midnight Eastern (UTC-4 or UTC-5; close enough for a daily boundary)
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000);
    const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

    // Pull all confirmations from the lookback window in one query.
    // We aggregate in JS rather than via PostgREST RPC — simpler, and
    // the volume is tiny (LK's typical store places ~50 orders/quarter).
    const { data: rows, error } = await supabase
      .from("milo_order_confirmations")
      .select(
        "id, ada_number, ada_name, placed_at, net_total, gross_total, line_item_count, line_items",
      )
      .eq("store_id", storeId)
      .gte("placed_at", ninetyDaysAgo.toISOString())
      .order("placed_at", { ascending: false });
    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    const confirmations = rows ?? [];

    /*
     * Bucket confirmations by week. We classify by `placed_at`'s
     * Eastern-local date relative to the computed week boundaries.
     */
    const inRange = (iso, startDate, endDate) => {
      const t = new Date(iso).getTime();
      return t >= startDate.getTime() && t <= endDate.getTime();
    };

    const thisWeek = confirmations.filter((c) =>
      inRange(c.placed_at, thisWeekStart, now),
    );
    const lastWeek = confirmations.filter((c) =>
      inRange(c.placed_at, lastWeekStart, lastWeekEnd),
    );

    const sum = (arr, key) =>
      arr.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
    const round2 = (n) => Math.round(n * 100) / 100;

    const thisWeekSpend = round2(sum(thisWeek, "net_total"));
    const lastWeekSpend = round2(sum(lastWeek, "net_total"));
    const wowChangePct =
      lastWeekSpend > 0
        ? round2(((thisWeekSpend - lastWeekSpend) / lastWeekSpend) * 100)
        : null;

    /*
     * ADA breakdown for this week. NWS Michigan (321), General Wine
     * (221), and Imperial Beverage (141) are the standard three.
     */
    const adaThisWeek = new Map();
    for (const conf of thisWeek) {
      const k = String(conf.ada_number ?? "").trim() || "?";
      const prev = adaThisWeek.get(k) ?? {
        ada_number: k,
        ada_name: conf.ada_name ?? "",
        net_total: 0,
        orders: 0,
      };
      prev.net_total += Number(conf.net_total) || 0;
      prev.orders += 1;
      adaThisWeek.set(k, prev);
    }
    const adaBreakdown = [...adaThisWeek.values()]
      .map((a) => ({ ...a, net_total: round2(a.net_total) }))
      .sort((a, b) => b.net_total - a.net_total);

    /*
     * Top SKUs over the lookback window. Each confirmation's
     * line_items is a JSON array of { liquorCode, productName,
     * quantity, unitPrice }. We aggregate by liquorCode.
     */
    const skuTally = new Map();
    for (const conf of confirmations) {
      const lines = Array.isArray(conf.line_items) ? conf.line_items : [];
      for (const line of lines) {
        const code = String(line?.liquorCode ?? "").trim();
        if (!code) continue;
        const qty = Number(line?.quantity) || 0;
        const unit = Number(line?.unitPrice) || 0;
        const prev = skuTally.get(code) ?? {
          code,
          name: line?.productName ?? code,
          units: 0,
          dollars: 0,
          orders: 0,
        };
        prev.units += qty;
        prev.dollars += qty * unit;
        prev.orders += 1;
        skuTally.set(code, prev);
      }
    }
    const topByUnits = [...skuTally.values()]
      .map((s) => ({ ...s, dollars: round2(s.dollars) }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);
    const topByDollars = [...skuTally.values()]
      .map((s) => ({ ...s, dollars: round2(s.dollars) }))
      .sort((a, b) => b.dollars - a.dollars)
      .slice(0, 5);

    /*
     * Biggest movers: which SKUs jumped most in volume this week vs.
     * the trailing 4-week average. Helpful for spotting trends ("Crown
     * Royal is up 60% this week — restock heavy") and for the SaaS
     * sales pitch ("LK tells you what's actually moving").
     */
    const fourWeeksAgo = new Date(now.getTime() - 28 * 86_400_000);
    const trailingFour = confirmations.filter(
      (c) => new Date(c.placed_at) >= fourWeeksAgo,
    );
    const trailingTally = new Map();
    for (const conf of trailingFour) {
      const lines = Array.isArray(conf.line_items) ? conf.line_items : [];
      for (const line of lines) {
        const code = String(line?.liquorCode ?? "").trim();
        if (!code) continue;
        const qty = Number(line?.quantity) || 0;
        trailingTally.set(code, (trailingTally.get(code) ?? 0) + qty);
      }
    }
    // This-week tally by code (sub-set of trailing).
    const thisWeekTally = new Map();
    for (const conf of thisWeek) {
      const lines = Array.isArray(conf.line_items) ? conf.line_items : [];
      for (const line of lines) {
        const code = String(line?.liquorCode ?? "").trim();
        if (!code) continue;
        const qty = Number(line?.quantity) || 0;
        thisWeekTally.set(code, (thisWeekTally.get(code) ?? 0) + qty);
      }
    }
    // Movement %: (this_week_units - avg_weekly_units) / avg_weekly_units.
    const movers = [];
    for (const [code, weeklyUnits] of thisWeekTally) {
      const trailing = trailingTally.get(code) ?? 0;
      // Need at least 4 weeks of history to compute a meaningful avg.
      const avgWeekly = trailing / 4;
      if (avgWeekly < 1) continue; // skip noise — code with <1/wk history
      const changePct = round2(((weeklyUnits - avgWeekly) / avgWeekly) * 100);
      const sku = skuTally.get(code);
      movers.push({
        code,
        name: sku?.name ?? code,
        this_week_units: weeklyUnits,
        avg_weekly_units: round2(avgWeekly),
        change_pct: changePct,
      });
    }
    movers.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
    const biggestMovers = movers.slice(0, 5);

    // Total bottles ordered this week (just the sum of quantities).
    const bottlesThisWeek = [...thisWeekTally.values()].reduce(
      (acc, v) => acc + v,
      0,
    );

    return res.json({
      ok: true,
      generated_at: now.toISOString(),
      this_week: {
        starts_at: thisWeekStart.toISOString(),
        spend: thisWeekSpend,
        order_count: thisWeek.length,
        bottle_count: bottlesThisWeek,
        ada_breakdown: adaBreakdown,
      },
      last_week: {
        starts_at: lastWeekStart.toISOString(),
        spend: lastWeekSpend,
        order_count: lastWeek.length,
      },
      wow_change_pct: wowChangePct,
      top_by_units: topByUnits,
      top_by_dollars: topByDollars,
      biggest_movers: biggestMovers,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
