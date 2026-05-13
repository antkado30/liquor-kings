/**
 * MLCC price book — UPC enrichment from the TXT version.
 *
 * Background: MLCC publishes the spirits price book in TWO formats on the
 * same info page:
 *   - .xlsx (the one we already ingest for catalog data — pricing, sizes, etc.)
 *   - .txt (same data PLUS a "GTIN/UPC" column that the xlsx does NOT have)
 *
 * The xlsx has been our authoritative source for everything except UPCs.
 * The txt fills the UPC gap. Tony Kado spotted this 2026-05-13 after weeks
 * of trying to get UPC data via distributor outreach (which is structurally
 * blocked). MLCC literally publishes it. This module wires it in.
 *
 * Pipeline:
 *   1. Discover the latest TXT URL from the same info page we use for XLSX
 *   2. Download + parse — extract a Map<liquor_code, canonical_upc>
 *   3. Update mlcc_items.upc for each row (matched by code)
 *
 * Idempotent: re-running enriches rows already filled in (same UPCs, same
 * canonical form via normalizeUpc) — no-op effective.
 *
 * Designed to run after the existing xlsx upsert finishes, so every row
 * gets BOTH catalog data and UPC in one ingest pass.
 */

import { normalizeUpc } from "../lib/upc-normalize.js";

const MLCC_PRICE_BOOK_INFO_URL =
  "https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info";

const DISCOVER_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;

// Header values we look for to identify the GTIN/UPC + Liquor Code columns
// in the txt file. Case-insensitive, whitespace-tolerant. If MLCC ever
// renames these columns, this is the single place to update.
const UPC_HEADER_RE = /^\s*GTIN\s*\/\s*UPC\s*$/i;
const CODE_HEADER_RE = /^\s*Liquor\s+Code\s*$/i;

function decodeBasicEntities(s) {
  return String(s ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function absolutizeMlccHref(hrefRaw) {
  const decoded = decodeBasicEntities(hrefRaw).trim();
  if (!decoded) return null;
  if (/^https?:\/\//i.test(decoded)) return decoded;
  if (decoded.startsWith("//")) return `https:${decoded}`;
  if (decoded.startsWith("/")) return `https://www.michigan.gov${decoded}`;
  return null;
}

function anchorVisibleText(innerHtml) {
  return decodeBasicEntities(innerHtml.replace(/<[^>]+>/g, " "));
}

/**
 * Full spirits price book TXT (not new-item list, ADA changes, etc.).
 * @param {string} hrefPathLower path + filename before query, lowercased
 */
function isFullPriceBookTxtHref(hrefPathLower) {
  if (!hrefPathLower.endsWith(".txt")) return false;
  if (!hrefPathLower.includes("price-book")) return false;
  if (
    /new-item|ada-changes|retail-price-changes|products-from-mi|mi-manufacturer/i.test(
      hrefPathLower,
    )
  ) {
    return false;
  }
  // MLCC names this file like "May-2-2026-Price-Book-TXT.txt"
  return /price-book-txt\.txt$/i.test(hrefPathLower);
}

function isPreferredPriceBookTxtLabel(label) {
  const L = String(label ?? "").toLowerCase();
  if (!L.includes("price book")) return false;
  if (L.includes("new item")) return false;
  if (L.includes("ada changes")) return false;
  if (L.includes("retail price changes")) return false;
  // "Price Book (TXT)" or "Price Book TXT" or similar
  return L.includes("txt");
}

/**
 * Discover the latest full MLCC price book TXT URL from the info page.
 * Mirrors discoverLatestPriceBookUrl in mlcc-price-book-ingestor.js but
 * scans for .txt instead of .xlsx.
 *
 * @returns {Promise<{ ok: true, url: string, label: string } | { ok: false, error: string }>}
 */
export async function discoverLatestPriceBookTxtUrl() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(MLCC_PRICE_BOOK_INFO_URL, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LiquorKingsPriceBook/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} fetching price book info page` };
    }
    const html = await res.text();
    if (!html) return { ok: false, error: "Empty price book info page response" };

    const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const candidates = [];
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
      const hrefRaw = m[1];
      const hrefPathLower = decodeBasicEntities(hrefRaw).split("?")[0].trim().toLowerCase();
      if (!isFullPriceBookTxtHref(hrefPathLower)) continue;
      const label = anchorVisibleText(m[2]);
      candidates.push({ hrefRaw, label });
    }

    if (!candidates.length) {
      return { ok: false, error: "No full price book TXT link found on the info page" };
    }

    const preferred = candidates.filter((c) => isPreferredPriceBookTxtLabel(c.label));
    const chosen = (preferred.length ? preferred : candidates)[0];
    const url = absolutizeMlccHref(chosen.hrefRaw);
    if (!url) return { ok: false, error: "Could not resolve absolute URL for price book TXT" };
    return { ok: true, url, label: chosen.label || url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Price book TXT URL discovery failed" };
  }
}

/**
 * Download the price book TXT.
 * @param {string} [urlOverride]
 * @returns {Promise<{ ok: true, text: string, url: string } | { ok: false, error: string, url?: string }>}
 */
export async function fetchPriceBookTxt(urlOverride) {
  let url = urlOverride && String(urlOverride).trim();
  if (!url) {
    const disc = await discoverLatestPriceBookTxtUrl();
    if (!disc.ok) return { ok: false, error: disc.error };
    url = disc.url;
    console.log("[upc-enrichment] discovered price book TXT URL:", url);
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} downloading price book TXT`, url };
    const text = await res.text();
    if (!text || text.length < 100) {
      return { ok: false, error: "Downloaded TXT is empty or too small", url };
    }
    return { ok: true, text, url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "TXT download failed", url };
  }
}

