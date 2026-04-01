import { describe, expect, it } from "vitest";
import {
  getExecutionRunOperatorReviewBundleById,
  listExecutionRunsForOperatorReview,
} from "../src/services/execution-run.service.js";

const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CART_1 = "11111111-1111-4111-8111-111111111111";
const CART_2 = "22222222-2222-4222-8222-222222222222";
const RUN_1 = "10101010-1010-4010-8010-101010101010";
const RUN_2 = "20202020-2020-4020-8020-202020202020";
const RUN_3 = "30303030-3030-4030-8030-303030303030";

const createSupabaseStub = ({ runs, actions }) => {
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = {};
      this.inFilters = {};
      this.rangeWindow = null;
      this.selectColumns = "*";
      this.sort = null;
    }

    select(columns, options) {
      this.selectColumns = columns;
      this.headCount =
        options?.head === true && String(options?.count ?? "") === "exact";
      return this;
    }

    eq(key, value) {
      this.filters[key] = value;
      return this;
    }

    in(key, values) {
      this.inFilters[key] = values;
      return this;
    }

    order(key, options) {
      this.sort = { key, ascending: options?.ascending ?? true };
      return this;
    }

    range(from, to) {
      this.rangeWindow = { from, to };
      return this;
    }

    maybeSingle() {
      const source = this.table === "execution_runs" ? runs : actions;
      const rows = this.#filteredRows(source);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    then(resolve, reject) {
      try {
        const source = this.table === "execution_runs" ? runs : actions;
        if (this.headCount) {
          const n = this.#filteredRows(source).length;
          resolve({ data: null, error: null, count: n });
          return;
        }
        const rows = this.#sortRows(this.#filteredRows(source));
        const data = this.rangeWindow
          ? rows.slice(this.rangeWindow.from, this.rangeWindow.to + 1)
          : rows;
        resolve({ data, error: null });
      } catch (error) {
        if (reject) reject(error);
      }
    }

    #filteredRows(source) {
      return source.filter((row) => {
        for (const [key, value] of Object.entries(this.filters)) {
          if (row[key] !== value) return false;
        }
        for (const [key, values] of Object.entries(this.inFilters)) {
          if (!values.includes(row[key])) return false;
        }
        return true;
      });
    }

    #sortRows(source) {
      if (!this.sort) return [...source];
      const { key, ascending } = this.sort;
      return [...source].sort((a, b) => {
        const av = new Date(a[key] ?? 0).getTime();
        const bv = new Date(b[key] ?? 0).getTime();
        return ascending ? av - bv : bv - av;
      });
    }
  }

  return {
    from(table) {
      return new Query(table);
    },
  };
};

const runsFixture = [
  {
    id: RUN_1,
    store_id: STORE_A,
    cart_id: CART_1,
    status: "failed",
    retry_count: 0,
    max_retries: 2,
    failure_type: "NETWORK_ERROR",
    error_message: "timeout",
    progress_stage: "failed",
    progress_message: "Execution failed",
    evidence: [{ kind: "screenshot", ref: "a.png" }],
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:05:00.000Z",
  },
  {
    id: RUN_2,
    store_id: STORE_A,
    cart_id: CART_2,
    status: "running",
    retry_count: 0,
    max_retries: 2,
    failure_type: null,
    error_message: null,
    progress_stage: "validate",
    progress_message: "Validating cart",
    evidence: [],
    created_at: "2026-03-01T11:00:00.000Z",
    updated_at: "2026-03-01T11:05:00.000Z",
  },
  {
    id: RUN_3,
    store_id: STORE_B,
    cart_id: CART_2,
    status: "failed",
    retry_count: 0,
    max_retries: 2,
    failure_type: "CODE_MISMATCH",
    error_message: "bad code",
    progress_stage: "failed",
    progress_message: "Execution failed",
    evidence: [],
    created_at: "2026-03-01T12:00:00.000Z",
    updated_at: "2026-03-01T12:05:00.000Z",
  },
];

