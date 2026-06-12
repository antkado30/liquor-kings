/**
 * Tier-2 UPC scoring — special-edition penalty + unknown-size retail prior.
 *
 * Born from the 2026-06-10 real-order failures (quality mandate):
 *  - Scanned a regular 1800 Silver fifth → the LIONS EDITION opened.
 *    "LIONS" isn't a qualifier-set token, and both names share SILVER, so
 *    the edition survived marker-conflict and outranked the base on name
 *    noise. Fix: -25 edition penalty (same isMlccSpecialEditionName
 *    detector the resolution path uses) when the UPC title doesn't
 *    mention the edition.
 *  - Top-scanned fifth UPCs were mapped to NIPS (Maker's 9008/50ml class).
 *    With UPC size unknown, the old flat "10 neutral" let a nip tie a
 *    fifth and win on name noise. Fix: retail-likelihood prior
 *    (750 → 12 … nip → 2), spread wider than name-similarity noise.
 */

import { describe, expect, it } from "vitest";
import { scoreUpcToMlccCandidate } from "../src/mlcc/mlcc-upc-scoring.js";

const upc1800 = {
  name: "1800 Silver Tequila 750ml",
  brand: "1800",
  size_ml: 750,
  plausible_sizes: [750],
  sizePenalty: 0,
  proof: null,
  rawTitle: "1800 Silver Tequila 750ml",
};
const base1800 = { code: "111", name: "1800 SILVER TEQ", bottle_size_ml: 750, proof: 80, category: "Tequila" };
const lions1800 = { code: "222", name: "1800 SILVER LIONS", bottle_size_ml: 750, proof: 80, category: "Tequila" };

describe("special-edition penalty (1800 Lions class)", () => {
  it("penalizes an edition the UPC title does not mention", () => {
    const r = scoreUpcToMlccCandidate(upc1800, lions1800);
    expect(r.breakdown.editionPenalty).toBe(-25);
    expect(r.disqualified).toBe(false); // pickable, just never on top
  });

  it("base product outranks the edition", () => {
    const rBase = scoreUpcToMlccCandidate(upc1800, base1800);
    const rLions = scoreUpcToMlccCandidate(upc1800, lions1800);
    expect(rBase.total).toBeGreaterThan(rLions.total);
  });

  it("no penalty when the UPC itself names the edition", () => {
    const upcLions = {
      ...upc1800,
      name: "1800 Silver Lions Edition Tequila 750ml",
      rawTitle: "1800 Silver Lions Edition Tequila 750ml",
    };
    const r = scoreUpcToMlccCandidate(upcLions, lions1800);
    expect(r.breakdown.editionPenalty).toBe(0);
  });

  it("penalizes other edition markers (CAMO/HOLIDAY style)", () => {
    const upcFireball = {
      name: "Fireball Cinnamon Whisky 750ml",
      brand: "Fireball",
      size_ml: 750,
      plausible_sizes: [750],
      sizePenalty: 0,
      proof: null,
      rawTitle: "Fireball Cinnamon Whisky 750ml",
    };
    const camo = {
      code: "555",
      name: "FIREBALL CINNAMON CAMO",
      bottle_size_ml: 750,
      proof: 66,
      category: "Flavored Whiskey",
    };
    const r = scoreUpcToMlccCandidate(upcFireball, camo);
    expect(r.breakdown.editionPenalty).toBe(-25);
  });
});

describe("unknown-size retail prior (Maker's nip class)", () => {
  const upcMakers = {
    name: "Maker's Mark Bourbon Whisky",
    brand: "Maker's Mark",
    size_ml: null,
    plausible_sizes: [],
    sizePenalty: 0,
    proof: null,
    rawTitle: "Maker's Mark Bourbon Whisky",
  };
  const fifth = { code: "333", name: "MAKERS MARK BRBN WSKY", bottle_size_ml: 750, proof: 90, category: "Straight Bourbon" };
  const nip = { code: "9008", name: "MAKERS MARK BRBN WSKY", bottle_size_ml: 50, proof: 90, category: "Straight Bourbon" };

  it("a fifth always outranks a nip when UPC size is unknown", () => {
    const rFifth = scoreUpcToMlccCandidate(upcMakers, fifth);
    const rNip = scoreUpcToMlccCandidate(upcMakers, nip);
    expect(rFifth.breakdown.sizeScore).toBeGreaterThan(rNip.breakdown.sizeScore);
    expect(rFifth.total).toBeGreaterThan(rNip.total);
  });

  it("a known 750ml UPC still hard-disqualifies the nip", () => {
    const known = { ...upcMakers, size_ml: 750, plausible_sizes: [750] };
    const r = scoreUpcToMlccCandidate(known, nip);
    expect(r.disqualified).toBe(true);
    expect(r.total).toBe(0);
  });
});

describe("regressions", () => {
  it("plain flagship match still scores strong with no edition penalty", () => {
    const upcTitos = {
      name: "Tito's Handmade Vodka 750ml",
      brand: "Tito's",
      size_ml: 750,
      plausible_sizes: [750],
      sizePenalty: 0,
      proof: 80,
      rawTitle: "Tito's Handmade Vodka 750ml",
    };
    const row = { code: "444", name: "TITOS HANDMADE VODKA", bottle_size_ml: 750, proof: 80, category: "Vodka" };
    const r = scoreUpcToMlccCandidate(upcTitos, row);
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.breakdown.editionPenalty).toBe(0);
  });
});
