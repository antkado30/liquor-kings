import { describe, expect, it } from "vitest";
import {
  getExecutionRunLifecycleById,
  getExecutionRunPilotVerificationById,
  getExecutionRunPilotVerdictById,
  getExecutionRunPilotReviewPacketById,
  getStorePilotOverview,
  getStorePilotRunsFeed,
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

const createSupabaseStub = ({ runs, actions, attempts = [] }) => {
  const resolveSource = (table) => {
    if (table === "execution_runs") return runs;
    if (table === "execution_run_attempts") return attempts;
    return actions;
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = {};
      this.inFilters = {};
      this.isFilters = {};
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

    is(key, value) {
      this.isFilters[key] = value;
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
      const source = resolveSource(this.table);
      let rows = this.#filteredRows(source);
      rows = this.#sortRows(rows);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    then(resolve, reject) {
      try {
        const source = resolveSource(this.table);
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
        for (const [key, value] of Object.entries(this.isFilters)) {
          if (value === null) {
            if (row[key] != null) return false;
          } else if (row[key] !== value) return false;
        }
        return true;
      });
    }

    #sortRows(source) {
      if (!this.sort) return [...source];
      const { key, ascending } = this.sort;
      return [...source].sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (typeof av === "number" && typeof bv === "number") {
          return ascending ? av - bv : bv - av;
        }
        const aTime = new Date(av ?? 0).getTime();
        const bTime = new Date(bv ?? 0).getTime();
        return ascending ? aTime - bTime : bTime - aTime;
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
    evidence: [
      { kind: "screenshot", ref: "a.png" },
      {
        kind: "worker_step_event",
        stage: "validate",
        message: "Deterministic payload assertions started",
        created_at: "2026-03-01T10:02:00.000Z",
        attributes: { source: "unit" },
      },
    ],
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

const attemptsFixture = [
  {
    id: "att-1",
    run_id: RUN_1,
    store_id: STORE_A,
    attempt_number: 1,
    started_at: "2026-03-01T10:00:00.000Z",
    finished_at: "2026-03-01T10:05:00.000Z",
    status: "failed",
    failure_type: "NETWORK_ERROR",
    failure_message: "timeout",
    progress_stage: "failed",
    progress_message: "Execution failed",
    evidence_metadata: { evidence_count: 1, evidence_kinds: ["screenshot"] },
    worker_id: "worker-a",
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:05:00.000Z",
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
    expect(res.body.data[0].stored_attempt_count).toBe(0);
    expect(res.body.data[0].repeated_same_stored_failure).toBe(false);
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
  it("returns summary + evidence + action history + attempt history in one response", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
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
    expect(res.body.data.evidence.items).toHaveLength(2);
    expect(
      res.body.data.evidence.items.some((e) => e.kind === "worker_step_event"),
    ).toBe(true);
    expect(res.body.data.operator_actions.count).toBe(1);
    expect(res.body.data.operator_actions.items[0].action).toBe(
      "mark_for_manual_review",
    );
    expect(res.body.data.attempt_history.count).toBe(1);
    expect(res.body.data.attempt_history.items).toHaveLength(1);
    expect(res.body.data.attempt_history.items[0].attempt_number).toBe(1);
    expect(res.body.data.attempt_history.items[0].worker_id).toBe("worker-a");
  });
});

describe("execution lifecycle contract", () => {
  it("returns lifecycle timeline with counts and evidence kinds", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
    });

    const res = await getExecutionRunLifecycleById(supabase, RUN_1, STORE_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.run_id).toBe(RUN_1);
    expect(res.body.lifecycle).toMatchObject({
      summary: expect.any(Object),
      counts: {
        attempts: 1,
        operator_actions: 1,
        evidence_entries: 2,
        step_evidence_entries: 1,
      },
      evidence_kinds_tally: {
        screenshot: 1,
        worker_step_event: 1,
      },
    });
    expect(Array.isArray(res.body.lifecycle.step_evidence)).toBe(true);
    expect(res.body.lifecycle.step_evidence[0]).toMatchObject({
      stage: "validate",
      message: expect.any(String),
      created_at: expect.any(String),
      attributes: expect.any(Object),
    });
    expect(Array.isArray(res.body.lifecycle.events)).toBe(true);
    expect(res.body.lifecycle.events.length).toBeGreaterThan(0);
    expect(
      res.body.lifecycle.events.some((e) => e.kind === "attempt_started"),
    ).toBe(true);
    expect(
      res.body.lifecycle.events.some((e) => e.kind === "operator_action"),
    ).toBe(true);
  });
});