const actionsFixture = [
  {
    id: "act-1",
    run_id: RUN_1,
    store_id: STORE_A,
    action: "mark_for_manual_review",
    reason: "needs review",
    note: null,
    actor_id: "user-a",
    created_at: "2026-03-01T10:10:00.000Z",
  },
  {
    id: "act-2",
    run_id: RUN_2,
    store_id: STORE_A,
    action: "acknowledge",
    reason: null,
    note: "watching",
    actor_id: "user-a",
    created_at: "2026-03-01T11:10:00.000Z",
  },
];

describe("execution operator review list contract", () => {
  it("lists store-scoped runs newest first with triage fields", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
    });
    const res = await listExecutionRunsForOperatorReview(supabase, STORE_A, {});
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].run_id).toBe(RUN_2);
    expect(res.body.data[1].run_id).toBe(RUN_1);
    expect(res.body.data[0]).toHaveProperty("operator_status");
    expect(res.body.data[0]).toHaveProperty("latest_operator_action");
    expect(res.body.data[0]).toHaveProperty("pending_manual_review");
    expect(res.body.data[0]).toHaveProperty("actionable_next_step");
    expect(res.body.total_count).toBe(2);
    expect(res.body.page.total_count).toBe(2);
  });

  it("filters by status, failure_type, cart_id and manual-review queue", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
    });
    const byStatus = await listExecutionRunsForOperatorReview(supabase, STORE_A, {
      status: "running",
    });
    expect(byStatus.body.data).toHaveLength(1);
    expect(byStatus.body.data[0].run_id).toBe(RUN_2);

    const byFailure = await listExecutionRunsForOperatorReview(supabase, STORE_A, {
      failureType: "NETWORK_ERROR",
    });
    expect(byFailure.body.data).toHaveLength(1);
    expect(byFailure.body.data[0].run_id).toBe(RUN_1);

    const byCart = await listExecutionRunsForOperatorReview(supabase, STORE_A, {
      cartId: CART_1,
    });
    expect(byCart.body.data).toHaveLength(1);
    expect(byCart.body.data[0].run_id).toBe(RUN_1);

    const manualQueue = await listExecutionRunsForOperatorReview(
      supabase,
      STORE_A,
      {
        pendingManualReview: true,
      },
    );
    expect(manualQueue.body.data).toHaveLength(1);
    expect(manualQueue.body.data[0].run_id).toBe(RUN_1);
    expect(manualQueue.body.data[0].pending_manual_review).toBe(true);
    expect(manualQueue.body.total_count).toBe(1);
    expect(manualQueue.body.page.total_count).toBe(1);
  });

  it("supports limit/offset pagination", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
    });
    const page1 = await listExecutionRunsForOperatorReview(supabase, STORE_A, {
      limit: 1,
      offset: 0,
    });
    const page2 = await listExecutionRunsForOperatorReview(supabase, STORE_A, {
      limit: 1,
      offset: 1,
    });
    expect(page1.body.data).toHaveLength(1);
    expect(page2.body.data).toHaveLength(1);
    expect(page1.body.data[0].run_id).not.toBe(page2.body.data[0].run_id);
    expect(page1.body.page).toEqual({ limit: 1, offset: 0, total_count: 2 });
    expect(page1.body.total_count).toBe(2);
  });

  it("rejects missing/invalid store scope", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
    });
    const res = await listExecutionRunsForOperatorReview(supabase, "not-a-uuid", {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Store context required");
  });
});

describe("execution operator review bundle contract", () => {
  it("returns summary + evidence + action history in one response", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
    });
    const res = await getExecutionRunOperatorReviewBundleById(
      supabase,
      RUN_1,
      STORE_A,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.run_id).toBe(RUN_1);
    expect(res.body.data.summary.run_id).toBe(RUN_1);
    expect(res.body.data.evidence.has_evidence).toBe(true);
    expect(res.body.data.evidence.items).toHaveLength(1);
    expect(res.body.data.operator_actions.count).toBe(1);
    expect(res.body.data.operator_actions.items[0].action).toBe(
      "mark_for_manual_review",
    );
  });
});
