/**
 * engine-order-sync.unit.test.js — #36 Phase A pins.
 *
 * The scenario these tests guard is first-order night (2026-08-05): a
 * GW&L order placed at $5,209.14 net, edited in MILO's UI down to
 * $2,029.14 — and LK's Orders page kept showing the stale placement
 * number. After a sync: placement columns UNTOUCHED (immutable record),
 * synced_* carrying MILO's current truth, and the difference visible.
 *
 * Fixtures are structural copies of the probed GET /users/orders shape
 * (2026-07-22), same as engine-orders.unit.test.js.
 */
import { describe, it, expect, vi } from "vitest";

import {
  normalizeMiloApiOrderForSync,
  buildSyncPlan,
  runMiloOrderSyncForStore,
} from "./engine-order-sync.js";
import { __resetNodeMiloSessionForTests } from "./milo-node-session.js";
import {
  syncDueVerdict,
  SYNC_EVERY_MS,
  RECENT_WINDOW_MS,
} from "../../workers/order-sync-loop.js";

const NOW_ISO = "2026-08-08T02:00:00.000Z";
const STORE = "e594fc3a-17b7-45d0-9dde-943ebbfa5391";

/** The 8/5 GW&L order, post-edit: current != original (owner removed a line). */
const editedApiOrder = () => ({
  orderNumber: 277169025,
  licenseNumber: "430342",
  placedOn: "2026-08-05T22:59:21.000Z",
  anticipatedDeliveryDate: "2026-08-11",
  originalDeliveryDate: "2026-08-11",
  confirmationNumber: "5869217",
  distributor: { referenceNumber: "221", name: "General Wine & Liquor", active: true },
  items: [
    {
      product: { code: "3797", name: "PLATINUM 7X PL" },
      quantity: 6,
      unitPrice: 8.03,
      total: 48.18,
      orderType: "MILO",
      updatedByAda: false,
    },
  ],
  total: 2137.2,
  netTotalAmt: 2029.14,
  originalTotal: 5486.04,
  originalNetTotalAmt: 5209.14,
  updatedByAda: false,
  adaConfirmed: true,
  orderType: "MILO",
});

/** An order MILO has that LK never saw (placed by hand in MILO). */
const handPlacedApiOrder = () => ({
  orderNumber: 275000001,
  licenseNumber: "430342",
  placedOn: "2026-07-30T18:00:00.000Z",
  anticipatedDeliveryDate: "2026-08-04",
  originalDeliveryDate: "2026-08-04",
  confirmationNumber: "5850000",
  distributor: { referenceNumber: "321", name: "NWS Michigan, Inc." },
  items: [
    {
      product: { code: "100", name: "TITOS HANDMADE 80" },
      quantity: 12,
      unitPrice: 20.0,
      total: 240.0,
      orderType: "MILO",
    },
  ],
  total: 252.0,
  netTotalAmt: 240.0,
  originalTotal: 252.0,
  originalNetTotalAmt: 240.0,
  updatedByAda: false,
  adaConfirmed: false,
});

describe("normalizeMiloApiOrderForSync", () => {
  it("keeps BOTH the placement money and the current money", () => {
    const n = normalizeMiloApiOrderForSync(editedApiOrder());
    expect(n?.originalNet).toBe(5209.14);
    expect(n?.originalGross).toBe(5486.04);
    expect(n?.currentNet).toBe(2029.14);
    expect(n?.currentGross).toBe(2137.2);
    expect(n?.adaNumber).toBe("221");
    expect(n?.status).toBe("Confirmed");
    expect(n?.lineItemCount).toBe(1);
    expect(n?.lineItems[0]).toMatchObject({
      liquorCode: "3797",
      quantity: 6,
      unitPrice: 8.03,
      lineSubtotal: 48.18,
    });
  });

  it("tolerates garbage without throwing", () => {
    expect(normalizeMiloApiOrderForSync(null)).toBe(null);
    expect(normalizeMiloApiOrderForSync("nope")).toBe(null);
    const n = normalizeMiloApiOrderForSync({});
    expect(n?.confirmationNumber).toBe(null);
    expect(n?.lineItemCount).toBe(0);
  });
});