describe("execution pilot verification contract", () => {
  it("returns pass/fail checks over lifecycle summary", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
    });

    const res = await getExecutionRunPilotVerificationById(supabase, RUN_1, STORE_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pilot_verification).toMatchObject({
      overall_pass: false,
      failed_check_count: expect.any(Number),
      checks: expect.any(Array),
    });
    const checkKeys = res.body.pilot_verification.checks.map((c) => c.key);
    expect(checkKeys).toContain("queue_timestamp_present");
    expect(checkKeys).toContain("failed_runs_have_failure_type");
    expect(checkKeys).toContain("attempt_history_present_after_start");
    expect(checkKeys).toContain(
      "no_submit_attestation_present_for_succeeded_runs",
    );
    expect(checkKeys).toContain(
      "worker_step_evidence_present_for_succeeded_runs",
    );
  });

  it("requires no-submit attestation evidence for succeeded runs", async () => {
    const RUN_4 = "40404040-4040-4040-8040-404040404040";
    const runs = [
      ...runsFixture,
      {
        id: RUN_4,
        store_id: STORE_A,
        cart_id: CART_1,
        status: "succeeded",
        retry_count: 0,
        max_retries: 2,
        failure_type: null,
        error_message: null,
        progress_stage: "completed",
        progress_message: "Execution completed successfully",
        evidence: [
          { kind: "no_submit_attestation", ref: "policy" },
          {
            kind: "worker_step_event",
            stage: "assertions_passed",
            message: "Deterministic assertions passed",
            created_at: "2026-03-01T13:03:00.000Z",
          },
        ],
        created_at: "2026-03-01T13:00:00.000Z",
        updated_at: "2026-03-01T13:05:00.000Z",
        queued_at: "2026-03-01T13:00:00.000Z",
        started_at: "2026-03-01T13:01:00.000Z",
        heartbeat_at: "2026-03-01T13:02:00.000Z",
        finished_at: "2026-03-01T13:05:00.000Z",
      },
    ];
    const supabase = createSupabaseStub({
      runs,
      actions: actionsFixture,
      attempts: [
        ...attemptsFixture,
        {
          id: "att-4",
          run_id: RUN_4,
          store_id: STORE_A,
          attempt_number: 1,
          started_at: "2026-03-01T13:01:00.000Z",
          finished_at: "2026-03-01T13:05:00.000Z",
          status: "succeeded",
          failure_type: null,
          failure_message: null,
          progress_stage: "completed",
          progress_message: "Execution completed successfully",
          evidence_metadata: { evidence_count: 1, evidence_kinds: ["no_submit_attestation"] },
          worker_id: "worker-s",
          created_at: "2026-03-01T13:01:00.000Z",
          updated_at: "2026-03-01T13:05:00.000Z",
        },
      ],
    });
    const res = await getExecutionRunPilotVerificationById(supabase, RUN_4, STORE_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.pilot_verification.overall_pass).toBe(true);
    const attCheck = res.body.pilot_verification.checks.find(
      (c) => c.key === "no_submit_attestation_present_for_succeeded_runs",
    );
    expect(attCheck).toBeTruthy();
    expect(attCheck.pass).toBe(true);
  });
});

