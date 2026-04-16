import { describe, it, expect } from "vitest";
import {
  OVERVIEW_CART_LIMIT_DEFAULT,
  OVERVIEW_CART_LIMIT_MAX,
  parseOperatorOverviewLimits,
  pickTopBacklogBottlesForOverview,
  pickTopBlockedCartsForOverview,
  toCompactTopBacklogBottle,
  toCompactTopBlockedCart,
} from "../src/mlcc/mlcc-operator-overview.service.js";

describe("parseOperatorOverviewLimits", () => {
  it("defaults and clamps", () => {
    expect(parseOperatorOverviewLimits({})).toEqual({
      cartLimit: OVERVIEW_CART_LIMIT_DEFAULT,
      backlogLimit: OVERVIEW_CART_LIMIT_DEFAULT,
    });
    expect(parseOperatorOverviewLimits({ cart_limit: "99", backlog_limit: "2" })).toEqual({
      cartLimit: OVERVIEW_CART_LIMIT_MAX,
      backlogLimit: 2,
    });
  });
});

describe("pickTopBlockedCartsForOverview", () => {
  it("returns only blocked, triage order, capped", () => {
    const mk = (id, blocked, updated) => ({
      cart_id: id,
      updated_at: updated,
      mlcc_execution_summary: { blocked, status_code: blocked ? "x" : "ready" },
      blocking_preview: blocked ? [{}] : [],
    });
    const carts = [
      mk("r1", false, "2026-01-01"),
      mk("b1", true, "2025-01-01"),
      mk("b2", true, "2026-06-01"),
    ];
    const top = pickTopBlockedCartsForOverview(carts, 1);
    expect(top).toHaveLength(1);
    expect(top[0].cart_id).toBe("b2");
  });
});

describe("pickTopBacklogBottlesForOverview", () => {
  it("slices in order", () => {
    const items = [
      {
        bottle_id: "a",
        proposed_fix_breakdown: { confirm_single_candidate: 1 },
        sample_candidates: [{ mlcc_item_id: "1", code: "1" }],
      },
      { bottle_id: "b", proposed_fix_breakdown: {}, sample_candidates: [] },
    ];
    const top = pickTopBacklogBottlesForOverview(items, 1);
    expect(top).toHaveLength(1);
    expect(top[0].bottle_id).toBe("a");
    expect(top[0].dominant_proposed_fix_action).toBe("confirm_single_candidate");
  });
});

describe("toCompactTopBlockedCart", () => {
  it("passes stable keys", () => {
    const c = {
      cart_id: "c1",
      created_at: "a",
      updated_at: "b",
      placed_at: null,
      validation_status: "validated",
      execution_status: "pending",
      mlcc_execution_summary: { blocked: true },
      blocking_preview: [],
    };
    expect(toCompactTopBlockedCart(c)).toEqual({
      cart_id: "c1",
      created_at: "a",
      updated_at: "b",
      placed_at: null,
      validation_status: "validated",
      execution_status: "pending",
      mlcc_execution_summary: { blocked: true },
      blocking_preview: [],
    });
  });
});

describe("toCompactTopBacklogBottle", () => {
  it("includes dominant action", () => {
    const it = {
      bottle_id: "b1",
      bottle_name: "N",
      bottle_mlcc_code: "1",
      normalized_mlcc_code: "1",
      blocking_hint_count: 2,
      affected_cart_count: 1,
      proposed_fix_breakdown: { operator_must_choose_candidate: 1 },
      sample_candidates: [],
    };
    expect(toCompactTopBacklogBottle(it).dominant_proposed_fix_action).toBe(
      "operator_must_choose_candidate",
    );
  });
});
