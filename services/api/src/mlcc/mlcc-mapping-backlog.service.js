/**
 * Bottle-centric MLCC mapping backlog: aggregate blocking hints by `bottle_id`.
 * Pure aggregation — hint rows must already include `proposed_fix` (from blocking hints pipeline).
 */

import { toProposedFixCandidateOption } from "./mlcc-blocking-hint-proposed-fix.js";

export const MLCC_BACKLOG_SAMPLE_CANDIDATES_MAX = 3;
export const MLCC_BACKLOG_RECENT_CART_IDS_MAX = 5;

/**
 * Dedupe candidate-like objects by `mlcc_item_id` or `code`, keep first N stable order.
 *
 * @param {Record<string, unknown>[]} sources
 * @param {number} max
 */
export function pickSampleCandidates(sources, max = MLCC_BACKLOG_SAMPLE_CANDIDATES_MAX) {
  const seen = new Set();
  const out = [];
  for (const c of sources ?? []) {
    if (!c || typeof c !== "object") continue;
    const id = c.mlcc_item_id != null ? String(c.mlcc_item_id) : null;
    const code = c.code != null ? String(c.code) : "";
    const key = id ?? `code:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toProposedFixCandidateOption(/** @type {Record<string, unknown>} */ (c)));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * @param {Array<Record<string, unknown> & { cart_id?: string; seen_at?: string }>} hintsWithMeta
 * @param {{ scanned_carts: number }} ctx
 * @returns {{ counts: { scanned_carts: number; backlog_bottles: number; total_blocking_hints: number }; items: Record<string, unknown>[] }}
 */
export function aggregateMlccMappingBacklog(hintsWithMeta, ctx) {
  const scanned_carts = Number(ctx.scanned_carts) || 0;
  const total_blocking_hints = hintsWithMeta.length;

  /** @type {Map<string, Record<string, unknown>>} */
  const byBottle = new Map();

  for (const row of hintsWithMeta) {
    const bid = row.bottle_id != null ? String(row.bottle_id).trim() : "";
    if (!bid) continue;

    const seen = String(row.seen_at ?? "");
    const cartId = row.cart_id != null ? String(row.cart_id) : "";

    let agg = byBottle.get(bid);
    if (!agg) {
      agg = {
        bottle_id: bid,
        bottle_name: row.bottle_name ?? null,
        bottle_mlcc_code: row.bottle_mlcc_code ?? null,
        normalized_mlcc_code: row.normalized_mlcc_code ?? null,
        blocking_hint_count: 0,
        cartLastSeen: /** @type {Map<string, string>} */ (new Map()),
        hint_status_breakdown: /** @type {Record<string, number>} */ ({}),
        proposed_fix_breakdown: /** @type {Record<string, number>} */ ({}),
        auto_selectable_count: 0,
        manual_review_count: 0,
        operator_choice_count: 0,
        _candidate_sources: /** @type {Record<string, unknown>[]} */ ([]),
      };
      byBottle.set(bid, agg);
    }

    agg.blocking_hint_count += 1;

    if (cartId) {
      const prev = agg.cartLastSeen.get(cartId) ?? "";
      if (seen > prev) agg.cartLastSeen.set(cartId, seen);
      else if (!agg.cartLastSeen.has(cartId)) agg.cartLastSeen.set(cartId, seen);
    }

    const prevLatest = String(agg._latest_seen ?? "");
    if (seen >= prevLatest) {
      agg._latest_seen = seen;
      if (row.bottle_name != null) agg.bottle_name = row.bottle_name;
      if (row.bottle_mlcc_code != null) agg.bottle_mlcc_code = row.bottle_mlcc_code;
      if (row.normalized_mlcc_code != null) agg.normalized_mlcc_code = row.normalized_mlcc_code;
    }

    const hs = typeof row.hint_status === "string" ? row.hint_status : "unknown";
    agg.hint_status_breakdown[hs] = (agg.hint_status_breakdown[hs] ?? 0) + 1;

    const pf = row.proposed_fix && typeof row.proposed_fix === "object" ? row.proposed_fix : {};
    const action = typeof pf.action === "string" ? pf.action : "unknown";
    agg.proposed_fix_breakdown[action] = (agg.proposed_fix_breakdown[action] ?? 0) + 1;

    if (pf.auto_selectable === true) agg.auto_selectable_count += 1;
    if (action === "manual_review_required") agg.manual_review_count += 1;
    if (action === "operator_must_choose_candidate") agg.operator_choice_count += 1;

    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    for (const c of candidates) {
      if (c && typeof c === "object") agg._candidate_sources.push(/** @type {Record<string, unknown>} */ (c));
    }
    const opts = Array.isArray(pf.candidate_options) ? pf.candidate_options : [];
    for (const c of opts) {
      if (c && typeof c === "object") agg._candidate_sources.push(/** @type {Record<string, unknown>} */ (c));
    }
  }

  const items = [];
  for (const agg of byBottle.values()) {
    const cartLastSeen = agg.cartLastSeen;
    const affected_cart_count = cartLastSeen.size;

    const recent_cart_ids = [...cartLastSeen.entries()]
      .sort((a, b) => {
        const cmp = String(b[1]).localeCompare(String(a[1]));
        if (cmp !== 0) return cmp;
        return String(a[0]).localeCompare(String(b[0]));
      })
      .slice(0, MLCC_BACKLOG_RECENT_CART_IDS_MAX)
      .map(([id]) => id);

    const sample_candidates = pickSampleCandidates(agg._candidate_sources, MLCC_BACKLOG_SAMPLE_CANDIDATES_MAX);

    items.push({
      bottle_id: agg.bottle_id,
      bottle_name: agg.bottle_name,
      bottle_mlcc_code: agg.bottle_mlcc_code,
      normalized_mlcc_code: agg.normalized_mlcc_code,
      blocking_hint_count: agg.blocking_hint_count,
      affected_cart_count,
      latest_seen_at: agg._latest_seen != null && agg._latest_seen !== "" ? agg._latest_seen : null,
      hint_status_breakdown: agg.hint_status_breakdown,
      proposed_fix_breakdown: agg.proposed_fix_breakdown,
      auto_selectable_count: agg.auto_selectable_count,
      manual_review_count: agg.manual_review_count,
      operator_choice_count: agg.operator_choice_count,
      sample_candidates,
      recent_cart_ids,
    });
  }

  items.sort((a, b) => {
    if (b.blocking_hint_count !== a.blocking_hint_count) {
      return b.blocking_hint_count - a.blocking_hint_count;
    }
    if (b.affected_cart_count !== a.affected_cart_count) {
      return b.affected_cart_count - a.affected_cart_count;
    }
    const tb = String(b.latest_seen_at ?? "");
    const ta = String(a.latest_seen_at ?? "");
    if (tb !== ta) return tb.localeCompare(ta);
    return String(a.bottle_id).localeCompare(String(b.bottle_id));
  });

  return {
    counts: {
      scanned_carts,
      backlog_bottles: items.length,
      total_blocking_hints,
    },
    items,
  };
}

/** Prefer higher-urgency action when counts tie (max count wins first, then this order). */
export const DOMINANT_PROPOSED_FIX_TIE_ORDER = [
  "operator_must_choose_candidate",
  "manual_review_required",
  "confirm_single_candidate",
];

/**
 * Dominant proposed-fix action for one backlog item from its `proposed_fix_breakdown`.
 * Highest count wins; ties broken by {@link DOMINANT_PROPOSED_FIX_TIE_ORDER}.
 *
 * @param {Record<string, unknown> | null | undefined} breakdown
 * @returns {string | null}
 */
export function dominantProposedFixActionFromBreakdown(breakdown) {
  const b = breakdown && typeof breakdown === "object" ? breakdown : {};
  let max = 0;
  for (const v of Object.values(b)) {
    const n = Number(v) || 0;
    if (n > max) max = n;
  }
  if (max <= 0) return null;
  for (const action of DOMINANT_PROPOSED_FIX_TIE_ORDER) {
    if ((Number(b[action]) || 0) === max) return action;
  }
  const firstOther = Object.entries(b).find(([, v]) => (Number(v) || 0) === max);
  return firstOther ? String(firstOther[0]) : null;
}

/**
 * Map a dominant action into one of the three `by_proposed_fix_action` buckets.
 *
 * @param {string | null} dominant
 * @returns {"confirm_single_candidate" | "operator_must_choose_candidate" | "manual_review_required"}
 */
export function byProposedFixActionBucketForDominant(dominant) {
  if (dominant === "operator_must_choose_candidate") return "operator_must_choose_candidate";
  if (dominant === "manual_review_required") return "manual_review_required";
  if (dominant === "confirm_single_candidate") return "confirm_single_candidate";
  return "manual_review_required";
}

/**
 * @param {{ confirm_single_candidate: number; manual_review_required: number; operator_must_choose_candidate: number }} byAction
 */
export function highestUrgencyBucketFromByAction(byAction) {
  const order = DOMINANT_PROPOSED_FIX_TIE_ORDER;
  for (const action of order) {
    const count = Number(byAction[action]) || 0;
    if (count > 0) return { action, count };
  }
  return { action: null, count: 0 };
}

/**
 * Operator overview from fully aggregated backlog `items` (before response `limit` slice).
 *
 * @param {Record<string, unknown>[]} items
 * @param {number} totalBlockingHints — must match `counts.total_blocking_hints` from aggregation
 */
export function buildBacklogSummaryFromItems(items, totalBlockingHints) {
  const by_proposed_fix_action = {
    confirm_single_candidate: 0,
    operator_must_choose_candidate: 0,
    manual_review_required: 0,
  };

  let auto_selectable_bottles = 0;
  let operator_choice_bottles = 0;
  let manual_review_bottles = 0;

  for (const it of items ?? []) {
    const breakdown = it?.proposed_fix_breakdown;
    const dominant = dominantProposedFixActionFromBreakdown(
      /** @type {Record<string, unknown>} */ (breakdown),
    );
    const bucket = byProposedFixActionBucketForDominant(dominant);
    by_proposed_fix_action[bucket] += 1;

    const autoN = Number(it?.auto_selectable_count) || 0;
    if (autoN > 0 && dominant === "confirm_single_candidate") {
      auto_selectable_bottles += 1;
    }
    if (dominant === "operator_must_choose_candidate") {
      operator_choice_bottles += 1;
    }
    if (dominant === "manual_review_required") {
      manual_review_bottles += 1;
    }
  }

  return {
    total_backlog_bottles: (items ?? []).length,
    total_blocking_hints: Number(totalBlockingHints) || 0,
    by_proposed_fix_action,
    by_effort_mode: {
      auto_selectable_bottles,
      operator_choice_bottles,
      manual_review_bottles,
    },
    highest_urgency_bucket: highestUrgencyBucketFromByAction(by_proposed_fix_action),
  };
}

/**
 * Bottle drill-down from prebuilt hintsWithMeta rows.
 *
 * @param {Array<Record<string, unknown> & { cart_id?: string; seen_at?: string }>} hintsWithMeta
 * @param {string} bottleId
 * @param {{ cartLimit?: number }} [opts]
 * @returns {Record<string, unknown> | null}
 */
export function buildBottleBacklogDetailFromHints(
  hintsWithMeta,
  bottleId,
  opts = {},
) {
  const bid = String(bottleId ?? "").trim();
  if (!bid) return null;

  const rows = (hintsWithMeta ?? []).filter(
    (r) => String(r?.bottle_id ?? "") === bid,
  );
  if (rows.length === 0) return null;

  const limitRaw = Number(opts.cartLimit ?? 20);
  const cartLimit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;

  const byCart = new Map();
  const proposed_fix_breakdown = {};
  const hint_status_breakdown = {};
  let auto_selectable_count = 0;
  let manual_review_count = 0;
  let operator_choice_count = 0;
  let latest_seen_at = "";
  const candidateSources = [];

  let bottle_name = null;
  let bottle_mlcc_code = null;
  let normalized_mlcc_code = null;

  for (const r of rows) {
    const seen = String(r?.seen_at ?? "");
    if (seen > latest_seen_at) {
      latest_seen_at = seen;
      bottle_name = r?.bottle_name ?? null;
      bottle_mlcc_code = r?.bottle_mlcc_code ?? null;
      normalized_mlcc_code = r?.normalized_mlcc_code ?? null;
    }

    const hs = typeof r?.hint_status === "string" ? r.hint_status : "unknown";
    hint_status_breakdown[hs] = (hint_status_breakdown[hs] ?? 0) + 1;

    const pf = r?.proposed_fix && typeof r.proposed_fix === "object" ? r.proposed_fix : {};
    const action = typeof pf.action === "string" ? pf.action : "unknown";
    proposed_fix_breakdown[action] = (proposed_fix_breakdown[action] ?? 0) + 1;
    if (pf.auto_selectable === true) auto_selectable_count += 1;
    if (action === "manual_review_required") manual_review_count += 1;
    if (action === "operator_must_choose_candidate") operator_choice_count += 1;

    const cartId = String(r?.cart_id ?? "");
    if (cartId) {
      const prev = byCart.get(cartId) ?? {
        cart_id: cartId,
        hint_count: 0,
        latest_seen_at: "",
        hint_status_breakdown: {},
        proposed_fix_breakdown: {},
      };
      prev.hint_count += 1;
      if (seen > String(prev.latest_seen_at ?? "")) {
        prev.latest_seen_at = seen;
      }
      prev.hint_status_breakdown[hs] =
        (prev.hint_status_breakdown[hs] ?? 0) + 1;
      prev.proposed_fix_breakdown[action] =
        (prev.proposed_fix_breakdown[action] ?? 0) + 1;
      byCart.set(cartId, prev);
    }

    const candidates = Array.isArray(r?.candidates) ? r.candidates : [];
    for (const c of candidates) {
      if (c && typeof c === "object") candidateSources.push(c);
    }
    const optsRows = Array.isArray(pf.candidate_options) ? pf.candidate_options : [];
    for (const c of optsRows) {
      if (c && typeof c === "object") candidateSources.push(c);
    }
  }

  const affected_carts = [...byCart.values()]
    .sort((a, b) => {
      if (b.hint_count !== a.hint_count) return b.hint_count - a.hint_count;
      const t = String(b.latest_seen_at ?? "").localeCompare(
        String(a.latest_seen_at ?? ""),
      );
      if (t !== 0) return t;
      return String(a.cart_id).localeCompare(String(b.cart_id));
    })
    .slice(0, cartLimit);

  return {
    bottle_id: bid,
    bottle_name,
    bottle_mlcc_code,
    normalized_mlcc_code,
    blocking_hint_count: rows.length,
    affected_cart_count: byCart.size,
    latest_seen_at: latest_seen_at || null,
    hint_status_breakdown,
    proposed_fix_breakdown,
    auto_selectable_count,
    manual_review_count,
    operator_choice_count,
    dominant_proposed_fix_action:
      dominantProposedFixActionFromBreakdown(proposed_fix_breakdown),
    sample_candidates: pickSampleCandidates(candidateSources),
    affected_carts,
  };
}
