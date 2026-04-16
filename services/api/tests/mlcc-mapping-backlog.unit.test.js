import { describe, it, expect } from "vitest";
import {
  MLCC_BACKLOG_SAMPLE_CANDIDATES_MAX,
  aggregateMlccMappingBacklog,
  buildBottleBacklogDetailFromHints,
  buildBacklogSummaryFromItems,
  byProposedFixActionBucketForDominant,
  dominantProposedFixActionFromBreakdown,
  highestUrgencyBucketFromByAction,
  pickSampleCandidates,
} from "../src/mlcc/mlcc-mapping-backlog.service.js";
import { deriveProposedFixFromBlockingHint } from "../src/mlcc/mlcc-blocking-hint-proposed-fix.js";

function hint({
  bottleId,
  cartId,
  seenAt,
  hintStatus = "exact_catalog_match_found",
  candidates = [
    {
      mlcc_item_id: "11111111-1111-1111-1111-111111111111",
      code: "2458",
      brand_name: "B",
      size: "750",
      proof: null,
      pack: null,
    },
  ],
}) {
  const row = {
    bottle_id: bottleId,
    bottle_name: `Bottle ${bottleId}`,
    bottle_mlcc_code: "2458",
    normalized_mlcc_code: "2458",
    hint_status: hintStatus,
    candidate_count: candidates.length,
    candidates,
    cart_id: cartId,
    seen_at: seenAt,
  };
  row.proposed_fix = deriveProposedFixFromBlockingHint(row);
  return row;
}

describe("dominantProposedFixActionFromBreakdown", () => {
  it("returns null for empty or zero counts", () => {
    expect(dominantProposedFixActionFromBreakdown({})).toBe(null);
    expect(dominantProposedFixActionFromBreakdown({ confirm_single_candidate: 0 })).toBe(null);
  });

  it("tie: prefers operator over manual over confirm at equal max", () => {
    expect(
      dominantProposedFixActionFromBreakdown({
        confirm_single_candidate: 2,
        manual_review_required: 2,
      }),
    ).toBe("manual_review_required");
    expect(
      dominantProposedFixActionFromBreakdown({
        operator_must_choose_candidate: 2,
        manual_review_required: 2,
      }),
    ).toBe("operator_must_choose_candidate");
    expect(
      dominantProposedFixActionFromBreakdown({
        confirm_single_candidate: 2,
        operator_must_choose_candidate: 2,
        manual_review_required: 2,
      }),
    ).toBe("operator_must_choose_candidate");
  });

  it("unique max wins regardless of tie order", () => {
    expect(
      dominantProposedFixActionFromBreakdown({
        confirm_single_candidate: 3,
        manual_review_required: 1,
      }),
    ).toBe("confirm_single_candidate");
  });
});

describe("buildBacklogSummaryFromItems", () => {
  it("empty backlog: zeros and highest_urgency_bucket.action null", () => {
    const s = buildBacklogSummaryFromItems([], 0);
    expect(s).toEqual({
      total_backlog_bottles: 0,
      total_blocking_hints: 0,
      by_proposed_fix_action: {
        confirm_single_candidate: 0,
        operator_must_choose_candidate: 0,
        manual_review_required: 0,
      },
      by_effort_mode: {
        auto_selectable_bottles: 0,
        operator_choice_bottles: 0,
        manual_review_bottles: 0,
      },
      highest_urgency_bucket: { action: null, count: 0 },
    });
  });

  it("all confirm-single-dominant with auto_selectable", () => {
    const items = [
      {
        proposed_fix_breakdown: { confirm_single_candidate: 2 },
        auto_selectable_count: 2,
      },
      {
        proposed_fix_breakdown: { confirm_single_candidate: 1 },
        auto_selectable_count: 1,
      },
    ];
    const s = buildBacklogSummaryFromItems(items, 4);
    expect(s.total_backlog_bottles).toBe(2);
    expect(s.total_blocking_hints).toBe(4);
    expect(s.by_proposed_fix_action.confirm_single_candidate).toBe(2);
    expect(s.by_effort_mode.auto_selectable_bottles).toBe(2);
    expect(s.highest_urgency_bucket).toEqual({
      action: "confirm_single_candidate",
      count: 2,
    });
  });

  it("mixed actions and effort modes", () => {
    const items = [
      {
        proposed_fix_breakdown: {
          confirm_single_candidate: 1,
          operator_must_choose_candidate: 1,
        },
        auto_selectable_count: 1,
      },
      {
        proposed_fix_breakdown: { manual_review_required: 2 },
        auto_selectable_count: 0,
      },
    ];
    const s = buildBacklogSummaryFromItems(items, 3);
    expect(s.by_proposed_fix_action.operator_must_choose_candidate).toBe(1);
    expect(s.by_proposed_fix_action.manual_review_required).toBe(1);
    expect(s.by_effort_mode.operator_choice_bottles).toBe(1);
    expect(s.by_effort_mode.manual_review_bottles).toBe(1);
    expect(s.by_effort_mode.auto_selectable_bottles).toBe(0);
    expect(s.highest_urgency_bucket).toEqual({
      action: "operator_must_choose_candidate",
      count: 1,
    });
  });

  it("highest urgency skips zero counts", () => {
    const by = {
      confirm_single_candidate: 2,
      operator_must_choose_candidate: 0,
      manual_review_required: 0,
    };
    expect(highestUrgencyBucketFromByAction(by)).toEqual({
      action: "confirm_single_candidate",
      count: 2,
    });
  });

  it("unknown dominant maps to manual bucket", () => {
    expect(byProposedFixActionBucketForDominant("weird")).toBe("manual_review_required");
  });

  it("confirm-dominant without auto_selectable does not increment auto_selectable_bottles", () => {
    const items = [
      {
        proposed_fix_breakdown: { confirm_single_candidate: 2 },
        auto_selectable_count: 0,
      },
    ];
    const s = buildBacklogSummaryFromItems(items, 2);
    expect(s.by_proposed_fix_action.confirm_single_candidate).toBe(1);
    expect(s.by_effort_mode.auto_selectable_bottles).toBe(0);
  });
});