describe("execution pilot verdict contract", () => {
  it("returns failed verdict when pilot checks fail", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
    });
    const res = await getExecutionRunPilotVerdictById(supabase, RUN_1, STORE_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verdict).toMatchObject({
      pilot_complete: false,
      verdict_code: "pilot_verification_failed",
    });
    expect(typeof res.body.triage_bucket).toBe("string");
    expect(Array.isArray(res.body.failed_checks)).toBe(true);
    expect(res.body.failed_checks.length).toBeGreaterThan(0);
  });

  it("returns pilot_complete verdict for succeeded run with passing checks", async () => {
    const RUN_5 = "50505050-5050-4050-8050-505050505050";
    const runs = [
      ...runsFixture,
      {
        id: RUN_5,
        store_id: STORE_A,
        cart_id: CART_1,
        status: "succeeded",
        retry_count: 0,
        max_retries: 2,
        failure_type: null,
        error_message: null,
        progress_stage: "completed",
        progress_message: "Execution completed successfully",
        evidence: [
          { kind: "no_submit_attestation" },
          {
            kind: "worker_step_event",
            stage: "mlcc_dry_run_plan_ready",
            message: "Dry-run plan generated",
            created_at: "2026-03-01T14:03:00.000Z",
          },
        ],
        created_at: "2026-03-01T14:00:00.000Z",
        updated_at: "2026-03-01T14:05:00.000Z",
        queued_at: "2026-03-01T14:00:00.000Z",
        started_at: "2026-03-01T14:01:00.000Z",
        heartbeat_at: "2026-03-01T14:02:00.000Z",
        finished_at: "2026-03-01T14:05:00.000Z",
      },
    ];
    const attempts = [
      ...attemptsFixture,
      {
        id: "att-5",
        run_id: RUN_5,
        store_id: STORE_A,
        attempt_number: 1,
        started_at: "2026-03-01T14:01:00.000Z",
        finished_at: "2026-03-01T14:05:00.000Z",
        status: "succeeded",
        failure_type: null,
        failure_message: null,
        progress_stage: "completed",
        progress_message: "Execution completed successfully",
        evidence_metadata: {
          evidence_count: 1,
          evidence_kinds: ["no_submit_attestation"],
        },
        worker_id: "worker-s",
        created_at: "2026-03-01T14:01:00.000Z",
        updated_at: "2026-03-01T14:05:00.000Z",
      },
    ];
    const supabase = createSupabaseStub({
      runs,
      actions: actionsFixture,
      attempts,
    });
    const res = await getExecutionRunPilotVerdictById(supabase, RUN_5, STORE_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.verdict).toMatchObject({
      pilot_complete: true,
      verdict_code: "pilot_complete_succeeded",
      next_action: "run_passed_no_submit_pilot_checks",
    });
    expect(res.body.triage_bucket).toBe("pilot_complete");
    expect(res.body.failed_checks).toEqual([]);
  });
});

describe("execution pilot review packet contract", () => {
  it("returns compact packet with verdict, failed checks and step trace", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
    });
    const res = await getExecutionRunPilotReviewPacketById(supabase, RUN_1, STORE_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pilot_review_packet).toMatchObject({
      verdict: expect.any(Object),
      triage_bucket: expect.any(String),
      checks: { total: expect.any(Number), passed: expect.any(Number), failed: expect.any(Number) },
      failed_checks: expect.any(Array),
      lifecycle_highlights: expect.any(Object),
      no_submit_evidence: { present: expect.any(Boolean), count: expect.any(Number) },
      worker_step_trace: {
        step_count: expect.any(Number),
        latest_steps: expect.any(Array),
      },
    });
  });

  it("shows no-submit evidence present for succeeded passing run", async () => {
    const RUN_6 = "60606060-6060-4060-8060-606060606060";
    const runs = [
      ...runsFixture,
      {
        id: RUN_6,
        store_id: STORE_A,
        cart_id: CART_1,
        status: "succeeded",
        retry_count: 0,
        max_retries: 2,
        failure_type: null,
        error_message: null,
        progress_stage: "completed",
        progress_message: "Execution completed successfully",
        evidence: [
          { kind: "no_submit_attestation", created_at: "2026-03-01T15:04:00.000Z" },
          {
            kind: "worker_step_event",
            stage: "assertions_passed",
            message: "Deterministic assertions passed",
            created_at: "2026-03-01T15:03:00.000Z",
          },
        ],
        created_at: "2026-03-01T15:00:00.000Z",
        updated_at: "2026-03-01T15:05:00.000Z",
        queued_at: "2026-03-01T15:00:00.000Z",
        started_at: "2026-03-01T15:01:00.000Z",
        heartbeat_at: "2026-03-01T15:02:00.000Z",
        finished_at: "2026-03-01T15:05:00.000Z",
      },
    ];
    const attempts = [
      ...attemptsFixture,
      {
        id: "att-6",
        run_id: RUN_6,
        store_id: STORE_A,
        attempt_number: 1,
        started_at: "2026-03-01T15:01:00.000Z",
        finished_at: "2026-03-01T15:05:00.000Z",
        status: "succeeded",
        failure_type: null,
        failure_message: null,
        progress_stage: "completed",
        progress_message: "Execution completed successfully",
        evidence_metadata: {
          evidence_count: 2,
          evidence_kinds: ["no_submit_attestation", "worker_step_event"],
        },
        worker_id: "worker-z",
        created_at: "2026-03-01T15:01:00.000Z",
        updated_at: "2026-03-01T15:05:00.000Z",
      },
    ];
    const supabase = createSupabaseStub({
      runs,
      actions: actionsFixture,
      attempts,
    });
    const res = await getExecutionRunPilotReviewPacketById(supabase, RUN_6, STORE_A);
    expect(res.statusCode).toBe(200);
    expect(res.body.pilot_review_packet.verdict).toMatchObject({
      pilot_complete: true,
      verdict_code: "pilot_complete_succeeded",
    });
    expect(res.body.pilot_review_packet.triage_bucket).toBe("pilot_complete");
    expect(res.body.pilot_review_packet.no_submit_evidence).toEqual({
      present: true,
      count: 1,
    });
    expect(
      res.body.pilot_review_packet.worker_step_trace.step_count,
    ).toBeGreaterThan(0);
  });
});

