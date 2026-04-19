import XLSX from "xlsx";

const COL = {
  ADA_NUMBER: "ADA NUMBER",
  LIQUOR_CODE: "LIQUOR CODE",
  BRAND_NAME: "BRAND NAME - FINAL",
  PROOF: "PROOF",
  BOTTLE_SIZE: "BOTTLE SIZE",
  CASE_SIZE: "CASE SIZE",
  BASE_PRICE: "BASE PRICE",
  LICENSEE_PRICE: "LICENSEE PRICE",
  MINIMUM_SHELF_PRICE: "MINIMUM SHELF PRICE",
};

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

function normalizeHeader(cell) {
  if (cell == null) return "";
  return String(cell).replace(/\s+/g, " ").trim().toUpperCase();
}

function buildHeaderMap(headerRow) {
  /** @type {Record<string, number>} */
  const map = {};
  if (!Array.isArray(headerRow)) return map;
  headerRow.forEach((cell, idx) => {
    const key = normalizeHeader(cell);
    if (key) map[key] = idx;
  });
  return map;
}

function cell(row, headerMap, canonical) {
  const idx = headerMap[normalizeHeader(canonical)];
  if (idx === undefined) return undefined;
  return row[idx];
}

function parseNumber(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const n = Number.parseFloat(String(val).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseInteger(val) {
  const n = parseNumber(val);
  if (n == null) return null;
  const i = Math.round(n);
  return Number.isFinite(i) ? i : null;
}

function rowLooksLikeSectionMarker(row) {
  if (!Array.isArray(row) || row.length === 0) return false;
  const first = String(row[0] ?? "").trim().toUpperCase();
  if (!first) return false;
  return (
    first.includes("NEW ITEM") ||
    first.includes("NEW PRODUCTS") ||
    first === "NEW" ||
    first.startsWith("SECTION")
  );
}

function rowHasLiquorData(row, headerMap) {
  const code = cell(row, headerMap, COL.LIQUOR_CODE);
  return code != null && String(code).trim() !== "";
}

function detectNewFromFlag(row, headerMap) {
  for (const key of Object.keys(headerMap)) {
    if (key.includes("NEW ITEM")) continue;
    if (key === "NEW" || key === "CHNG" || key === "CHG" || key === "FLAG" || key === "STATUS" || key === "ITEM STATUS") {
      const v = String(row[headerMap[key]] ?? "").trim().toUpperCase();
      if (v === "NEW" || v === "CHNG" || v === "CHG" || v === "CHANGE" || v === "Y") return true;
    }
  }
  const joined = Array.isArray(row) ? row.map((c) => String(c ?? "").toUpperCase()).join(" ") : "";
  if (/\bNEW\b/.test(joined) && /\bCHNG\b/.test(joined)) return true;
  return false;
}

/**
 * @param {Buffer} buffer
 * @returns {{ ok: true, items: object[], priceBookDate: Date | null, errors: string[] } | { ok: false, items: [], errors: string[] }}
 */
export function parseMlccPriceBookExcel(buffer) {
  const errors = [];
  try {
    if (buffer == null || !(buffer instanceof Buffer) || buffer.length === 0) {
      errors.push("Invalid or empty Excel buffer");
      return { ok: false, items: [], errors };
    }

    let workbook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return { ok: false, items: [], errors };
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      errors.push("Workbook has no sheets");
      return { ok: false, items: [], errors };
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      errors.push("First sheet is missing");
      return { ok: false, items: [], errors };
    }

    /** @type {unknown[][]} */
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    if (!rows.length) {
      errors.push("Sheet is empty");
      return { ok: false, items: [], errors };
    }

    let headerMap = null;
    let headerRowIndex = -1;
    let inNewItemsSection = false;
    /** @type {Date | null} */
    let priceBookDate = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      if (rowLooksLikeSectionMarker(row)) {
        if (String(row[0] ?? "").toUpperCase().includes("NEW")) inNewItemsSection = true;
        continue;
      }

      const trialMap = buildHeaderMap(row);
      if (trialMap[normalizeHeader(COL.LIQUOR_CODE)] !== undefined && trialMap[normalizeHeader(COL.BRAND_NAME)] !== undefined) {
        headerMap = trialMap;
        headerRowIndex = i;
        break;
      }

      const line = row.map((c) => String(c ?? "").trim()).filter(Boolean).join(" ");
      const dateMatch = line.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
      if (dateMatch) {
        const d = new Date(Number(dateMatch[3]), Number(dateMatch[1]) - 1, Number(dateMatch[2]));
        if (!Number.isNaN(d.getTime())) priceBookDate = d;
      }
    }

    if (!headerMap || headerRowIndex < 0) {
      errors.push("Could not find a header row with LIQUOR CODE and BRAND NAME - FINAL");
      return { ok: false, items: [], errors };
    }

    const items = [];
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      if (rowLooksLikeSectionMarker(row)) {
        if (String(row[0] ?? "").toUpperCase().includes("NEW")) inNewItemsSection = true;
        continue;
      }
      if (!rowHasLiquorData(row, headerMap)) continue;

      const adaNumber = String(cell(row, headerMap, COL.ADA_NUMBER) ?? "").trim();
      const mlccCode = String(cell(row, headerMap, COL.LIQUOR_CODE) ?? "").trim();
      const brandName = String(cell(row, headerMap, COL.BRAND_NAME) ?? "").trim();
      const bottleSizeLabel = String(cell(row, headerMap, COL.BOTTLE_SIZE) ?? "").trim();

      const proof = parseNumber(cell(row, headerMap, COL.PROOF));
      const bottleSizeMl = parseBottleSizeMl(bottleSizeLabel);
      const caseSize = parseInteger(cell(row, headerMap, COL.CASE_SIZE));
      const basePrice = parseNumber(cell(row, headerMap, COL.BASE_PRICE));
      const licenseePrice = parseNumber(cell(row, headerMap, COL.LICENSEE_PRICE));
      const minShelfPrice = parseNumber(cell(row, headerMap, COL.MINIMUM_SHELF_PRICE));

      const flagNew = detectNewFromFlag(row, headerMap);
      const isNewItem = inNewItemsSection || flagNew;

      items.push({
        adaNumber,
        mlccCode,
        brandName,
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

    return { ok: true, items, priceBookDate, errors: [] };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { ok: false, items: [], errors };
  }
}
