import { describe, it, expect } from "vitest";

import {
  applyTenantAdvisoryForUncertain,
  buildPhase2gTypingPolicyManifest,
  buildPlaywrightSelectorFromHint,
  classifyMutationBoundaryControl,
  computePhase2gExtendedMutationRisk,
  evaluatePhase2fOpenCandidateEligibility,
  isProbeUiTextUnsafe,
  parseMutationBoundaryUncertainHints,
  parsePhase2fSafeOpenTextAllowSubstrings,
  parsePhase2gSentinelValue,
  parsePhase2hTestCode,
  parseSafeOpenCandidateSelectors,
  PHASE_2G_TYPING_POLICY_VERSION,
  shouldBlockHttpRequest,
} from "../src/workers/mlcc-browser-add-by-code-probe.js";

describe("shouldBlockHttpRequest", () => {
  it("blocks mutation methods to cart/order-like URLs", () => {
    const b = shouldBlockHttpRequest(
      "https://vendor.example/api/cart/add",
      "POST",
    );
    expect(b.block).toBe(true);
  });

  it("allows GET navigation to generic pages", () => {
    const b = shouldBlockHttpRequest("https://vendor.example/home", "GET");
    expect(b.block).toBe(false);
  });
});

describe("classifyMutationBoundaryControl", () => {
  it("classifies obvious mutation labels as unsafe", () => {
    const r = classifyMutationBoundaryControl({
      tag: "button",
      text: "Add to cart",
    });

    expect(r.classification).toBe("unsafe_mutation_likely");
  });

  it("classifies help/privacy style as informational heuristic only", () => {
    const r = classifyMutationBoundaryControl({
      tag: "a",
      text: "Privacy policy",
      href: "https://example.com/privacy",
    });

    expect(r.classification).toBe("safe_informational");
  });

  it("returns uncertain for ambiguous labels with uncertain_detail", () => {
    const r = classifyMutationBoundaryControl({
      tag: "button",
      text: "Continue",
    });

    expect(r.classification).toBe("uncertain");
    expect(r.uncertain_detail).toBe(
      "generic_navigation_or_action_verb_needs_tenant_context",
    );
  });
});

describe("parseMutationBoundaryUncertainHints", () => {
  it("returns empty array for null/blank", () => {
    expect(parseMutationBoundaryUncertainHints(null)).toEqual([]);
    expect(parseMutationBoundaryUncertainHints("  ")).toEqual([]);
  });

  it("parses valid hint entries", () => {
    const raw = JSON.stringify([
      { contains: "foo", advisory_label: "note" },
      { contains: "", advisory_label: "x" },
    ]);
    expect(parseMutationBoundaryUncertainHints(raw)).toEqual([
      { contains: "foo", advisory_label: "note" },
    ]);
  });

  it("throws when JSON is not an array", () => {
    expect(() => parseMutationBoundaryUncertainHints('{"x":1}')).toThrow(
      /must be a JSON array/,
    );
  });
});

describe("parsePhase2hTestCode", () => {
  it("accepts trimmed non-empty string within max length", () => {
    const r = parsePhase2hTestCode("  hi  ");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("hi");
  });

  it("rejects empty and oversize", () => {
    expect(parsePhase2hTestCode("").ok).toBe(false);
    expect(parsePhase2hTestCode("a".repeat(65)).ok).toBe(false);
    expect(parsePhase2hTestCode("a\nb").ok).toBe(false);
  });
});

