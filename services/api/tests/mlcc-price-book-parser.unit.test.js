import { describe, it, expect } from "vitest";
import XLSX from "xlsx";
import {
  deriveAdaName,
  parseBottleSizeMl,
  parseMlccPriceBookExcel,
} from "../src/mlcc/mlcc-price-book-parser.js";

describe("mlcc-price-book-parser", () => {
  describe("parseBottleSizeMl", () => {
    it("parses ML labels", () => {
      expect(parseBottleSizeMl("750 ML")).toBe(750);
      expect(parseBottleSizeMl("1000 ML")).toBe(1000);
      expect(parseBottleSizeMl("375 ML")).toBe(375);
    });

    it("parses liter labels", () => {
      expect(parseBottleSizeMl("1.75 L")).toBe(1750);
    });

    it("returns null for empty or garbage", () => {
      expect(parseBottleSizeMl("")).toBeNull();
      expect(parseBottleSizeMl("   ")).toBeNull();
      expect(parseBottleSizeMl("n/a")).toBeNull();
      expect(parseBottleSizeMl(null)).toBeNull();
    });
  });

  describe("deriveAdaName", () => {
    it("maps known ADA numbers", () => {
      expect(deriveAdaName("141")).toBe("Imperial Beverage");
      expect(deriveAdaName("221")).toBe("General Wine & Liquor");
      expect(deriveAdaName("321")).toBe("NWS Michigan");
      expect(deriveAdaName("999")).toBe("Unknown");
    });
  });

  describe("parseMlccPriceBookExcel", () => {
    it("parses a minimal workbook built with xlsx", () => {
      const header = [
        "ADA NUMBER",
        "LIQUOR CODE",
        "BRAND NAME - FINAL",
        "PROOF",
        "BOTTLE SIZE",
        "CASE SIZE",
        "BASE PRICE",
        "LICENSEE PRICE",
        "MINIMUM SHELF PRICE",
        "FLAG",
      ];
      const rows = [
        header,
        ["141", "1001", "Alpha Vodka", "80", "750 ML", "12", "20.5", "18", "22", "NEW"],
        ["221", "1002", "Beta Gin", "90", "1000 ML", "6", "30", "28", "35", ""],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const out = parseMlccPriceBookExcel(buffer);
      expect(out.ok).toBe(true);
      expect(out.errors).toEqual([]);
      expect(out.items).toHaveLength(2);
      expect(out.items[0]).toMatchObject({
        adaNumber: "141",
        mlccCode: "1001",
        brandName: "Alpha Vodka",
        proof: 80,
        bottleSizeLabel: "750 ML",
        bottleSizeMl: 750,
        caseSize: 12,
        basePrice: 20.5,
        licenseePrice: 18,
        minShelfPrice: 22,
        isNewItem: true,
      });
      expect(out.items[1]).toMatchObject({
        adaNumber: "221",
        mlccCode: "1002",
        isNewItem: false,
        bottleSizeMl: 1000,
      });
    });

    it("returns ok false for null without throwing", () => {
      expect(() => parseMlccPriceBookExcel(/** @type {any} */ (null))).not.toThrow();
      const out = parseMlccPriceBookExcel(null);
      expect(out.ok).toBe(false);
      expect(out.items).toEqual([]);
      expect(out.errors.length).toBeGreaterThan(0);
    });

    it("returns ok false for empty buffer without throwing", () => {
      const out = parseMlccPriceBookExcel(Buffer.alloc(0));
      expect(out.ok).toBe(false);
      expect(out.items).toEqual([]);
    });
  });
});
