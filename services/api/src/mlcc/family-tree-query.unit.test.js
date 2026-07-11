/**
 * Adversarial unit tests for family-tree-query — the pure decision layer
 * behind the /items/:code/family family_key fast path (2026-07-11).
 *
 * Fixtures mirror the REAL mlcc_items row shape (code, ada_number, name,
 * family_key, container, pack_count, is_combo, bottle_size_ml, is_active…)
 * — never invented shapes (2026-07-08 run_type lesson).
 */
import { describe, it, expect } from "vitest";
import {
  escapeLikePattern,
  pickComboPrefixFallbackKey,
  familyMembersFromRows,
  familyHasMixedContainers,
  groupRowsIntoFamilies,
  COMBO_PREFIX_FALLBACK_MIN_LEN,
} from "./family-tree-query.js";

/** Real-shape mlcc_items row (subset the helpers touch + realistic extras). */
function makeRow(overrides = {}) {
  return {
    id: `row-${Math.random().toString(36).slice(2, 8)}`,
    code: "1505",
    ada_number: "141",
    ada_name: "NWS Michigan, Inc.",
    name: "JACK DANIELS OLD 7 PT",
    family_key: "JACK DANIELS OLD 7",
    container: "glass",
    pack_count: null,
    is_combo: false,
    bottle_size_ml: 375,
    bottle_size_label: "375 ML",
    category: "Whiskey",
    is_active: true,
    licensee_price: 12.5,
    ...overrides,
  };
}

describe("escapeLikePattern", () => {
  it("escapes %, _ and backslash so they match literally", () => {
    expect(escapeLikePattern("100% AGAVE")).toBe("100\\% AGAVE");
    expect(escapeLikePattern("A_B")).toBe("A\\_B");
    expect(escapeLikePattern("A\\B")).toBe("A\\\\B");
    // Backslash escaped FIRST — an input "%\\" can't double-escape.
    expect(escapeLikePattern("%\\_")).toBe("\\%\\\\\\_");
  });

  it("passes apostrophes and plain text through untouched", () => {
    expect(escapeLikePattern("TITO'S HANDMADE VODKA")).toBe(
      "TITO'S HANDMADE VODKA",
    );
  });

  it("stringifies null/undefined to empty", () => {
    expect(escapeLikePattern(null)).toBe("");
    expect(escapeLikePattern(undefined)).toBe("");
  });
});

describe("pickComboPrefixFallbackKey", () => {
  const anchorKey = "TITO'S HANDMADE VODK"; // truncated by MLCC

  it("adopts the key when EXACTLY ONE distinct candidate exists", () => {
    expect(
      pickComboPrefixFallbackKey(anchorKey, [
        "TITO'S HANDMADE VODKA",
        "TITO'S HANDMADE VODKA", // duplicate rows of the same key are fine
      ]),
    ).toBe("TITO'S HANDMADE VODKA");
  });

  it("returns null when candidates are ambiguous (2+ distinct keys) — never guess a family", () => {
    expect(
      pickComboPrefixFallbackKey(anchorKey, [
        "TITO'S HANDMADE VODKA",
        "TITO'S HANDMADE VODKA GIFT",
      ]),
    ).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    expect(pickComboPrefixFallbackKey(anchorKey, [])).toBeNull();
    expect(pickComboPrefixFallbackKey(anchorKey, [null, undefined, ""])).toBeNull();
  });

  it("ignores the anchor's own key echoed back", () => {
    expect(pickComboPrefixFallbackKey(anchorKey, [anchorKey])).toBeNull();
    expect(
      pickComboPrefixFallbackKey(anchorKey, [anchorKey, "TITO'S HANDMADE VODKA"]),
    ).toBe("TITO'S HANDMADE VODKA");
  });

  it("refuses short anchor keys (would prefix-match half the catalog)", () => {
    const short = "E&J BRAND"; // 9 chars < min
    expect(short.length).toBeLessThan(COMBO_PREFIX_FALLBACK_MIN_LEN);
    expect(pickComboPrefixFallbackKey(short, ["E&J BRANDY"])).toBeNull();
  });

  it("drops candidates that don't actually start with the anchor key (defense vs sloppy caller)", () => {
    expect(
      pickComboPrefixFallbackKey(anchorKey, ["SMIRNOFF VODKA 80"]),
    ).toBeNull();
  });
});

