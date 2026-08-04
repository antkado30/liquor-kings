import { describe, expect, it } from "vitest";
import {
  isFullPriceBookXlsxHref,
  isNewItemListXlsxHref,
  isRetailPriceChangesXlsxHref,
  isAdaChangesXlsxHref,
  assertNewItemListRowCount,
  nextPreviousLicenseePrice,
} from "./mlcc-price-book-ingestor.js";

/*
  Discovery contract pins (2026-07-12, Option A — new-item list ingest).
  The two href matchers are the fork in the road between "replace the
  whole catalog's prices" and "additively add a few dozen SKUs". A file
  matching BOTH, or the wrong one, is how a full book gets ingested as a
  new-item list (mass is_new_item=true) or vice versa. Pin the fence.
*/

describe("isFullPriceBookXlsxHref", () => {
  it("matches the canonical full book href", () => {
    expect(
      isFullPriceBookXlsxHref("/lara/-/media/lcc/june-2026-price-book-excel.xlsx"),
    ).toBe(true);
  });
  it("still excludes every between-book variant (the 7/4 exclusion list)", () => {
    expect(isFullPriceBookXlsxHref("/lcc/june-2026-new-item-price-book-excel.xlsx")).toBe(false);
    expect(isFullPriceBookXlsxHref("/lcc/ada-changes-price-book-excel.xlsx")).toBe(false);
    expect(isFullPriceBookXlsxHref("/lcc/retail-price-changes-price-book-excel.xlsx")).toBe(false);
    expect(isFullPriceBookXlsxHref("/lcc/products-from-mi-price-book-excel.xlsx")).toBe(false);
  });
  it("rejects non-xlsx and non-price-book files", () => {
    expect(isFullPriceBookXlsxHref("/lcc/june-2026-price-book.pdf")).toBe(false);
    expect(isFullPriceBookXlsxHref("/lcc/some-other-report.xlsx")).toBe(false);
  });
});

describe("isNewItemListXlsxHref", () => {
  it("matches new-item xlsx hrefs in the shapes MLCC uses", () => {
    expect(isNewItemListXlsxHref("/lcc/june-2026-new-item-price-book-excel.xlsx")).toBe(true);
    expect(isNewItemListXlsxHref("/lara/-/media/lcc/new-item-price-list-june.xlsx")).toBe(true);
  });
  it("NEVER matches a full book or the other between-book variants", () => {
    expect(isNewItemListXlsxHref("/lcc/june-2026-price-book-excel.xlsx")).toBe(false);
    expect(isNewItemListXlsxHref("/lcc/ada-changes-price-book-excel.xlsx")).toBe(false);
    expect(isNewItemListXlsxHref("/lcc/retail-price-changes-price-book-excel.xlsx")).toBe(false);
  });
  it("rejects non-xlsx even when the path says new-item", () => {
    expect(isNewItemListXlsxHref("/lcc/new-item-price-list.pdf")).toBe(false);
  });
  it("a full-book href can never satisfy BOTH matchers", () => {
    const full = "/lara/-/media/lcc/june-2026-price-book-excel.xlsx";
    expect(isFullPriceBookXlsxHref(full) && isNewItemListXlsxHref(full)).toBe(false);
  });
});

/*
  Between-book family pins (2026-08-04). All four matchers walk the SAME
  info-page anchors — a single href satisfying two of them is how a
  40-row changes list mass-updates the catalog (or vice versa). The live
  hrefs below were read off the real LCC page on 2026-08-04.
*/
const LIVE = {
  full: "/lara/-/media/project/websites/lara/lcc/price-book/5-3-26-price-book-excel.xlsx",
  newItem: "/lara/-/media/project/websites/lara/lcc/price-book/5-3-26-new-item-price-list-excel.xlsx",
  retail: "/lara/-/media/project/websites/lara/lcc/price-book/5-3-26-retail-price-changes-excel.xlsx",
  ada: "/lara/-/media/project/websites/lara/lcc/price-book/5-3-26-ada-changes-excel.xlsx",
  miMfr: "/lara/-/media/project/websites/lara/lcc/price-book/5-3-26-products-from-mi-manufacturer-excel.xlsx",
};

describe("isRetailPriceChangesXlsxHref", () => {
  it("matches the live Retail Price Changes href", () => {
    expect(isRetailPriceChangesXlsxHref(LIVE.retail)).toBe(true);
  });
  it("rejects every other live file and non-xlsx", () => {
    expect(isRetailPriceChangesXlsxHref(LIVE.full)).toBe(false);
    expect(isRetailPriceChangesXlsxHref(LIVE.newItem)).toBe(false);
    expect(isRetailPriceChangesXlsxHref(LIVE.ada)).toBe(false);
    expect(isRetailPriceChangesXlsxHref(LIVE.miMfr)).toBe(false);
    expect(isRetailPriceChangesXlsxHref("/lcc/retail-price-changes.pdf")).toBe(false);
  });
});

