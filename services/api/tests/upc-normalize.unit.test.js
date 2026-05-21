import { describe, it, expect } from "vitest";

import { normalizeUpc, isPlausibleUpc } from "../src/lib/upc-normalize.js";

/**
 * Tests for normalizeUpc — the canonical UPC normalizer. Load-bearing for
 * the 97% catalog UPC match rate: the MLCC ingest (write side) and the
 * scanner lookup (read side) both call this, and a scan matches a catalog
 * row ONLY when both sides normalize to the identical string. A regression
 * here silently drops match rate.
 */

describe("normalizeUpc — canonical form", () => {
  it("pads an 11-digit UPC to 12-digit UPC-A", () => {
    expect(normalizeUpc("82184038727")).toBe("082184038727");
  });

  it("leaves a clean 12-digit UPC-A unchanged", () => {
    expect(normalizeUpc("858349004148")).toBe("858349004148");
  });

  it("pads a short-but-valid code to 12 digits", () => {
    expect(normalizeUpc("123456")).toBe("000000123456");
  });
});

describe("normalizeUpc — THE critical property: write and read sides match", () => {
  it("MLCC GTIN-14 and NRS 12-digit UPC normalize to the same string", () => {
    // MLCC TXT publishes "00858349004148"; NRS exports "858349004148".
    // Same physical product — must normalize identically or it never matches.
    const fromMlcc = normalizeUpc("00858349004148");
    const fromNrs = normalizeUpc("858349004148");
    expect(fromMlcc).toBe(fromNrs);
    expect(fromMlcc).toBe("858349004148");
  });

  it("accepts a numeric input the same as its string form", () => {
    expect(normalizeUpc(858349004148)).toBe(normalizeUpc("858349004148"));
  });
});

describe("normalizeUpc — strips noise", () => {
  it("strips spaces", () => {
    expect(normalizeUpc("  858349004148  ")).toBe("858349004148");
  });

  it("strips dashes", () => {
    expect(normalizeUpc("8-5834-9004148")).toBe("858349004148");
  });

  it("strips a leading = (NRS Excel-formula wrapping)", () => {
    expect(normalizeUpc("=858349004148")).toBe("858349004148");
  });
});

describe("normalizeUpc — returns null for non-UPCs", () => {
  it("null / undefined / empty", () => {
    expect(normalizeUpc(null)).toBeNull();
    expect(normalizeUpc(undefined)).toBeNull();
    expect(normalizeUpc("")).toBeNull();
  });

  it("MLCC all-zero 'no UPC on file' placeholder", () => {
    expect(normalizeUpc("0000000000000")).toBeNull();
    expect(normalizeUpc("000000000000")).toBeNull();
  });

  it("strings with no digits at all", () => {
    expect(normalizeUpc("abcdef")).toBeNull();
    expect(normalizeUpc("--- ---")).toBeNull();
  });

  it("too short after leading-zero strip (< 6 significant digits)", () => {
    expect(normalizeUpc("12345")).toBeNull();
    expect(normalizeUpc("0000012345")).toBeNull();
  });

  it("too long (> 14 significant digits) — likely junk", () => {
    expect(normalizeUpc("123456789012345")).toBeNull();
  });
});

describe("normalizeUpc — preserves long real-world barcodes", () => {
  it("keeps a 13-digit EAN with a non-zero leading digit", () => {
    expect(normalizeUpc("5012345678900")).toBe("5012345678900");
  });

  it("keeps a 14-digit GTIN that does not reduce under 13 after strip", () => {
    expect(normalizeUpc("50123456789012")).toBe("50123456789012");
  });
});

describe("isPlausibleUpc", () => {
  it("true when normalizeUpc yields a value", () => {
    expect(isPlausibleUpc("858349004148")).toBe(true);
    expect(isPlausibleUpc("00858349004148")).toBe(true);
  });

  it("false for placeholders, junk, and empties", () => {
    expect(isPlausibleUpc("0000000000000")).toBe(false);
    expect(isPlausibleUpc("12345")).toBe(false);
    expect(isPlausibleUpc(null)).toBe(false);
    expect(isPlausibleUpc("abcdef")).toBe(false);
  });
});
