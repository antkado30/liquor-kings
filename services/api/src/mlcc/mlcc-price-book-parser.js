import ExcelJS from "exceljs";
import {
  Worker,
  isMainThread,
  workerData,
  receiveMessageOnPort,
  MessageChannel,
} from "node:worker_threads";

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
function normalizeExcelCellValue(val) {
  if (val == null) return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return val;
  }
  if (val instanceof Date) {
    return val;
  }
  if (typeof val === "object") {
    const o = /** @type {{ richText?: { text?: string }[]; text?: unknown; result?: unknown }} */ (val);
    if (Array.isArray(o.richText)) {
      return o.richText.map((t) => String(t.text ?? "")).join("");
    }
    if (o.text != null) {
      return o.text;
    }
    if (o.result !== undefined && o.result !== null) {
      return o.result;
    }
  }
  return val;
}

/**
 * @param {import("exceljs").Row} row
 * @param {number} width
 * @returns {unknown[]}
 */
function excelRowTo0BasedArray(row, width) {
  const arr = /** @type {unknown[]} */ ([]);
  for (let c = 1; c <= width; c++) {
    arr[c - 1] = normalizeExcelCellValue(row.getCell(c).value);
  }
  return arr;
}

/**
 * @param {import("exceljs").Worksheet} worksheet
 * @returns {unknown[][]}
 */
function worksheetToRowArrays(worksheet) {
  const rowCount = worksheet.rowCount;
  if (!rowCount) return [];

  const widthFromSheet = worksheet.columnCount || 0;
  const headerRow = worksheet.getRow(1);
  const headerSpan = headerRow.values && headerRow.values.length > 1 ? headerRow.values.length - 1 : 0;
  const width = Math.max(widthFromSheet, headerSpan, 1);

  /** @type {unknown[][]} */
  const rows = [];
  for (let r = 1; r <= rowCount; r++) {
    rows.push(excelRowTo0BasedArray(worksheet.getRow(r), width));
  }
  return rows;
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ ok: true, items: object[], priceBookDate: Date, errors: string[] } | { ok: false, items: [], errors: string[] }>}
 */
async function parseMlccPriceBookExcelAsync(buffer) {
  try {
    let workbook;
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
    } catch (e) {
      return { ok: false, items: [], errors: [e instanceof Error ? e.message : String(e)] };
    }

    const worksheet = workbook.getWorksheet(1) ?? workbook.worksheets[0];
    if (!worksheet) {
      return { ok: false, items: [], errors: ["Workbook has no sheets"] };
    }

    const rows = worksheetToRowArrays(worksheet);
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

if (!isMainThread) {
  const wd = /** @type {{ port: import("node:worker_threads").MessagePort; buffer: Buffer }} */ (
    workerData
  );
  const { port, buffer } = wd;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  parseMlccPriceBookExcelAsync(buf).then(
    (res) => {
      port.postMessage(res);
    },
    (e) => {
      port.postMessage({
        ok: false,
        items: [],
        errors: [e instanceof Error ? e.message : String(e)],
      });
    }
  );
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

    if (!isMainThread) {
      return { ok: false, items: [], errors: ["parseMlccPriceBookExcel must run on the main thread"] };
    }

    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { port: port2, buffer },
      transferList: [port2],
    });

    /** @type {{ message: unknown } | undefined} */
    let received;
    while ((received = receiveMessageOnPort(port1)) === undefined) {
      // Worker runs parseMlccPriceBookExcelAsync on another thread; busy-wait until postMessage.
    }

    void worker.terminate();

    const payload = /** @type {{ ok: boolean, items: object[], priceBookDate?: Date, errors: string[] }} */ (
      received.message
    );
    return payload;
  } catch (e) {
    return { ok: false, items: [], errors: [e instanceof Error ? e.message : String(e)] };
  }
}
