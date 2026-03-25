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
