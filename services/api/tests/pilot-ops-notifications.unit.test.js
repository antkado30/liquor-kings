import { beforeEach, describe, expect, it } from "vitest";
import {
  evaluateAndRecordPilotOpsNotifications,
  listPilotOpsNotifications,
} from "../src/services/pilot-ops-notifications.service.js";

const STORE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("pilot ops notifications service", () => {
  const stateByStore = new Map();
  const notifications = [];

  const createSupabaseStub = () => ({
    from(table) {
      if (table !== "pilot_ops_notification_state" && table !== "pilot_ops_notifications") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        table,
        select() {
          return this;
        },
        eq(key, value) {
          this.eqKey = key;
          this.eqValue = value;
          return this;
        },
        in(key, values) {
          this.inKey = key;
          this.inValues = values;
          return this;
        },
        order() {
          return this;
        },
        range(from, to) {
          this.rangeWindow = { from, to };
          return this;
        },
        maybeSingle() {
          if (this.table !== "pilot_ops_notification_state") {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({
            data: stateByStore.get(this.eqValue) ?? null,
            error: null,
          });
        },
        upsert(payload) {
          stateByStore.set(payload.store_id, { ...payload });
          return Promise.resolve({ data: null, error: null });
        },
        insert(payload) {
          const rows = Array.isArray(payload) ? payload : [payload];
          for (const row of rows) {
            notifications.push({
              id: `n-${notifications.length + 1}`,
              ...row,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (this.table !== "pilot_ops_notifications") {
            resolve({ data: [], error: null });
            return;
          }
          const ids = Array.isArray(this.inValues) ? this.inValues : [];
          let rows = notifications.filter((r) => ids.includes(r.store_id));
          rows = rows.sort(
            (a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime(),
          );
          if (this.rangeWindow) {
            rows = rows.slice(this.rangeWindow.from, this.rangeWindow.to + 1);
          }
          resolve({ data: rows, error: null });
        },
      };
    },
  });

  beforeEach(() => {
    stateByStore.clear();
    notifications.splice(0, notifications.length);
  });

  it("creates newly_needs_attention once, then dedupes unchanged state", async () => {
    const supabase = createSupabaseStub();
    const first = await evaluateAndRecordPilotOpsNotifications(supabase, {
      storeId: STORE_ID,
      healthStatus: "needs_attention",
      attentionOverdue: { is_overdue: false },
      alertReasons: ["recent_failure_streak"],
      workflowState: { pilot_ops_status: "unreviewed" },
      now: "2026-04-15T10:00:00.000Z",
    });
    expect(first.ok).toBe(true);
    expect(first.created_count).toBe(1);

    const second = await evaluateAndRecordPilotOpsNotifications(supabase, {
      storeId: STORE_ID,
      healthStatus: "needs_attention",
      attentionOverdue: { is_overdue: false },
      alertReasons: ["recent_failure_streak"],
      workflowState: { pilot_ops_status: "unreviewed" },
      now: "2026-04-15T10:05:00.000Z",
    });
    expect(second.ok).toBe(true);
    expect(second.created_count).toBe(0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].notification_kind).toBe("newly_needs_attention");
  });

  it("creates newly_attention_overdue only on transition to overdue", async () => {
    const supabase = createSupabaseStub();
    await evaluateAndRecordPilotOpsNotifications(supabase, {
      storeId: STORE_ID,
      healthStatus: "needs_attention",
      attentionOverdue: { is_overdue: false },
      workflowState: { pilot_ops_status: "watching" },
      now: "2026-04-15T10:00:00.000Z",
    });
    const out = await evaluateAndRecordPilotOpsNotifications(supabase, {
      storeId: STORE_ID,
      healthStatus: "needs_attention",
      attentionOverdue: { is_overdue: true, reason_code: "needs_attention_follow_up_overdue" },
      workflowState: { pilot_ops_status: "watching" },
      now: "2026-04-15T23:00:00.000Z",
    });
    expect(out.ok).toBe(true);
    expect(out.created_count).toBe(1);
    expect(notifications[1].notification_kind).toBe("newly_attention_overdue");
  });

  it("lists recent notifications for store scope", async () => {
    const supabase = createSupabaseStub();
    await evaluateAndRecordPilotOpsNotifications(supabase, {
      storeId: STORE_ID,
      healthStatus: "needs_attention",
      attentionOverdue: { is_overdue: true },
      workflowState: { pilot_ops_status: "unreviewed" },
      now: "2026-04-15T22:00:00.000Z",
    });
    const list = await listPilotOpsNotifications(supabase, [STORE_ID], { limit: 10 });
    expect(list.ok).toBe(true);
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data[0]).toHaveProperty("reason_code");
  });
});

