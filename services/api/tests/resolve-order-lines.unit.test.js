import { describe, it, expect } from "vitest";
import {
  sizeFromText,
  preferFromText,
  tokenizeName,
  scoreCandidate,
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
  it("keeps brand identity, drops sizes/packaging/numbers", () => {
    expect(tokenizeName("CROWN ROYAL REGAL APPLE")).toEqual([
      "crown",
      "royal",
      "regal",
      "apple",
    ]);
    // 'PL' (plastic) and bare numbers are dropped.
    expect(tokenizeName("SMIRNOFF 80 PL")).toEqual(["smirnoff"]);
    expect(tokenizeName("JIM BEAM PL")).toEqual(["jim", "beam"]);
  });
  it("handles apostrophes (the Tito's bug)", () => {
    expect(tokenizeName("TITO'S HANDMADE VODKA")).toEqual([
      "tito",
      "handmade",
      "vodka",
    ]);
  });
});

describe("scoreCandidate (lower = better)", () => {
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
