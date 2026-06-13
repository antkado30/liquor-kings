#!/usr/bin/env node
/**
 * load-mlcc-pricebook-upcs.mjs — bulk-seed upc_mappings (+ backfill
 * mlcc_items.upc) directly from MLCC's own statewide price book export.
 *
 * WHY: the price book TSV (e.g. "May 2 2026 Price Book TXT.txt") has a
 * "Liquor Code" column (== mlcc_items.code) AND a "GTIN/UPC" column, side
 * by side, for ~97% of the ~13.9k rows. That's a direct, authoritative
 * UPC -> liquor code mapping straight from MLCC — no fuzzy name/size
 * matching needed. This is a MUCH higher-confidence source than the NRS
 * tier-2 fuzzy matcher (which only covers Tony's store's ~9.4k products and
 * guesses based on name/size overlap).
 *
 * Found 2026-06-13 (audit #12 follow-up): nrs_import-based coverage was
 * stuck at 44% confirmed / 41% no-match. This source can close most of that
 * gap directly.
 *
 * SAFETY MODEL (read this before --apply):
 *  - NET-NEW inserts: price-book UPC isn't in upc_mappings yet, AND the
 *    price book gives it exactly ONE liquor code, AND that code exists in
 *    mlcc_items. -> INSERT confidence_source='mlcc_price_book_official'.
 *    This is the big win, near-zero risk (pure gap-fill).
 *  - CORRECTIONS: price-book UPC already has a mapping, but to a DIFFERENT
 *    code, and the existing mapping's confidence_source is NOT
 *    'user_confirmed' or 'manual_admin' (i.e. it was a fuzzy NRS guess or
 *    an old auto-seed). The official price book outranks a fuzzy guess ->
 *    UPDATE to the price-book code. Anything 'user_confirmed'/'manual_admin'
 *    is NEVER touched, even if it disagrees — a human looked at it.
 *  - AMBIGUOUS (skipped, written to review CSV): price book itself lists
 *    the same UPC under >1 distinct liquor code. Usually old-code/new-code
 *    rotation pairs for the same physical product (MLCC re-issuing a code).
 *    Not auto-applied — candidates for mlcc_item_codes rotation history,
 *    future pass.
 *  - mlcc_items.upc backfill: only fills NULL upc columns (never overwrites),
 *    only for non-ambiguous price-book UPCs whose code matches that row.
 *
 * USAGE (services/api/):
 *   node scripts/load-mlcc-pricebook-upcs.mjs --file=/path/to/pricebook.txt --dry-run
 *   node scripts/load-mlcc-pricebook-upcs.mjs --file=/path/to/pricebook.txt
 *
 * Outputs review CSVs alongside the input file:
 *   <input>.conflicts.csv   — corrections that WOULD be / WERE applied
 *   <input>.ambiguous.csv   — same-UPC/multi-code rows, skipped
 *   <input>.unknown-codes.csv — price-book codes not found in mlcc_items
 *
 * ENV: LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY (.env).
 */

import "dotenv/config";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY || /127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("[pricebook-upcs] Need LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY (prod) in .env.");
  process.exit(1);
}

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith("--file="));
const DRY_RUN = !args.includes("--apply"); // default dry-run unless --apply passed
const PAGE_SIZE = 1000;
const BATCH_SIZE = 100;

if (!fileArg) {
  console.error("[pricebook-upcs] Usage: node scripts/load-mlcc-pricebook-upcs.mjs --file=/path/to/pricebook.txt [--apply]");
  process.exit(1);
}
const filePath = fileArg.split("=").slice(1).join("=");
if (!fs.existsSync(filePath)) {
  console.error(`[pricebook-upcs] File not found: ${filePath}`);
  process.exit(1);
}

console.log(
  `[pricebook-upcs] target=${SUPABASE_URL.includes("eamoozfhqolshdztbrez") ? "PROD" : SUPABASE_URL} file=${filePath}${DRY_RUN ? " DRY-RUN (pass --apply to write)" : " *** APPLY MODE ***"}`,
);

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

