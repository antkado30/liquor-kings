/**
 * "More from this brand" ranking law (2026-07-26, TONY-WANTS design
 * locked). Pins Tony's interrogation answers as executable truth:
 *   1. The hybrid ranking — LK-fleet orders first, scans tiebreak.
 *   2. One entry per family; the open family is never suggested back.
 *   3. Combos / inactive / unkeyed rows are never suggestions.
 *   4. The thin-brand price band: same kind, similar money — and no
 *      band at all when the anchor has no price (never guess with money).
 */
import { describe, it, expect } from "vitest";
import {
  groupIntoFamilies,
  pickRepresentative,
  rankFamilies,
  priceBandFor,
} from "../src/lib/related-products.js";

const row = (over = {}) => ({
  code: "1000",
  name: "SMIRNOFF 80 PL",
  family_key: "fam-smirnoff-80",
  bottle_size_ml: 750,
  licensee_price: 12.35,
  ordered_count: 0,
  scan_count: 0,
  is_combo: false,
  is_active: true,
  ...over,
});

describe("groupIntoFamilies", () => {
  it("groups by family_key with one entry per family", () => {
    const fams = groupIntoFamilies([
      row({ code: "1", family_key: "a" }),
      row({ code: "2", family_key: "a", bottle_size_ml: 375 }),
      row({ code: "3", family_key: "b" }),
    ]);
    expect(fams).toHaveLength(2);
    const a = fams.find((f) => f.family_key === "a");
    expect(a.sizes_count).toBe(2);
  });

  it("never suggests the open family back (excludeFamilyKey)", () => {
    const fams = groupIntoFamilies(
      [row({ family_key: "open" }), row({ code: "9", family_key: "other" })],
      { excludeFamilyKey: "open" },
    );
    expect(fams.map((f) => f.family_key)).toEqual(["other"]);
  });

  it("drops combos, inactive rows, and unkeyed rows", () => {
    const fams = groupIntoFamilies([
      row({ family_key: "combo", is_combo: true }),
      row({ code: "2", family_key: "dead", is_active: false }),
      row({ code: "3", family_key: "" }),
      row({ code: "4", family_key: null }),
      row({ code: "5", family_key: "keep" }),
    ]);
    expect(fams.map((f) => f.family_key)).toEqual(["keep"]);
  });

  it("from_price is the family's cheapest REAL price; junk prices ignored", () => {
    const fams = groupIntoFamilies([
      row({ code: "1", family_key: "a", licensee_price: 21.5 }),
      row({ code: "2", family_key: "a", licensee_price: 9.99 }),
      row({ code: "3", family_key: "a", licensee_price: 0 }),
      row({ code: "4", family_key: "a", licensee_price: null }),
    ]);
    expect(fams[0].from_price).toBe(9.99);
  });

  it("from_price is null when no member has a usable price", () => {
    const fams = groupIntoFamilies([
      row({ family_key: "a", licensee_price: null }),
    ]);
    expect(fams[0].from_price).toBeNull();
  });
});

describe("pickRepresentative", () => {
  it("most-ordered size is the family's face", () => {
    const rep = pickRepresentative([
      row({ code: "1", ordered_count: 2 }),
      row({ code: "2", ordered_count: 40 }),
    ]);
    expect(rep.code).toBe("2");
  });

  it("scans break an order tie", () => {
    const rep = pickRepresentative([
      row({ code: "1", ordered_count: 5, scan_count: 1 }),
      row({ code: "2", ordered_count: 5, scan_count: 9 }),
    ]);
    expect(rep.code).toBe("2");
  });

  it("750ml settles a dead tie (the shelf-standard size)", () => {
    const rep = pickRepresentative([
      row({ code: "1", bottle_size_ml: 1750 }),
      row({ code: "2", bottle_size_ml: 750 }),
    ]);
    expect(rep.code).toBe("2");
  });
});

describe("rankFamilies", () => {
  const fam = (key, ordered, scanned, name = key) => ({
    family_key: key,
    ordered,
    scanned,
    representative: { name },
    sizes_count: 1,
    from_price: 10,
  });

  it("LK-fleet orders rank first; scans break ties; capped at the limit", () => {
    const ranked = rankFamilies(
      [fam("c", 1, 0), fam("a", 9, 0), fam("b", 9, 5), fam("d", 0, 99)],
      3,
    );
    expect(ranked.map((f) => f.family_key)).toEqual(["b", "a", "c"]);
  });

  it("name is the final stable tiebreak", () => {
    const ranked = rankFamilies([fam("z", 0, 0, "ZULU"), fam("a", 0, 0, "ALPHA")]);
    expect(ranked[0].family_key).toBe("a");
  });
});

describe("priceBandFor", () => {
  it("half-to-double the anchor price, floored at a dollar", () => {
    expect(priceBandFor(20)).toEqual({ min: 10, max: 40 });
    expect(priceBandFor(1.2)).toEqual({ min: 1, max: 2.4 });
  });

  it("no price → no band (never guess with money)", () => {
    expect(priceBandFor(null)).toBeNull();
    expect(priceBandFor(0)).toBeNull();
    expect(priceBandFor("nope")).toBeNull();
  });
});