describe("store pilot runs feed contract", () => {
  it("returns compact pilot items + aggregate counts for store window", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
    });

    const res = await getStorePilotRunsFeed(supabase, STORE_A, { limit: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.store_id).toBe(STORE_A);
    expect(res.body.counts).toMatchObject({
      total_runs: expect.any(Number),
      pilot_complete_runs: expect.any(Number),
      runs_with_failed_checks: expect.any(Number),
      by_status: expect.any(Object),
      by_verdict_code: expect.any(Object),
      by_triage_bucket: expect.any(Object),
    });
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toMatchObject({
      run_id: expect.any(String),
      cart_id: expect.any(String),
      created_at: expect.any(String),
      updated_at: expect.any(String),
      status: expect.any(String),
      pilot_verdict_code: expect.any(String),
      triage_bucket: expect.any(String),
      pilot_complete: expect.any(Boolean),
      failed_check_count: expect.any(Number),
      no_submit_evidence_present: expect.any(Boolean),
      worker_step_count: expect.any(Number),
    });
    expect(res.body.counts.total_runs).toBe(res.body.items.length);
  });

  it("rejects invalid store scope", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
    });
    const res = await getStorePilotRunsFeed(supabase, "not-a-uuid", { limit: 20 });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Store context required");
  });
});