describe("pickSampleCandidates", () => {
  it("dedupes by mlcc_item_id and caps", () => {
    const dup = [
      { mlcc_item_id: "a", code: "1" },
      { mlcc_item_id: "a", code: "1" },
      { mlcc_item_id: "b", code: "2" },
      { mlcc_item_id: "c", code: "3" },
      { mlcc_item_id: "d", code: "4" },
    ];
    expect(pickSampleCandidates(dup, MLCC_BACKLOG_SAMPLE_CANDIDATES_MAX).length).toBe(3);
  });
});

describe("aggregateMlccMappingBacklog", () => {
  it("collapses multiple hints for same bottle", () => {
    const hints = [
      hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" }),
      hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" }),
    ];
    const { counts, items } = aggregateMlccMappingBacklog(hints, { scanned_carts: 3 });
    expect(counts.scanned_carts).toBe(3);
    expect(counts.total_blocking_hints).toBe(2);
    expect(counts.backlog_bottles).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].blocking_hint_count).toBe(2);
    expect(items[0].affected_cart_count).toBe(1);
  });

  it("keeps different bottles separate", () => {
    const hints = [
      hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" }),
      hint({ bottleId: "b2", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" }),
    ];
    const { items } = aggregateMlccMappingBacklog(hints, { scanned_carts: 1 });
    expect(items).toHaveLength(2);
  });

  it("affected_cart_count across multiple carts", () => {
    const hints = [
      hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" }),
      hint({ bottleId: "b1", cartId: "c2", seenAt: "2025-02-01T00:00:00Z" }),
    ];
    const { items } = aggregateMlccMappingBacklog(hints, { scanned_carts: 2 });
    expect(items[0].affected_cart_count).toBe(2);
    expect(items[0].recent_cart_ids).toContain("c1");
    expect(items[0].recent_cart_ids).toContain("c2");
  });

  it("proposed_fix and hint_status breakdowns + selectable counts", () => {
    const h1 = hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" });
    const row2 = {
      bottle_id: "b1",
      bottle_name: "Bottle b1",
      bottle_mlcc_code: "2458",
      normalized_mlcc_code: "2458",
      hint_status: "multiple_catalog_matches",
      candidate_count: 2,
      candidates: [
        { mlcc_item_id: "a", code: "2458", brand_name: "x", size: null, proof: null, pack: null },
        { mlcc_item_id: "b", code: "2458", brand_name: "y", size: null, proof: null, pack: null },
      ],
      cart_id: "c1",
      seen_at: "2025-01-02T00:00:00Z",
    };
    row2.proposed_fix = deriveProposedFixFromBlockingHint(row2);
    const { items } = aggregateMlccMappingBacklog([h1, row2], { scanned_carts: 1 });
    const it0 = items[0];
    expect(it0.hint_status_breakdown.exact_catalog_match_found).toBe(1);
    expect(it0.hint_status_breakdown.multiple_catalog_matches).toBe(1);
    expect(it0.proposed_fix_breakdown.confirm_single_candidate).toBe(1);
    expect(it0.proposed_fix_breakdown.operator_must_choose_candidate).toBe(1);
    expect(it0.auto_selectable_count).toBe(1);
    expect(it0.manual_review_count).toBe(0);
    expect(it0.operator_choice_count).toBe(1);
  });

  it("manual_review_count for blank_code hints", () => {
    const row = {
      bottle_id: "b1",
      bottle_name: "X",
      bottle_mlcc_code: "",
      normalized_mlcc_code: null,
      hint_status: "blank_code",
      candidate_count: 0,
      candidates: [],
      cart_id: "c1",
      seen_at: "2025-01-01T00:00:00Z",
    };
    row.proposed_fix = deriveProposedFixFromBlockingHint(row);
    const { items } = aggregateMlccMappingBacklog([row], { scanned_carts: 1 });
    expect(items[0].manual_review_count).toBe(1);
    expect(items[0].auto_selectable_count).toBe(0);
  });

  it("sort: higher blocking_hint_count first, then affected_cart_count, then latest_seen_at, then bottle_id", () => {
    const hints = [
      hint({ bottleId: "low", cartId: "c1", seenAt: "2020-01-01T00:00:00Z" }),
      hint({ bottleId: "high", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" }),
      hint({ bottleId: "high", cartId: "c2", seenAt: "2025-01-01T00:00:00Z" }),
      hint({ bottleId: "high", cartId: "c2", seenAt: "2025-01-01T00:00:00Z" }),
      hint({ bottleId: "mid", cartId: "c3", seenAt: "2025-06-01T00:00:00Z" }),
      hint({ bottleId: "mid", cartId: "c4", seenAt: "2025-06-01T00:00:00Z" }),
    ];
    const { items } = aggregateMlccMappingBacklog(hints, { scanned_carts: 4 });
    expect(items.map((x) => x.bottle_id)).toEqual(["high", "mid", "low"]);
  });

  it("sample_candidates capped and stable", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      mlcc_item_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      code: "2458",
      brand_name: `N${i}`,
      size: null,
      proof: null,
      pack: null,
    }));
    const h = hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" });
    h.candidates = many;
    h.candidate_count = many.length;
    h.proposed_fix = deriveProposedFixFromBlockingHint(h);
    const { items } = aggregateMlccMappingBacklog([h], { scanned_carts: 1 });
    expect(items[0].sample_candidates.length).toBe(MLCC_BACKLOG_SAMPLE_CANDIDATES_MAX);
  });

  it("aggregate + backlog_summary aligns counts for mixed bottle", () => {
    const h1 = hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" });
    const row2 = {
      bottle_id: "b1",
      bottle_name: "Bottle b1",
      bottle_mlcc_code: "2458",
      normalized_mlcc_code: "2458",
      hint_status: "multiple_catalog_matches",
      candidate_count: 2,
      candidates: [
        { mlcc_item_id: "a", code: "2458", brand_name: "x", size: null, proof: null, pack: null },
        { mlcc_item_id: "b", code: "2458", brand_name: "y", size: null, proof: null, pack: null },
      ],
      cart_id: "c1",
      seen_at: "2025-01-02T00:00:00Z",
    };
    row2.proposed_fix = deriveProposedFixFromBlockingHint(row2);
    const { counts, items } = aggregateMlccMappingBacklog([h1, row2], { scanned_carts: 1 });
    const summary = buildBacklogSummaryFromItems(items, counts.total_blocking_hints);
    expect(summary.total_backlog_bottles).toBe(1);
    expect(summary.total_blocking_hints).toBe(counts.total_blocking_hints);
    expect(summary.by_proposed_fix_action.operator_must_choose_candidate).toBe(1);
    expect(summary.highest_urgency_bucket.action).toBe("operator_must_choose_candidate");
  });
});

