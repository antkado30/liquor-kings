import { describe, it, expect } from "vitest";

import {
  evaluateDryRunMappingConfidenceGuard,
  snapQuantityForMlccSku,
} from "../src/quantity-rules/index.js";

describe("snapQuantityForMlccSku", () => {
  it("SKU 7127 snaps up to a multiple of 6", () => {
    expect(snapQuantityForMlccSku("7127", 1)).toMatchObject({
      ok: true,
      snapped: 6,
      step: 6,
      rule: "ceil_multiple_of_6",
    });
    expect(snapQuantityForMlccSku("7127", 6)).toMatchObject({ ok: true, snapped: 6 });
    expect(snapQuantityForMlccSku("7127", 7)).toMatchObject({ ok: true, snapped: 12 });
  });

  it("SKU 4101 snaps up to a multiple of 4", () => {
    expect(snapQuantityForMlccSku("4101", 1)).toMatchObject({
      ok: true,
      snapped: 4,
      step: 4,
      rule: "ceil_multiple_of_4",
    });
    expect(snapQuantityForMlccSku("4101", 4)).toMatchObject({ ok: true, snapped: 4 });
    expect(snapQuantityForMlccSku("4101", 5)).toMatchObject({ ok: true, snapped: 8 });
  });

  it("unknown SKU uses identity snap (no pack rule)", () => {
    expect(snapQuantityForMlccSku("99999", 11)).toMatchObject({
      ok: true,
      snapped: 11,
      rule: "unknown_sku_no_special_snap",
      step: 1,
    });
    expect(snapQuantityForMlccSku("", 3)).toMatchObject({
      ok: true,
      snapped: 3,
      rule: "unknown_sku_no_special_snap",
    });
  });

  it("rejects non-positive or non-integer quantity", () => {
    expect(snapQuantityForMlccSku("7127", 0).ok).toBe(false);
    expect(snapQuantityForMlccSku("7127", 1.5).ok).toBe(false);
  });
});

describe("evaluateDryRunMappingConfidenceGuard", () => {
  it("passes when all items are confirmed or mapping field omitted", () => {
    const r = evaluateDryRunMappingConfidenceGuard({
      items: [
        { cartItemId: "a", bottleId: "b", bottle: { mlcc_code: "1" } },
        {
          cartItemId: "c",
          bottleId: "d",
          mappingconfidence: "confirmed",
          bottle: { mlcc_code: "2" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.unknown_items).toHaveLength(0);
    expect(r.inferred_items).toHaveLength(0);
  });

  it("blocks when any item is unknown", () => {
    const r = evaluateDryRunMappingConfidenceGuard({
      items: [
        {
          cartItemId: "ci-1",
          bottleId: "b-1",
          mappingconfidence: "confirmed",
          bottle: { mlcc_code: "100" },
        },
        {
          cartItemId: "ci-2",
          bottleId: "b-2",
          mappingConfidence: "unknown",
          bottle: { mlcc_code: "200" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.unknown_items).toHaveLength(1);
    expect(r.unknown_items[0].cartItemId).toBe("ci-2");
    expect(r.message).toMatch(/unknown/i);
  });

  it("allows inferred but lists them for audit", () => {
    const r = evaluateDryRunMappingConfidenceGuard({
      items: [
        {
          cartItemId: "x",
          mappingconfidence: "inferred",
          bottle: { mlcc_code: "4101" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.inferred_items).toHaveLength(1);
    expect(r.inferred_items[0].mappingconfidence).toBe("inferred");
  });

  it("reads mappingconfidence from bottle when set there", () => {
    const r = evaluateDryRunMappingConfidenceGuard({
      items: [
        {
          cartItemId: "z",
          bottleId: "bid",
          bottle: { mlcc_code: "1", mappingconfidence: "unknown" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.unknown_items[0].mlcc_code).toBe("1");
  });
});
