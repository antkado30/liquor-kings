import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { cartId, storeId } from "./helpers/test-data.js";
import {
  serviceRoleAuthHeaders,
  storeScopedAuthHeaders,
} from "./helpers/service-auth.js";

describe("authorization route checks", () => {
  it("missing auth rejects protected routes", async () => {
    const res = await request(app).get(`/cart/${storeId}/history`);
    expect(res.status).toBe(401);
  });

  it("same-store service auth can access store-scoped endpoints", async () => {
    const headers = storeScopedAuthHeaders(storeId);
    const cartRes = await request(app)
      .get(`/cart/${storeId}/history`)
      .set(headers);
    expect(cartRes.status).toBe(200);

    const inventoryRes = await request(app)
      .get(`/inventory/${storeId}`)
      .set(headers);
    expect(inventoryRes.status).toBe(200);

    const executionRes = await request(app)
      .get(`/execution-runs/cart/${storeId}/${cartId}`)
      .set(headers);
    expect(executionRes.status).toBe(200);
  });

  it("cross-store access is denied", async () => {
    const otherStore = "22222222-2222-2222-2222-222222222222";
    const res = await request(app)
      .get(`/cart/${storeId}/history`)
      .set(storeScopedAuthHeaders(otherStore));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Store context mismatch");
  });

  it("worker/service auth can still claim runs", async () => {
    const res = await request(app)
      .post("/execution-runs/claim-next")
      .set(serviceRoleAuthHeaders())
      .send({ workerId: "authz-worker-check" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res.body, "data")).toBe(true);
  });
});