// ---- Parse the price book TSV (latin1 — has stray 0x92 etc.) ----
const raw = fs.readFileSync(filePath, "latin1");
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = lines[0].split("\t");
const codeIdx = header.indexOf("Liquor Code");
const upcIdx = header.indexOf("GTIN/UPC");
const nameIdx = header.indexOf("Brand Name");
if (codeIdx === -1 || upcIdx === -1) {
  console.error("[pricebook-upcs] Expected columns 'Liquor Code' and 'GTIN/UPC' not found in header.");
  process.exit(1);
}

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split("\t");
  const code = (cols[codeIdx] || "").trim();
  const upc = (cols[upcIdx] || "").trim();
  const name = (cols[nameIdx] || "").trim();
  if (!code) continue;
  if (!upc || upc.replace(/0/g, "") === "") continue; // skip empty/all-zero UPCs
  rows.push({ code, upc, name });
}
console.log(`[pricebook-upcs] parsed ${lines.length - 1} rows, ${rows.length} with a usable UPC`);

// Group by UPC to find ambiguous (same UPC, multiple distinct codes)
const byUpc = new Map();
for (const r of rows) {
  if (!byUpc.has(r.upc)) byUpc.set(r.upc, []);
  byUpc.get(r.upc).push(r);
}
const ambiguousUpcs = new Set();
for (const [upc, group] of byUpc.entries()) {
  if (new Set(group.map((g) => g.code)).size > 1) ambiguousUpcs.add(upc);
}
console.log(`[pricebook-upcs] ${byUpc.size} unique UPCs, ${ambiguousUpcs.size} ambiguous (skipped, written to review CSV)`);

// ---- Pull mlcc_items (code, upc) ----
async function fetchAll(table, columns) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

const mlccItems = await fetchAll("mlcc_items", "id, code, upc");
const itemsByCode = new Map(mlccItems.map((it) => [it.code, it]));
console.log(`[pricebook-upcs] mlcc_items: ${mlccItems.length} rows, ${itemsByCode.size} distinct codes`);

const existingMappings = await fetchAll("upc_mappings", "upc, mlcc_code, confidence_source");
const existingByUpc = new Map(existingMappings.map((m) => [m.upc, m]));
console.log(`[pricebook-upcs] upc_mappings: ${existingMappings.length} existing rows`);

// ---- Classify each non-ambiguous price-book UPC ----
const PROTECTED_SOURCES = new Set(["user_confirmed", "manual_admin"]);

const toInsert = []; // net-new upc_mappings rows
const toCorrect = []; // {upc, oldCode, oldSource, newCode}
const protectedConflicts = []; // disagreements we won't touch
const unknownCodes = []; // price-book code not in mlcc_items
const upcBackfill = []; // {code, upc} for mlcc_items.upc currently null
const alreadyGood = [];

for (const [upc, group] of byUpc.entries()) {
  if (ambiguousUpcs.has(upc)) continue;
  const code = group[0].code;
  const name = group[0].name;
  const item = itemsByCode.get(code);
  if (!item) {
    unknownCodes.push({ upc, code, name });
    continue;
  }
  const existing = existingByUpc.get(upc);
  if (!existing) {
    toInsert.push({
      upc,
      mlcc_code: code,
      confidence_source: "mlcc_price_book_official",
      notes: `MLCC price book ${name}`.slice(0, 250),
    });
  } else if (existing.mlcc_code === code) {
    alreadyGood.push({ upc, code });
  } else if (PROTECTED_SOURCES.has(existing.confidence_source)) {
    protectedConflicts.push({ upc, name, priceBookCode: code, existingCode: existing.mlcc_code, source: existing.confidence_source });
  } else {
    toCorrect.push({ upc, name, oldCode: existing.mlcc_code, oldSource: existing.confidence_source, newCode: code });
  }

  if (!item.upc) {
    upcBackfill.push({ code, upc });
  }
}

