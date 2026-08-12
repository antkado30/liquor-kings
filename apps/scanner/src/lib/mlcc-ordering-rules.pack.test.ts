/**
 * PACK-AWARE CASE MATH pins (2026-08-10) — born from Tony's Fireball
 * Party Bucket find: a 20-pack 50ml item with MLCC case_size 120 was
 * demanding 120 PACKS (2,400 bottles, ~$2,035) instead of 6 packs
 * (one real case, ~$102). MLCC counts case_size in bottles; packs are
 * priced and ordered per pack (proven by the 8/5 real order, penny-
 * matched). These pins make the 20× money error impossible to
 * reintroduce silently.
 */
import { describe, expect, it } from "vitest";
import {
  generateValidQuantities,
  getOrderingRuleDisplay,
} from "./mlcc-ordering-rules";

const BUCKET = {
  code: "25553",
  bottle_size_ml: 50,
  case_size: 120,
  ada_name: "General Wine & Liquor",
  pack_count: 20,
};

describe("pack-aware case math (the Party Bucket fix)", () => {
  it("20-pack, case 120 → order in multiples of 6 packs, not 120", () => {
    const rule = getOrderingRuleDisplay(BUCKET);
    expect(rule.caseSize).toBe(6);
    expect(rule.primary).toContain("6 packs");
    expect(rule.primary).toContain("120 bottles");
    const valid = generateValidQuantities(rule);
    expect(valid[0]).toBe(6); // smallest orderable = ONE case of buckets
    expect(valid).toContain(12);
    expect(valid).not.toContain(120 * 1 + 1);
  });

  it("plain 50ml (no pack) keeps raw case multiples — unchanged behavior", () => {
    const rule = getOrderingRuleDisplay({
      code: "11111",
      bottle_size_ml: 50,
      case_size: 120,
      ada_name: null,
      pack_count: null,
    });
    expect(rule.caseSize).toBe(120);
    expect(rule.primary).toContain("multiples of 120");
    expect(generateValidQuantities(rule)[0]).toBe(120);
  });

  it("pack_count 1 is treated as no pack", () => {
    const rule = getOrderingRuleDisplay({ ...BUCKET, pack_count: 1 });
    expect(rule.caseSize).toBe(120);
  });

  it("case equals one pack → sold by the pack, min quantity 1", () => {
    const rule = getOrderingRuleDisplay({
      ...BUCKET,
      case_size: 20,
      pack_count: 20,
    });
    expect(rule.caseSize).toBe(1);
    expect(rule.primary).toContain("Sold by the pack");
    expect(generateValidQuantities(rule)[0]).toBe(1);
  });

  it("dirty division: keeps the raw number and SAYS SO (never guesses)", () => {
    const rule = getOrderingRuleDisplay({
      ...BUCKET,
      case_size: 120,
      pack_count: 7, // 120 % 7 !== 0
    });
    expect(rule.caseSize).toBe(120); // raw preserved
    expect(rule.secondary ?? "").toContain("doesn't divide evenly");
  });

  it("70000-series limited items show the pack breakdown too", () => {
    const rule = getOrderingRuleDisplay({ ...BUCKET, code: "70123" });
    expect(rule.primary).toContain("full case only");
    expect(rule.primary).toContain("20-pack");
  });
});
