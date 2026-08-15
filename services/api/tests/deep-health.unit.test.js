import { beforeEach, describe, expect, it } from "vitest";
import {
  runDeepHealth,
  workerVerdict,
  recordWorkerClaimHeartbeat,
  __resetHeartbeatThrottle,
  WORKER_STALE_MIN,
} from "../src/lib/deep-health.js";

const NOW = Date.parse("2026-08-13T12:00:00Z");

function fakeSupabase({ itemCount = 100, itemErr = null, hbAt = null, hbErr = null } = {}) {
  const upserts = [];
  return {
    upserts,
    from: (table) => {
      if (table === "mlcc_items") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve(
                itemErr
                  ? { count: null, error: { message: itemErr } }
                  : { count: itemCount, error: null },
              ),
          }),
        };
      }
      if (table === "ops_heartbeats") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve(
                  hbErr
                    ? { data: null, error: { message: hbErr } }
                    : { data: hbAt ? { at: hbAt } : null, error: null },
                ),
            }),
          }),
          upsert: (row, opts) => {
            upserts.push({ row, opts });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("workerVerdict (pure staleness law)", () => {
  it("fresh heartbeat → ok", () => {
    const v = workerVerdict(new Date(NOW - 2 * 60_000).toISOString(), NOW);
    expect(v.ok).toBe(true);
    expect(v.age_min).toBe(2);
  });
  it("stale > threshold → not ok, says why", () => {
    const v = workerVerdict(new Date(NOW - (WORKER_STALE_MIN + 1) * 60_000).toISOString(), NOW);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/stale/);
  });
  it("missing / garbage rows are loud, never quietly ok", () => {
    expect(workerVerdict(null, NOW).ok).toBe(false);
    expect(workerVerdict("not-a-date", NOW).ok).toBe(false);
  });
});

describe("runDeepHealth", () => {
  it("all green → ok:true", async () => {
    const s = fakeSupabase({ itemCount: 14437, hbAt: new Date(NOW - 60_000).toISOString() });
    const r = await runDeepHealth(s, { nowMs: NOW });
    expect(r.ok).toBe(true);
    expect(r.checks.db.active_items).toBe(14437);
    expect(r.checks.worker.ok).toBe(true);
  });
  it("empty catalog IS an outage", async () => {
    const s = fakeSupabase({ itemCount: 0, hbAt: new Date(NOW).toISOString() });
    const r = await runDeepHealth(s, { nowMs: NOW });
    expect(r.ok).toBe(false);
    expect(r.checks.db.ok).toBe(false);
  });
  it("db error / heartbeat-table error → degraded (missing migration must be loud)", async () => {
    const dbDown = await runDeepHealth(fakeSupabase({ itemErr: "boom" }), { nowMs: NOW });
    expect(dbDown.ok).toBe(false);
    const hbDown = await runDeepHealth(
      fakeSupabase({ itemCount: 5, hbErr: "relation ops_heartbeats does not exist" }),
      { nowMs: NOW },
    );
    expect(hbDown.ok).toBe(false);
    expect(hbDown.checks.worker.ok).toBe(false);
  });
});

describe("recordWorkerClaimHeartbeat (throttled, fail-soft)", () => {
  beforeEach(() => __resetHeartbeatThrottle());

  it("writes once, then throttles inside the window", async () => {
    const s = fakeSupabase();
    await recordWorkerClaimHeartbeat(s, "worker-1");
    await recordWorkerClaimHeartbeat(s, "worker-1");
    await recordWorkerClaimHeartbeat(s, "worker-1");
    expect(s.upserts).toHaveLength(1);
    expect(s.upserts[0].row.key).toBe("worker_claim");
    expect(s.upserts[0].opts.onConflict).toBe("key");
  });

  it("a throwing client never breaks the caller", async () => {
    __resetHeartbeatThrottle();
    const broken = { from: () => ({ upsert: () => Promise.reject(new Error("db down")) }) };
    await expect(recordWorkerClaimHeartbeat(broken, "w")).resolves.toBeUndefined();
  });
});
