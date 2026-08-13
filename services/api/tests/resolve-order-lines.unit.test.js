import { describe, it, expect } from "vitest";
import {
  sizeFromText,
  preferFromText,
  tokenizeName,
  scoreCandidate,
  preciseTermSets,
  fallbackTermSets,
  termCoverage,
} from "../src/lib/resolve-order-lines.js";

describe("sizeFromText", () => {
  it("maps liquor size slang to ml", () => {
    expect(sizeFromText("Crown Royal Apple fifth")).toBe(750);
    expect(sizeFromText("1/2 gallon")).toBe(1750);
    expect(sizeFromText("half gallon")).toBe(1750);
    expect(sizeFromText("1.75")).toBe(1750);
    expect(sizeFromText("pint")).toBe(375);
    expect(sizeFromText("1/2 pint of jack")).toBe(200);
    expect(sizeFromText("750 ml")).toBe(750);
    expect(sizeFromText("liter")).toBe(1000);
  });
  it("prefers the more specific half-pint over pint", () => {
    // 'half pint' must not be swallowed by the 'pint' rule.
    expect(sizeFromText("half pint")).toBe(200);
  });
  it("returns null when no size is present", () => {
    expect(sizeFromText("just a brand name")).toBeNull();
  });
});

describe("preferFromText", () => {
  it("detects plastic vs glass intent", () => {
    expect(preferFromText("Smirnoff plastic 1/2 gallon")).toBe("plastic");
    expect(preferFromText("glass jim beam fifth")).toBe("glass");
    expect(preferFromText("Tito's 1/2 gallon")).toBeNull();
  });
});

describe("tokenizeName", () => {
  it("keeps brand identity + brand/proof numbers, drops sizes & packaging", () => {
    expect(tokenizeName("CROWN ROYAL REGAL APPLE")).toEqual([
      "crown",
      "royal",
      "regal",
      "apple",
    ]);
    // 'PL' (plastic) dropped; proof/brand numbers KEPT; bottle sizes dropped.
    expect(tokenizeName("SMIRNOFF 80 PL")).toEqual(["smirnoff", "80"]);
    expect(tokenizeName("JIM BEAM PL")).toEqual(["jim", "beam"]);
    expect(tokenizeName("1792 SINGLE BARREL")).toEqual(["1792", "single", "barrel"]);
    expect(tokenizeName("1800 REPOSADO 750 ML")).toEqual(["1800", "reposado"]);
  });
  it("handles apostrophes (the Tito's bug)", () => {
    expect(tokenizeName("TITO'S HANDMADE VODKA")).toEqual([
      "tito",
      "handmade",
      "vodka",
    ]);
  });
});

describe("preciseTermSets (merged precise search)", () => {
  it("includes the strict terms AND the brand-lead-as-initial (jack -> j)", () => {
    // 'Jack Daniel's' standard is 'J DANIELS'; flavors are 'JACK DANIEL'S ...'.
    // Searching both ['jack','daniels'] and ['j','daniels'] then merging puts
    // the standard in the pool next to the flavors.
    expect(preciseTermSets(["jack", "daniels"])).toEqual([
      ["jack", "daniels"],
      ["j", "daniels"],
    ]);
  });
  it("does NOT expand when the rest is only generic (tito vodka)", () => {
    // ['tito','vodka'] must NOT become [['tito','vodka'],['t','vodka']] — that
    // would flood the pool with every vodka (the ATWATER bug).
    expect(preciseTermSets(["tito", "vodka"])).toEqual([["tito", "vodka"]]);
  });
  it("a single term has just itself (no initial variant)", () => {
    expect(preciseTermSets(["belvedere"])).toEqual([["belvedere"]]);
  });
});

describe("fallbackTermSets (only used if precise finds nothing)", () => {
  it("drops the brand lead, then the longest token", () => {
    expect(fallbackTermSets(["jack", "daniels"])).toEqual([
      ["daniels"],
      ["daniels"],
    ]);
  });
  it("a single long term falls back to its own 5-char prefix ONLY (2026-07-23 typo tolerance)", () => {
    // Changed 2026-07-23: was [] ("no fallback for single terms" — the intent
    // was avoiding CROSS-BRAND noise). A prefix of the SAME brand is not
    // cross-brand noise; it's what rescues a typo'd lone brand ("Glenfidich").
    expect(fallbackTermSets(["belvedere"])).toEqual([["belve"]]);
    // Short single terms still get no fallback — a prefix of a 5-char word
    // would be pure noise.
    expect(fallbackTermSets(["skyy"])).toEqual([]);
  });
});

