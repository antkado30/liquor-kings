/**
 * ONE MATCHER LAW — vision route (2026-07-26, scanner war phase 2).
 *
 * Pins Tony's screenshot from the Colony floor as executable truth:
 * vision read a plain 50ml Smirnoff correctly ("Smirnoff Vodka", high
 * confidence) and the route's OLD private token-ranker recommended
 * SMIRNOFF SOURS GREEN APPLE anyway — plain and flavored scored the
 * same on brand+size, and a coin flip crowned a flavor. The route now
 * feeds the photo through resolveOrderLine (the same deterministic
 * matcher as AI chat / paste-order / CLI), whose flavor penalty makes
 * the plain bottle win. If someone ever reintroduces a private vision
 * matcher, these tests are the tombstone they have to read first.
 */
import { describe, it, expect } from "vitest";
import { visionLineFromExtracted } from "../src/routes/catalog-vision.routes.js";
import {
  resolveOrderLine,
  scoreCandidate,
  tokenizeName,
} from "../src/lib/resolve-order-lines.js";

/** Chainable supabase stub: every query resolves to the same pool. */
function mockSupabase(rows) {
  return {
    from: () => {
      const q = {
        select: () => q,
        or: () => q,
        ilike: () => q,
        eq: () => q,
        limit: () => Promise.resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
}

const smirnoff = (code, name, over = {}) => ({
  id: `id-${code}`,
  code,
  name,
  ada_number: "141",
  bottle_size_ml: 50,
  bottle_size_label: "50 ML",
  licensee_price: 0.81,
  is_combo: false,
  family_key: `fam-${code}`,
  ...over,
});

// The exact cast from the screenshot + the plain bottle that never showed.
const PLAIN = smirnoff("10022", "SMIRNOFF 80 PL");
const SOURS = smirnoff("11876", "SMIRNOFF SOURS GREEN APPLE PL");
const RWB = smirnoff("20426", "SMIRNOFF RED, WHITE & BERRY PL");
const ROOT_BEER = smirnoff("6447", "SMIRNOFF ROOT BEER", { licensee_price: 1.01 });
const PROOF_100 = smirnoff("10088", "SMIRNOFF 100 PL");

const SCREENSHOT_EXTRACTED = {
  brand: "Smirnoff",
  product_name: "Vodka",
  size_label: "50 mL",
  size_ml: 50,
  confidence: "high",
};

describe("visionLineFromExtracted", () => {
  it("photo becomes a plain order line: brand + product, size, qty 1", () => {
    expect(visionLineFromExtracted(SCREENSHOT_EXTRACTED)).toEqual({
      name: "Smirnoff Vodka",
      sizeMl: 50,
      qty: 1,
      rawText: "Smirnoff Vodka 50 mL",
    });
  });

  it("missing pieces degrade cleanly (brand only, no size)", () => {
    expect(
      visionLineFromExtracted({ brand: "Tito's", product_name: "", size_label: "" }),
    ).toEqual({ name: "Tito's", sizeMl: null, qty: 1, rawText: "Tito's" });
  });

  it("null/garbage extraction never throws", () => {
    expect(visionLineFromExtracted(null).name).toBe("");
    expect(visionLineFromExtracted({}).sizeMl).toBeNull();
  });
});

describe("THE SCREENSHOT PIN — plain Smirnoff must beat its own flavors", () => {
  it("resolver recommends SMIRNOFF 80 PL, flavors become alternates", async () => {
    const supabase = mockSupabase([SOURS, RWB, ROOT_BEER, PLAIN]);
    const r = await resolveOrderLine(supabase, visionLineFromExtracted(SCREENSHOT_EXTRACTED));
    expect(r.best?.name).toBe("SMIRNOFF 80 PL");
    expect(r.alternates.map((a) => a.name)).toContain("SMIRNOFF SOURS GREEN APPLE PL");
    // Clear-margin win over pure flavors → the confident badge is earned.
    expect(r.confidence).toBe("high");
  });

  it("SMIRNOFF 100 in the pool: plain STILL wins (proof-line demotion)", async () => {
    const supabase = mockSupabase([PROOF_100, SOURS, RWB, ROOT_BEER, PLAIN]);
    const r = await resolveOrderLine(supabase, visionLineFromExtracted(SCREENSHOT_EXTRACTED));
    expect(r.best?.name).toBe("SMIRNOFF 80 PL");
  });

  it("ROOT BEER is a flavor, not a brevity contest (2026-07-26 corpus add)", () => {
    const terms = tokenizeName("Smirnoff Vodka");
    const plainScore = scoreCandidate(PLAIN.name, terms, null, { row: PLAIN, rawText: "smirnoff vodka 50 ml" });
    const rootBeerScore = scoreCandidate(ROOT_BEER.name, terms, null, { row: ROOT_BEER, rawText: "smirnoff vodka 50 ml" });
    // The compound "root beer" flavor penalty (100) must dominate — before
    // the corpus add, plain won by a 4-character brevity coin flip.
    expect(rootBeerScore - plainScore).toBeGreaterThanOrEqual(90);
  });

  it("but a flavor the user ASKED for is not penalized (green apple photo)", async () => {
    const supabase = mockSupabase([SOURS, RWB, ROOT_BEER, PLAIN]);
    const r = await resolveOrderLine(supabase, visionLineFromExtracted({
      brand: "Smirnoff",
      product_name: "Sours Green Apple",
      size_label: "50 mL",
      size_ml: 50,
      confidence: "high",
    }));
    expect(r.best?.name).toBe("SMIRNOFF SOURS GREEN APPLE PL");
  });
});