describe("store pilot overview contract", () => {
  it("returns compact one-call pilot health summary + failed slice", async () => {
    const supabase = createSupabaseStub({
      runs: runsFixture,
      actions: actionsFixture,
      attempts: attemptsFixture,
    });
    const res = await getStorePilotOverview(supabase, STORE_A, {
      limit: 20,
      failedLimit: 3,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.store_id).toBe(STORE_A);
    expect(res.body.summary).toMatchObject({
      total_recent_runs: expect.any(Number),
      pilot_complete_runs: expect.any(Number),
      completion_rate_pct: expect.any(Number),
      runs_with_failed_checks: expect.any(Number),
      by_status: expect.any(Object),
      by_verdict: expect.any(Object),
      by_triage_bucket: expect.any(Object),
      most_common_triage_bucket: {
        bucket: expect.anything(),
        count: expect.any(Number),
      },
    });
    expect(res.body.health).toMatchObject({
      health_status: expect.any(String),
      needs_attention_since:
        res.body.health.health_status === "needs_attention" ? expect.any(String) : null,
      minimum_data_window_met: expect.any(Boolean),
      alert_reasons: expect.any(Array),
      triggered_by: {
        low_completion_rate: expect.any(Boolean),
        repeated_failed_checks: expect.any(Boolean),
        repeated_same_triage_bucket: expect.any(Boolean),
        recent_failure_streak: expect.any(Boolean),
        no_recent_pilot_complete_runs: expect.any(Boolean),
      },
    });
    expect(Array.isArray(res.body.recent_failed_runs)).toBe(true);
    expect(res.body.recent_failed_runs.length).toBeLessThanOrEqual(3);
    if (res.body.recent_failed_runs.length > 0) {
      expect(res.body.recent_failed_runs[0]).toMatchObject({
        run_id: expect.any(String),
        status: expect.any(String),
        pilot_verdict_code: expect.any(String),
        triage_bucket: expect.any(String),
        failed_check_count: expect.any(Number),
        no_submit_evidence_present: expect.any(Boolean),
        worker_step_count: expect.any(Number),
      });
    }
  });

  it("marks needs_attention for severe low-completion + failure streak window", async () => {
    const RUN_A = "70707070-7070-4070-8070-707070707070";
    const RUN_B = "71717171-7171-4171-8171-717171717171";
    const RUN_C = "72727272-7272-4272-8272-727272727272";
    const runs = [
      {
        id: RUN_A,
        store_id: STORE_A,
        cart_id: CART_1,
        status: "failed",
        retry_count: 0,
        max_retries: 2,
        failure_type: "UNKNOWN",
        error_message: "x",
        progress_stage: "failed",
        progress_message: "Execution failed",
        evidence: [],
        created_at: "2026-03-02T10:00:00.000Z",
        updated_at: "2026-03-02T10:05:00.000Z",
      },
      {
        id: RUN_B,
        store_id: STORE_A,
        cart_id: CART_1,
        status: "failed",
        retry_count: 0,
        max_retries: 2,
        failure_type: "UNKNOWN",
        error_message: "x",
        progress_stage: "failed",
        progress_message: "Execution failed",
        evidence: [],
        created_at: "2026-03-02T09:00:00.000Z",
        updated_at: "2026-03-02T09:05:00.000Z",
      },
      {
        id: RUN_C,
        store_id: STORE_A,
        cart_id: CART_2,
        status: "failed",
        retry_count: 0,
        max_retries: 2,
        failure_type: "UNKNOWN",
        error_message: "x",
        progress_stage: "failed",
        progress_message: "Execution failed",
        evidence: [],
        created_at: "2026-03-02T08:00:00.000Z",
        updated_at: "2026-03-02T08:05:00.000Z",
      },
    ];
    const supabase = createSupabaseStub({
      runs,
      actions: [],
      attempts: [],
    });
    const res = await getStorePilotOverview(supabase, STORE_A, {
      limit: 20,
      failedLimit: 3,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.health.health_status).toBe("needs_attention");
    expect(res.body.health.minimum_data_window_met).toBe(true);
    expect(res.body.health.needs_attention_since).toBe("2026-03-02T08:05:00.000Z");
    expect(res.body.health.alert_reasons).toContain("low_completion_rate");
    expect(res.body.health.alert_reasons).toContain("recent_failure_streak");
    expect(res.body.health.triggered_by.no_recent_pilot_complete_runs).toBe(true);
  });

  it("keeps minimum_data_window_met false for tiny run windows", async () => {
    const RUN_A = "80808080-8080-4080-8080-808080808080";
    const RUN_B = "81818181-8181-4181-8181-818181818181";
    const runs = [
      {
        id: RUN_A,
        store_id: STORE_A,
        cart_id: CART_1,
        status: "failed",
        retry_count: 0,
        max_retries: 2,
        failure_type: "UNKNOWN",
        error_message: "x",
        progress_stage: "failed",
        progress_message: "Execution failed",
        evidence: [],
        created_at: "2026-03-03T10:00:00.000Z",
        updated_at: "2026-03-03T10:05:00.000Z",
      },
      {
        id: RUN_B,
        store_id: STORE_A,
        cart_id: CART_2,
        status: "failed",
        retry_count: 0,
        max_retries: 2,
        failure_type: "UNKNOWN",
        error_message: "x",
        progress_stage: "failed",
        progress_message: "Execution failed",
        evidence: [],
        created_at: "2026-03-03T09:00:00.000Z",
        updated_at: "2026-03-03T09:05:00.000Z",
      },
    ];
    const supabase = createSupabaseStub({
      runs,
      actions: [],
      attempts: [],
    });
    const res = await getStorePilotOverview(supabase, STORE_A, {
      limit: 20,
      failedLimit: 3,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.summary.total_recent_runs).toBe(2);
    expect(res.body.health.minimum_data_window_met).toBe(false);
    expect(res.body.health.health_status).not.toBe("needs_attention");
  });
});
