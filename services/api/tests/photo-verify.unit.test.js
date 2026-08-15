import { describe, expect, it } from "vitest";
import {
  buildSkepticPrompt,
  buildDefenderPrompt,
  parseVerdict,
  decideVerdict,
  isApplicable,
} from "../src/lib/photo-verify.js";

const ITEM = {
  code: "41307",
  name: "CAPT MORGAN SPICED RUM (P R)",
  bottle_size_ml: 750,
  bottle_size_label: "750 mL",
  category: "Rum",
};

describe("prompts", () => {
  it("both passes carry the product identity and the abbreviation lesson", () => {
    for (const p of [buildSkepticPrompt(ITEM), buildDefenderPrompt(ITEM)]) {
      expect(p).toContain("CAPT MORGAN SPICED RUM (P R)");
      expect(p).toContain("750 mL");
      expect(p).toMatch(/Captain\s*Morgan/i); // abbreviation coaching present
    }
    // Different framings — the two sources must be genuinely independent.
    expect(buildSkepticPrompt(ITEM)).toContain('"wrong"');
    expect(buildDefenderPrompt(ITEM)).toContain("DEFEND");
  });
});

describe("parseVerdict — strict, never guesses", () => {
  it("parses clean JSON and clamps junk fields", () => {
    const v = parseVerdict('{"verdict":"match","reason":"same bottle","confidence":0.9}', [
      "match", "wrong", "unsure",
    ]);
    expect(v).toEqual({ verdict: "match", reason: "same bottle", confidence: 0.9 });
  });
  it("finds JSON inside prose", () => {
    const v = parseVerdict('Sure! {"verdict":"wrong","reason":"different brand"} hope that helps', [
      "match", "wrong", "unsure",
    ]);
    expect(v?.verdict).toBe("wrong");
  });
  it("rejects unknown verdicts, malformed JSON, and empty output", () => {
    expect(parseVerdict('{"verdict":"maybe"}', ["match", "wrong", "unsure"])).toBeNull();
    expect(parseVerdict("{not json", ["match"])).toBeNull();
    expect(parseVerdict("", ["match"])).toBeNull();
    expect(parseVerdict('{"verdict":"match","confidence":7}', ["match"])?.confidence).toBeNull();
  });
});

describe("decideVerdict — the double-check law", () => {
  const S = (verdict, reason = "r") => ({ verdict, reason, confidence: 0.9 });

  it("match / unsure pass straight through (no second call needed)", () => {
    expect(decideVerdict(S("match"), null).verdict).toBe("match");
    expect(decideVerdict(S("unsure"), null).verdict).toBe("unsure");
  });
  it("wrong + undeniably_wrong = confirmed (both independent sources agree)", () => {
    const d = decideVerdict(S("wrong", "shows Bacardi"), S("undeniably_wrong", "clearly Bacardi"));
    expect(d.verdict).toBe("confirmed_wrong");
    expect(d.reason).toContain("Bacardi");
  });
  it("wrong + defensible = OVERRULED — photo kept", () => {
    expect(decideVerdict(S("wrong"), S("defensible")).verdict).toBe("overruled");
  });
  it("an unparseable pass NEVER condemns a photo", () => {
    expect(decideVerdict(null, null).verdict).toBe("unsure");
    expect(decideVerdict(S("wrong"), null).verdict).toBe("overruled");
  });
});

describe("isApplicable — only confirmed_wrong, only once", () => {
  it("confirmed_wrong + not yet applied → applicable", () => {
    expect(isApplicable({ verdict: "confirmed_wrong", applied_at: null })).toBe(true);
  });
  it("everything else is untouchable", () => {
    expect(isApplicable({ verdict: "match", applied_at: null })).toBe(false);
    expect(isApplicable({ verdict: "overruled", applied_at: null })).toBe(false);
    expect(isApplicable({ verdict: "unsure", applied_at: null })).toBe(false);
    expect(isApplicable({ verdict: "error", applied_at: null })).toBe(false);
    expect(isApplicable({ verdict: "confirmed_wrong", applied_at: "2026-08-14T00:00:00Z" })).toBe(false);
    expect(isApplicable(null)).toBe(false);
  });
});
