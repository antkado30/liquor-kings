/**
 * Unit tests for the next-gen family identity (src/mlcc/family-key.js).
 * Every case here is a REAL failure class from the 2026-07-01 root-cause
 * (docs/lk/catalog-family-tree-plan.md) or a guard against over-merging.
 *
 * The two invariants, in Tony's words:
 *  1. "Scan a plastic pint of Jack → show the FULL family tree"
 *     → glass/plastic/minis/packs of one line share ONE familyKey.
 *  2. "I don't want someone ordering glass and getting plastic"
 *     → container comes back as DATA, never silently merged away.
 * And the audit's zero-tolerance rule: flavors, proofs, ages, editions
 * must NEVER share a key with the base bottle.
 */
import { describe, it, expect } from "vitest";
import { computeFamilyIdentity, familyKeyOf } from "../src/mlcc/family-key.js";

describe("family-key — Tony's plastic-pint bug class (container tokens)", () => {
  it("glass pint and plastic pint of the same bottle share a key; containers differ", () => {
    const glass = computeFamilyIdentity("JACK DANIELS OLD 7 BLACK PT");
    const plastic = computeFamilyIdentity("JACK DANIELS OLD 7 BLACK PL PT");
    expect(glass.familyKey).toBe("JACK DANIELS OLD 7 BLACK");
    expect(plastic.familyKey).toBe(glass.familyKey);
    expect(glass.container).toBe("glass");
    expect(plastic.container).toBe("plastic");
  });

  it("stacked suffixes reduce fully in EITHER order (single-pass bug is dead)", () => {
    expect(familyKeyOf("JACK DANIELS OLD 7 BLACK PT PL")).toBe("JACK DANIELS OLD 7 BLACK");
    expect(familyKeyOf("JACK DANIELS OLD 7 BLACK PL PT")).toBe("JACK DANIELS OLD 7 BLACK");
    expect(familyKeyOf("MOHAWK VODKA HALF GAL PL")).toBe("MOHAWK VODKA");
    expect(familyKeyOf("MOHAWK VODKA PL HALF GAL")).toBe("MOHAWK VODKA");
  });

  it("Smirnoff 80 PL joins Smirnoff 80 — and proof is NEVER stripped", () => {
    expect(familyKeyOf("SMIRNOFF 80 PL")).toBe("SMIRNOFF 80");
    expect(familyKeyOf("SMIRNOFF 80")).toBe("SMIRNOFF 80");
    // 100-proof is a DIFFERENT product line, not a size.
    expect(familyKeyOf("SMIRNOFF 100")).toBe("SMIRNOFF 100");
    expect(familyKeyOf("SMIRNOFF 100")).not.toBe(familyKeyOf("SMIRNOFF 80"));
  });

  it("traveler and PET count as plastic; GLS counts as glass", () => {
    expect(computeFamilyIdentity("E&J VS BRANDY TRAV").container).toBe("plastic");
    expect(computeFamilyIdentity("FIREBALL CINNAMON PET").container).toBe("plastic");
    expect(computeFamilyIdentity("FIREBALL CINNAMON GLS").container).toBe("glass");
    expect(familyKeyOf("FIREBALL CINNAMON PET")).toBe(familyKeyOf("FIREBALL CINNAMON GLS"));
  });
});

describe("family-key — size tokens (complete list, incl. the ones the live module misses)", () => {
  it("metric sizes strip: one-token, two-token, and liters", () => {
    expect(familyKeyOf("TITOS HANDMADE VODKA 200ML")).toBe("TITOS HANDMADE VODKA");
    expect(familyKeyOf("TITOS HANDMADE VODKA 200 ML")).toBe("TITOS HANDMADE VODKA");
    expect(familyKeyOf("TITOS HANDMADE VODKA 100ML")).toBe("TITOS HANDMADE VODKA");
    expect(familyKeyOf("TITOS HANDMADE VODKA 1.75L")).toBe("TITOS HANDMADE VODKA");
    expect(familyKeyOf("TITOS HANDMADE VODKA 750ML")).toBe("TITOS HANDMADE VODKA");
  });

  it("word sizes strip: PT / FTH / LTR / QTR / HALF GAL", () => {
    for (const suffix of ["PT", "FTH", "LTR", "QTR", "HALF GAL"]) {
      expect(familyKeyOf(`KESSLER BLEND ${suffix}`)).toBe("KESSLER BLEND");
    }
  });

  it("numeric brands survive: trailing bare numbers are NOT sizes", () => {
    expect(familyKeyOf("1010 MARGARITA 750ML")).toBe("1010 MARGARITA");
    expect(familyKeyOf("1792 SMALL BATCH")).toBe("1792 SMALL BATCH");
    expect(familyKeyOf("SEAGRAMS 7")).toBe("SEAGRAMS 7");
  });
});

describe("family-key — packs become data", () => {
  it("12PK forms group with the base line and carry packCount", () => {
    const pk1 = computeFamilyIdentity("TITOS HANDMADE VODKA 12PK");
    const pk2 = computeFamilyIdentity("TITOS HANDMADE VODKA 12 PK");
    expect(pk1.familyKey).toBe("TITOS HANDMADE VODKA");
    expect(pk2.familyKey).toBe("TITOS HANDMADE VODKA");
    expect(pk1.packCount).toBe(12);
    expect(pk2.packCount).toBe(12);
    expect(computeFamilyIdentity("TITOS HANDMADE VODKA 750ML").packCount).toBeNull();
  });
});

describe("family-key — must-NOT-merge (zero-tolerance false-merge classes)", () => {
  it("flavors stay separate families", () => {
    expect(familyKeyOf("JACK DANIELS TENN HONEY PT")).not.toBe(
      familyKeyOf("JACK DANIELS OLD 7 BLACK PT"),
    );
  });

  it("ages stay separate families", () => {
    expect(familyKeyOf("GLENFARCLAS 10 YR")).not.toBe(familyKeyOf("GLENFARCLAS 25 YR"));
  });

  it("special editions stay separate from the base line", () => {
    expect(familyKeyOf("1800 SILVER LIONS EDITION")).not.toBe(familyKeyOf("1800 SILVER"));
  });
});

describe("family-key — combos and safety rails", () => {
  it("gift combos cut to the base line and are flagged", () => {
    const combo = computeFamilyIdentity("CASAMIGOS REPOSADO W/50ML REPO W/");
    expect(combo.familyKey).toBe("CASAMIGOS REPOSADO");
    expect(combo.isCombo).toBe(true);
    expect(computeFamilyIdentity("CASAMIGOS REPOSADO 750ML").isCombo).toBe(false);
  });

  it("slash-digit combo form cuts too", () => {
    expect(familyKeyOf("BLACK VELVET APPLE/50ML PEACH W/")).toBe("BLACK VELVET APPLE");
  });

  it("never strips a name down to nothing", () => {
    expect(familyKeyOf("PT")).toBe("PT");
    expect(familyKeyOf("PL")).toBe("PL");
  });

  it("case- and whitespace-insensitive; empty-safe", () => {
    expect(familyKeyOf("  tito's   handmade  vodka  750ml ")).toBe("TITO'S HANDMADE VODKA");
    expect(familyKeyOf("")).toBe("");
    expect(familyKeyOf(null)).toBe("");
    expect(familyKeyOf(undefined)).toBe("");
  });

  it("keeps an audit trail of every stripped token", () => {
    const id = computeFamilyIdentity("JACK DANIELS OLD 7 BLACK PL PT");
    expect(id.strippedTokens).toEqual(["PT", "PL"]);
  });
});