/**
 * Split a line by tabs OR by 2+ consecutive whitespace characters (handles
 * both true tab-delimited files and column-aligned fixed-width-ish exports).
 *
 * @param {string} line
 */
function splitFields(line) {
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  // Multi-space fallback — fields may legitimately contain single spaces
  // (e.g. "GENTLEMAN JACK 250TH ANNIVERSARY") so only split on 2+ whitespace.
  return line.split(/\s{2,}/).map((s) => s.trim());
}

/**
 * Parse the price book TXT into a Map<liquor_code, canonical_upc>. Headers
 * are inspected to locate the Liquor Code + GTIN/UPC columns by name so we
 * don't depend on column ordering staying stable.
 *
 * Returns counts in `stats` so the caller can report what happened.
 *
 * @param {string} text
 * @returns {{ map: Map<string, string>, stats: { totalLines: number, headerFound: boolean, rowsParsed: number, rowsWithUpc: number, rowsWithoutUpc: number, rowsInvalid: number, codeColIdx: number | null, upcColIdx: number | null } }}
 */
export function parseUpcMapFromTxt(text) {
  const stats = {
    totalLines: 0,
    headerFound: false,
    rowsParsed: 0,
    rowsWithUpc: 0,
    rowsWithoutUpc: 0,
    rowsInvalid: 0,
    codeColIdx: /** @type {number | null} */ (null),
    upcColIdx: /** @type {number | null} */ (null),
  };
  /** @type {Map<string, string>} */
  const map = new Map();

  const lines = String(text).split(/\r?\n/);
  stats.totalLines = lines.length;

  // Find header line — first line that contains BOTH a Liquor Code-ish
  // column AND a GTIN/UPC-ish column.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 50); i += 1) {
    const fields = splitFields(lines[i]);
    const codeIdx = fields.findIndex((f) => CODE_HEADER_RE.test(f));
    const upcIdx = fields.findIndex((f) => UPC_HEADER_RE.test(f));
    if (codeIdx >= 0 && upcIdx >= 0) {
      headerIdx = i;
      stats.codeColIdx = codeIdx;
      stats.upcColIdx = upcIdx;
      stats.headerFound = true;
      break;
    }
  }

  if (!stats.headerFound) {
    return { map, stats };
  }

  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;
    const fields = splitFields(line);
    if (fields.length <= Math.max(stats.codeColIdx, stats.upcColIdx)) {
      stats.rowsInvalid += 1;
      continue;
    }
    const rawCode = fields[stats.codeColIdx];
    const rawUpc = fields[stats.upcColIdx];
    // Liquor code must be all-digit, 1-6 chars typically. Strip anything
    // unexpected so a stray header reprint or footer doesn't get treated as
    // a row.
    const code = String(rawCode ?? "").replace(/\D/g, "");
    if (!code || code.length < 1 || code.length > 8) {
      stats.rowsInvalid += 1;
      continue;
    }
    stats.rowsParsed += 1;
    const canonical = normalizeUpc(rawUpc);
    if (canonical == null) {
      stats.rowsWithoutUpc += 1;
      continue;
    }
    map.set(code, canonical);
    stats.rowsWithUpc += 1;
  }

  return { map, stats };
}

