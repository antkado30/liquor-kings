import { describe, it, expect } from "vitest";
import {
  sizeFromText,
  preferFromText,
  tokenizeName,
  scoreCandidate,
  preciseTermSets,
  fallbackTermSets,
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
import { applyFlagshipAlias, FLAGSHIP_ALIASES, resolveOrderLine } from "../src/lib/resolve-order-lines.js";

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
});
