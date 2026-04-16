import { describe, it, expect } from "vitest";
import {
  buildMlccDashboardCounts,
  filterMlccDashboardCarts,
  parseMlccDashboardQueryParams,
  sortMlccDashboardCartsForTriage,
} from "../src/services/cart-submitted-mlcc-feed.service.js";

describe("parseMlccDashboardQueryParams", () => {
  it("defaults limit and null status_code", () => {
    expect(parseMlccDashboardQueryParams({})).toEqual({
      blockedOnly: false,
      statusCode: null,
      limit: 20,
    });
  });

  it("parses blocked_only and status_code and limit", () => {
    expect(
      parseMlccDashboardQueryParams({
        blocked_only: "1",
        status_code: "ready",
        limit: "5",
      }),
    ).toEqual({
      blockedOnly: true,
      statusCode: "ready",
      limit: 5,
    });
  });

  it("caps high limit", () => {
    expect(parseMlccDashboardQueryParams({ limit: "999" }).limit).toBe(100);
  });
});

describe("buildMlccDashboardCounts", () => {
  it("empty input", () => {
    expect(buildMlccDashboardCounts([])).toEqual({
      total_carts: 0,
      blocked_carts: 0,
      ready_carts: 0,
      by_status_code: {},
    });
  });

  it("aggregates by status_code and blocked / ready", () => {
    const carts = [
      {
        mlcc_execution_summary: {
          status_code: "blocked_missing_mlcc_item_id",
          blocked: true,
        },
      },
      {
        mlcc_execution_summary: { status_code: "ready", blocked: false },
      },
      {
        mlcc_execution_summary: { status_code: "not_mlcc_ready", blocked: true },
      },
    ];
    expect(buildMlccDashboardCounts(carts)).toEqual({
      total_carts: 3,
      blocked_carts: 2,
      ready_carts: 1,
      by_status_code: {
        blocked_missing_mlcc_item_id: 1,
        ready: 1,
        not_mlcc_ready: 1,
      },
    });
  });
});

describe("filterMlccDashboardCarts", () => {
  const carts = [
    { cart_id: "a", mlcc_execution_summary: { status_code: "ready", blocked: false } },
    {
      cart_id: "b",
      mlcc_execution_summary: {
        status_code: "blocked_missing_mlcc_item_id",
        blocked: true,
      },
    },
  ];

  it("blocked_only keeps blocked", () => {
    expect(filterMlccDashboardCarts(carts, { blockedOnly: true, statusCode: null })).toEqual([
      carts[1],
    ]);
  });

  it("status_code exact match", () => {
    expect(
      filterMlccDashboardCarts(carts, { blockedOnly: false, statusCode: "ready" }),
    ).toEqual([carts[0]]);
  });

  it("combines filters", () => {
    const mixed = [
      ...carts,
      {
        cart_id: "c",
        mlcc_execution_summary: { status_code: "not_mlcc_ready", blocked: true },
      },
    ];
    expect(
      filterMlccDashboardCarts(mixed, {
        blockedOnly: true,
        statusCode: "blocked_missing_mlcc_item_id",
      }),
    ).toEqual([carts[1]]);
  });
});

describe("sortMlccDashboardCartsForTriage", () => {
  it("orders blocked before ready, then newer updated_at first", () => {
    const readyOld = {
      cart_id: "r1",
      updated_at: "2020-01-01T00:00:00.000Z",
      mlcc_execution_summary: { blocked: false, status_code: "ready" },
    };
    const readyNew = {
      cart_id: "r2",
      updated_at: "2025-01-01T00:00:00.000Z",
      mlcc_execution_summary: { blocked: false, status_code: "ready" },
    };
    const blockedOld = {
      cart_id: "b1",
      updated_at: "2021-01-01T00:00:00.000Z",
      mlcc_execution_summary: { blocked: true, status_code: "blocked_missing_mlcc_item_id" },
    };
    const blockedNew = {
      cart_id: "b2",
      updated_at: "2026-01-01T00:00:00.000Z",
      mlcc_execution_summary: { blocked: true, status_code: "blocked_missing_mlcc_item_id" },
    };
    const sorted = sortMlccDashboardCartsForTriage([
      readyNew,
      blockedOld,
      readyOld,
      blockedNew,
    ]);
    expect(sorted.map((c) => c.cart_id)).toEqual(["b2", "b1", "r2", "r1"]);
  });
});
