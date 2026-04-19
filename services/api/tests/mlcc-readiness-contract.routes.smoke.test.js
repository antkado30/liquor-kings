/**
 * Route-level JSON contract for MLCC readiness on:
 * - GET /cart/:storeId/history/:cartId/mlcc-execution-readiness (wrapper + fields)
 * - GET /cart/:storeId/history/:cartId (embedded mlcc_execution_readiness)
 * - GET /cart/:storeId/history (embedded per row)
 * - GET /cart/:storeId/mlcc-readiness-dashboard (filters, counts, carts)
 * - GET /cart/:storeId/history/:cartId/mlcc-blocking-hints
 * - GET /cart/:storeId/mlcc-mapping-backlog
 * - GET /cart/:storeId/mlcc-mapping-backlog/:bottleId
 * - GET /cart/:storeId/mlcc-operator-overview
 * - POST /execution-runs/from-cart/:storeId/:cartId (Gate 3)
 *
 * Uses the same seeded cart/store as api.smoke.test.js. Requires the same Supabase
 * env vars and network reachability as `api.smoke.test.js` (service role + `X-Store-Id`).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import supabase from "../src/config/supabase.js";
import { bottleId, cartId, storeId } from "./helpers/test-data.js";
import { resetTestCartState } from "./helpers/cart-reset.js";
import { ensureExecutionTestCartHasMlccItemIds } from "./helpers/ensure-execution-mlcc-item-ids.js";
import { storeScopedAuthHeaders } from "./helpers/service-auth.js";

const auth = {
  get: (path) => request(app).get(path).set(storeScopedAuthHeaders(storeId)),
  post: (path) => request(app).post(path).set(storeScopedAuthHeaders(storeId)),
  patch: (path) => request(app).patch(path).set(storeScopedAuthHeaders(storeId)),
};

function assertDedicatedBlockedPayload(body) {
  expect(body).toHaveProperty("ok");
  expect(body).toHaveProperty("ready");
  expect(body).toHaveProperty("error");
  expect(body).toHaveProperty("message");
  expect(body).toHaveProperty("blocking_lines");
  expect(body.ok).toBe(true);
  expect(body.ready).toBe(false);
  expect(body.error).toBe("MLCC_ITEM_ID_REQUIRED");
  expect(typeof body.message).toBe("string");
  expect(body.message.length).toBeGreaterThan(0);
  expect(Array.isArray(body.blocking_lines)).toBe(true);
  expect(body.blocking_lines.length).toBeGreaterThan(0);
  expect(body.blocking_lines[0]).toMatchObject({
    reason: "missing_mlcc_item_id",
    bottleId,
  });
}

function assertDedicatedReadyPayload(body) {
  expect(body).toHaveProperty("ok");
  expect(body).toHaveProperty("ready");
  expect(body).toHaveProperty("error");
  expect(body).toHaveProperty("message");
  expect(body).toHaveProperty("blocking_lines");
  expect(body.ok).toBe(true);
  expect(body.ready).toBe(true);
  expect(body.error).toBeNull();
  expect(body.message).toBeNull();
  expect(body.blocking_lines).toEqual([]);
}

function assertEmbeddedReadiness(r, { blocked }) {
  expect(r).toHaveProperty("ready");
  expect(r).toHaveProperty("error");
  expect(r).toHaveProperty("message");
  expect(r).toHaveProperty("blocking_lines");
  expect(Array.isArray(r.blocking_lines)).toBe(true);
  if (blocked) {
    expect(r.ready).toBe(false);
    expect(r.error).toBe("MLCC_ITEM_ID_REQUIRED");
    expect(typeof r.message).toBe("string");
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.blocking_lines.length).toBeGreaterThan(0);
  } else {
    expect(r.ready).toBe(true);
    expect(r.error).toBeNull();
    expect(r.message).toBeNull();
    expect(r.blocking_lines).toEqual([]);
  }
}

describe("MLCC readiness HTTP JSON contract (routes)", () => {
  vi.setConfig({ testTimeout: 30000 });

  afterAll(async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });
    await resetTestCartState(supabase, cartId);
  });

  it("blocked then ready: dedicated wrapper + embedded detail + embedded history row", async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);

    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const dedicatedBlocked = await auth.get(
      `/cart/${storeId}/history/${cartId}/mlcc-execution-readiness`,
    );
    expect(dedicatedBlocked.status).toBe(200);
    assertDedicatedBlockedPayload(dedicatedBlocked.body);

    const detailBlocked = await auth.get(`/cart/${storeId}/history/${cartId}`);
    expect(detailBlocked.status).toBe(200);
    expect(detailBlocked.body.mlcc_execution_readiness).toBeDefined();
    assertEmbeddedReadiness(detailBlocked.body.mlcc_execution_readiness, {
      blocked: true,
    });

    const listBlocked = await auth.get(`/cart/${storeId}/history`);
    expect(listBlocked.status).toBe(200);
    const rowBlocked = listBlocked.body.history.find((c) => c.id === cartId);
    expect(rowBlocked).toBeTruthy();
    expect(rowBlocked.mlcc_execution_readiness).toBeDefined();
    assertEmbeddedReadiness(rowBlocked.mlcc_execution_readiness, { blocked: true });
    expect(rowBlocked.mlcc_execution_summary).toEqual({
      status_code: "blocked_missing_mlcc_item_id",
      blocked: true,
      blocking_count: rowBlocked.mlcc_execution_readiness.blocking_lines.length,
      missing_mlcc_item_id_count:
        rowBlocked.mlcc_execution_readiness.blocking_lines.length,
    });

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });

    const dedicatedReady = await auth.get(
      `/cart/${storeId}/history/${cartId}/mlcc-execution-readiness`,
    );
    expect(dedicatedReady.status).toBe(200);
    assertDedicatedReadyPayload(dedicatedReady.body);

    const detailReady = await auth.get(`/cart/${storeId}/history/${cartId}`);
    expect(detailReady.status).toBe(200);
    assertEmbeddedReadiness(detailReady.body.mlcc_execution_readiness, {
      blocked: false,
    });

    const listReady = await auth.get(`/cart/${storeId}/history`);
    expect(listReady.status).toBe(200);
    const rowReady = listReady.body.history.find((c) => c.id === cartId);
    expect(rowReady).toBeTruthy();
    assertEmbeddedReadiness(rowReady.mlcc_execution_readiness, { blocked: false });
    expect(rowReady.mlcc_execution_summary).toEqual({
      status_code: "ready",
      blocked: false,
      blocking_count: 0,
      missing_mlcc_item_id_count: 0,
    });
  });

  it("GET /cart/:storeId/mlcc-readiness-dashboard — contract for blocked vs ready", async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);

    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const dashBlocked = await auth.get(
      `/cart/${storeId}/mlcc-readiness-dashboard`,
    );
    expect(dashBlocked.status).toBe(200);
    expect(dashBlocked.body).toMatchObject({
      ok: true,
      store_id: storeId,
      filters: {
        blocked_only: false,
        status_code: null,
        limit: 20,
      },
    });
    expect(dashBlocked.body.counts).toMatchObject({
      total_carts: expect.any(Number),
      blocked_carts: expect.any(Number),
      ready_carts: expect.any(Number),
      by_status_code: expect.any(Object),
    });
    expect(dashBlocked.body.counts.total_carts).toBeGreaterThanOrEqual(1);
    expect(dashBlocked.body.counts.blocked_carts).toBeGreaterThanOrEqual(1);
    expect(
      dashBlocked.body.counts.by_status_code.blocked_missing_mlcc_item_id,
    ).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(dashBlocked.body.carts)).toBe(true);
    const cartBlocked = dashBlocked.body.carts.find((c) => c.cart_id === cartId);
    expect(cartBlocked).toBeTruthy();
    expect(cartBlocked.cart_id).toBe(cartId);
    expect(cartBlocked.item_count).toBeGreaterThanOrEqual(1);
    expect(cartBlocked.mlcc_execution_summary.status_code).toBe(
      "blocked_missing_mlcc_item_id",
    );
    expect(cartBlocked.mlcc_execution_summary.blocked).toBe(true);
    expect(Array.isArray(cartBlocked.blocking_preview)).toBe(true);
    expect(cartBlocked.blocking_preview.length).toBeGreaterThan(0);
    expect(cartBlocked.blocking_preview.length).toBeLessThanOrEqual(3);
    expect(cartBlocked.blocking_preview[0]).toMatchObject({
      reason: "missing_mlcc_item_id",
      bottleId,
    });

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });

    const dashReady = await auth.get(`/cart/${storeId}/mlcc-readiness-dashboard`);
    expect(dashReady.status).toBe(200);
    expect(dashReady.body.ok).toBe(true);
    expect(dashReady.body.filters).toMatchObject({
      blocked_only: false,
      status_code: null,
      limit: 20,
    });
    expect(dashReady.body.counts.ready_carts).toBeGreaterThanOrEqual(1);
    expect(dashReady.body.counts.by_status_code.ready).toBeGreaterThanOrEqual(1);
    const cartReady = dashReady.body.carts.find((c) => c.cart_id === cartId);
    expect(cartReady).toBeTruthy();
    expect(cartReady.mlcc_execution_summary).toEqual({
      status_code: "ready",
      blocked: false,
      blocking_count: 0,
      missing_mlcc_item_id_count: 0,
    });
    expect(cartReady.blocking_preview).toEqual([]);
  });

  it("GET /cart/:storeId/history/:cartId/mlcc-blocking-hints — invalid uuid, not found, blocked, ready", async () => {
    const badUuid = await auth.get(
      `/cart/${storeId}/history/not-a-uuid/mlcc-blocking-hints`,
    );
    expect(badUuid.status).toBe(404);
    expect(badUuid.body.ok).toBe(false);
    expect(badUuid.body.blocked).toBe(true);
    expect(badUuid.body.error).toBe("cart_not_found");

    const notFound = await auth.get(
      `/cart/${storeId}/history/00000000-0000-0000-0000-000000000001/mlcc-blocking-hints`,
    );
    expect(notFound.status).toBe(404);
    expect(notFound.body.ok).toBe(false);
    expect(notFound.body.blocked).toBe(true);
    expect(notFound.body.error).toBe("cart_not_found");

    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);

    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const blockedHints = await auth.get(
      `/cart/${storeId}/history/${cartId}/mlcc-blocking-hints`,
    );
    expect(blockedHints.status).toBe(200);
    expect(blockedHints.body).toMatchObject({
      ok: true,
      store_id: storeId,
      cart_id: cartId,
      ready: false,
      error: "MLCC_ITEM_ID_REQUIRED",
    });
    expect(Array.isArray(blockedHints.body.blocking_hints)).toBe(true);
    expect(blockedHints.body.blocking_hints.length).toBeGreaterThan(0);
    expect(blockedHints.body.blocking_hints[0]).toMatchObject({
      cart_item_id: expect.any(String),
      bottle_id: bottleId,
      reason: "missing_mlcc_item_id",
      bottle_name: expect.any(String),
      hint_status: expect.any(String),
      candidate_count: expect.any(Number),
      candidates: expect.any(Array),
      proposed_fix: {
        action: expect.any(String),
        reason_code: expect.any(String),
        suggested_mlcc_item_id: expect.anything(),
        auto_selectable: expect.any(Boolean),
      },
    });

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });

    const readyHints = await auth.get(
      `/cart/${storeId}/history/${cartId}/mlcc-blocking-hints`,
    );
    expect(readyHints.status).toBe(200);
    expect(readyHints.body.ok).toBe(true);
    expect(readyHints.body.ready).toBe(true);
    expect(readyHints.body.error).toBeNull();
    expect(readyHints.body.message).toBeNull();
    expect(readyHints.body.blocking_hints).toEqual([]);
    expect(readyHints.body.blocking_hints.every((h) => !("proposed_fix" in h))).toBe(true);
  });

  it("GET /cart/:storeId/mlcc-mapping-backlog — shape, blocked aggregates, ready clears test bottle", async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);

    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const blockedBacklog = await auth.get(`/cart/${storeId}/mlcc-mapping-backlog`);
    expect(blockedBacklog.status).toBe(200);
    expect(blockedBacklog.body).toMatchObject({
      ok: true,
      store_id: storeId,
      counts: {
        scanned_carts: expect.any(Number),
        backlog_bottles: expect.any(Number),
        total_blocking_hints: expect.any(Number),
      },
      backlog_summary: {
        total_backlog_bottles: expect.any(Number),
        total_blocking_hints: expect.any(Number),
        by_proposed_fix_action: {
          confirm_single_candidate: expect.any(Number),
          operator_must_choose_candidate: expect.any(Number),
          manual_review_required: expect.any(Number),
        },
        by_effort_mode: {
          auto_selectable_bottles: expect.any(Number),
          operator_choice_bottles: expect.any(Number),
          manual_review_bottles: expect.any(Number),
        },
        highest_urgency_bucket: {
          action: expect.anything(),
          count: expect.any(Number),
        },
      },
    });
    expect(blockedBacklog.body.backlog_summary.total_backlog_bottles).toBe(
      blockedBacklog.body.counts.backlog_bottles,
    );
    expect(blockedBacklog.body.backlog_summary.total_blocking_hints).toBe(
      blockedBacklog.body.counts.total_blocking_hints,
    );
    expect(Array.isArray(blockedBacklog.body.items)).toBe(true);
    expect(blockedBacklog.body.counts.scanned_carts).toBeGreaterThanOrEqual(1);
    expect(blockedBacklog.body.counts.total_blocking_hints).toBeGreaterThanOrEqual(1);

    const row = blockedBacklog.body.items.find((i) => i.bottle_id === bottleId);
    expect(row).toBeTruthy();
    expect(row).toMatchObject({
      bottle_id: bottleId,
      bottle_name: expect.any(String),
      blocking_hint_count: expect.any(Number),
      affected_cart_count: expect.any(Number),
      latest_seen_at: expect.anything(),
      hint_status_breakdown: expect.any(Object),
      proposed_fix_breakdown: expect.any(Object),
      auto_selectable_count: expect.any(Number),
      manual_review_count: expect.any(Number),
      operator_choice_count: expect.any(Number),
      sample_candidates: expect.any(Array),
      recent_cart_ids: expect.any(Array),
    });
    expect(row.blocking_hint_count).toBeGreaterThanOrEqual(1);
    expect(row.affected_cart_count).toBeGreaterThanOrEqual(1);
    expect(row.recent_cart_ids).toContain(cartId);

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });

    const readyBacklog = await auth.get(`/cart/${storeId}/mlcc-mapping-backlog`);
    expect(readyBacklog.status).toBe(200);
    expect(readyBacklog.body.ok).toBe(true);
    expect(readyBacklog.body.backlog_summary).toMatchObject({
      total_backlog_bottles: expect.any(Number),
      total_blocking_hints: expect.any(Number),
      highest_urgency_bucket: {
        action: expect.toSatisfy((v) => v === null || typeof v === "string"),
        count: expect.any(Number),
      },
    });
    expect(
      readyBacklog.body.items.filter((i) => i.bottle_id === bottleId),
    ).toEqual([]);
  });

  it("GET /cart/:storeId/mlcc-mapping-backlog/:bottleId — 404/200 drill-down shape", async () => {
    const bad = await auth.get(`/cart/${storeId}/mlcc-mapping-backlog/not-a-uuid`);
    expect(bad.status).toBe(404);
    expect(bad.body.ok).toBe(false);

    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);
    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });
    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const ok = await auth.get(
      `/cart/${storeId}/mlcc-mapping-backlog/${bottleId}?cart_limit=2`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      ok: true,
      store_id: storeId,
      bottle_id: bottleId,
      detail: {
        bottle_id: bottleId,
        blocking_hint_count: expect.any(Number),
        affected_cart_count: expect.any(Number),
        hint_status_breakdown: expect.any(Object),
        proposed_fix_breakdown: expect.any(Object),
        dominant_proposed_fix_action: expect.anything(),
        sample_candidates: expect.any(Array),
        affected_carts: expect.any(Array),
      },
    });
    expect(ok.body.detail.blocking_hint_count).toBeGreaterThanOrEqual(1);
    expect(ok.body.detail.affected_carts.length).toBeLessThanOrEqual(2);
    if (ok.body.detail.affected_carts.length > 0) {
      expect(ok.body.detail.affected_carts[0]).toMatchObject({
        cart_id: expect.any(String),
        hint_count: expect.any(Number),
      });
    }

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });
  });

  it("POST /execution-runs/from-cart — Gate 3: not-ready returns 400 + no run; ready returns 201", async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);

    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const { count: countBlockedBefore } = await supabase
      .from("execution_runs")
      .select("*", { count: "exact", head: true })
      .eq("cart_id", cartId);
    expect(countBlockedBefore ?? 0).toBe(0);

    const blockedExec = await auth
      .post(`/execution-runs/from-cart/${storeId}/${cartId}`)
      .send();
    expect(blockedExec.status).toBe(400);
    expect(blockedExec.body.error).toBe("MLCC_ITEM_ID_REQUIRED");
    expect(typeof blockedExec.body.message).toBe("string");
    expect(Array.isArray(blockedExec.body.blocking_lines)).toBe(true);
    expect(blockedExec.body.blocking_lines.length).toBeGreaterThan(0);

    const { count: countBlockedAfter } = await supabase
      .from("execution_runs")
      .select("*", { count: "exact", head: true })
      .eq("cart_id", cartId);
    expect(countBlockedAfter ?? 0).toBe(0);

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });

    const okExec = await auth.post(`/execution-runs/from-cart/${storeId}/${cartId}`).send();
    expect(okExec.status).toBe(201);
    expect(okExec.body.success).toBe(true);
    expect(okExec.body.data?.id).toBeTruthy();

    const { count: countReady } = await supabase
      .from("execution_runs")
      .select("*", { count: "exact", head: true })
      .eq("cart_id", cartId);
    expect((countReady ?? 0)).toBeGreaterThanOrEqual(1);

    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);
  });

  it("GET /cart/:storeId/mlcc-operator-overview — shape, limits, blocked + backlog slices", async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);

    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const ov = await auth.get(
      `/cart/${storeId}/mlcc-operator-overview?cart_limit=2&backlog_limit=2`,
    );
    expect(ov.status).toBe(200);
    expect(ov.body).toMatchObject({
      ok: true,
      store_id: storeId,
      limits: { cart_limit: 2, backlog_limit: 2 },
      readiness_dashboard: {
        counts: {
          total_carts: expect.any(Number),
          blocked_carts: expect.any(Number),
          ready_carts: expect.any(Number),
          by_status_code: expect.any(Object),
        },
        filters: expect.any(Object),
        load_scope: expect.any(Object),
      },
      backlog_summary: {
        total_backlog_bottles: expect.any(Number),
        total_blocking_hints: expect.any(Number),
        by_proposed_fix_action: expect.any(Object),
        by_effort_mode: expect.any(Object),
        highest_urgency_bucket: expect.any(Object),
      },
    });
    expect(typeof ov.body.generated_at).toBe("string");
    expect(Array.isArray(ov.body.top_blocked_carts)).toBe(true);
    expect(ov.body.top_blocked_carts.length).toBeLessThanOrEqual(2);
    expect(Array.isArray(ov.body.top_backlog_bottles)).toBe(true);
    expect(ov.body.top_backlog_bottles.length).toBeLessThanOrEqual(2);
    if (ov.body.top_blocked_carts.length > 0) {
      expect(ov.body.top_blocked_carts[0]).toMatchObject({
        cart_id: expect.any(String),
        mlcc_execution_summary: expect.any(Object),
        blocking_preview: expect.any(Array),
      });
    }
    if (ov.body.top_backlog_bottles.length > 0) {
      expect(ov.body.top_backlog_bottles[0]).toMatchObject({
        bottle_id: expect.any(String),
        blocking_hint_count: expect.any(Number),
        dominant_proposed_fix_action: expect.anything(),
        sample_candidates: expect.any(Array),
      });
    }

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });

    const ovReady = await auth.get(`/cart/${storeId}/mlcc-operator-overview`);
    expect(ovReady.status).toBe(200);
    expect(ovReady.body.limits.cart_limit).toBe(5);
    expect(ovReady.body.limits.backlog_limit).toBe(5);
  });

  it("GET /cart/:storeId/mlcc-readiness-dashboard — filters, counts vs response limit, blocked_only", async () => {
    await supabase.from("execution_runs").delete().eq("cart_id", cartId);
    await resetTestCartState(supabase, cartId);

    await auth.post(`/cart/${storeId}/validate`).send();
    await auth
      .patch(`/cart/${storeId}/history/${cartId}/validation-result`)
      .send({ validationStatus: "validated" });

    await supabase.from("cart_items").update({ mlcc_item_id: null }).eq("cart_id", cartId);
    await supabase.from("bottles").update({ mlcc_item_id: null }).eq("id", bottleId);

    const full = await auth.get(`/cart/${storeId}/mlcc-readiness-dashboard`);
    expect(full.status).toBe(200);
    const total = full.body.counts.total_carts;
    expect(total).toBeGreaterThanOrEqual(1);

    const limited = await auth.get(
      `/cart/${storeId}/mlcc-readiness-dashboard?limit=1`,
    );
    expect(limited.status).toBe(200);
    expect(limited.body.filters.limit).toBe(1);
    expect(limited.body.carts.length).toBeLessThanOrEqual(1);
    expect(limited.body.counts.total_carts).toBe(total);

    const blockedOnly = await auth.get(
      `/cart/${storeId}/mlcc-readiness-dashboard?blocked_only=1`,
    );
    expect(blockedOnly.status).toBe(200);
    expect(blockedOnly.body.filters.blocked_only).toBe(true);
    expect(blockedOnly.body.carts.every((c) => c.mlcc_execution_summary.blocked === true)).toBe(
      true,
    );

    const statusFilter = await auth.get(
      `/cart/${storeId}/mlcc-readiness-dashboard?status_code=blocked_missing_mlcc_item_id`,
    );
    expect(statusFilter.status).toBe(200);
    expect(statusFilter.body.filters.status_code).toBe("blocked_missing_mlcc_item_id");
    expect(
      statusFilter.body.carts.every(
        (c) => c.mlcc_execution_summary.status_code === "blocked_missing_mlcc_item_id",
      ),
    ).toBe(true);

    await ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId });

    const readyFilter = await auth.get(
      `/cart/${storeId}/mlcc-readiness-dashboard?status_code=ready`,
    );
    expect(readyFilter.status).toBe(200);
    expect(readyFilter.body.carts.every((c) => c.mlcc_execution_summary.status_code === "ready")).toBe(
      true,
    );

    const mix = await auth.get(`/cart/${storeId}/mlcc-readiness-dashboard`);
    expect(mix.status).toBe(200);
    const list = mix.body.carts;
    const firstReadyPartition = list.findIndex(
      (c) => c.mlcc_execution_summary.blocked !== true,
    );
    if (firstReadyPartition >= 0) {
      for (let i = 0; i < firstReadyPartition; i++) {
        expect(list[i].mlcc_execution_summary.blocked).toBe(true);
      }
      for (let i = firstReadyPartition; i < list.length; i++) {
        expect(list[i].mlcc_execution_summary.blocked).toBe(false);
      }
    }
  });
});