describe("buildSyncPlan", () => {
  const localGwl = () => ({
    id: "row-1",
    confirmation_number: "5869217",
    placed_at: "2026-08-05T22:59:21.000Z",
    order_number: "277169025",
    delivery_date: "2026-08-11",
    net_total: 5209.14,
    gross_total: 5486.04,
  });

  it("the 8/5 scenario: synced_* carries current truth, placement stays untouched", () => {
    const plan = buildSyncPlan({
      localRows: [localGwl()],
      apiOrders: [normalizeMiloApiOrderForSync(editedApiOrder())],
      nowIso: NOW_ISO,
      storeId: STORE,
    });
    expect(plan.matched).toBe(1);
    expect(plan.imports).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    const patch = plan.updates[0].patch;
    expect(patch.synced_net_total).toBe(2029.14);
    expect(patch.synced_gross_total).toBe(2137.2);
    expect(patch.synced_at).toBe(NOW_ISO);
    expect(patch.synced_status).toBe("Confirmed");
    expect(patch.synced_line_item_count).toBe(1);
    // Placement facts present locally → the patch must NOT touch them.
    expect(patch).not.toHaveProperty("net_total");
    expect(patch).not.toHaveProperty("gross_total");
    expect(patch).not.toHaveProperty("placed_at");
    expect(patch).not.toHaveProperty("order_number");
    expect(patch).not.toHaveProperty("delivery_date");
  });

  it("backfills placement HOLES from original* (evidence-backfill rows)", () => {
    const bare = {
      id: "row-2",
      confirmation_number: "5869217",
      placed_at: null,
      order_number: null,
      delivery_date: null,
      net_total: null,
      gross_total: null,
    };
    const plan = buildSyncPlan({
      localRows: [bare],
      apiOrders: [normalizeMiloApiOrderForSync(editedApiOrder())],
      nowIso: NOW_ISO,
      storeId: STORE,
    });
    const patch = plan.updates[0].patch;
    // Holes fill with PLACEMENT-time values, never current ones.
    expect(patch.net_total).toBe(5209.14);
    expect(patch.gross_total).toBe(5486.04);
    expect(patch.placed_at).toBe("2026-08-05T22:59:21.000Z");
    expect(patch.order_number).toBe("277169025");
    expect(patch.delivery_date).toBe("2026-08-11");
    // And synced_* still carries the current truth alongside.
    expect(patch.synced_net_total).toBe(2029.14);
  });

  it("imports MILO orders LK never saw, flagged origin milo_sync with honest empty placement lines", () => {
    const plan = buildSyncPlan({
      localRows: [localGwl()],
      apiOrders: [
        normalizeMiloApiOrderForSync(editedApiOrder()),
        normalizeMiloApiOrderForSync(handPlacedApiOrder()),
      ],
      nowIso: NOW_ISO,
      storeId: STORE,
    });
    expect(plan.imports).toHaveLength(1);
    const imp = plan.imports[0];
    expect(imp.origin).toBe("milo_sync");
    expect(imp.execution_run_id).toBe(null);
    expect(imp.store_id).toBe(STORE);
    expect(imp.confirmation_number).toBe("5850000");
    expect(imp.ada_number).toBe("321");
    expect(imp.ada_name).toMatch(/NWS/i);
    expect(imp.net_total).toBe(240.0);
    // We never captured placement lines for a hand-placed order — say so.
    expect(imp.line_items).toEqual([]);
    expect(imp.line_item_count).toBe(0);
    expect(imp.synced_line_item_count).toBe(1);
  });

  it("counts local rows MILO no longer returns (old history) without touching them", () => {
    const ancient = { id: "row-3", confirmation_number: "5654920" };
    const plan = buildSyncPlan({
      localRows: [localGwl(), ancient],
      apiOrders: [normalizeMiloApiOrderForSync(editedApiOrder())],
      nowIso: NOW_ISO,
      storeId: STORE,
    });
    expect(plan.unmatchedLocal).toBe(1);
    expect(plan.updates.map((u) => u.id)).toEqual(["row-1"]);
  });
});