describe("isAdaChangesXlsxHref", () => {
  it("matches the live ADA Changes href", () => {
    expect(isAdaChangesXlsxHref(LIVE.ada)).toBe(true);
  });
  it("rejects every other live file and non-xlsx", () => {
    expect(isAdaChangesXlsxHref(LIVE.full)).toBe(false);
    expect(isAdaChangesXlsxHref(LIVE.newItem)).toBe(false);
    expect(isAdaChangesXlsxHref(LIVE.retail)).toBe(false);
    expect(isAdaChangesXlsxHref("/lcc/ada-changes.pdf")).toBe(false);
  });
});

describe("matcher mutual exclusion across the whole family", () => {
  it("every live href satisfies EXACTLY ONE matcher (MI-manufacturer: none)", () => {
    const matchers = [
      isFullPriceBookXlsxHref,
      isNewItemListXlsxHref,
      isRetailPriceChangesXlsxHref,
      isAdaChangesXlsxHref,
    ];
    const countFor = (href) => matchers.filter((m) => m(href)).length;
    expect(countFor(LIVE.full)).toBe(1);
    expect(countFor(LIVE.newItem)).toBe(1);
    expect(countFor(LIVE.retail)).toBe(1);
    expect(countFor(LIVE.ada)).toBe(1);
    expect(countFor(LIVE.miMfr)).toBe(0);
  });
});

describe("assertNewItemListRowCount", () => {
  it("accepts a plausible list size", () => {
    expect(assertNewItemListRowCount(1, 2000).ok).toBe(true);
    expect(assertNewItemListRowCount(58, 2000).ok).toBe(true);
    expect(assertNewItemListRowCount(2000, 2000).ok).toBe(true);
  });
  it("fails CLOSED on zero rows (parse mis-fire / layout change)", () => {
    const r = assertNewItemListRowCount(0, 2000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/0 rows/);
  });
  it("fails CLOSED on full-book-sized input (mis-grab guard)", () => {
    const r = assertNewItemListRowCount(13828, 2000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/FULL price book/);
  });
  it("names the kind in the error when a label is given (2026-08-04 family)", () => {
    const r = assertNewItemListRowCount(0, 2000, "Retail Price Changes");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Retail Price Changes parsed to 0 rows/);
  });
});

/*
  Price memory pins (2026-08-01). The whole feature rests on this one
  pure decision: previous_licensee_price must be a REAL former shelf
  price or null — never invented, never lost by a book that didn't
  touch it. The upsert used to destroy the old price in place; these
  pins make that impossible to regress silently.
*/
describe("nextPreviousLicenseePrice", () => {
  it("a brand-new item has no history", () => {
    expect(nextPreviousLicenseePrice(undefined, 12.99)).toBe(null);
  });

  it("captures the outgoing price when the licensee price moves", () => {
    const existing = { licensee_price: 11.49, previous_licensee_price: null };
    expect(nextPreviousLicenseePrice(existing, 12.99)).toBe(11.49);
  });

  it("a second move overwrites the memory with the latest outgoing price", () => {
    const existing = { licensee_price: 12.99, previous_licensee_price: 11.49 };
    expect(nextPreviousLicenseePrice(existing, 13.49)).toBe(12.99);
  });

  it("carries the memory forward when the licensee price is unchanged", () => {
    const existing = { licensee_price: 12.99, previous_licensee_price: 11.49 };
    expect(nextPreviousLicenseePrice(existing, 12.99)).toBe(11.49);
  });

  it("a base-only book change never destroys the memory (licensee untouched → carry)", () => {
    // The caller only hands this function the LICENSEE price — base and
    // min-shelf moves are invisible here by design, so they cannot wipe it.
    const existing = { licensee_price: 12.99, previous_licensee_price: 11.49 };
    expect(nextPreviousLicenseePrice(existing, 12.99)).toBe(11.49);
  });

  it("numeric-string DB values compare as numbers, not strings", () => {
    // Supabase numeric columns arrive as strings; "12.99" vs 12.99 is NOT a move.
    const existing = { licensee_price: "12.99", previous_licensee_price: "11.49" };
    expect(nextPreviousLicenseePrice(existing, 12.99)).toBe("11.49");
  });

  it("an outgoing null price is not a memory (no 'was blank' chips)", () => {
    const existing = { licensee_price: null, previous_licensee_price: null };
    expect(nextPreviousLicenseePrice(existing, 12.99)).toBe(null);
  });

  it("rows that predate the column carry null, not undefined", () => {
    const existing = { licensee_price: 12.99 };
    expect(nextPreviousLicenseePrice(existing, 12.99)).toBe(null);
  });
});
