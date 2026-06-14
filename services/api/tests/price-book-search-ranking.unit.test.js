/**
 * Unit tests for the search-ranking heuristic added 2026-06-13 in response
 * to Tony's "Jack Daniels search shows the wrong bottle first" complaint.
 *
 * Background: orderMlccItemsByScanThenName orders by scan_count desc, then
 * name asc. Pre-launch, every SKU has scan_count = 0, so ordering falls to
 * pure alphabetical on `name`. MLCC catalog names for flavored line
 * extensions (e.g. "JACK DANIELS APPLE", "...HONEY", "...FIRE") can sort
 * alphabetically ahead of the flagship expression (e.g. "JACK DANIELS OLD
 * #7" / "...BLACK LABEL"), so a brand search surfaces a flavor bottle first
 * instead of the bottle most customers actually mean.
 *
 * sortByRelevance / computeVariantPenalty / VARIANT_KEYWORDS are a bounded
 * cold-start tiebreaker:
 *   1. scan_count desc always wins first (real usage beats the heuristic)
 *   2. flagship (no variant keywords) outranks a variant on a tie
 *   3. a query that itself names a flavor isn't penalized for that word
 *   4. name asc, then code asc as final tiebreakers
 */
import { describe, it, expect } from "vitest";
import {
  sortByRelevance,
  computeVariantPenalty,
  extractSearchTokens,
  VARIANT_KEYWORDS,
} from "../src/routes/price-book.routes.js";

function row(name, { scan_count = 0, code = "0000" } = {}) {
  return { name, scan_count, code };
}

describe("price-book search ranking", () => {
  describe("VARIANT_KEYWORDS / computeVariantPenalty", () => {
    it("flags flavor words not present in the query", () => {
      const tokens = new Set(extractSearchTokens("jack daniels"));
      expect(computeVariantPenalty("JACK DANIELS APPLE", tokens)).toBeGreaterThan(0);
      expect(computeVariantPenalty("JACK DANIELS HONEY", tokens)).toBeGreaterThan(0);
      expect(computeVariantPenalty("JACK DANIELS OLD #7", tokens)).toBe(0);
    });

    it("does not penalize a variant word the user explicitly searched for", () => {
      const tokens = new Set(extractSearchTokens("jack daniels honey"));
      expect(computeVariantPenalty("JACK DANIELS HONEY", tokens)).toBe(0);
    });

    it("sanity-checks a representative sample of the keyword list", () => {
      for (const word of ["apple", "honey", "fire", "peach", "edition"]) {
        expect(VARIANT_KEYWORDS.has(word)).toBe(true);
      }
    });
  });

  describe("sortByRelevance", () => {
    it("surfaces the flagship Jack Daniel's bottle ahead of flavored variants at scan_count 0", () => {
      const rows = [
        row("JACK DANIELS APPLE"),
        row("JACK DANIELS HONEY TENNESSEE"),
        row("JACK DANIELS OLD #7"),
        row("JACK DANIELS FIRE"),
      ];
      const tokens = new Set(extractSearchTokens("jack daniels"));
      const sorted = sortByRelevance(rows, tokens);
      expect(sorted[0].name).toBe("JACK DANIELS OLD #7");
    });

    it("lets real usage (scan_count) override the variant heuristic", () => {
      const rows = [
        row("JACK DANIELS OLD #7", { scan_count: 0 }),
        row("JACK DANIELS APPLE", { scan_count: 5 }),
      ];
      const tokens = new Set(extractSearchTokens("jack daniels"));
      const sorted = sortByRelevance(rows, tokens);
      // Apple has real scans, so it wins despite the variant penalty.
      expect(sorted[0].name).toBe("JACK DANIELS APPLE");
    });

    it("does not penalize a SKU whose query explicitly named the flavor", () => {
      const rows = [
        row("JACK DANIELS OLD #7"),
        row("JACK DANIELS HONEY TENNESSEE"),
      ];
      const tokens = new Set(extractSearchTokens("jack daniels honey"));
      const sorted = sortByRelevance(rows, tokens);
      expect(sorted[0].name).toBe("JACK DANIELS HONEY TENNESSEE");
    });

    it("falls back to name then code when scan_count and variant penalty tie", () => {
      const rows = [
        row("ABSOLUT VODKA", { code: "2000" }),
        row("ABSOLUT VODKA", { code: "1000" }),
      ];
      const tokens = new Set(extractSearchTokens("absolut"));
      const sorted = sortByRelevance(rows, tokens);
      expect(sorted[0].code).toBe("1000");
    });

    it("returns an empty array for null/undefined input without throwing", () => {
      const tokens = new Set();
      expect(sortByRelevance(null, tokens)).toEqual([]);
      expect(sortByRelevance(undefined, tokens)).toEqual([]);
    });
  });
});
