import XLSX from "xlsx";

/**
 * @param {string | null | undefined} adaNumber
 * @returns {string}
 */
export function deriveAdaName(adaNumber) {
  const n = String(adaNumber ?? "").trim();
  if (n === "141") return "Imperial Beverage";
  if (n === "221") return "General Wine & Liquor";
  if (n === "321") return "NWS Michigan";
  return "Unknown";
}

/**
 * @param {string | null | undefined} sizeLabel
 * @returns {number | null}
 */
export function parseBottleSizeMl(sizeLabel) {
  if (sizeLabel == null) return null;
  const s = String(sizeLabel).trim();
  if (!s) return null;

  const mlMatch = s.match(/(\d+(?:\.\d+)?)\s*ML\b/i);
  if (mlMatch) {
    const v = Number.parseFloat(mlMatch[1]);
    return Number.isFinite(v) ? Math.round(v) : null;
  }

  const lMatch = s.match(/(\d+(?:\.\d+)?)\s*L\b/i);
  if (lMatch) {
    const liters = Number.parseFloat(lMatch[1]);
    if (!Number.isFinite(liters)) return null;
    return Math.round(liters * 1000);
  }

  return null;
}

/**
 * @param {unknown} cell
 */
function normalizeHeaderCell(cell) {
  return String(cell ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {unknown[]} headerRow
 * @returns {{
 *   mlccCodeIdx: number,
 *   brandNameIdx: number,
 *   adaNumberIdx?: number,
 *   liquorTypeIdx: number,
 *   proofIdx?: number,
 *   bottleSizeIdx?: number,
 *   caseSizeIdx?: number,
 *   basePriceIdx?: number,
 *   licenseePriceIdx?: number,
 *   minShelfPriceIdx?: number,
 *   newChngIdx?: number,
 * } | null}
 */
function resolveColumnIndices(headerRow) {
  if (!Array.isArray(headerRow)) return null;

  /** @type {Record<string, number | undefined>} */
  const idx = {};

  for (let i = 0; i < headerRow.length; i++) {
    const h = normalizeHeaderCell(headerRow[i]);
    if (!h) continue;

    if (idx.mlccCode === undefined && h.includes("liqour") && h.includes("code")) {
      idx.mlccCode = i;
      continue;
    }
    if (idx.mlccCode === undefined && h.includes("liquor") && h.includes("code")) {
      idx.mlccCode = i;
      continue;
    }

    if (idx.brandName === undefined && h.includes("brand name")) {
      idx.brandName = i;
      continue;
    }

    if (idx.adaNumber === undefined && (h.includes("ada #") || h.includes("ada number"))) {
      idx.adaNumber = i;
      continue;
    }

    if (idx.liquorType === undefined && h.includes("liquor type")) {
      idx.liquorType = i;
      continue;
    }

    if (idx.proof === undefined && h === "proof") {
      idx.proof = i;
      continue;
    }

    if (idx.bottleSize === undefined && h.includes("bottle size")) {
      idx.bottleSize = i;
      continue;
    }

    if (idx.caseSize === undefined && h.includes("case size")) {
      idx.caseSize = i;
      continue;
    }

    if (idx.basePrice === undefined && h.includes("base price")) {
      idx.basePrice = i;
      continue;
    }

    if (idx.licenseePrice === undefined && h.includes("licensee price")) {
      idx.licenseePrice = i;
      continue;
    }

    if (
      idx.minShelfPrice === undefined &&
      (h.includes("minimum shelf price") || h.includes("min shelf price"))
    ) {
      idx.minShelfPrice = i;
      continue;
    }

    if (
      idx.newChng === undefined &&
      (h.includes("new/chng") ||
        h.includes("new/chg") ||
        h === "new" ||
        /^new\s*\/\s*ch/i.test(h))
    ) {
      idx.newChng = i;
      continue;
    }
  }

  if (idx.mlccCode === undefined || idx.brandName === undefined) {
    return null;
  }

  const liquorTypeIdx = idx.liquorType !== undefined ? idx.liquorType : 0;

  return {
    mlccCodeIdx: idx.mlccCode,
    brandNameIdx: idx.brandName,
    adaNumberIdx: idx.adaNumber,
    liquorTypeIdx,
    proofIdx: idx.proof,
    bottleSizeIdx: idx.bottleSize,
    caseSizeIdx: idx.caseSize,
    basePriceIdx: idx.basePrice,
    licenseePriceIdx: idx.licenseePrice,
    minShelfPriceIdx: idx.minShelfPrice,
    newChngIdx: idx.newChng,
  };
}

/**
 * @param {unknown} val
 */
function cellStr(row, colIdx) {
  if (colIdx === undefined || !Array.isArray(row)) return "";
  const v = row[colIdx];
  return String(v ?? "").trim();
}

/**
 * @param {unknown} val
 */
function parseFloatOrNull(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const n = Number.parseFloat(String(val).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} val
 */
function parseIntOrNull(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) return Math.round(val);
  const n = Number.parseInt(String(val).replace(/[,]/g, "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Category rows: non-empty liquor type cell that looks like a section header.
 * @param {string} s
 */
function looksLikeCategoryHeader(s) {
  const t = s.trim();
  if (!t) return false;
  if (/^\d/.test(t)) return true;
  if (t.includes("-")) return true;
  return false;
}

/**
 * MLCC liquor codes in the price book are numeric strings.
 * @param {string} code
 */
function isNumericMlccCode(code) {
  return /^\d+$/.test(code.trim());
}

/**
 * @param {Buffer} buffer
 * @returns {{ ok: true, items: object[], priceBookDate: Date, errors: string[] } | { ok: false, items: [], errors: string[] }}
 */
export function parseMlccPriceBookExcel(buffer) {
  try {
    if (buffer == null || !(buffer instanceof Buffer) || buffer.length === 0) {
      return { ok: false, items: [], errors: ["Invalid or empty Excel buffer"] };
    }

    let workbook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch (e) {
      return { ok: false, items: [], errors: [e instanceof Error ? e.message : String(e)] };
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { ok: false, items: [], errors: ["Workbook has no sheets"] };
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return { ok: false, items: [], errors: ["First sheet is missing"] };
    }

    /** @type {unknown[][]} */
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
    if (!rows.length) {
      return { ok: false, items: [], errors: ["Sheet is empty"] };
    }

    const headerRow = rows[0];
    const cols = resolveColumnIndices(headerRow);
    if (!cols) {
      return { ok: false, items: [], errors: ["Could not find required columns"] };
    }

    const {
      mlccCodeIdx,
      brandNameIdx,
      adaNumberIdx,
      liquorTypeIdx,
      proofIdx,
      bottleSizeIdx,
      caseSizeIdx,
      basePriceIdx,
      licenseePriceIdx,
      minShelfPriceIdx,
      newChngIdx,
    } = cols;

    let currentCategory = "";
    const items = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      const typeCell = cellStr(row, liquorTypeIdx);
      if (typeCell && looksLikeCategoryHeader(typeCell)) {
        currentCategory = typeCell;
      }

      const mlccCode = cellStr(row, mlccCodeIdx);
      if (!mlccCode || !isNumericMlccCode(mlccCode)) {
        continue;
      }

      const brandName = cellStr(row, brandNameIdx);
      if (!brandName) {
        continue;
      }

      const adaNumber = adaNumberIdx !== undefined ? cellStr(row, adaNumberIdx) : "";
      const bottleSizeLabel = bottleSizeIdx !== undefined ? cellStr(row, bottleSizeIdx) : "";
      const proof = proofIdx !== undefined ? parseFloatOrNull(row[proofIdx]) : null;
      const bottleSizeMl = parseBottleSizeMl(bottleSizeLabel);
      const caseSize = caseSizeIdx !== undefined ? parseIntOrNull(row[caseSizeIdx]) : null;
      const basePrice = basePriceIdx !== undefined ? parseFloatOrNull(row[basePriceIdx]) : null;
      const licenseePrice = licenseePriceIdx !== undefined ? parseFloatOrNull(row[licenseePriceIdx]) : null;
      const minShelfPrice = minShelfPriceIdx !== undefined ? parseFloatOrNull(row[minShelfPriceIdx]) : null;
      const isNewItem =
        newChngIdx !== undefined ? String(row[newChngIdx] ?? "").trim().length > 0 : false;

      items.push({
        mlccCode,
        brandName,
        adaNumber,
        category: currentCategory,
        proof,
        bottleSizeLabel,
        bottleSizeMl,
        caseSize,
        basePrice,
        licenseePrice,
        minShelfPrice,
        isNewItem,
      });
    }

    return { ok: true, items, priceBookDate: new Date(), errors: [] };
  } catch (e) {
    return { ok: false, items: [], errors: [e instanceof Error ? e.message : String(e)] };
  }
}
