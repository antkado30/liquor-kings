import { describe, it, expect } from "vitest";
import {
  MLCC_HINT_CANDIDATE_CAP,
  buildMlccBlockingHintRow,
  buildMlccBlockingHintsFromReadinessAndItems,
  classifyCatalogHintForNormalizedCode,
  mapMlccItemRowToCandidate,
  normalizeMlccCodeForHints,
} from "../src/mlcc/mlcc-blocking-hints.service.js";

describe("normalizeMlccCodeForHints", () => {
  it("trims and maps blank to null", () => {
    expect(normalizeMlccCodeForHints("  2458  ")).toBe("2458");
    expect(normalizeMlccCodeForHints("   ")).toBe(null);
    expect(normalizeMlccCodeForHints(null)).toBe(null);
  });
});

describe("classifyCatalogHintForNormalizedCode", () => {
  it("blank_code", () => {
    expect(classifyCatalogHintForNormalizedCode({ normalizedCode: null, catalogRows: [] })).toEqual({
      hint_status: "blank_code",
      candidate_count: 0,
      candidates: [],
    });
  });

  it("bad_code_format", () => {
    expect(
      classifyCatalogHintForNormalizedCode({
        normalizedCode: "12!!34",
        catalogRows: [],
      }),
    ).toMatchObject({ hint_status: "bad_code_format", candidate_count: 0, candidates: [] });
  });

  it("no_catalog_match", () => {
    expect(
      classifyCatalogHintForNormalizedCode({
        normalizedCode: "2458",
        catalogRows: [],
      }),
    ).toEqual({
      hint_status: "no_catalog_match",
      candidate_count: 0,
      candidates: [],
    });
  });

  it("exact_catalog_match_found", () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      code: "2458",
      name: "Test Brand",
      size_ml: 750,
      abv: 40,
      mlcc_item_no: "n1",
    };
    const out = classifyCatalogHintForNormalizedCode({
      normalizedCode: "2458",
      catalogRows: [row],
    });
    expect(out.hint_status).toBe("exact_catalog_match_found");
    expect(out.candidate_count).toBe(1);
    expect(out.candidates).toEqual([mapMlccItemRowToCandidate(row)]);
  });

  it("multiple_catalog_matches and caps candidates", () => {
    const rows = Array.from({ length: MLCC_HINT_CANDIDATE_CAP + 2 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      code: "2458",
      name: `N${i}`,
      size_ml: 750,
      abv: null,
      mlcc_item_no: `no-${i}`,
    }));
    const out = classifyCatalogHintForNormalizedCode({
      normalizedCode: "2458",
      catalogRows: rows,
    });
    expect(out.hint_status).toBe("multiple_catalog_matches");
    expect(out.candidate_count).toBe(rows.length);
    expect(out.candidates.length).toBe(MLCC_HINT_CANDIDATE_CAP);
  });
});

describe("buildMlccBlockingHintsFromReadinessAndItems", () => {
  const itemRow = {
    id: "cart-item-1",
    bottle_id: "bottle-1",
    bottles: { id: "bottle-1", name: "Bottle A", mlcc_code: "2458" },
  };

  it("skips non-missing reasons and builds hints for missing lines", () => {
    const readiness = {
      blocking_lines: [
        { cartItemId: "cart-item-1", bottleId: "bottle-1", reason: "missing_mlcc_item_id" },
        { cartItemId: "x", bottleId: "y", reason: "other" },
      ],
    };
    const catalogRow = {
      id: "11111111-1111-1111-1111-111111111111",
      code: "2458",
      name: "Cat",
      size_ml: 750,
      abv: null,
      mlcc_item_no: "1",
    };
    const hints = buildMlccBlockingHintsFromReadinessAndItems({
      readiness,
      items: [itemRow],
      catalogRows: [catalogRow],
    });
    expect(hints).toHaveLength(1);
    expect(hints[0].hint_status).toBe("exact_catalog_match_found");
    expect(hints[0].cart_item_id).toBe("cart-item-1");
    expect(hints[0].bottle_name).toBe("Bottle A");
    expect(hints[0].proposed_fix).toMatchObject({
      action: "confirm_single_candidate",
      reason_code: "exact_catalog_match_found",
      suggested_mlcc_item_id: catalogRow.id,
      auto_selectable: true,
    });
    expect(hints[0].proposed_fix.candidate_options).toHaveLength(1);
  });
});

describe("buildMlccBlockingHintRow", () => {
  it("uses catalogByCode bucket", () => {
    const map = new Map([
      [
        "8000",
        [
          {
            id: "a",
            code: "8000",
            name: "X",
            size_ml: null,
            abv: null,
            mlcc_item_no: "1",
          },
        ],
      ],
    ]);
    const hint = buildMlccBlockingHintRow({
      line: { cartItemId: "ci", bottleId: "bi", reason: "missing_mlcc_item_id" },
      cartItemRow: {
        id: "ci",
        bottles: { name: "N", mlcc_code: "8000" },
      },
      catalogByCode: map,
    });
    expect(hint.normalized_mlcc_code).toBe("8000");
    expect(hint.hint_status).toBe("exact_catalog_match_found");
    expect(hint.proposed_fix.action).toBe("confirm_single_candidate");
    expect(hint.proposed_fix.suggested_mlcc_item_id).toBe("a");
  });
});