describe("scoreCandidate (lower = better)", () => {
  it("rejects a cross-brand match missing the brand anchor (ATWATER for Tito's)", () => {
    const terms = ["tito", "vodka"];
    expect(scoreCandidate("TITO'S HANDMADE VODKA", terms, null)).toBeLessThan(
      scoreCandidate("ATWATER VODKA", terms, null),
    );
  });
  it("requires distinctive brand words — descriptor collisions lose", () => {
    // "fris proof" must beat "1792 FULL PROOF" (missing the brand 'fris').
    const terms = ["fris", "proof"];
    expect(scoreCandidate("FRIS VODKA 100 PROOF", terms, null)).toBeLessThan(
      scoreCandidate("1792 FULL PROOF", terms, null),
    );
  });
  it("ranks the standard bottle above aged / variety expressions", () => {
    const terms = ["jack", "daniels"];
    const standard = scoreCandidate("J DANIELS OLD 7 BLACK", terms, null);
    expect(standard).toBeLessThan(scoreCandidate("JACK DANIELS-10 YR", terms, null));
    expect(standard).toBeLessThan(scoreCandidate("J DANIELS VARIETY PL", terms, null));
  });
  it("a correct brand that's aged beats a DIFFERENT brand (kirkland)", () => {
    const terms = ["kirkland", "canadian"];
    expect(scoreCandidate("KIRKLAND CANADIAN WHISKEY-6 YR", terms, null)).toBeLessThan(
      scoreCandidate("CANADIAN LAKE WHISKY", terms, null),
    );
  });
  it("respects an explicitly-typed age (rebel 10 → the 10yr, not the 100)", () => {
    const terms = ["rebel", "10"];
    expect(scoreCandidate("REBEL-10 YR", terms, null)).toBeLessThan(
      scoreCandidate("REBEL STRAIGHT RYE 100", terms, null),
    );
  });
  it("ranks the plain product above flavored line-extensions", () => {
    const terms = ["svedka"];
    const plain = scoreCandidate("SVEDKA 80", terms, null);
    const banana = scoreCandidate("SVEDKA BANANA", terms, null);
    const raspberry = scoreCandidate("SVEDKA RASPBERRY", terms, null);
    expect(plain).toBeLessThan(banana);
    expect(plain).toBeLessThan(raspberry);
  });
  it("does NOT penalize a flavor the user explicitly asked for", () => {
    const terms = ["crown", "royal", "apple"];
    // 'apple' is requested, so 'REGAL APPLE' isn't penalized for it.
    const regalApple = scoreCandidate("CROWN ROYAL REGAL APPLE", terms, null);
    const peach = scoreCandidate("CROWN ROYAL PEACH", terms, null);
    expect(regalApple).toBeLessThan(peach);
  });
  it("ranks the base bottle above a premium/limited edition", () => {
    const terms = ["crown", "royal"];
    const plain = scoreCandidate("CROWN ROYAL", terms, null);
    const reserve = scoreCandidate("CROWN ROYAL RESERVE-12 YR", terms, null);
    expect(plain).toBeLessThan(reserve);
  });
  it("prefers the named category within a brand (McCormick Vodka vs Gin)", () => {
    const terms = ["mccormick", "vodka"];
    expect(scoreCandidate("MCCORMICK VODKA PL", terms, null)).toBeLessThan(
      scoreCandidate("MCCORMICK GIN", terms, null),
    );
  });
  it("does not false-trigger category conflict on substrings (gin in VIRGINIA)", () => {
    // 'gin' inside 'VIRGINIA' must NOT count as a gin category for a vodka query.
    const terms = ["virginia", "black"];
    const noConflict = scoreCandidate("VIRGINIA BLACK", terms, null);
    expect(noConflict).toBeLessThan(500); // no +50 conflict, no +1000 anything
  });
  it("respects glass vs plastic preference", () => {
    const terms = ["jim", "beam"];
    const glassWantsPlastic = scoreCandidate("JIM BEAM", terms, "plastic");
    const plWantsPlastic = scoreCandidate("JIM BEAM PL", terms, "plastic");
    expect(plWantsPlastic).toBeLessThan(glassWantsPlastic);

    const glassWantsGlass = scoreCandidate("JIM BEAM", terms, "glass");
    const plWantsGlass = scoreCandidate("JIM BEAM PL", terms, "glass");
    expect(glassWantsGlass).toBeLessThan(plWantsGlass);
  });
});

/*
 * ── 2026-07-23 CORPUS PINS — Tony's real weekly list, live-card misses ──
 * Every case below was a CONFIRMED wrong answer on order night (see
 * docs/lk/assistant-resolver-corpus-2026-07-23.md). These pins make each
 * one structurally impossible to regress.
 */
import {
  applyFlagshipAlias,
  applyBrandSynonyms,
  FLAGSHIP_ALIASES,
  BRAND_SYNONYMS,
  resolveOrderLine,
} from "../src/lib/resolve-order-lines.js";

describe("sizeFromText — 2026-07-23 additions", () => {
  it("maps 'double shot' to 100ml (Tony's register vocabulary)", () => {
    expect(sizeFromText("Tito's double shot x case")).toBe(100);
    expect(sizeFromText("double shot fireball")).toBe(100);
    expect(sizeFromText("100 ml")).toBe(100);
  });
  it("does not confuse double shot with the 50ml mini", () => {
    expect(sizeFromText("mini")).toBe(50);
    expect(sizeFromText("50 ml")).toBe(50);
  });
});

describe("applyFlagshipAlias — bare brand = flagship plain (Tony's law)", () => {
  it("expands bare brands to their flagship terms", () => {
    expect(applyFlagshipAlias(["bacardi", "rum"])).toEqual(["bacardi", "superior"]);
    expect(applyFlagshipAlias(["skrewball"])).toEqual(["skrewball", "peanut", "butter"]);
    expect(applyFlagshipAlias(["carolans"])).toEqual(["carolans", "irish", "cream"]);
    expect(applyFlagshipAlias(["fireball"])).toEqual(["fireball", "cinnamon"]);
  });
  it("does NOT fire when the user asked for a specific variant", () => {
    expect(applyFlagshipAlias(["bacardi", "spiced", "rum"])).toEqual(["bacardi", "spiced", "rum"]);
    expect(applyFlagshipAlias(["fireball", "apple"])).toEqual(["fireball", "apple"]);
  });
  it("passes non-alias brands through untouched", () => {
    expect(applyFlagshipAlias(["tito", "vodka"])).toEqual(["tito", "vodka"]);
    expect(Object.keys(FLAGSHIP_ALIASES)).toContain("bacardi");
  });
});

