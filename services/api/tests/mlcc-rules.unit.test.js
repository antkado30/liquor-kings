import { describe, it, expect, beforeEach } from "vitest";

import {
  clearMlccRulesCache,
  getAllActiveRules,
  getRulesByType,
  getRuleByCode,
  getMinimumOrderLiters,
  getSplitCaseEligibilityRule,
  getRulesNeedingVerification,
  getRulesSummary,
} from "../src/lib/mlcc-rules.js";

/**
 * Tests for the mlcc-rules service module — the runtime query layer over
 * the mlcc_rules table. Supabase is stubbed; the focus is the query
 * helpers, the convenience accessors, the in-memory cache, and the safe
 * fallbacks.
 */

const RULES = [
  {
    id: "1",
    rule_type: "order_minimum",
    code: "min_9l_per_ada",
    name: "9-liter minimum per ADA",
    description: "Each ADA sub-order must total >= 9000mL.",
    parameters: { min_volume_ml: 9000, scope: "per_ada" },
    deprecated_at: null,
  },
  {
    id: "2",
    rule_type: "workflow",
    code: "validate_before_checkout",
    name: "Validate before checkout",
    description: "Validate must succeed before Checkout.",
    parameters: {},
    deprecated_at: null,
  },
  {
    id: "3",
    rule_type: "workflow",
    code: "edit_until_cutoff",
    name: "Edit until cutoff",
    description: "Orders editable until the ADA cutoff date.",
    parameters: { needs_verification: true },
    deprecated_at: null,
  },
  {
    id: "4",
    rule_type: "size_quantity",
    code: "split_case_eligibility_per_product",
    name: "Split-case eligibility per product",
    description: "Split-case eligibility is flagged per product.",
    parameters: {},
    deprecated_at: null,
  },
];

/** Chainable Supabase stub that also counts how many queries were issued. */
function mockSupabase({ rows = RULES, error = null } = {}) {
  let fromCalls = 0;
  const result = { data: rows, error };
  const builder = {
    select: () => builder,
    is: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error }),
    then: (resolve) => resolve(result),
  };
  return {
    from: () => {
      fromCalls += 1;
      return builder;
    },
    get fromCalls() {
      return fromCalls;
    },
  };
}

beforeEach(() => {
  clearMlccRulesCache();
});

describe("getAllActiveRules", () => {
  it("returns the active rules from the table", async () => {
    const rules = await getAllActiveRules({ supabase: mockSupabase() });
    expect(rules).toHaveLength(4);
    expect(rules[0].code).toBe("min_9l_per_ada");
  });

  it("caches — a second call does not re-query", async () => {
    const supabase = mockSupabase();
    await getAllActiveRules({ supabase });
    await getAllActiveRules({ supabase });
    expect(supabase.fromCalls).toBe(1);
  });

  it("forceRefresh bypasses the cache", async () => {
    const supabase = mockSupabase();
    await getAllActiveRules({ supabase });
    await getAllActiveRules({ supabase, forceRefresh: true });
    expect(supabase.fromCalls).toBe(2);
  });

  it("clearMlccRulesCache forces the next call to re-query", async () => {
    const supabase = mockSupabase();
    await getAllActiveRules({ supabase });
    clearMlccRulesCache();
    await getAllActiveRules({ supabase });
    expect(supabase.fromCalls).toBe(2);
  });

  it("throws a clear error when the query fails", async () => {
    await expect(
      getAllActiveRules({ supabase: mockSupabase({ error: { message: "boom" } }) }),
    ).rejects.toThrow(/boom/);
  });
});

describe("getRulesByType", () => {
  it("filters to a single rule_type", async () => {
    const workflow = await getRulesByType("workflow", { supabase: mockSupabase() });
    expect(workflow).toHaveLength(2);
    expect(workflow.every((r) => r.rule_type === "workflow")).toBe(true);
  });

  it("returns an empty array for an unknown type", async () => {
    const none = await getRulesByType("nonexistent", { supabase: mockSupabase() });
    expect(none).toEqual([]);
  });

  it("throws when called without a type", async () => {
    await expect(getRulesByType(undefined, { supabase: mockSupabase() })).rejects.toThrow();
  });
});

describe("getRuleByCode", () => {
  it("finds a rule by its code slug", async () => {
    const rule = await getRuleByCode("min_9l_per_ada", { supabase: mockSupabase() });
    expect(rule).not.toBeNull();
    expect(rule.rule_type).toBe("order_minimum");
  });

  it("returns null for an unknown code", async () => {
    const rule = await getRuleByCode("does_not_exist", { supabase: mockSupabase() });
    expect(rule).toBeNull();
  });
});

describe("getMinimumOrderLiters", () => {
  it("reads 9 from the min_9l_per_ada rule (9000mL)", async () => {
    const liters = await getMinimumOrderLiters({ supabase: mockSupabase() });
    expect(liters).toBe(9);
  });

  it("falls back to 9 when the rule is missing", async () => {
    const liters = await getMinimumOrderLiters({
      supabase: mockSupabase({ rows: [RULES[1]] }), // no min_9l_per_ada
    });
    expect(liters).toBe(9);
  });

  it("falls back to 9 when the DB query errors", async () => {
    const liters = await getMinimumOrderLiters({
      supabase: mockSupabase({ error: { message: "db down" } }),
    });
    expect(liters).toBe(9);
  });
});

describe("getSplitCaseEligibilityRule", () => {
  it("finds the split-case-eligibility rule", async () => {
    const rule = await getSplitCaseEligibilityRule({ supabase: mockSupabase() });
    expect(rule).not.toBeNull();
    expect(rule.code).toBe("split_case_eligibility_per_product");
  });
});

describe("getRulesNeedingVerification", () => {
  it("returns only rules flagged needs_verification", async () => {
    const flagged = await getRulesNeedingVerification({ supabase: mockSupabase() });
    expect(flagged).toHaveLength(1);
    expect(flagged[0].code).toBe("edit_until_cutoff");
  });
});

describe("getRulesSummary", () => {
  it("counts total and by-type", async () => {
    const summary = await getRulesSummary({ supabase: mockSupabase() });
    expect(summary.total).toBe(4);
    expect(summary.byType.workflow).toBe(2);
    expect(summary.byType.order_minimum).toBe(1);
    expect(summary.byType.size_quantity).toBe(1);
  });
});
