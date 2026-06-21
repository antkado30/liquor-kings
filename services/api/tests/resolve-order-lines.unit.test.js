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
  it("a single term has no fallback", () => {
    expect(fallbackTermSets(["belvedere"])).toEqual([]);
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
