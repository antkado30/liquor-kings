/**
 * Saved-matches route shaping (2026-07-28, the Settings audit door).
 * Pins the display join law: FIRST catalog row per code anchors (code
 * is non-unique), missing products degrade to nulls (a delisted
 * bottle's memory still renders by code), and counters never NaN.
 */
import { describe, it, expect } from "vitest";
import { shapeMemoryItems } from "../src/routes/store-memory.routes.js";

const memRow = (over = {}) => ({
  phrase: "smirnoff",
  size_ml: 750,
  mlcc_code: "10022",
  source: "card_swap",
  times_used: 3,
  updated_at: "2026-07-27T12:00:00Z",
  ...over,
});

describe("shapeMemoryItems", () => {
  it("joins product name + size label by code", () => {
    const items = shapeMemoryItems(
      [memRow()],
      [{ code: "10022", name: "SMIRNOFF 80 PL", bottle_size_label: "750 ML" }],
    );
    expect(items).toEqual([
      {
        phrase: "smirnoff",
        size_ml: 750,
        mlcc_code: "10022",
        product_name: "SMIRNOFF 80 PL",
        bottle_size_label: "750 ML",
        source: "card_swap",
        times_used: 3,
        updated_at: "2026-07-27T12:00:00Z",
      },
    ]);
  });

  it("code is non-unique — the FIRST catalog row anchors", () => {
    const items = shapeMemoryItems(
      [memRow()],
      [
        { code: "10022", name: "FIRST ROW WINS", bottle_size_label: "750 ML" },
        { code: "10022", name: "SECOND ROW LOSES", bottle_size_label: "750 ML" },
      ],
    );
    expect(items[0].product_name).toBe("FIRST ROW WINS");
  });

  it("a delisted bottle still renders: nulls, never a dropped row", () => {
    const items = shapeMemoryItems([memRow({ mlcc_code: "99999" })], []);
    expect(items).toHaveLength(1);
    expect(items[0].product_name).toBeNull();
    expect(items[0].mlcc_code).toBe("99999");
  });

  it("size-less memory keeps null size; junk counters floor to 0", () => {
    const items = shapeMemoryItems(
      [memRow({ size_ml: null, times_used: "nope" })],
      [],
    );
    expect(items[0].size_ml).toBeNull();
    expect(items[0].times_used).toBe(0);
  });

  it("empty inputs are calm", () => {
    expect(shapeMemoryItems([], [])).toEqual([]);
    expect(shapeMemoryItems(null, null)).toEqual([]);
  });
});