describe("fallbackTermSets — typo tolerance (the Glenfidich whiff)", () => {
  it("leads with the brand's 5-char prefix so one dropped letter still lands", () => {
    const sets = fallbackTermSets(["glenfidich", "18", "year"]);
    expect(sets[0]).toEqual(["glenf"]);
  });
});

describe("scoreCandidate — 2026-07-23 corpus pins", () => {
  it("SKREWBALL: flagship Peanut Butter beats the Eggnog seasonal (was lost to the length tiebreak)", () => {
    const terms = applyFlagshipAlias(["skrewball"]);
    expect(scoreCandidate("SKREWBALL PEANUT BUTTER WHISKY", terms, null)).toBeLessThan(
      scoreCandidate("SKREWBALL EGGNOG", terms, null),
    );
  });
  it("CAROLANS: Irish Cream flagship beats Cold Brew, no self-inflicted cream penalty", () => {
    const terms = applyFlagshipAlias(["carolans"]);
    expect(scoreCandidate("CAROLANS IRISH CREAM LIQ (IRE)", terms, null)).toBeLessThan(
      scoreCandidate("CAROLANS COLD BREW", terms, null),
    );
  });
  it("FIREBALL: the real Fireball beats CATCH FIRE (cross-brand cinnamon)", () => {
    const terms = applyFlagshipAlias(["fireball"]);
    expect(scoreCandidate("FIREBALL CINNAMON PL", terms, null)).toBeLessThan(
      scoreCandidate("CATCH FIRE CINNAMON WHISKY", terms, null),
    );
  });
  it("BACARDI: Superior (flagship white) beats Spiced on a bare 'bacardi rum' line", () => {
    const terms = applyFlagshipAlias(["bacardi", "rum"]);
    expect(scoreCandidate("BACARDI SUPERIOR", terms, null)).toBeLessThan(
      scoreCandidate("BACARDI SPICED RUM", terms, null),
    );
  });
  it("SMIRNOFF 100 (proof line) is demoted unless the owner typed the proof", () => {
    const terms = ["smirnoff"];
    const plain = scoreCandidate("SMIRNOFF VODKA PL", terms, null, { rawText: "smirnoff half pint" });
    const proof = scoreCandidate("SMIRNOFF 100", terms, null, { rawText: "smirnoff half pint" });
    expect(plain).toBeLessThan(proof);
    // Waiver: typing the proof number keeps it un-penalized.
    const waived = scoreCandidate("SMIRNOFF 100", terms, null, { rawText: "smirnoff 100 half pint" });
    expect(waived).toBeLessThan(proof);
  });
  it("combo/gift packs are demoted below the plain bottle", () => {
    const terms = ["ketel", "one"];
    const plain = scoreCandidate("KETEL ONE (HOL)", terms, null, { row: { is_combo: false } });
    const combo = scoreCandidate("KETEL ONE W/2 COUPE GLS W/", terms, null, { row: { is_combo: true } });
    expect(plain).toBeLessThan(combo);
  });
  it("stays back-compatible with the 3-arg call shape", () => {
    expect(() => scoreCandidate("JIM BEAM", ["jim", "beam"], null)).not.toThrow();
  });
});

describe("scoreCandidate — possessive-'s false match (2026-07-23, the deep bug)", () => {
  it("a possessive 's does NOT satisfy a different brand's initial", () => {
    // "skrewball" must read as MISSING from "RAM'S POINT" — the trailing 's in
    // ram's used to count as the brand initial and zero out the penalty.
    const terms = ["skrewball", "peanut", "butter"];
    const real = scoreCandidate("SKREWBALL PEANUT BUTTER WHISKY", terms, null);
    const imposter = scoreCandidate("RAM'S POINT PEANUT BUTTER", terms, null);
    expect(real).toBeLessThan(imposter);
  });
  it("Stoli(chnaya) is missing from BURNETT'S despite the possessive 's", () => {
    const terms = ["stolichnaya", "vanilla"];
    const real = scoreCandidate("STOLICHNAYA VANIL", terms, null);
    const imposter = scoreCandidate("BURNETT'S VANILLA VODKA", terms, null);
    expect(real).toBeLessThan(imposter);
  });
  it("still matches a real brand-lead abbreviation (jack → J DANIELS)", () => {
    const terms = ["jack", "daniels"];
    // J DANIELS: 'jack' present via the standalone 'J' initial (not possessive).
    const abbrev = scoreCandidate("J DANIELS TENNESSEE WHISKEY", terms, null);
    const wrong = scoreCandidate("GORDONS LONDON DRY", terms, null);
    expect(abbrev).toBeLessThan(wrong);
  });
  it("VANIL truncation: a 5-char prefix of a long term counts as present", () => {
    // MLCC truncates 'VANILLA' -> 'VANIL'; the term must not read as missing.
    const withTrunc = scoreCandidate("STOLICHNAYA VANIL", ["stolichnaya", "vanilla"], null);
    const missingIt = scoreCandidate("STOLICHNAYA GARBAGE", ["stolichnaya", "vanilla"], null);
    expect(withTrunc).toBeLessThan(missingIt);
  });
});