/**
 * Update `mlcc_items.upc` for every row in the catalog that has a matching
 * UPC in the parsed map. Uses the `bulk_update_mlcc_upcs` Postgres function
 * (defined in the matching migration) — one atomic UPDATE FROM jsonb per
 * chunk. Previous per-row approach made 13,800 individual HTTP calls and
 * Kong (local Supabase proxy) dropped many of them mid-stream. RPC takes
 * ~14 round trips for the full catalog instead.
 *
 * Idempotent: re-running with same data is a no-op apart from the SET.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Map<string, string>} codeToUpc
 * @returns {Promise<{ totalCodes: number, submitted: number, updatedRows: number, missingMlccCodes: number, writeErrors: string[] }>}
 */
export async function applyUpcMapToMlccItems(supabase, codeToUpc) {
  const allItems = [...codeToUpc.entries()].map(([code, upc]) => ({ code, upc }));
  const result = {
    totalCodes: allItems.length,
    submitted: 0,
    updatedRows: 0,
    missingMlccCodes: 0,
    writeErrors: /** @type {string[]} */ ([]),
  };

  // Chunk to avoid huge JSON payloads. 1000 codes per chunk × ~60 bytes
  // per entry ≈ 60 KB payload — well under any limit.
  const CHUNK = 1000;
  for (let i = 0; i < allItems.length; i += CHUNK) {
    const chunk = allItems.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase.rpc("bulk_update_mlcc_upcs", {
        items: chunk,
      });
      if (error) {
        result.writeErrors.push(`chunk ${i / CHUNK}: ${error.message}`);
        continue;
      }
      const submitted = Number(data?.submitted ?? 0) || 0;
      const updated = Number(data?.updated ?? 0) || 0;
      result.submitted += submitted;
      result.updatedRows += updated;
      result.missingMlccCodes += Math.max(submitted - updated, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.writeErrors.push(`chunk ${i / CHUNK}: ${msg}`);
    }
    console.log(
      `[upc-enrichment] progress: ${Math.min(i + CHUNK, allItems.length)}/${allItems.length} codes processed, ${result.updatedRows} rows updated`,
    );
  }
  return result;
}

/**
 * End-to-end UPC enrichment: discover URL (or use override), download, parse,
 * apply to mlcc_items. Designed to be called after the existing xlsx upsert
 * inside ingestMlccPriceBook so every ingest run also refreshes UPCs.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ urlOverride?: string, dryRun?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, url?: string, error?: string, parse?: any, apply?: any }>}
 */
export async function runUpcEnrichment(supabase, options = {}) {
  const dryRun = options.dryRun === true;
  const dl = await fetchPriceBookTxt(options.urlOverride);
  if (!dl.ok) return { ok: false, error: dl.error };
  console.log("[upc-enrichment] downloaded TXT:", dl.url);

  const { map, stats } = parseUpcMapFromTxt(dl.text);
  console.log("[upc-enrichment] parse stats:", JSON.stringify(stats));
  if (!stats.headerFound) {
    return {
      ok: false,
      url: dl.url,
      error: "TXT header row not found (no Liquor Code + GTIN/UPC columns detected)",
      parse: stats,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      url: dl.url,
      parse: stats,
      apply: { dryRun: true, totalCodes: map.size, updatedRows: 0, missingMlccCodes: 0 },
    };
  }

  const apply = await applyUpcMapToMlccItems(supabase, map);
  console.log(
    "[upc-enrichment] apply complete:",
    JSON.stringify({
      totalCodes: apply.totalCodes,
      updatedRows: apply.updatedRows,
      missingMlccCodes: apply.missingMlccCodes,
      writeErrorCount: apply.writeErrors.length,
    }),
  );
  return { ok: true, url: dl.url, parse: stats, apply };
}