describe("buildBottleBacklogDetailFromHints", () => {
  it("returns null when bottle has no hints", () => {
    const out = buildBottleBacklogDetailFromHints([], "bottle-x");
    expect(out).toBeNull();
  });

  it("aggregates one bottle across multiple carts and caps affected_carts", () => {
    const h1 = hint({ bottleId: "b1", cartId: "c1", seenAt: "2025-01-01T00:00:00Z" });
    const h2 = hint({ bottleId: "b1", cartId: "c2", seenAt: "2025-02-01T00:00:00Z" });
    const h3 = hint({ bottleId: "b1", cartId: "c2", seenAt: "2025-02-02T00:00:00Z" });
    const out = buildBottleBacklogDetailFromHints([h1, h2, h3], "b1", {
      cartLimit: 1,
    });
    expect(out).toBeTruthy();
    expect(out.blocking_hint_count).toBe(3);
    expect(out.affected_cart_count).toBe(2);
    expect(out.latest_seen_at).toBe("2025-02-02T00:00:00Z");
    expect(out.affected_carts).toHaveLength(1);
    expect(out.affected_carts[0]).toMatchObject({
      cart_id: "c2",
      hint_count: 2,
    });
  });

  it("derives dominant action and summaries", () => {
    const row = {
      bottle_id: "b1",
      bottle_name: "Bottle b1",
      bottle_mlcc_code: "2458",
      normalized_mlcc_code: "2458",
      hint_status: "multiple_catalog_matches",
      candidate_count: 2,
      candidates: [
        { mlcc_item_id: "a", code: "2458", brand_name: "x", size: null, proof: null, pack: null },
        { mlcc_item_id: "b", code: "2458", brand_name: "y", size: null, proof: null, pack: null },
      ],
      cart_id: "c1",
      seen_at: "2025-01-02T00:00:00Z",
    };
    row.proposed_fix = deriveProposedFixFromBlockingHint(row);
    const out = buildBottleBacklogDetailFromHints([row], "b1");
    expect(out.dominant_proposed_fix_action).toBe("operator_must_choose_candidate");
    expect(out.operator_choice_count).toBe(1);
    expect(out.proposed_fix_breakdown.operator_must_choose_candidate).toBe(1);
    expect(out.sample_candidates.length).toBeGreaterThan(0);
  });
});
