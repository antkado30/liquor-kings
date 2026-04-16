import { describe, it, expect } from "vitest";
import {
  deriveProposedFixFromBlockingHint,
  toProposedFixCandidateOption,
} from "../src/mlcc/mlcc-blocking-hint-proposed-fix.js";

const cand = (id, code = "2458") => ({
  mlcc_item_id: id,
  code,
  brand_name: "B",
  size: "750",
  proof: "40",
  pack: null,
});

describe("deriveProposedFixFromBlockingHint", () => {
  it("blank_code → manual_review_required", () => {
    expect(
      deriveProposedFixFromBlockingHint({
        hint_status: "blank_code",
        candidates: [],
      }),
    ).toEqual({
      action: "manual_review_required",
      reason_code: "blank_code",
      suggested_mlcc_item_id: null,
      auto_selectable: false,
    });
  });

  it("bad_code_format → manual_review_required", () => {
    expect(
      deriveProposedFixFromBlockingHint({
        hint_status: "bad_code_format",
        candidates: [],
      }),
    ).toEqual({
      action: "manual_review_required",
      reason_code: "bad_code_format",
      suggested_mlcc_item_id: null,
      auto_selectable: false,
    });
  });

  it("no_catalog_match → manual_review_required", () => {
    expect(
      deriveProposedFixFromBlockingHint({
        hint_status: "no_catalog_match",
        candidates: [],
      }),
    ).toEqual({
      action: "manual_review_required",
      reason_code: "no_catalog_match",
      suggested_mlcc_item_id: null,
      auto_selectable: false,
    });
  });

  it("exact_catalog_match_found with one candidate → confirm_single_candidate", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const c = cand(id);
    expect(
      deriveProposedFixFromBlockingHint({
        hint_status: "exact_catalog_match_found",
        candidate_count: 1,
        candidates: [c],
      }),
    ).toEqual({
      action: "confirm_single_candidate",
      reason_code: "exact_catalog_match_found",
      suggested_mlcc_item_id: id,
      candidate_options: [toProposedFixCandidateOption(c)],
      auto_selectable: true,
    });
  });

  it("exact_catalog_match_found but zero candidates → manual_review", () => {
    expect(
      deriveProposedFixFromBlockingHint({
        hint_status: "exact_catalog_match_found",
        candidate_count: 1,
        candidates: [],
      }),
    ).toEqual({
      action: "manual_review_required",
      reason_code: "exact_catalog_match_found",
      suggested_mlcc_item_id: null,
      auto_selectable: false,
    });
  });

  it("multiple_catalog_matches → operator_must_choose_candidate with options", () => {
    const c0 = cand("00000000-0000-4000-8000-000000000001");
    const c1 = cand("00000000-0000-4000-8000-000000000002");
    const out = deriveProposedFixFromBlockingHint({
      hint_status: "multiple_catalog_matches",
      candidate_count: 2,
      candidates: [c0, c1],
    });
    expect(out).toEqual({
      action: "operator_must_choose_candidate",
      reason_code: "multiple_catalog_matches",
      suggested_mlcc_item_id: null,
      candidate_options: [toProposedFixCandidateOption(c0), toProposedFixCandidateOption(c1)],
      auto_selectable: false,
    });
  });

  it("caps candidate_options at 5 with stable order", () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      cand(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, String(9000 + i)),
    );
    const out = deriveProposedFixFromBlockingHint({
      hint_status: "multiple_catalog_matches",
      candidate_count: 7,
      candidates: many,
    });
    expect(out.candidate_options.length).toBe(5);
    expect(out.candidate_options[0].mlcc_item_id).toBe(many[0].mlcc_item_id);
    expect(out.candidate_options[4].mlcc_item_id).toBe(many[4].mlcc_item_id);
  });

  it("unknown hint_status → manual_review with reason_code", () => {
    expect(
      deriveProposedFixFromBlockingHint({ hint_status: "weird", candidates: [] }),
    ).toEqual({
      action: "manual_review_required",
      reason_code: "weird",
      suggested_mlcc_item_id: null,
      auto_selectable: false,
    });
  });

  it("empty hint_status → unknown_hint_status", () => {
    expect(deriveProposedFixFromBlockingHint({ candidates: [] })).toMatchObject({
      reason_code: "unknown_hint_status",
    });
  });
});

describe("toProposedFixCandidateOption", () => {
  it("coerces types", () => {
    expect(
      toProposedFixCandidateOption({
        mlcc_item_id: 1,
        code: 2458,
        brand_name: "X",
        size: null,
        proof: null,
        pack: undefined,
      }),
    ).toEqual({
      mlcc_item_id: "1",
      code: "2458",
      brand_name: "X",
      size: null,
      proof: null,
      pack: null,
    });
  });
});