describe("familyMembersFromRows", () => {
  it("collapses the same code under multiple ADAs to ONE chip (lowest ada_number wins)", () => {
    const anchor = makeRow({ code: "1505", ada_number: "141" });
    const rows = [
      makeRow({ code: "1505", ada_number: "321", id: "dup-ada" }),
      makeRow({ code: "1506", ada_number: "321", bottle_size_ml: 750 }),
      makeRow({ code: "1506", ada_number: "141", bottle_size_ml: 750, id: "keep-141" }),
    ];
    const members = familyMembersFromRows(anchor, rows);
    expect(members.map((m) => m.code)).toEqual(["1505", "1506"]);
    const chip1506 = members.find((m) => m.code === "1506");
    expect(chip1506.ada_number).toBe("141");
  });

  it("drops NON-anchor combo rows but keeps a combo ANCHOR (anchor-only combo policy)", () => {
    const comboAnchor = makeRow({
      code: "9001",
      name: "CASAMIGOS BLANCO W/50ML REPO",
      is_combo: true,
      bottle_size_ml: 750,
    });
    const rows = [
      makeRow({ code: "9002", is_combo: true, bottle_size_ml: 750, name: "OTHER GIFT W/GLASS" }),
      makeRow({ code: "1000", is_combo: false, bottle_size_ml: 375 }),
    ];
    const members = familyMembersFromRows(comboAnchor, rows);
    expect(members.map((m) => m.code).sort()).toEqual(["1000", "9001"]);
  });

  it("always includes the anchor even when the fetched rows miss it (e.g. inactive anchor)", () => {
    const inactiveAnchor = makeRow({ code: "777", is_active: false, bottle_size_ml: 1750 });
    const rows = [makeRow({ code: "778", bottle_size_ml: 750 })];
    const members = familyMembersFromRows(inactiveAnchor, rows);
    expect(members.map((m) => m.code)).toEqual(["778", "777"]); // sorted by size
  });

  it("anchor row wins the dedupe for its own code over an ADA twin", () => {
    const anchor = makeRow({ code: "1505", ada_number: "321", id: "anchor-id" });
    const rows = [makeRow({ code: "1505", ada_number: "141", id: "twin-id" })];
    const members = familyMembersFromRows(anchor, rows);
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("anchor-id");
  });

  it("sorts by bottle_size_ml ascending, tolerating null sizes", () => {
    const anchor = makeRow({ code: "a", bottle_size_ml: 750 });
    const rows = [
      makeRow({ code: "b", bottle_size_ml: null }),
      makeRow({ code: "c", bottle_size_ml: 50 }),
      makeRow({ code: "d", bottle_size_ml: 1750 }),
    ];
    expect(familyMembersFromRows(anchor, rows).map((m) => m.code)).toEqual([
      "b", "c", "a", "d",
    ]);
  });

  it("survives garbage rows (missing code, null row) without throwing", () => {
    const anchor = makeRow({ code: "1" });
    const members = familyMembersFromRows(anchor, [
      null,
      {},
      makeRow({ code: "" }),
      makeRow({ code: "2", bottle_size_ml: 200 }),
    ]);
    expect(members.map((m) => m.code)).toEqual(["2", "1"]);
  });
});

describe("familyHasMixedContainers", () => {
  it("true for glass + plastic in one family (the 527-family class)", () => {
    expect(
      familyHasMixedContainers([
        makeRow({ container: "glass" }),
        makeRow({ container: "plastic" }),
      ]),
    ).toBe(true);
  });

  it("false when every member is the same material", () => {
    expect(
      familyHasMixedContainers([
        makeRow({ container: "glass" }),
        makeRow({ container: "glass" }),
      ]),
    ).toBe(false);
  });

  it("treats NULL/empty container as glass (engine default)", () => {
    expect(
      familyHasMixedContainers([
        makeRow({ container: null }),
        makeRow({ container: "glass" }),
      ]),
    ).toBe(false);
    expect(
      familyHasMixedContainers([
        makeRow({ container: null }),
        makeRow({ container: "plastic" }),
      ]),
    ).toBe(true);
  });

  it("empty family → false", () => {
    expect(familyHasMixedContainers([])).toBe(false);
    expect(familyHasMixedContainers(null)).toBe(false);
  });
});

