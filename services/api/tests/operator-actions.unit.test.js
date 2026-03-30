import { describe, expect, it } from "vitest";
import { applyExecutionRunOperatorAction } from "../src/services/execution-run.service.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";

const createSupabaseStub = (initialRun) => {
  const db = {
    run: { ...initialRun },
    actions: [],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = {};
      this.patch = null;
      this.inserted = null;
    }

    select() {
      return this;
    }

    update(patch) {
      this.patch = patch;
      return this;
    }

    insert(payload) {
      this.inserted = payload;
      return Promise.resolve({
        data: this.table === "execution_run_operator_actions" ? payload : null,
        error: null,
      });
    }

    eq(key, value) {
      this.filters[key] = value;
      return this;
    }

    maybeSingle() {
      if (this.table !== "execution_runs") {
        return Promise.resolve({ data: null, error: null });
      }
      const matches =
        db.run.id === this.filters.id && db.run.store_id === this.filters.store_id;
      return Promise.resolve({ data: matches ? { ...db.run } : null, error: null });
    }

    single() {
      if (this.table !== "execution_runs") {
        return Promise.resolve({ data: null, error: null });
      }
      if (
        db.run.id !== this.filters.id ||
        db.run.store_id !== this.filters.store_id
      ) {
        return Promise.resolve({ data: null, error: null });
      }
      db.run = { ...db.run, ...this.patch };
      return Promise.resolve({ data: { ...db.run }, error: null });
    }

    order(key, { ascending }) {
      if (this.table !== "execution_run_operator_actions") {
        return Promise.resolve({ data: [], error: null });
      }
      const rows = db.actions
        .filter(
          (row) =>
            row.run_id === this.filters.run_id &&
            row.store_id === this.filters.store_id,
        )
        .sort((a, b) => {
          const av = new Date(a[key]).getTime();
          const bv = new Date(b[key]).getTime();
          return ascending ? av - bv : bv - av;
        });
      return Promise.resolve({ data: rows, error: null });
    }
  }

  const supabase = {
    from(table) {
      const query = new Query(table);
      const originalInsert = query.insert.bind(query);
      query.insert = (payload) => {
        if (table === "execution_run_operator_actions") {
          db.actions.push({
            id: `action-${db.actions.length + 1}`,
            ...payload,
            created_at: new Date().toISOString(),
          });
        }
        return originalInsert(payload);
      };
      return query;
    },
  };

  return { supabase, db };
};

const makeRun = (overrides = {}) => ({
  id: RUN_ID,
  store_id: STORE_ID,
  cart_id: "33333333-3333-4333-8333-333333333333",
  status: "failed",
  retry_count: 0,
  max_retries: 2,
  failure_type: "NETWORK_ERROR",
  error_message: "timeout",
  progress_stage: "failed",
  progress_message: "Execution failed",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("execution run operator actions", () => {
  it("acknowledge records action and returns enriched summary", async () => {
    const { supabase, db } = createSupabaseStub(makeRun({ status: "running" }));
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "acknowledge",
      { reason: "seen", note: "tracking", actorId: "user-1" },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.operator_status).toBe("acknowledged");
    expect(res.body.data.pending_manual_review).toBe(false);
    expect(res.body.data.latest_operator_action.action).toBe("acknowledge");
    expect(res.body.data.actionable_next_step).toBe("monitor");
    expect(db.actions).toHaveLength(1);
  });

  it("mark_for_manual_review sets pending review summary state", async () => {
    const { supabase } = createSupabaseStub(makeRun());
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "mark_for_manual_review",
      { note: "needs human check", actorId: "user-2" },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.operator_status).toBe("manual_review");
    expect(res.body.data.pending_manual_review).toBe(true);
    expect(res.body.data.latest_operator_action.action).toBe(
      "mark_for_manual_review",
    );
    expect(res.body.data.actionable_next_step).toBe("manual_review");
  });

  it("retry_now allowed requeues run and records action", async () => {
    const { supabase, db } = createSupabaseStub(makeRun());
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "retry_now",
      { reason: "transient issue", actorId: "user-3" },
    );
    expect(res.statusCode).toBe(200);
    expect(db.run.status).toBe("queued");
    expect(db.run.progress_stage).toBe("operator_retry_requested");
    expect(res.body.data.latest_operator_action.action).toBe("retry_now");
    expect(res.body.data.operator_status).toBe("none");
  });

  it("retry_now rejected when retry_allowed is false", async () => {
    const { supabase, db } = createSupabaseStub(
      makeRun({ failure_type: "CODE_MISMATCH" }),
    );
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "retry_now",
      { actorId: "user-4" },
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("retry_now is not allowed for this run");
    expect(db.actions).toHaveLength(0);
    expect(db.run.status).toBe("failed");
  });

  it("cancel allowed for non-succeeded run", async () => {
    const { supabase, db } = createSupabaseStub(makeRun({ status: "running" }));
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "cancel",
      { note: "operator cancel", actorId: "user-5" },
    );
    expect(res.statusCode).toBe(200);
    expect(db.run.status).toBe("canceled");
    expect(res.body.data.operator_status).toBe("canceled_by_operator");
    expect(res.body.data.latest_operator_action.action).toBe("cancel");
  });

  it("cancel rejected on succeeded run", async () => {
    const { supabase, db } = createSupabaseStub(makeRun({ status: "succeeded" }));
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "cancel",
      { actorId: "user-6" },
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Cannot cancel a succeeded run");
    expect(db.actions).toHaveLength(0);
  });

  it("resolve_without_retry allowed for failed run", async () => {
    const { supabase, db } = createSupabaseStub(makeRun({ status: "failed" }));
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "resolve_without_retry",
      { note: "accepted non-retry resolution", actorId: "user-7" },
    );
    expect(res.statusCode).toBe(200);
    expect(db.run.progress_stage).toBe("resolved_without_retry");
    expect(res.body.data.operator_status).toBe("resolved_without_retry");
    expect(res.body.data.latest_operator_action.action).toBe(
      "resolve_without_retry",
    );
    expect(res.body.data.pending_manual_review).toBe(false);
  });

  it("resolve_without_retry rejected for non-failed run", async () => {
    const { supabase, db } = createSupabaseStub(makeRun({ status: "running" }));
    const res = await applyExecutionRunOperatorAction(
      supabase,
      RUN_ID,
      STORE_ID,
      "resolve_without_retry",
      { actorId: "user-8" },
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("resolve_without_retry requires a failed run");
    expect(db.actions).toHaveLength(0);
  });
});
