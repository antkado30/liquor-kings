import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import supabase from "../src/config/supabase.js";
import { bottleId, cartId, mlccCode, storeId } from "./helpers/test-data.js";
import { resetTestCartState } from "./helpers/cart-reset.js";

describe("Liquor Kings API smoke tests", () => {
  it("GET /health", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /bottles/search?q=test", async () => {
    const res = await request(app).get("/bottles/search").query({ q: "test" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /bottles/search/compact?q=test", async () => {
    const res = await request(app)
      .get("/bottles/search/compact")
      .query({ q: "test" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /bottles/:id", async () => {
    const res = await request(app).get(`/bottles/${bottleId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(bottleId);
  });

  it("GET /bottles/code/:mlccCode", async () => {
    const res = await request(app).get(`/bottles/code/${mlccCode}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mlcc_code).toBe(mlccCode);
  });

  it("GET /bottles/upc/123456789012 (not found)", async () => {
    const res = await request(app).get("/bottles/upc/123456789012");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Bottle not found");
  });

  it("GET /bottles/related/:id", async () => {
    const res = await request(app).get(`/bottles/related/${bottleId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source.id).toBe(bottleId);
  });

  it("GET /cart/:storeId/history", async () => {
    const res = await request(app).get(`/cart/${storeId}/history`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it("GET /cart/:storeId/history/:cartId", async () => {
    const res = await request(app).get(`/cart/${storeId}/history/${cartId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.id).toBe(cartId);
  });

  it("GET /cart/:storeId/latest-submitted-summary", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/latest-submitted-summary`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.id).toBe(cartId);
  });

  it("GET /cart/:storeId/history/:cartId/summary", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/${cartId}/summary`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.id).toBe(cartId);
  });

  it("A) GET /cart/:storeId/active-availability", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/active-availability`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("success");
    expect(res.body).toHaveProperty("cart");
    expect(res.body).toHaveProperty("items");

    if (res.body.cart === null) {
      expect(res.body.items).toEqual([]);
    } else {
      expect(Array.isArray(res.body.items)).toBe(true);
    }
  });

  it("B) GET /cart/:storeId/history/:cartId/availability", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/${cartId}/availability`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.id).toBe(cartId);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("C) GET /cart/:storeId/history/not-a-real-cart-id/availability", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/not-a-real-cart-id/availability`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Submitted cart not found");
  });

  it("D) submitted availability item shape when items exist", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/${cartId}/availability`,
    );

    expect(res.status).toBe(200);
    if (!res.body.items?.length) {
      return;
    }

    const first = res.body.items[0];
    expect(first).toHaveProperty("cartItemId");
    expect(first).toHaveProperty("bottleId");
    expect(first).toHaveProperty("cartQuantity");
    expect(first).toHaveProperty("inventoryMatches");
    expect(first).toHaveProperty("availability");
    expect(first.availability).toHaveProperty("hasInventoryMatch");
    expect(first.availability).toHaveProperty("totalInventoryQuantity");
    expect(first.availability).toHaveProperty("hasOutOfStockMatch");
    expect(first.availability).toHaveProperty("hasLowStockMatch");
  });

  it("A) GET /cart/:storeId/history/:cartId/execution-payload", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/${cartId}/execution-payload`,
    );

    expect([200, 400]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.payload).toBeDefined();
    } else {
      expect(res.body.error).toBe(
        "Cart must be validated before execution payload can be built",
      );
    }
  });

  it("B) GET /cart/:storeId/execution-payload/latest", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/execution-payload/latest`,
    );

    expect([200, 400, 404]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.payload).toBeDefined();
    } else if (res.status === 404) {
      expect(res.body.error).toBe("Submitted cart not found");
    } else {
      expect(res.body.error).toBe(
        "Cart must be validated before execution payload can be built",
      );
    }
  });

  it("C) GET /cart/:storeId/history/not-a-real-cart-id/execution-payload", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/not-a-real-cart-id/execution-payload`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Submitted cart not found");
  });

  it("D) execution-payload payload shape when 200", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/${cartId}/execution-payload`,
    );

    if (res.status !== 200) {
      return;
    }

    expect(res.body.payload).toHaveProperty("cart");
    expect(res.body.payload).toHaveProperty("store");
    expect(res.body.payload).toHaveProperty("items");
    expect(res.body.payload).toHaveProperty("summary");
    expect(res.body.payload.summary).toHaveProperty("itemCount");
    expect(res.body.payload.summary).toHaveProperty("totalQuantity");
  });

  it("GET /cart/:storeId/overview", async () => {
    const res = await request(app).get(`/cart/${storeId}/overview`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.overview).toBeTruthy();
  });

  it("GET /cart/:storeId/history/not-a-real-cart-id (invalid id)", async () => {
    const res = await request(app).get(
      `/cart/${storeId}/history/not-a-real-cart-id`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Submitted cart not found");
  });

  it("GET /inventory/:storeId", async () => {
    const res = await request(app).get(`/inventory/${storeId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(storeId);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /inventory/:storeId?limit=5", async () => {
    const res = await request(app)
      .get(`/inventory/${storeId}`)
      .query({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it("GET /inventory/:storeId/summary", async () => {
    const res = await request(app).get(`/inventory/${storeId}/summary`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeTruthy();
    expect(typeof res.body.summary.totalRows).toBe("number");
  });

  it("GET /inventory/:storeId/lookup?q=test", async () => {
    const res = await request(app)
      .get(`/inventory/${storeId}/lookup`)
      .query({ q: "test" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(storeId);
    expect(res.body.query).toBe("test");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /inventory/:storeId/lookup with no q", async () => {
    const res = await request(app).get(`/inventory/${storeId}/lookup`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Lookup query is required");
  });

  it("GET /inventory/:storeId/bottle/:bottleId", async () => {
    const res = await request(app).get(
      `/inventory/${storeId}/bottle/${bottleId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(storeId);
    expect(res.body.bottleId).toBe(bottleId);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /inventory/:storeId/bottle/not-a-real-id", async () => {
    const res = await request(app).get(
      `/inventory/${storeId}/bottle/not-a-real-id`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Inventory item not found");
  });

  it("GET /inventory/:storeId/low-stock", async () => {
    const res = await request(app).get(`/inventory/${storeId}/low-stock`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(storeId);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /inventory/:storeId/out-of-stock", async () => {
    const res = await request(app).get(`/inventory/${storeId}/out-of-stock`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(storeId);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /inventory/:storeId/reorder-candidates", async () => {
    const res = await request(app).get(
      `/inventory/${storeId}/reorder-candidates`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(storeId);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /inventory/:storeId/location/:location", async () => {
    const list = await request(app).get(`/inventory/${storeId}`);

    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    expect(Array.isArray(list.body.data)).toBe(true);

    if (!list.body.data.length) {
      expect(list.body.data).toEqual([]);
      return;
    }

    const firstLocation = list.body.data[0].location;
    const usableLocation =
      typeof firstLocation === "string" ? firstLocation.trim() : "";

    if (!usableLocation) {
      expect(
        firstLocation === null ||
          firstLocation === undefined ||
          (typeof firstLocation === "string" && firstLocation.trim() === ""),
      ).toBe(true);
      return;
    }

    const res = await request(app).get(
      `/inventory/${storeId}/location/${encodeURIComponent(usableLocation)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storeId).toBe(storeId);
    expect(res.body.location).toBe(usableLocation);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /inventory/:storeId/location/  (missing/empty location)", async () => {
    const res = await request(app).get(
      `/inventory/${storeId}/location/%20`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Location is required");
  });

  it("GET /inventory/:storeId/:inventoryId (detail when rows exist)", async () => {
    const list = await request(app).get(`/inventory/${storeId}`);

    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    if (!list.body.data.length) {
      expect(list.body.data).toEqual([]);
      return;
    }

    const inventoryId = list.body.data[0].id;
    const res = await request(app).get(`/inventory/${storeId}/${inventoryId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /inventory/:storeId/not-a-real-id (invalid inventory id)", async () => {
    const res = await request(app).get(
      `/inventory/${storeId}/not-a-real-id`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Inventory item not found");
  });
});

describe("inventory action smoke tests", () => {
  let baseline = null;

  beforeAll(async () => {
    const list = await request(app).get(`/inventory/${storeId}`);

    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);

    if (!list.body.data?.length) {
      expect(list.body.data ?? []).toEqual([]);
      return;
    }

    const row = list.body.data[0];
    baseline = {
      id: row.id,
      quantity: row.quantity,
      location: row.location,
      location_note: row.location_note,
      low_stock_threshold: row.low_stock_threshold,
      reorder_point: row.reorder_point,
    };
  });

  afterAll(async () => {
    if (!baseline) {
      return;
    }

    await supabase
      .from("inventory")
      .update({
        quantity: baseline.quantity,
        location: baseline.location,
        location_note: baseline.location_note,
        low_stock_threshold: baseline.low_stock_threshold,
        reorder_point: baseline.reorder_point,
        updated_at: new Date().toISOString(),
      })
      .eq("id", baseline.id)
      .eq("store_id", storeId);
  });

  it("A) PATCH /inventory/:storeId/:inventoryId/quantity", async () => {
    if (!baseline) {
      const list = await request(app).get(`/inventory/${storeId}`);

      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);
      expect(list.body.data ?? []).toEqual([]);
      return;
    }

    const inventoryId = baseline.id;
    const newQty = Number(baseline.quantity ?? 0) + 1;
    const res = await request(app)
      .patch(`/inventory/${storeId}/${inventoryId}/quantity`)
      .send({ quantity: newQty });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quantity).toBe(newQty);
  });

  it("B) PATCH /inventory/:storeId/:inventoryId/quantity (invalid negative)", async () => {
    if (!baseline) {
      const list = await request(app).get(`/inventory/${storeId}`);

      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);
      expect(list.body.data ?? []).toEqual([]);
      return;
    }

    const inventoryId = baseline.id;
    const res = await request(app)
      .patch(`/inventory/${storeId}/${inventoryId}/quantity`)
      .send({ quantity: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Quantity must be a non-negative integer");
  });

  it("C) PATCH /inventory/:storeId/:inventoryId/location", async () => {
    if (!baseline) {
      const list = await request(app).get(`/inventory/${storeId}`);

      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);
      expect(list.body.data ?? []).toEqual([]);
      return;
    }

    const inventoryId = baseline.id;
    const res = await request(app)
      .patch(`/inventory/${storeId}/${inventoryId}/location`)
      .send({
        location: "VITEST-LOCATION",
        locationNote: "temporary test note",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.location).toBe("VITEST-LOCATION");
  });

  it("D) PATCH /inventory/:storeId/:inventoryId/location (empty location)", async () => {
    if (!baseline) {
      const list = await request(app).get(`/inventory/${storeId}`);

      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);
      expect(list.body.data ?? []).toEqual([]);
      return;
    }

    const inventoryId = baseline.id;
    const res = await request(app)
      .patch(`/inventory/${storeId}/${inventoryId}/location`)
      .send({ location: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Location is required");
  });

  it("E) PATCH /inventory/:storeId/:inventoryId/reorder-settings", async () => {
    if (!baseline) {
      const list = await request(app).get(`/inventory/${storeId}`);

      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);
      expect(list.body.data ?? []).toEqual([]);
      return;
    }

    const inventoryId = baseline.id;
    const res = await request(app)
      .patch(`/inventory/${storeId}/${inventoryId}/reorder-settings`)
      .send({
        lowStockThreshold: 3,
        reorderPoint: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.low_stock_threshold).toBe(3);
    expect(res.body.data.reorder_point).toBe(5);
  });

  it("F) PATCH /inventory/:storeId/:inventoryId/reorder-settings (no fields)", async () => {
    if (!baseline) {
      const list = await request(app).get(`/inventory/${storeId}`);

      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);
      expect(list.body.data ?? []).toEqual([]);
      return;
    }

    const inventoryId = baseline.id;
    const res = await request(app)
      .patch(`/inventory/${storeId}/${inventoryId}/reorder-settings`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("At least one reorder setting is required");
  });

  it("G) PATCH /inventory/:storeId/not-a-real-id/quantity", async () => {
    const res = await request(app)
      .patch(`/inventory/${storeId}/not-a-real-id/quantity`)
      .send({ quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Inventory item not found");
  });
});

describe("cart lifecycle smoke tests", () => {
  beforeAll(async () => {
    await resetTestCartState(supabase, cartId);
  });

  afterAll(async () => {
    await resetTestCartState(supabase, cartId);
  });

  it("A) POST /cart/:storeId/validate", async () => {
    const res = await request(app).post(`/cart/${storeId}/validate`).send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.validation_status).toBe("pending");
  });

  it("B) duplicate POST /cart/:storeId/validate", async () => {
    const res = await request(app).post(`/cart/${storeId}/validate`).send();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Validation has already been requested for this cart",
    );
  });

  it("C) PATCH /cart/:storeId/history/:cartId/validation-result (validated)", async () => {
    const res = await request(app)
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.validation_status).toBe("validated");
  });

  it("D) duplicate PATCH validation-result (failed - should be blocked)", async () => {
    const res = await request(app)
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({
        validationStatus: "failed",
        validationError: "should be blocked",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Validation result can only be recorded after validation has been requested",
    );
  });

  it("E) POST /cart/:storeId/execute", async () => {
    const res = await request(app).post(`/cart/${storeId}/execute`).send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.execution_status).toBe("pending");
  });

  it("F) duplicate POST /cart/:storeId/execute", async () => {
    const res = await request(app).post(`/cart/${storeId}/execute`).send();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Execution has already been requested for this cart",
    );
  });

  it("G) PATCH /cart/:storeId/history/:cartId/execution-result (executed)", async () => {
    const res = await request(app)
      .patch(`/cart/${storeId}/history/${cartId}/execution-result`)
      .send({
        executionStatus: "executed",
        externalOrderRef: "MLCC-ORDER-TEST",
        executionNotes: "smoke lifecycle test",
        receiptSnapshot: { confirmation: "ok", source: "vitest" },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.execution_status).toBe("executed");
    expect(res.body.cart.external_order_ref).toBe("MLCC-ORDER-TEST");
  });

  it("H) duplicate PATCH execution-result (failed - should be blocked)", async () => {
    const res = await request(app)
      .patch(`/cart/${storeId}/history/${cartId}/execution-result`)
      .send({
        executionStatus: "failed",
        executionError: "should be blocked",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Execution result can only be recorded after execution has been requested",
    );
  });

  it("GET /cart/:storeId/history/:cartId (final verification)", async () => {
    const res = await request(app).get(`/cart/${storeId}/history/${cartId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.validation_status).toBe("validated");
    expect(res.body.cart.execution_status).toBe("executed");
    expect(res.body.cart.external_order_ref).toBe("MLCC-ORDER-TEST");
  });
});

describe("execution run smoke tests", () => {
  let runId;

  beforeAll(async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);

    await resetTestCartState(supabase, cartId);

    await request(app).post(`/cart/${storeId}/validate`).send();

    await request(app)
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });
  });

  afterAll(async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);

    await resetTestCartState(supabase, cartId);
  });

  it("A) POST /execution-runs/from-cart/:storeId/:cartId", async () => {
    const res = await request(app).post(
      `/execution-runs/from-cart/${storeId}/${cartId}`,
    );

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cart_id).toBe(cartId);
    expect(res.body.data.status).toBe("queued");

    runId = res.body.data.id;
  });

  it("B) duplicate POST /execution-runs/from-cart/:storeId/:cartId", async () => {
    const res = await request(app).post(
      `/execution-runs/from-cart/${storeId}/${cartId}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "An active execution run already exists for this cart",
    );
  });

  it("C) GET /execution-runs/cart/:storeId/:cartId", async () => {
    const res = await request(app).get(
      `/execution-runs/cart/${storeId}/${cartId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it("D) GET /execution-runs/:runId", async () => {
    const res = await request(app).get(`/execution-runs/${runId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(runId);
  });

  it("E) PATCH /execution-runs/:runId/status (running)", async () => {
    const res = await request(app)
      .patch(`/execution-runs/${runId}/status`)
      .send({
        status: "running",
        workerNotes: "started by smoke test",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("running");
    expect(res.body.data.started_at).toBeTruthy();
  });

  it("F) PATCH /execution-runs/:runId/status (failed)", async () => {
    const res = await request(app)
      .patch(`/execution-runs/${runId}/status`)
      .send({
        status: "failed",
        workerNotes: "failed in smoke test",
        errorMessage: "simulated failure",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("failed");
    expect(res.body.data.finished_at).toBeTruthy();
    expect(res.body.data.error_message).toBe("simulated failure");
  });

  it("G) PATCH /execution-runs/:runId/status after failure (running)", async () => {
    const res = await request(app)
      .patch(`/execution-runs/${runId}/status`)
      .send({ status: "running" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Execution run is already finalized");
  });

  it("H) GET /execution-runs/not-a-real-id", async () => {
    const res = await request(app).get("/execution-runs/not-a-real-id");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Execution run not found");
  });
});