describe("groupRowsIntoFamilies (grouped search, plan §C)", () => {
  it("collapses a family's sizes into ONE card with count, price range, and first-seen representative", () => {
    const rows = [
      makeRow({ code: "5701", family_key: "TITOS HANDMADE VODKA", bottle_size_ml: 750, licensee_price: 19.99, name: "TITOS HANDMADE VODKA 750ML" }),
      makeRow({ code: "5702", family_key: "TITOS HANDMADE VODKA", bottle_size_ml: 1750, licensee_price: 34.99, name: "TITOS HANDMADE VODKA 1750ML" }),
      makeRow({ code: "5700", family_key: "TITOS HANDMADE VODKA", bottle_size_ml: 50, licensee_price: 1.99, name: "TITOS HANDMADE VODKA 50ML" }),
    ];
    const groups = groupRowsIntoFamilies(rows);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.baseName).toBe("TITOS HANDMADE VODKA");
    expect(g.sizeCount).toBe(3);
    expect(g.minPrice).toBe(1.99);
    expect(g.maxPrice).toBe(34.99);
    expect(g.representative.code).toBe("5701"); // first seen = most relevant
    expect(g.isCombo).toBe(false);
  });

  it("keeps relevance order between groups (first-seen order)", () => {
    const rows = [
      makeRow({ code: "1", family_key: "JACK DANIELS OLD 7" }),
      makeRow({ code: "9", family_key: "JACK DANIELS HONEY" }),
      makeRow({ code: "2", family_key: "JACK DANIELS OLD 7" }),
    ];
    const groups = groupRowsIntoFamilies(rows);
    expect(groups.map((g) => g.familyKey)).toEqual([
      "JACK DANIELS OLD 7",
      "JACK DANIELS HONEY",
    ]);
  });

  it("same key in DIFFERENT categories stays two cards (the ~20 cross-category keys)", () => {
    const rows = [
      makeRow({ code: "1", family_key: "SAME KEY", category: "Whiskey" }),
      makeRow({ code: "2", family_key: "SAME KEY", category: "Cordials" }),
    ];
    expect(groupRowsIntoFamilies(rows)).toHaveLength(2);
  });

  it("a COMBO row is its own singleton card with its REAL name — never folded into the base family", () => {
    const rows = [
      makeRow({ code: "100", family_key: "CASAMIGOS BLANCO", bottle_size_ml: 750 }),
      makeRow({
        code: "900",
        family_key: "CASAMIGOS BLANCO",
        is_combo: true,
        name: "CASAMIGOS BLANCO W/50ML REPO",
        licensee_price: 45,
      }),
    ];
    const groups = groupRowsIntoFamilies(rows);
    expect(groups).toHaveLength(2);
    const combo = groups.find((g) => g.isCombo);
    expect(combo.baseName).toBe("CASAMIGOS BLANCO W/50ML REPO");
    expect(combo.sizeCount).toBe(1);
    const fam = groups.find((g) => !g.isCombo);
    expect(fam.sizeCount).toBe(1); // combo not counted into the family card
  });

  it("rows with NO family_key become singleton cards keyed by code — never dropped", () => {
    const rows = [
      makeRow({ code: "42", family_key: null, name: "BRAND NEW SKU 750ML" }),
      makeRow({ code: "43", family_key: "", name: "OTHER NEW SKU 750ML" }),
    ];
    const groups = groupRowsIntoFamilies(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].baseName).toBe("BRAND NEW SKU 750ML"); // falls back to row name
  });

  it("mixed containers flagged on the family card; null prices ignored in the range", () => {
    const rows = [
      makeRow({ code: "1", family_key: "K", container: "glass", licensee_price: 10 }),
      makeRow({ code: "2", family_key: "K", container: "plastic", licensee_price: null }),
    ];
    const g = groupRowsIntoFamilies(rows)[0];
    expect(g.mixedContainers).toBe(true);
    expect(g.minPrice).toBe(10);
    expect(g.maxPrice).toBe(10);
  });

  it("duplicate codes (ADA twins) count once in sizeCount", () => {
    const rows = [
      makeRow({ code: "7", family_key: "K", ada_number: "141" }),
      makeRow({ code: "7", family_key: "K", ada_number: "321" }),
    ];
    expect(groupRowsIntoFamilies(rows)[0].sizeCount).toBe(1);
  });

  it("survives garbage input", () => {
    expect(groupRowsIntoFamilies(null)).toEqual([]);
    expect(groupRowsIntoFamilies([null, {}, makeRow({ code: "" })])).toEqual([]);
  });
});