console.log("[pricebook-upcs] --- classification ---");
console.log(`  net-new inserts:           ${toInsert.length}`);
console.log(`  corrections (low-conf):    ${toCorrect.length}`);
console.log(`  protected conflicts (skip):${protectedConflicts.length}`);
console.log(`  already correct:           ${alreadyGood.length}`);
console.log(`  unknown codes (skip):      ${unknownCodes.length}`);
console.log(`  ambiguous UPCs (skip):     ${ambiguousUpcs.size}`);
console.log(`  mlcc_items.upc backfill:   ${upcBackfill.length}`);

// ---- Write review CSVs ----
function writeCsv(suffix, headerCols, dataRows, mapFn) {
  const out = [headerCols.join(",")];
  for (const r of dataRows) {
    out.push(mapFn(r).map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const outPath = filePath.replace(/(\.[^.]+)?$/, `${suffix}.csv`);
  fs.writeFileSync(outPath, out.join("\n") + "\n");
  console.log(`[pricebook-upcs] wrote ${dataRows.length} rows -> ${outPath}`);
  return outPath;
}

if (toCorrect.length) {
  writeCsv(".corrections", ["upc", "name", "old_code", "old_source", "new_code"], toCorrect, (r) => [r.upc, r.name, r.oldCode, r.oldSource, r.newCode]);
}
if (protectedConflicts.length) {
  writeCsv(".protected-conflicts", ["upc", "name", "price_book_code", "existing_code", "existing_source"], protectedConflicts, (r) => [r.upc, r.name, r.priceBookCode, r.existingCode, r.source]);
}
if (unknownCodes.length) {
  writeCsv(".unknown-codes", ["upc", "code", "name"], unknownCodes, (r) => [r.upc, r.code, r.name]);
}
if (ambiguousUpcs.size) {
  const ambiguousRows = [];
  for (const upc of ambiguousUpcs) {
    for (const r of byUpc.get(upc)) ambiguousRows.push({ upc, code: r.code, name: r.name });
  }
  writeCsv(".ambiguous", ["upc", "code", "name"], ambiguousRows, (r) => [r.upc, r.code, r.name]);
}

if (DRY_RUN) {
  console.log("[pricebook-upcs] DRY-RUN — nothing written. Re-run with --apply to commit.");
  process.exit(0);
}

// ---- APPLY ----
let inserted = 0, insertFailed = 0;
for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
  const chunk = toInsert.slice(i, i + BATCH_SIZE);
  const { error } = await supabase.from("upc_mappings").upsert(chunk, { onConflict: "upc" });
  if (error) {
    console.error(`[pricebook-upcs] insert chunk ${i / BATCH_SIZE} failed: ${error.message}`);
    insertFailed += chunk.length;
  } else {
    inserted += chunk.length;
  }
}
console.log(`[pricebook-upcs] inserted ${inserted} net-new mappings (${insertFailed} failed)`);

let corrected = 0, correctFailed = 0;
for (const c of toCorrect) {
  const { error } = await supabase
    .from("upc_mappings")
    .update({ mlcc_code: c.newCode, confidence_source: "mlcc_price_book_official", notes: `Corrected from ${c.oldSource}->mlcc_price_book_official (was ${c.oldCode})` })
    .eq("upc", c.upc);
  if (error) {
    console.error(`[pricebook-upcs] correction for ${c.upc} failed: ${error.message}`);
    correctFailed++;
  } else {
    corrected++;
  }
}
console.log(`[pricebook-upcs] corrected ${corrected} low-confidence mappings (${correctFailed} failed)`);

let backfilled = 0, backfillFailed = 0;
for (const b of upcBackfill) {
  const { error } = await supabase
    .from("mlcc_items")
    .update({ upc: b.upc })
    .eq("code", b.code)
    .is("upc", null);
  if (error) {
    console.error(`[pricebook-upcs] upc backfill for code ${b.code} failed: ${error.message}`);
    backfillFailed++;
  } else {
    backfilled++;
  }
}
console.log(`[pricebook-upcs] backfilled mlcc_items.upc for ${backfilled} items (${backfillFailed} failed)`);

console.log("[pricebook-upcs] DONE.");
