import { describe, expect, it } from "vitest";
import { buildOrderHistoryForCodes } from "../src/lib/order-history-for-codes.js";

const li = (liquorCode, quantity) => ({ liquorCode, quantity });

describe("buildOrderHistoryForCodes", () => {
  it("counts orders per code and reports the LATEST order's qty + date", () => {
    const rows = [
      // Deliberately out of order — the lib must sort desc itself.
      {
        placed_at: "2026-07-01T10:00:00Z",
        line_items: [li("100", 2), li("200", 1)],
      },
      {
        placed_at: "2026-08-05T10:00:00Z",
        line_items: [li("100", 6)],
      },
      {
        placed_at: "2026-06-01T10:00:00Z",
        line_items: [li("100", 3)],
      },
    ];
    const h = buildOrderHistoryForCodes(rows, ["100", "200", "300"]);
    expect(h["100"]).toEqual({
      times_ordered: 3,
      last_ordered_at: "2026-08-05T10:00:00Z",
      last_quantity: 6,
    });
    expect(h["200"]).toEqual({
      times_ordered: 1,
      last_ordered_at: "2026-07-01T10:00:00Z",
      last_quantity: 1,
    });
    expect(h["300"]).toBeUndefined();
  });

  it("prefers synced_line_items (post-sync truth) when present and non-empty", () => {
    const rows = [
      {
        placed_at: "2026-08-01T10:00:00Z",
        line_items: [li("100", 6)],
        synced_line_items: [li("100", 4)], // ADA cut 2 — synced is the truth
      },
      {
        placed_at: "2026-07-01T10:00:00Z",
        line_items: [li("100", 2)],
        synced_line_items: [], // empty sync array → fall back to placement
      },
    ];
    const h = buildOrderHistoryForCodes(rows, ["100"]);
    expect(h["100"].times_ordered).toBe(2);
    expect(h["100"].last_quantity).toBe(4);
  });

  it("one order with the same code on two lines counts ONCE, qty summed", () => {
    const rows = [
      {
        placed_at: "2026-08-01T10:00:00Z",
        line_items: [li("100", 2), li("100", 3)],
      },
    ];
    const h = buildOrderHistoryForCodes(rows, ["100"]);
    expect(h["100"]).toEqual({
      times_ordered: 1,
      last_ordered_at: "2026-08-01T10:00:00Z",
      last_quantity: 5,
    });
  });

  it("normalizes leading zeros both sides ('0123' matches catalog '123')", () => {
    const rows = [
      { placed_at: "2026-08-01T10:00:00Z", line_items: [li("0123", 1)] },
    ];
    const h = buildOrderHistoryForCodes(rows, ["123"]);
    expect(h["123"]?.times_ordered).toBe(1);
  });

  it("falls back to created_at when placed_at is null", () => {
    const rows = [
      { placed_at: null, created_at: "2026-08-02T10:00:00Z", line_items: [li("100", 1)] },
      { placed_at: "2026-08-01T10:00:00Z", line_items: [li("100", 9)] },
    ];
    const h = buildOrderHistoryForCodes(rows, ["100"]);
    expect(h["100"].last_ordered_at).toBe("2026-08-02T10:00:00Z");
    expect(h["100"].last_quantity).toBe(1);
  });

  it("missing quantity on the latest order reports last_quantity null, still counts", () => {
    const rows = [
      { placed_at: "2026-08-01T10:00:00Z", line_items: [{ liquorCode: "100" }] },
    ];
    const h = buildOrderHistoryForCodes(rows, ["100"]);
    expect(h["100"]).toEqual({
      times_ordered: 1,
      last_ordered_at: "2026-08-01T10:00:00Z",
      last_quantity: null,
    });
  });

  it("garbage in → empty out, never throws", () => {
    expect(buildOrderHistoryForCodes(null, ["100"])).toEqual({});
    expect(buildOrderHistoryForCodes([], null)).toEqual({});
    expect(
      buildOrderHistoryForCodes(
        [{ line_items: "nope" }, null, { placed_at: "2026-08-01T00:00:00Z" }],
        ["100", "", null],
      ),
    ).toEqual({});
  });
});

describe("collectOrderedCodes", () => {
  it("collects normalized codes across orders, synced preferred", async () => {
    const { collectOrderedCodes } = await import("../src/lib/order-history-for-codes.js");
    const set = collectOrderedCodes([
      { line_items: [{ liquorCode: "0100" }, { liquorCode: "200" }] },
      { line_items: [{ liquorCode: "300" }], synced_line_items: [{ liquorCode: "301" }] },
      null,
      { line_items: "garbage" },
    ]);
    expect(set.has("100")).toBe(true); // leading zeros stripped
    expect(set.has("200")).toBe(true);
    expect(set.has("301")).toBe(true); // synced truth
    expect(set.has("300")).toBe(false); // placement snapshot superseded
    expect(set.size).toBe(3);
  });
});