describe("runMiloOrderSyncForStore", () => {
  const makeTransport = (ordersBody, { loginOk = true } = {}) => ({
    call: vi.fn(async (method, path) => {
      if (path === "/auth/login") {
        return loginOk
          ? { ok: true, status: 200, ms: 5, body: { accessToken: "x.y.z" } }
          : { ok: false, status: 401, ms: 5, body: { message: "bad creds" } };
      }
      if (path === "/account") {
        return { ok: true, status: 200, ms: 5, body: { groups: [{ id: 7, subscriptionId: 9 }] } };
      }
      if (String(path).startsWith("/users/orders")) {
        return ordersBody instanceof Error
          ? { ok: false, status: 500, ms: 5, body: null }
          : { ok: true, status: 200, ms: 5, body: ordersBody };
      }
      throw new Error(`unexpected path ${path}`);
    }),
  });

  /** Minimal supabase fake covering the three tables the sync touches. */
  const makeSupabase = (localRows) => {
    const writes = { updates: [], inserts: [], storePatch: null };
    const supabase = {
      from: (table) => {
        if (table === "milo_order_confirmations") {
          return {
            select: () => ({
              eq: async () => ({ data: localRows, error: null }),
            }),
            update: (patch) => ({
              eq: async (_col, id) => {
                writes.updates.push({ id, patch });
                return { error: null };
              },
            }),
            insert: (rows) => ({
              select: async () => {
                writes.inserts.push(...rows);
                return { data: rows.map((_, i) => ({ id: `new-${i}` })), error: null };
              },
            }),
          };
        }
        if (table === "stores") {
          return {
            update: (patch) => ({
              eq: async () => {
                writes.storePatch = patch;
                return { error: null };
              },
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return { supabase, writes };
  };

  it("happy path: updates matched rows, imports unknowns, stamps the store", async () => {
    __resetNodeMiloSessionForTests();
    const { supabase, writes } = makeSupabase([
      {
        id: "row-1",
        confirmation_number: "5869217",
        placed_at: "2026-08-05T22:59:21.000Z",
        order_number: "277169025",
        delivery_date: "2026-08-11",
        net_total: 5209.14,
        gross_total: 5486.04,
      },
    ]);
    const transport = makeTransport([editedApiOrder(), handPlacedApiOrder()]);
    const summary = await runMiloOrderSyncForStore({
      supabase,
      storeId: STORE,
      username: "u",
      password: "p",
      transport,
      nowIso: NOW_ISO,
    });
    expect(summary.ok).toBe(true);
    expect(summary.miloOrders).toBe(2);
    expect(summary.updated).toBe(1);
    expect(summary.imported).toBe(1);
    expect(writes.updates[0].id).toBe("row-1");
    expect(writes.updates[0].patch.synced_net_total).toBe(2029.14);
    expect(writes.inserts[0].confirmation_number).toBe("5850000");
    expect(writes.storePatch).toEqual({ last_order_sync_at: NOW_ISO });
  });

  it("orders fetch failure returns ok:false and stamps nothing", async () => {
    __resetNodeMiloSessionForTests();
    const { supabase, writes } = makeSupabase([]);
    const transport = makeTransport(new Error("down"));
    const summary = await runMiloOrderSyncForStore({
      supabase,
      storeId: STORE,
      username: "u",
      password: "p",
      transport,
      nowIso: NOW_ISO,
    });
    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/orders_fetch_failed/);
    expect(writes.updates).toHaveLength(0);
    expect(writes.storePatch).toBe(null);
  });

  it("bad credentials throw the classified login error (caller routes it)", async () => {
    __resetNodeMiloSessionForTests();
    const { supabase } = makeSupabase([]);
    const transport = makeTransport([], { loginOk: false });
    await expect(
      runMiloOrderSyncForStore({
        supabase,
        storeId: STORE,
        username: "u",
        password: "bad",
        transport,
        nowIso: NOW_ISO,
      }),
    ).rejects.toMatchObject({ classification: "invalid_credentials" });
  });
});

describe("syncDueVerdict", () => {
  const now = Date.parse(NOW_ISO);

  it("owner tap always wins: requested newer than last sync → due", () => {
    expect(
      syncDueVerdict({
        requestedAtMs: now - 1000,
        lastSyncAtMs: now - 60_000,
        newestConfirmationMs: null,
        nowMs: now,
      }),
    ).toEqual({ due: true, reason: "requested" });
  });

  it("already-served request stays quiet", () => {
    expect(
      syncDueVerdict({
        requestedAtMs: now - 60_000,
        lastSyncAtMs: now - 1000,
        newestConfirmationMs: now - 1000,
        nowMs: now,
      }).due,
    ).toBe(false);
  });

  it("recent order + stale sync → scheduled; no recent orders → never scheduled", () => {
    expect(
      syncDueVerdict({
        requestedAtMs: null,
        lastSyncAtMs: now - SYNC_EVERY_MS - 1,
        newestConfirmationMs: now - 24 * 60 * 60_000,
        nowMs: now,
      }),
    ).toEqual({ due: true, reason: "scheduled" });
    expect(
      syncDueVerdict({
        requestedAtMs: null,
        lastSyncAtMs: null,
        newestConfirmationMs: now - RECENT_WINDOW_MS - 1,
        nowMs: now,
      }).due,
    ).toBe(false);
  });

  it("recent order but fresh sync stays quiet until the cadence elapses", () => {
    expect(
      syncDueVerdict({
        requestedAtMs: null,
        lastSyncAtMs: now - 60_000,
        newestConfirmationMs: now - 60_000,
        nowMs: now,
      }).due,
    ).toBe(false);
  });
});
