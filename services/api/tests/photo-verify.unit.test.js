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
    // Different framings — the two sources must be genuinely independent —
    // and BOTH must transcribe before judging (the v2 hallucination guard).
    expect(buildSkepticPrompt(ITEM)).toContain('"wrong"');
    expect(buildDefenderPrompt(ITEM)).toContain("second look");
    for (const p of [buildSkepticPrompt(ITEM), buildDefenderPrompt(ITEM)]) {
      expect(p).toContain("TRANSCRIBE");
      expect(p).toContain("label_reads");
    }
  });
});

describe("parseVerdict — strict, never guesses", () => {
  it("parses clean JSON and clamps junk fields", () => {
    const v = parseVerdict('{"verdict":"match","reason":"same bottle","confidence":0.9}', [
      "match", "wrong", "unsure",
    ]);
    expect(v).toEqual({ verdict: "match", reason: "same bottle", label_reads: null, confidence: 0.9 });
    const v2 = parseVerdict(
      '{"label_reads":"popov 80 proof vodka","verdict":"match","reason":"r","confidence":1}',
      ["match", "wrong", "unsure"],
    );
    expect(v2?.label_reads).toBe("popov 80 proof vodka");
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

describe("decideVerdict — the double-check law (v2: evidence stability)", () => {
  const S = (verdict, reason = "r", label_reads = "captain morgan spiced rum") => ({
    verdict,
    reason,
    label_reads,
    confidence: 0.9,
  });

  it("grounded match / unsure pass straight through", () => {
    expect(
      decideVerdict(S("match"), null, { itemName: "CAPT MORGAN SPICED RUM (P R)" }).verdict,
    ).toBe("match");
    expect(decideVerdict(S("unsure"), null).verdict).toBe("unsure");
  });
  it("an UNGROUNDED match (transcription shares nothing with the name) → unsure", () => {
    const d = decideVerdict(S("match", "looks right", "prestige distillers finest"), null, {
      itemName: "POPOV 80 VODKA PL",
    });
    expect(d.verdict).toBe("unsure");
    expect(d.reason).toContain("prestige");
  });
  it("a match claimed on an illegible/absent transcription → unsure", () => {
    expect(decideVerdict(S("match", "r", "illegible"), null).verdict).toBe("unsure");
    expect(decideVerdict(S("match", "r", null), null).verdict).toBe("unsure");
  });
  it("wrong + undeniably_wrong with AGREEING transcriptions = confirmed", () => {
    const d = decideVerdict(
      S("wrong", "shows Bacardi", "bacardi superior"),
      S("undeniably_wrong", "clearly Bacardi", "bacardi superior white"),
    );
    expect(d.verdict).toBe("confirmed_wrong");
    expect(d.reason).toContain("Bacardi");
  });
  it("wrong + undeniably_wrong but the passes READ DIFFERENT LABELS → unsure (the thumbnail-hallucination guard)", () => {
    const d = decideVerdict(
      S("wrong", "shows Prestige", "prestige vodka"),
      S("undeniably_wrong", "not the product", "smirnoff red label"),
    );
    expect(d.verdict).toBe("unsure");
    expect(d.reason).toContain("different labels");
  });
  it("wrong + defensible = OVERRULED — photo kept", () => {
    expect(decideVerdict(S("wrong"), S("defensible")).verdict).toBe("overruled");
  });
  it("an unparseable pass NEVER condemns a photo", () => {
    expect(decideVerdict(null, null).verdict).toBe("unsure");
    expect(decideVerdict(S("wrong"), null).verdict).toBe("overruled");
  });
});

describe("labelTokens / tokensAgree — transcription comparison", () => {
  it("generic category words never carry an agreement", async () => {
    const { tokensAgree } = await import("../src/lib/photo-verify.js");
    expect(tokensAgree("coconut rum caribbean", "CALYPSO SILVER RUM")).toBe(false); // rum is generic
    expect(tokensAgree("malibu coconut rum", "MALIBU COCONUT RUM PL")).toBe(true);
  });
  it("MLCC truncations agree by prefix (capt ↔ captain)", async () => {
    const { tokensAgree } = await import("../src/lib/photo-verify.js");
    expect(tokensAgree("captain morgan", "CAPT MORGAN SPICED RUM")).toBe(true);
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