describe("Phase 2g policy and risk", () => {
  it("exports a stable policy version string", () => {
    expect(PHASE_2G_TYPING_POLICY_VERSION).toMatch(/^lk-rpa-2g-/);
    expect(buildPhase2gTypingPolicyManifest().version).toBe(
      PHASE_2G_TYPING_POLICY_VERSION,
    );
  });

  it("parsePhase2gSentinelValue accepts only LK sentinel pattern", () => {
    expect(parsePhase2gSentinelValue("__LK_X__").ok).toBe(true);
    expect(parsePhase2gSentinelValue("bad").ok).toBe(false);
    expect(parsePhase2gSentinelValue(null).ok).toBe(true);
    expect(parsePhase2gSentinelValue(null).value).toBe(null);
  });

  it("computePhase2gExtendedMutationRisk blocks suspicious form action", () => {
    const r = computePhase2gExtendedMutationRisk({
      kind: "field",
      inputType: "text",
      formAction: "https://x.example/cart/add",
      formMethodAttr: "post",
      formSubmitCount: 1,
      id: "sku",
      name: "code",
    });
    expect(r.rehearsal_blocked).toBe(true);
    expect(r.block_reasons.some((x) => /form_action/.test(x))).toBe(true);
  });

  it("computePhase2gExtendedMutationRisk flags number input advisory", () => {
    const r = computePhase2gExtendedMutationRisk({
      kind: "field",
      inputType: "number",
      formAction: "",
      formMethodAttr: "get",
      formSubmitCount: 0,
      id: "qty",
      name: "qty",
    });
    expect(r.rehearsal_blocked).toBe(false);
    expect(r.advisory_signals.some((x) => /number/.test(x))).toBe(true);
  });
});

describe("parseSafeOpenCandidateSelectors", () => {
  it("parses non-empty selector array", () => {
    expect(parseSafeOpenCandidateSelectors('["a", " b "]')).toEqual(["a", "b"]);
  });

  it("throws when empty", () => {
    expect(() => parseSafeOpenCandidateSelectors("[]")).toThrow(/non-empty/);
  });
});

describe("parsePhase2fSafeOpenTextAllowSubstrings", () => {
  it("returns empty for blank", () => {
    expect(parsePhase2fSafeOpenTextAllowSubstrings(null)).toEqual([]);
  });

  it("parses string array", () => {
    expect(parsePhase2fSafeOpenTextAllowSubstrings('["x"]')).toEqual(["x"]);
  });
});

describe("evaluatePhase2fOpenCandidateEligibility", () => {
  it("rejects add-to-cart via layer3", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Add to cart" },
      [],
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/layer3/);
  });

  it("accepts add-by-code uncertain label via default intent", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Add by code" },
      [],
    );
    expect(r.eligible).toBe(true);
  });

  it("accepts uncertain when tenant substring matches", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Open special panel" },
      ["special"],
    );
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/tenant/);
  });

  it("rejects Continue without allowlist match", () => {
    const r = evaluatePhase2fOpenCandidateEligibility(
      { tag: "button", text: "Continue" },
      [],
    );
    expect(r.eligible).toBe(false);
  });
});

describe("applyTenantAdvisoryForUncertain", () => {
  it("does not attach hints for unsafe classification", () => {
    const row = { text: "Add to cart" };
    const out = applyTenantAdvisoryForUncertain(row, "unsafe_mutation_likely", [
      { contains: "cart", advisory_label: "wrong" },
    ]);
    expect(out).toEqual({});
  });

  it("attaches advisory only for uncertain rows", () => {
    const row = { text: "Enter sku here" };
    const out = applyTenantAdvisoryForUncertain(row, "uncertain", [
      { contains: "sku", advisory_label: "Tenant: code field area" },
    ]);
    expect(out.tenant_advisory_label).toBe("Tenant: code field area");
    expect(out.tenant_advisory_disclaimer).toMatch(/non_authoritative/);
  });
});

describe("buildPlaywrightSelectorFromHint", () => {
  it("prefers id when valid", () => {
    expect(buildPlaywrightSelectorFromHint({ id: "skuInput", name: "x" })).toBe(
      "#skuInput",
    );
  });

  it("falls back to name when id missing", () => {
    expect(buildPlaywrightSelectorFromHint({ id: null, name: "mlcc_code" })).toBe(
      '[name="mlcc_code"]',
    );
  });

  it("returns null when not constructible", () => {
    expect(buildPlaywrightSelectorFromHint({})).toBe(null);
  });
});

describe("isProbeUiTextUnsafe", () => {
  it("flags checkout and add-to-cart labels", () => {
    expect(isProbeUiTextUnsafe("Add to cart").unsafe).toBe(true);
    expect(isProbeUiTextUnsafe("Checkout").unsafe).toBe(true);
    expect(isProbeUiTextUnsafe("Validate order").unsafe).toBe(true);
  });

  it("allows neutral labels", () => {
    expect(isProbeUiTextUnsafe("Add by code").unsafe).toBe(false);
    expect(isProbeUiTextUnsafe("Enter code").unsafe).toBe(false);
  });
});
