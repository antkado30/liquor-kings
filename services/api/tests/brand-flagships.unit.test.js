import { describe, expect, it } from "vitest";
import {
  clusterBrands,
  chooseFlagship,
  brandKeysOf,
  loadFlagshipMap,
  __resetFlagshipCache,
} from "../src/lib/brand-flagships.js";
import { applyFlagshipAlias } from "../src/lib/resolve-order-lines.js";

const GENERIC = new Set(["vodka", "rum", "gin", "whiskey", "tequila"]);

/** The REAL Captain Morgan cluster — Tony's prod SQL, 2026-08-12. */
const MORGAN = [
  { code: "86373", name: "CAPT MORGAN SPICED RUM (P R)", bottle_size_ml: 50, is_combo: false },
  { code: "41302", name: "CAPT MORGAN SPICED RUM (P R)", bottle_size_ml: 200, is_combo: false },
  { code: "41307", name: "CAPT MORGAN SPICED RUM (P R)", bottle_size_ml: 750, is_combo: false },
  { code: "41301", name: "CAPT MORGAN SPICED RUM (P R)", bottle_size_ml: 1000, is_combo: false },
  { code: "41308", name: "CAPT MORGAN SPICED RUM (P R)", bottle_size_ml: 1750, is_combo: false },
  { code: "41303", name: "CAPT MORGAN SPICED RUM (PR) PL", bottle_size_ml: 375, is_combo: false },
  { code: "41297", name: "CAPT MORGAN SPICED RUM (PR) PL", bottle_size_ml: 750, is_combo: false },
  { code: "5502", name: "CAPT MORGAN SPICED RUM (PR) PL", bottle_size_ml: 1750, is_combo: false },
  { code: "10923", name: "CAPTAIN MORGAN WHITE RUM", bottle_size_ml: 750, is_combo: false },
  { code: "10922", name: "CAPTAIN MORGAN WHITE RUM", bottle_size_ml: 1000, is_combo: false },
  { code: "31833", name: "CAPTAIN MORGAN WHITE RUM", bottle_size_ml: 1750, is_combo: false },
  { code: "34124", name: "CAPTAIN MORGAN CHILI LIME", bottle_size_ml: 750, is_combo: false },
  { code: "34125", name: "CAPTAIN MORGAN CHILI LIME", bottle_size_ml: 1000, is_combo: false },
  { code: "34126", name: "CAPTAIN MORGAN CHILI LIME", bottle_size_ml: 1750, is_combo: false },
  { code: "22339", name: "CAPTAIN MORGAN SLICED APPLE", bottle_size_ml: 750, is_combo: false },
  { code: "5246", name: "CAPTAIN MORGAN SPICED-100", bottle_size_ml: 750, is_combo: false },
  { code: "5247", name: "CAPTAIN MORGAN SPICED-100", bottle_size_ml: 1000, is_combo: false },
  { code: "6108", name: "CAPT MORG LONG ISL ICED TEA", bottle_size_ml: 375, is_combo: false },
  { code: "5538", name: "CAPT MORG LONG ISL ICED TEA", bottle_size_ml: 1750, is_combo: false },
  { code: "76811", name: "CAPT MORGAN SPICED RUM (PR) W/ 50mL CAPT MORGAN SPICED RUM (P R) PL", bottle_size_ml: 750, is_combo: true },
];

const JACKSON = [
  { code: "16789", name: "JACKSON MORGAN SALTED CARAMEL", bottle_size_ml: 750, is_combo: false },
  { code: "16777", name: "JACKSON MORGAN BANANA PUDDING", bottle_size_ml: 750, is_combo: false },
];

const JACK = [
  { code: "8001", name: "J DANIELS OLD 7 BLACK", bottle_size_ml: 750, is_combo: false },
  { code: "8002", name: "JACK DANIEL'S BLACKBERRY", bottle_size_ml: 750, is_combo: false },
];

describe("clusterBrands — truncation-aware brand grouping", () => {
  it("merges CAPT/CAPTAIN/CAPT MORG spellings into ONE brand", () => {
    const clusters = clusterBrands(MORGAN);
    expect(clusters.size).toBe(1);
    const rows = [...clusters.values()][0];
    expect(rows).toHaveLength(MORGAN.length);
  });

  it("keeps JACKSON MORGAN out of the Captain cluster (second-token guard)", () => {
    const clusters = clusterBrands([...MORGAN, ...JACKSON]);
    expect(clusters.size).toBe(2);
  });

  it("does NOT merge jack into jackson (daniels ≠ morgan)", () => {
    const clusters = clusterBrands([...JACK, ...JACKSON]);
    // j / jack / jackson: J DANIELS and JACK DANIEL'S bridge (j is <4 so no
    // bridge on lead alone — they stay separate clusters); jackson separate.
    // The invariant that matters: no cluster contains BOTH a daniels row and
    // a jackson row.
    for (const rows of clusters.values()) {
      const hasDaniels = rows.some((r) => /DANIEL/i.test(r.name));
      const hasJackson = rows.some((r) => /JACKSON/i.test(r.name));
      expect(hasDaniels && hasJackson).toBe(false);
    }
  });
});

