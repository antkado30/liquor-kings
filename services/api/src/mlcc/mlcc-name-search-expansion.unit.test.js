import { describe, expect, it } from "vitest";
import { expandMlccNameForImageSearch } from "./mlcc-name-search-expansion.js";

/*
  Pins for the 2026-07-14 recall fix — every case is a REAL catalog name
  that ended noMatch (or nearly) under raw-token search. The variant-guard
  case is the important one: before expansion, a page saying "Peppermint"
  was REJECTED for "ARROW PPRMNT SCHNAPPS" as a wrong flavor.
*/

describe("expandMlccNameForImageSearch", () => {
  it("expands flavor/style abbreviations the internet never uses", () => {
    expect(expandMlccNameForImageSearch("ARROW PPRMNT SCHNAPPS PL")).toBe(
      "ARROW PEPPERMINT SCHNAPPS",
    );
    expect(expandMlccNameForImageSearch("MAKER'S MARK BBN PL")).toBe("MAKER'S MARK BOURBON");
    expect(expandMlccNameForImageSearch("WOODFORD RESERVE BBN")).toBe("WOODFORD RESERVE BOURBON");
  });

  it("expands the J DANIELS house abbreviation", () => {
    expect(expandMlccNameForImageSearch("J DANIELS OLD 7 BLACK (TN)")).toBe(
      "JACK DANIELS OLD 7 BLACK",
    );
    expect(expandMlccNameForImageSearch("J DANIELS TENNESSEE HONEY PL")).toBe(
      "JACK DANIELS TENNESSEE HONEY",
    );
  });

  it("drops parenthesized origin tags", () => {
    expect(expandMlccNameForImageSearch("LUKSUSOWA 80 (POL)")).toBe("LUKSUSOWA 80");
    expect(expandMlccNameForImageSearch("BACARDI SUPERIOR (P R)")).toBe("BACARDI SUPERIOR");
    expect(expandMlccNameForImageSearch("KETEL ONE (HOL)")).toBe("KETEL ONE");
    expect(expandMlccNameForImageSearch("GRAND MARNIER (FR)")).toBe("GRAND MARNIER");
  });

  it("strips container/pack noise but PRESERVES every numeric token", () => {
    expect(expandMlccNameForImageSearch("SMIRNOFF 90.4 PL")).toBe("SMIRNOFF 90.4");
    expect(expandMlccNameForImageSearch("FIREBALL CINNAMON PL")).toBe("FIREBALL CINNAMON");
    expect(expandMlccNameForImageSearch("1800 BLANCO")).toBe("1800 BLANCO");
    expect(expandMlccNameForImageSearch("PLATINUM 7X PL")).toBe("PLATINUM 7X");
  });

  it("turns W/ into WITH (combo names)", () => {
    expect(expandMlccNameForImageSearch("CASAMIGOS BLANCO W/2 GLASSES")).toBe(
      "CASAMIGOS BLANCO WITH 2 GLASSES",
    );
  });

  it("leaves clean names alone", () => {
    expect(expandMlccNameForImageSearch("TITO'S HANDMADE VODKA")).toBe("TITO'S HANDMADE VODKA");
    expect(expandMlccNameForImageSearch("DON JULIO 1942")).toBe("DON JULIO 1942");
  });

  it("is idempotent — expanding an expanded name changes nothing", () => {
    const once = expandMlccNameForImageSearch("J DANIELS OLD 7 BLACK (TN) PL");
    expect(expandMlccNameForImageSearch(once)).toBe(once);
  });

  it("empty/garbage input returns empty string, never throws", () => {
    expect(expandMlccNameForImageSearch(null)).toBe("");
    expect(expandMlccNameForImageSearch("   ")).toBe("");
  });
});