describe("applyBrandSynonyms — store-fact brand spelling (Tony, 2026-07-23)", () => {
  it("expands stoli → stolichnaya per-token, regardless of other words", () => {
    expect(applyBrandSynonyms(["stoli", "vanilla"])).toEqual(["stolichnaya", "vanilla"]);
    expect(applyBrandSynonyms(["stoli"])).toEqual(["stolichnaya"]);
    expect(BRAND_SYNONYMS.stoli).toBe("stolichnaya");
  });
  it("leaves unknown tokens untouched", () => {
    expect(applyBrandSynonyms(["tito", "vodka"])).toEqual(["tito", "vodka"]);
  });
});

describe("scoreCandidate — Skrewball flagship after removing 'peanut' from flavors", () => {
  it("Skrewball Peanut Butter (the flagship) is NOT flavor-penalized", () => {
    // 'peanut' must not be a flavor word — it's Skrewball's core product.
    const terms = ["skrewball", "peanut", "butter"];
    const flagship = scoreCandidate("SKREWBALL PEANUT BUTTER WHISKY", terms, null);
    const eggnog = scoreCandidate("SKREWBALL EGGNOG", terms, null);
    expect(flagship).toBeLessThan(eggnog);
  });
});

describe("resolveOrderLine — SIZE HONESTY (the Platinum 7X law)", () => {
  /** Minimal thenable fake supabase: every query returns the given rows. */
  const fakeSupabase = (rows) => ({
    from: () => ({
      select: () => {
        const builder = {
          or: () => builder,
          ilike: () => builder,
          limit: () => Promise.resolve({ data: rows, error: null }),
        };
        return builder;
      },
    }),
  });

  it("a requested size with no candidate NEVER returns a confident different-size best", async () => {
    const rows = [
      { code: "6937", name: "PLATINUM 7X", bottle_size_ml: 100, is_combo: false },
      { code: "2080", name: "PLATINUM 7X PL", bottle_size_ml: 750, is_combo: false },
      { code: "2082", name: "PLATINUM 7X PL", bottle_size_ml: 1000, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), {
      name: "Platinum 7x plastic",
      sizeMl: 1750,
      prefer: "plastic",
    });
    expect(r.sizeMismatch).toBe(true);
    expect(r.requestedSizeMl).toBe(1750);
    expect(r.confidence).toBe("review"); // never high/medium on a size substitute
    expect(r.best).toBeTruthy(); // closest product still surfaces — honestly flagged
  });

  it("an exact single-size hit stays high confidence with no mismatch flag", async () => {
    const rows = [{ code: "2081", name: "PLATINUM 7X PL", bottle_size_ml: 1750, is_combo: false }];
    const r = await resolveOrderLine(fakeSupabase(rows), {
      name: "Platinum 7x plastic",
      sizeMl: 1750,
      prefer: "plastic",
    });
    expect(r.sizeMismatch).toBe(false);
    expect(r.confidence).toBe("high");
    expect(r.best.code).toBe("2081");
  });

  it("bare brand picks the plain 80-proof over the 100-proof step-up (Smirnoff)", async () => {
    // Both real 200ml SKUs (probe-catalog-size.mjs, 2026-07-23). The proof
    // penalty demotes SMIRNOFF 100; the 80 must win. (The live miss was the
    // 80 being TRUNCATED from the pool by the old limit — see queryByTerms.)
    const rows = [
      { code: "85800", name: "SMIRNOFF 100", bottle_size_ml: 200, is_combo: false },
      { code: "61102", name: "SMIRNOFF 80 PL", bottle_size_ml: 200, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Smirnoff", sizeMl: 200 });
    expect(r.best.code).toBe("61102");
  });
});

/**
 * EVIDENCE-BASED CONFIDENCE (2026-07-24 calibration — stress-catalog run
 * N=200 seed=20260724). The old "exactly one exact-size row = high" rule
 * failed both ways: perfect matches wore amber (27 CHECKs on Tony's
 * near-perfect live order) and a single wrong-brand fallback row wore HIGH
 * (the stress run's only catastrophic class: "smrnoff citrus" → PINNACLE
 * CITRUS). New ladder: lead-word-missing → review; all words covered + clear
 * margin → high; contested → medium.
 */
describe("confidence calibration (2026-07-24)", () => {
  const fakeSupabase = (rows) => ({
    from: () => ({
      select: () => {
        const builder = {
          or: () => builder,
          ilike: () => builder,
          limit: () => Promise.resolve({ data: rows, error: null }),
        };
        return builder;
      },
    }),
  });

  it("typo'd brand cross-match can NEVER wear a confident badge (was HIGH)", async () => {
    // The stress run's HIGH-CONF-WRONG class: brand typo'd, fallback found a
    // single exact-size row of a DIFFERENT brand → old rule crowned it high.
    const rows = [{ code: "12582", name: "PINNACLE CITRUS", bottle_size_ml: 1000, is_combo: false }];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "smrnoff citrus", sizeMl: 1000 });
    expect(r.best.code).toBe("12582"); // still surfaces as the closest thing
    expect(r.confidence).toBe("review"); // but honestly flagged — brand word absent
  });

  it("an evidenced clear winner is GREEN even with brand-mates in the pool (was check)", async () => {
    const rows = [
      { code: "9795", name: "CASAMIGOS REPOSADO", bottle_size_ml: 750, is_combo: false },
      { code: "17160", name: "CENOTE REPOSADO", bottle_size_ml: 750, is_combo: false },
      { code: "31289", name: "VOLCAN REPOSADO", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Casamigos reposado", sizeMl: 750 });
    expect(r.best.code).toBe("9795");
    expect(r.confidence).toBe("high"); // every word covered + clear margin over CENOTE
  });

  it("a genuinely contested line stays amber (bare Limoncello across brands)", async () => {
    const rows = [
      { code: "26792", name: "LIM LIMONCELLO", bottle_size_ml: 750, is_combo: false },
      { code: "22553", name: "CRAZ LIMONCELLO", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Limoncello", sizeMl: 750 });
    expect(r.confidence).toBe("medium"); // rivals inside the margin — a human should glance
  });

  it("synonym + MLCC truncation still count as covered (Stoli vanilla → green)", async () => {
    const rows = [
      { code: "95996", name: "STOLICHNAYA VANIL", bottle_size_ml: 750, is_combo: false },
      { code: "35355", name: "SVEDKA VANILLA", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Stoli vanilla", sizeMl: 750 });
    expect(r.best.code).toBe("95996");
    expect(r.confidence).toBe("high"); // stolichnaya via synonym, vanilla via VANIL prefix
  });

  it("termCoverage: apostrophes never break coverage (TITO'S ↔ titos)", () => {
    const cov = termCoverage("TITO'S HANDMADE VODKA", ["titos"]);
    expect(cov.leadCovered).toBe(true);
    expect(cov.allCovered).toBe(true);
  });

  // ── 2026-07-25: the connoisseur-list live failures, pinned ────────────────
  it("the BRAND outranks descriptors (Blanton's must not lose to CRUZAN SINGLE BARREL)", async () => {
    const rows = [
      { code: "92286", name: "CRUZAN SINGLE BARREL", bottle_size_ml: 750, is_combo: false },
      { code: "18116", name: "BLANTON'S BOURBON", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), {
      name: "Blanton's single barrel bourbon",
      sizeMl: 750,
    });
    // Brand hit missing two descriptors (120) beats descriptor hit missing
    // the brand (150) — the wrong-brand rum can never headline again.
    expect(r.best.code).toBe("18116");
    expect(r.leadMissing).toBe(false);
  });

  it("when the brand matches NOTHING, leadMissing flags it (likely not in the book)", async () => {
    const rows = [{ code: "92286", name: "CRUZAN SINGLE BARREL", bottle_size_ml: 750, is_combo: false }];
    const r = await resolveOrderLine(fakeSupabase(rows), {
      name: "Blanton's single barrel bourbon",
      sizeMl: 750,
    });
    expect(r.leadMissing).toBe(true); // → tool ships brand_absent, card warns
    expect(r.confidence).toBe("review");
  });

  it("small-number ages are scored — WhistlePig 10 finds the 10 YR, not FarmStock", async () => {
    const rows = [
      { code: "32170", name: "WHISTLEPIG FARMSTOCK RYE", bottle_size_ml: 750, is_combo: false },
      { code: "20648", name: "WHISTLEPIG STRAIGHT RYE-10 YR", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), {
      name: "WhistlePig 10 year rye",
      sizeMl: 750,
      rawText: "WhistlePig 10 Year Rye",
    });
    expect(r.best.code).toBe("20648");
  });

  it("MLCC abbreviations satisfy their full words (SNGL BRL ≡ single barrel) — Michter's 10 finds the 10 YR", async () => {
    const rows = [
      { code: "10857", name: "MICHTER'S SINGLE BARREL ST BBN", bottle_size_ml: 750, is_combo: false },
      { code: "31234", name: "MICHTER'S SNGL BRL BBN-10 YR", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), {
      name: "Michter's 10 year single barrel bourbon",
      sizeMl: 750,
      rawText: "Michter's 10 Year Single Barrel Bourbon",
    });
    expect(r.best.code).toBe("31234");
  });

  it('number terms match on word boundaries — "10" never hides inside "100"', () => {
    expect(termCoverage("SMIRNOFF 100", ["smirnoff", "10"]).allCovered).toBe(false);
    expect(termCoverage("WHISTLEPIG STRAIGHT RYE-10 YR", ["whistlepig", "10"]).allCovered).toBe(true);
  });

  it("scoring now shares coverage's stripped compare (TITO'S no longer penalized by its own apostrophe)", () => {
    const s = scoreCandidate("tito's handmade vodka", ["titos", "handmade", "vodka"]);
    expect(s).toBeLessThan(60); // length tiebreak only — zero missing-term penalties
  });

  // ── NO-SIZE CONFIDENCE (2026-07-25, the connoisseur rematch polish) ──────
  it("a uniquely-determined bottle earns HIGH without a spoken size (Midwinter Dram)", async () => {
    const rows = [
      { code: "12236", name: "HIGH WEST MIDWINTER NIGHTS DRAM", bottle_size_ml: 750, is_combo: false },
      { code: "11111", name: "HIGH WEST RENDEZVOUS RYE", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "High West Midwinter Nights Dram" });
    expect(r.best.code).toBe("12236");
    expect(r.confidence).toBe("high"); // all words covered, one size exists, clear win
  });

  it("right product in MULTIPLE sizes without a spoken size = medium (owner picks via the chip)", async () => {
    const rows = [
      { code: "7128", name: "TITO'S HANDMADE VODKA", bottle_size_ml: 200, is_combo: false },
      { code: "2980", name: "TITO'S HANDMADE VODKA", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Titos handmade vodka" });
    expect(r.confidence).toBe("medium");
  });

  it("a single-word phrase can NEVER go green without a size (no cocky 'rocks')", async () => {
    const rows = [{ code: "26792", name: "LIM LIMONCELLO", bottle_size_ml: 750, is_combo: false }];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Limoncello" });
    expect(r.confidence).toBe("medium"); // capped — one eligible term is thin evidence
  });

  it("no-size + absent brand stays review + leadMissing (honesty unchanged)", async () => {
    const rows = [{ code: "92286", name: "CRUZAN SINGLE BARREL", bottle_size_ml: 750, is_combo: false }];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Blanton's single barrel bourbon" });
    expect(r.confidence).toBe("review");
    expect(r.leadMissing).toBe(true);
  });

  it("no-size + partial coverage stays review (default untouched)", async () => {
    const rows = [{ code: "31807", name: "BLANTON'S SINGLE BARREL SB", bottle_size_ml: 750, is_combo: false }];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "Blanton's original zeppelin edition" });
    expect(r.confidence).toBe("review");
  });

  // ── Round 2 (2026-07-24 stress re-run): the brand-initial shortcut fired on
  // stray single letters ANYWHERE in a name — "C&D", "D' ARGENT" — putting
  // wrong brands in green. Initial now counts ONLY as the name's FIRST token.
  it("a stray 'C&D' tail can never satisfy the brand initial (camesi ↛ CODIGO … C&D)", async () => {
    const rows = [
      { code: "34199", name: "CODIGO 1530 GS ANEJO C&D", bottle_size_ml: 750, is_combo: false },
      { code: "28829", name: "CARMESI ANEJO", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "camesi anejo", sizeMl: 750 });
    expect(r.best.code).toBe("28829"); // right family wins the tiebreak now
    expect(r.confidence).toBe("review"); // typo'd brand still honestly flagged
  });

  it("a mid-name \"D'\" can never satisfy the brand initial (damore ↛ HARDY NOCES D' ARGENT)", async () => {
    const rows = [
      { code: "16171", name: "HARDY NOCES D' ARGENT-25 YR", bottle_size_ml: 750, is_combo: false },
      { code: "11088", name: "THE DALMORE-25 YR", bottle_size_ml: 750, is_combo: false },
    ];
    const r = await resolveOrderLine(fakeSupabase(rows), { name: "the damore-25 yr", sizeMl: 750 });
    expect(r.confidence).not.toBe("high"); // never green on a typo'd brand
  });

  it("the REAL brand-initial pattern still works (jack → J DANIELS, first token)", () => {
    const cov = termCoverage("J DANIELS TENNESSEE HONEY PL", ["jack", "daniels", "honey"]);
    expect(cov.leadCovered).toBe(true);
    expect(cov.allCovered).toBe(true);
    // …and scoring agrees: no missing-term penalty on the lead. (Score is
    // never literally 0 — the name-length brevity tiebreak rides on top — so
    // assert it's below a single MISSING_TERM_PENALTY.)
    const s = scoreCandidate("j daniels tennessee honey pl", ["jack", "daniels", "honey"]);
    expect(s).toBeLessThan(60);
  });
});

/*
 * 2026-08-12 — the CAPTAIN MORGAN ICED TEA whiff. Tony pasted a big order,
 * "captain morgans fifth x 3" resolved to the RTD iced tea. Two fixes pinned
 * here: RTD cocktail lines are flavor-penalized compounds, and the store's
 * own order history breaks flavor ties (ORDERED_BEFORE_BONUS) without ever
 * outvoting typed words.
 */
import { ORDERED_BEFORE_BONUS } from "../src/lib/resolve-order-lines.js";

describe("RTD cocktail variants (iced tea / margarita class)", () => {
  it("an unrequested ICED TEA variant is penalized like any flavor", () => {
    const terms = ["captain", "morgans"];
    const icedTea = scoreCandidate("CAPTAIN MORGAN ICED TEA", terms, null);
    const plainRum = scoreCandidate("CAPTAIN MORGAN WHITE RUM", terms, null);
    expect(plainRum).toBeLessThan(icedTea);
  });

  it("typing 'iced tea' waives the penalty — the variant becomes reachable", () => {
    const terms = ["captain", "morgan", "iced", "tea"];
    const icedTea = scoreCandidate("CAPTAIN MORGAN ICED TEA", terms, null);
    const flagship = scoreCandidate("CAPTAIN MORGAN ORIGINAL SPICED", terms, null);
    expect(icedTea).toBeLessThan(flagship);
  });

  it("margarita RTDs are demoted, but the MARGARITAVILLE brand itself is waived", () => {
    const bare1800 = scoreCandidate("1800 ULTIMATE MARGARITA", ["1800"], null);
    const silver = scoreCandidate("1800 SILVER", ["1800"], null);
    expect(silver).toBeLessThan(bare1800);
    // Brand waiver: typing "margaritaville" must not penalize its own bottles.
    const mvGold = scoreCandidate("MARGARITAVILLE GOLD", ["margaritaville"], null);
    expect(mvGold).toBeLessThan(100); // no flavor penalty applied
  });
});

describe("ORDERED_BEFORE_BONUS — store history breaks ties, never overrides words", () => {
  it("captain morgans (bare): both variants eat flavor penalties; history crowns the store's bottle", () => {
    const terms = ["captain", "morgans"];
    const flagship = scoreCandidate("CAPTAIN MORGAN ORIGINAL SPICED", terms, null, {
      orderedBefore: true,
    });
    const icedTea = scoreCandidate("CAPTAIN MORGAN ICED TEA", terms, null, {
      orderedBefore: false,
    });
    expect(flagship).toBeLessThan(icedTea);
  });

  it("typed variant words ALWAYS beat history (cherry asked, plain in history)", () => {
    const terms = ["smirnoff", "cherry"];
    const cherry = scoreCandidate("SMIRNOFF CHERRY", terms, null, { orderedBefore: false });
    const plain = scoreCandidate("SMIRNOFF 80", terms, null, { orderedBefore: true });
    // Plain is missing "cherry" (+60); the -35 history bonus must not save it.
    expect(cherry).toBeLessThan(plain);
  });

  it("history never rescues a wrong brand (lead penalty dwarfs the bonus)", () => {
    const terms = ["titos"];
    const right = scoreCandidate("TITO'S HANDMADE VODKA", terms, null, { orderedBefore: false });
    const wrong = scoreCandidate("ATWATER VODKA", terms, null, { orderedBefore: true });
    expect(right).toBeLessThan(wrong);
  });

  it("the bonus is strictly smaller than every real penalty", () => {
    expect(ORDERED_BEFORE_BONUS).toBeLessThan(40); // VARIANT_PENALTY
  });

  it("end-to-end: a NON-aliased brand where every family member is flavored — history picks the store's bottle, badge stays honest", async () => {
    // Malibu-shaped: the flagship IS a flavor (coconut), the rival is another
    // flavor — both eat +100, structure alone can't crown a winner. The
    // store's own history decides, and the 35-point margin (< VARIANT_PENALTY)
    // correctly reads as contested → CHECK, not green.
    const rows = [
      { code: "7701", name: "MALIBU COCONUT RUM", bottle_size_ml: 750, is_combo: false },
      { code: "7702", name: "MALIBU PINEAPPLE RUM", bottle_size_ml: 750, is_combo: false },
    ];
    const fake = {
      from: () => ({
        select: () => {
          const b = {
            or: () => b,
            ilike: () => b,
            limit: () => Promise.resolve({ data: rows, error: null }),
          };
          return b;
        },
      }),
    };
    const r = await resolveOrderLine(
      fake,
      { name: "malibu", sizeMl: 750, rawText: "malibu fifth x 3" },
      { orderedCodes: new Set(["7701"]) },
    );
    expect(r.best?.code).toBe("7701");
    // Margin is the 35-point history bonus (< VARIANT_PENALTY 40): the win is
    // real but contested — the badge must say CHECK, not high.
    expect(r.confidence).toBe("medium");
  });
});

describe("flavor truncation tolerance (the TROPICL PNCH class, 2026-08-12)", () => {
  it("MLCC-truncated PNCH still eats the 'punch' flavor penalty", () => {
    const terms = ["captain", "morgans"];
    const punch = scoreCandidate("CAPTAIN MORGAN TROPICL PNCH PL", terms, null);
    const white = scoreCandidate("CAPTAIN MORGAN WHITE RUM", terms, null);
    expect(white).toBeLessThan(punch);
  });

  it("typing 'punch' waives it regardless of the name's spelling", () => {
    const terms = ["captain", "morgan", "tropical", "punch"];
    const punch = scoreCandidate("CAPTAIN MORGAN TROPICL PNCH PL", terms, null);
    const white = scoreCandidate("CAPTAIN MORGAN WHITE RUM", terms, null);
    // The punch bottle is now the intent; white rum is missing 'punch' (+60)
    // and 'tropical' (+60).
    expect(punch).toBeLessThan(white);
  });

  it("VANIL truncation is caught by the skeleton rule", () => {
    const s = scoreCandidate("STOLICHNAYA VANIL", ["stolichnaya"], null);
    expect(s).toBeGreaterThanOrEqual(100); // vanilla penalty fired
  });

  it("whole real words that PREFIX a longer flavor are never accused (BLACK ≠ blackberry)", () => {
    const terms = ["jack", "daniels"];
    const standard = scoreCandidate("J DANIELS OLD 7 BLACK", terms, null);
    expect(standard).toBeLessThan(100); // no blackberry penalty
  });

  it("a LONGER token with the same skeleton is never accused (PANACHE ≠ punch)", () => {
    const s = scoreCandidate("PANACHE VODKA", ["panache"], null);
    expect(s).toBeLessThan(100); // no punch penalty
  });

  it("compound flavors still need the full phrase (no half-compound accusations)", () => {
    // "iced" alone in a name must not fire the "iced tea" penalty.
    const s = scoreCandidate("ICED VODKA CO", ["iced", "vodka", "co"], null);
    expect(s).toBeLessThan(100);
  });
});

/*
 * 2026-08-12 pt.2 — the REAL Captain Morgan family, verbatim from Tony's
 * prod SQL dump. MLCC stores the flagship ABBREVIATED ("CAPT MORGAN SPICED
 * RUM (P R)") and the flavors fully spelled — so "captain morgans" could
 * not even SEE the bottle it named. Pins: the token-prefix truncation
 * bridge (capt→captain, morg→morgans), the two-token flagship alias, and
 * the guards that keep JACKSON MORGAN (a different brand) out of the race.
 */
describe("Captain Morgan — catalog-truth fixture (Tony's SQL, 2026-08-12)", () => {
  const MORGAN_ROWS = [
    { code: "41307", name: "CAPT MORGAN SPICED RUM (P R)", bottle_size_ml: 750, is_combo: false },
    { code: "41297", name: "CAPT MORGAN SPICED RUM (PR) PL", bottle_size_ml: 750, is_combo: false },
    { code: "41317", name: "CAPT MORGAN SILVER SPICED RUM", bottle_size_ml: 750, is_combo: false },
    { code: "5246", name: "CAPTAIN MORGAN SPICED-100", bottle_size_ml: 750, is_combo: false },
    { code: "10923", name: "CAPTAIN MORGAN WHITE RUM", bottle_size_ml: 750, is_combo: false },
    { code: "22339", name: "CAPTAIN MORGAN SLICED APPLE", bottle_size_ml: 750, is_combo: false },
    { code: "34124", name: "CAPTAIN MORGAN CHILI LIME", bottle_size_ml: 750, is_combo: false },
    { code: "12294", name: "CAPTAIN MORGAN COCONUT RUM", bottle_size_ml: 750, is_combo: false },
    { code: "6108", name: "CAPT MORG LONG ISL ICED TEA", bottle_size_ml: 375, is_combo: false },
    { code: "5538", name: "CAPT MORG LONG ISL ICED TEA", bottle_size_ml: 1750, is_combo: false },
    { code: "85440", name: "CAPT MORGAN PRIVATE STOCK", bottle_size_ml: 750, is_combo: false },
    { code: "76811", name: "CAPT MORGAN SPICED RUM (PR) W/ 50mL CAPT MORGAN SPICED RUM (P R) PL", bottle_size_ml: 750, is_combo: true },
    { code: "16789", name: "JACKSON MORGAN SALTED CARAMEL", bottle_size_ml: 750, is_combo: false },
    { code: "30721", name: "CAPTAIN APPLE JACK", bottle_size_ml: 750, is_combo: false },
  ];
  const fake = (rows) => ({
    from: () => ({
      select: () => {
        const b = {
          or: () => b,
          ilike: () => b,
          limit: () => Promise.resolve({ data: rows, error: null }),
        };
        return b;
      },
    }),
  });

  it("token-prefix truncation: 'captain'/'morgans' read as PRESENT in CAPT MORG names", () => {
    const cov = termCoverage("CAPT MORG LONG ISL ICED TEA", ["captain", "morgans"]);
    expect(cov.leadCovered).toBe(true);
    expect(cov.allCovered).toBe(true);
  });

  it("the alias fires on the TWO-token bare brand", () => {
    expect(applyFlagshipAlias(["captain", "morgans"])).toEqual(["capt", "morgan", "spiced", "rum"]);
    expect(applyFlagshipAlias(["captain"])).toEqual(["capt", "morgan", "spiced", "rum"]);
    // Any extra distinctive word disables it — typed intent passes through.
    expect(applyFlagshipAlias(["captain", "morgan", "white"])).toEqual(["captain", "morgan", "white"]);
  });

  it("'captain morgans fifth x 3' → THE flagship 41307, not a flavor, not white rum", async () => {
    const r = await resolveOrderLine(fake(MORGAN_ROWS), {
      name: "captain morgans",
      sizeMl: 750,
      rawText: "captain morgans fifth x 3",
    });
    expect(r.best?.code).toBe("41307");
  });

  it("history refines glass vs plastic within the flagship (Colony buys the PL)", async () => {
    const r = await resolveOrderLine(
      fake(MORGAN_ROWS),
      { name: "captain morgans", sizeMl: 750, rawText: "captain morgans fifth" },
      { orderedCodes: new Set(["41297"]) },
    );
    expect(r.best?.code).toBe("41297");
  });

  it("'captain morgan iced tea' reaches the RTD — and size honesty flags the missing fifth", async () => {
    const r = await resolveOrderLine(fake(MORGAN_ROWS), {
      name: "captain morgan iced tea",
      sizeMl: 750,
      rawText: "captain morgan iced tea fifth",
    });
    // No 750 exists for the iced tea — the resolver may surface it but must
    // say the size is a mismatch and never wear a confident badge.
    expect(r.best?.name).toBe("CAPT MORG LONG ISL ICED TEA");
    expect(r.sizeMismatch).toBe(true);
    expect(r.confidence).toBe("review");
  });

  it("'captain morgan white rum' still resolves to white rum (typed variant wins)", async () => {
    const r = await resolveOrderLine(fake(MORGAN_ROWS), {
      name: "captain morgan white rum",
      sizeMl: 750,
      rawText: "captain morgan white rum fifth",
    });
    expect(r.best?.code).toBe("10923");
  });

  it("JACKSON MORGAN and CAPTAIN APPLE JACK never win the captain's race", async () => {
    const r = await resolveOrderLine(fake(MORGAN_ROWS), {
      name: "captain morgans",
      sizeMl: 750,
      rawText: "captain morgans fifth",
    });
    const names = [r.best, ...r.alternates].filter(Boolean).map((c) => c.name);
    expect(names[0]).not.toMatch(/JACKSON|APPLE JACK/);
  });

  it("jackson morgan salted caramel resolves inside ITS brand", async () => {
    const r = await resolveOrderLine(fake(MORGAN_ROWS), {
      name: "jackson morgan salted caramel",
      sizeMl: 750,
      rawText: "jackson morgan salted caramel",
    });
    expect(r.best?.code).toBe("16789");
  });
});