describe("chooseFlagship — the size-ladder law", () => {
  it("crowns CAPT MORGAN SPICED RUM over every flavor, white rum, and the combo", () => {
    const clusters = clusterBrands(MORGAN);
    const pick = chooseFlagship([...clusters.values()][0]);
    expect(pick).not.toBeNull();
    expect(pick.lineKey).toBe("CAPT MORGAN SPICED RUM");
    expect(pick.confident).toBe(true);
    expect(pick.flagshipCode).toBe("41307"); // the glass 750
    expect(pick.aliasTerms).toEqual(["capt", "morgan", "spiced", "rum"]);
  });

  it("a combo/gift row can never be the flagship", () => {
    const pick = chooseFlagship([
      { code: "1", name: "BRANDX VODKA W/ 2 GLS", bottle_size_ml: 750, is_combo: true },
      { code: "2", name: "BRANDX VODKA", bottle_size_ml: 750, is_combo: false },
    ]);
    expect(pick.lineKey).toBe("BRANDX VODKA");
  });

  it("proof-line loses to the base at equal ladders (Smirnoff 100 class)", () => {
    const pick = chooseFlagship([
      { code: "1", name: "SMIRNOFF 80 PL", bottle_size_ml: 750, is_combo: false },
      { code: "2", name: "SMIRNOFF 80 PL", bottle_size_ml: 1750, is_combo: false },
      { code: "3", name: "SMIRNOFF 100 PL", bottle_size_ml: 750, is_combo: false },
      { code: "4", name: "SMIRNOFF 100 PL", bottle_size_ml: 1750, is_combo: false },
    ]);
    expect(pick.lineKey).toBe("SMIRNOFF 80");
  });

  it("close race → confident:false (review, never auto-written)", () => {
    const pick = chooseFlagship([
      { code: "1", name: "BRANDY LINE ONE", bottle_size_ml: 750, is_combo: false },
      { code: "2", name: "BRANDY LINE TWO", bottle_size_ml: 750, is_combo: false },
    ]);
    expect(pick.confident).toBe(false);
  });
});

describe("brandKeysOf — the keys people type", () => {
  it("derives lead and lead+second keys from every spelling in the cluster", () => {
    const keys = brandKeysOf(MORGAN, GENERIC);
    expect(keys).toContain("capt");
    expect(keys).toContain("captain");
    expect(keys).toContain("capt morgan");
    expect(keys).toContain("captain morgan");
    expect(keys).toContain("capt morg");
  });
});

describe("applyFlagshipAlias — dynamic map + depluralized lookup", () => {
  it("falls through to the dynamic map for brands the static map lacks", () => {
    const dyn = new Map([["malibu", ["malibu", "coconut", "rum"]]]);
    expect(applyFlagshipAlias(["malibu"], dyn)).toEqual(["malibu", "coconut", "rum"]);
    // Plural typed → depluralized key still hits.
    expect(applyFlagshipAlias(["malibus"], dyn)).toEqual(["malibu", "coconut", "rum"]);
  });

  it("static (curated) map always outranks the dynamic map", () => {
    const dyn = new Map([["fireball", ["fireball", "wrong"]]]);
    expect(applyFlagshipAlias(["fireball"], dyn)).toEqual(["fireball", "cinnamon"]);
  });

  it("extra distinctive words disable any alias — typed intent passes through", () => {
    const dyn = new Map([["malibu", ["malibu", "coconut", "rum"]]]);
    expect(applyFlagshipAlias(["malibu", "pineapple"], dyn)).toEqual(["malibu", "pineapple"]);
  });
});

describe("loadFlagshipMap — fail-soft loading", () => {
  it("bad table / error → empty map, never a throw", async () => {
    __resetFlagshipCache();
    const broken = {
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve({ data: null, error: { message: "no such table" } }),
        }),
      }),
    };
    const map = await loadFlagshipMap(broken);
    expect(map.size).toBe(0);
  });

  it("valid rows load; confident:false rows are skipped", async () => {
    __resetFlagshipCache();
    const fake = {
      from: () => ({
        select: () => ({
          limit: () =>
            Promise.resolve({
              data: [
                { brand_key: "Malibu", alias_terms: ["MALIBU", "coconut"], confident: true },
                { brand_key: "shaky", alias_terms: ["shaky", "guess"], confident: false },
                { brand_key: "", alias_terms: ["x"], confident: true },
                { brand_key: "noterms", alias_terms: [], confident: true },
              ],
              error: null,
            }),
        }),
      }),
    };
    const map = await loadFlagshipMap(fake);
    expect(map.get("malibu")).toEqual(["malibu", "coconut"]);
    expect(map.has("shaky")).toBe(false);
    expect(map.size).toBe(1);
    __resetFlagshipCache();
  });
});
