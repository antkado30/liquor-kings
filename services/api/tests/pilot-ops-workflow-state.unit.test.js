import { describe, expect, it, beforeEach } from "vitest";
import {
  getPilotOpsWorkflowState,
  listPilotOpsWorkflowStateHistory,
  updatePilotOpsWorkflowState,
} from "../src/services/pilot-ops-workflow-state.service.js";

const STORE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("pilot ops workflow state service", () => {
  const rows = new Map();
  const historyRows = [];
  const createSupabaseStub = () => ({
    from(table) {
      if (table !== "pilot_ops_workflow_states" && table !== "pilot_ops_workflow_state_history") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        table,
        select() {
          return this;
        },
        eq(key, value) {
          this.storeId = key === "store_id" ? value : null;
          return this;
        },
        order() {
          return this;
        },
        range(from, to) {
          this.rangeWindow = { from, to };
          return this;
        },
        upsert(payload) {
          rows.set(payload.store_id, { ...payload });
          this.storeId = payload.store_id;
          return this;
        },
        insert(payload) {
          historyRows.push({
            id: `hist-${historyRows.length + 1}`,
            ...payload,
          });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          const row = this.storeId ? rows.get(this.storeId) ?? null : null;
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve) {
          if (this.table === "pilot_ops_workflow_state_history") {
            let out = [...historyRows];
            if (this.storeId) out = out.filter((r) => r.store_id === this.storeId);
            out.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
            if (this.rangeWindow) {
              out = out.slice(this.rangeWindow.from, this.rangeWindow.to + 1);
            }
            resolve({ data: out, error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
    },
  });

  beforeEach(() => {
    rows.clear();
    historyRows.splice(0, historyRows.length);
  });

  it("defaults to unreviewed state", async () => {
    const out = await getPilotOpsWorkflowState(createSupabaseStub(), STORE_ID);
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({
      pilot_ops_status: "unreviewed",
      last_reviewed_at: null,
      last_reviewed_by: null,
      operator_note: null,
    });
  });

  it("updates state with actor and trimmed note", async () => {
    const supabase = createSupabaseStub();
    const out = await updatePilotOpsWorkflowState(supabase, STORE_ID, {
      status: "watching",
      note: "  monitor heartbeats  ",
      actorId: "u1",
      actorEmail: "ops@example.com",
    });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      pilot_ops_status: "watching",
      last_reviewed_by: "ops@example.com",
      operator_note: "monitor heartbeats",
    });
    expect(typeof out.data.last_reviewed_at).toBe("string");

    const loaded = await getPilotOpsWorkflowState(supabase, STORE_ID);
    expect(loaded.ok).toBe(true);
    expect(loaded.data.pilot_ops_status).toBe("watching");

    const historyOut = await listPilotOpsWorkflowStateHistory(supabase, STORE_ID);
    expect(historyOut.ok).toBe(true);
    expect(historyOut.data).toHaveLength(1);
    expect(historyOut.data[0]).toMatchObject({
      store_id: STORE_ID,
      changed_by: "ops@example.com",
      previous_pilot_ops_status: "unreviewed",
      new_pilot_ops_status: "watching",
      previous_operator_note: null,
      new_operator_note: "monitor heartbeats",
    });
  });

  it("rejects invalid status", async () => {
    const out = await updatePilotOpsWorkflowState(createSupabaseStub(), STORE_ID, {
      status: "invalid",
      note: null,
      actorId: "u1",
      actorEmail: null,
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("pilot_ops_status");
  });

  it("returns empty history when no changes exist", async () => {
    const out = await listPilotOpsWorkflowStateHistory(createSupabaseStub(), STORE_ID);
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([]);
  });
});

