import { describe, expect, it } from "vitest";
import {
  isFullPriceBookXlsxHref,
  isNewItemListXlsxHref,
  assertNewItemListRowCount,
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
});
