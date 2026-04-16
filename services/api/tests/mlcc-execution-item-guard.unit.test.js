import { describe, it, expect } from "vitest";
import { collectMissingMlccItemIdLines } from "../src/utils/mlcc-execution-item-guard.js";

describe("mlcc-execution-item-guard", () => {
  it("returns empty when every line has bottle mlcc_item_id", () => {
    const payload = {
      items: [
        {
          cartItemId: "c1",
          bottleId: "b1",
          quantity: 1,
          bottle: { mlcc_code: "1", mlcc_item_id: "00000000-0000-4000-8000-000000000001" },
        },
      ],
    };
    expect(collectMissingMlccItemIdLines(payload)).toEqual([]);
  });

  it("returns empty when line-level mlcc_item_id is set", () => {
    const payload = {
      items: [
        {
          cartItemId: "c1",
          bottleId: "b1",
          mlcc_item_id: "00000000-0000-4000-8000-000000000002",
          quantity: 1,
          bottle: { mlcc_code: "1", mlcc_item_id: null },
        },
      ],
    };
    expect(collectMissingMlccItemIdLines(payload)).toEqual([]);
  });

  it("flags missing_mlcc_item_id with cart and bottle ids", () => {
    const payload = {
      items: [
        {
          cartItemId: "c1",
          bottleId: "b1",
          quantity: 1,
          bottle: { mlcc_code: "1", mlcc_item_id: null },
        },
      ],
    };
    expect(collectMissingMlccItemIdLines(payload)).toEqual([
      {
        cartItemId: "c1",
        bottleId: "b1",
        reason: "missing_mlcc_item_id",
      },
    ]);
  });

  it("mixed cart: any missing line is reported", () => {
    const payload = {
      items: [
        {
          cartItemId: "c-ok",
          bottleId: "b-ok",
          bottle: { mlcc_item_id: "00000000-0000-4000-8000-000000000099" },
        },
        {
          cartItemId: "c-bad",
          bottleId: "b-bad",
          bottle: { mlcc_code: "x" },
        },
      ],
    };
    expect(collectMissingMlccItemIdLines(payload)).toEqual([
      {
        cartItemId: "c-bad",
        bottleId: "b-bad",
        reason: "missing_mlcc_item_id",
      },
    ]);
  });

  it("treats blank string mlcc_item_id as missing", () => {
    const payload = {
      items: [
        {
          cartItemId: "c1",
          bottleId: "b1",
          mlcc_item_id: "   ",
          bottle: { mlcc_item_id: null },
        },
      ],
    };
    expect(collectMissingMlccItemIdLines(payload).length).toBe(1);
  });
});
