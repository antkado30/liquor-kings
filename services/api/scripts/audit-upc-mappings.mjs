#!/usr/bin/env node
/**
 * UPC→MLCC MAPPING AUDIT (Tony, 2026-06-10 night — "check each individual
 * bottle we have mapped, I will not tolerate any mismatches").
 *
 * Real-world failures that ordered this audit:
 *   - Scanning a fifth of 1800 Silver opened the DETROIT LIONS edition.
 *   - MLCC's own portal shows "Product code changed from 2836 to 5703" —
 *     MLCC ROTATES CODES, so mappings and catalog rows go stale silently.
 *
 * What it does, for EVERY row in upc_mappings:
 *   1. Resolve the mapped mlcc_items row (name, size, active?).
 *   2. Find the independent source name for that UPC (nrs_import — the
 *      NRS pricebook's own description of what that barcode is).
 *   3. Score agreement: token containment both directions, size within
 *      ±50mL, variant/flavor conflicts, special-edition mismatch.
 *   4. Verdict per mapping:
 *        OK          — strong agreement
 *        DEAD_CODE   — mapped code no longer exists / inactive (MLCC
 *                      code rotation!) ← auto-fixable candidates
 *        SUSPICIOUS  — partial agreement (wrong variant/size/edition)
 *        BAD         — names fundamentally disagree
 *        UNVERIFIED  — no independent source name exists for this UPC
 *                      (listed by scan_count so humans check what matters)
 *   5. Writes tmp/upc-audit-<date>.csv + a summary table.
 *
 * MODES:
 *   (default)   Report only. Touches NOTHING.
 *   --apply     Conservative repairs only:
 *                 - DELETE mappings with verdict BAD (a deleted mapping is
 *                   recoverable — next scan re-resolves via scoring; a WRONG
 *                   mapping silently lies forever. Doctrine: loud > wrong.)
 *                 - DELETE DEAD_CODE mappings (code no longer in catalog).
 *               SUSPICIOUS and UNVERIFIED are NEVER auto-touched — they are
 *               for the Command Deck review queue / human eyes.
 *
 * ENV: LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY (.env).
 * USAGE (services/api/):
 *   node scripts/audit-upc-mappings.mjs               # full report
 *   node scripts/audit-upc-mappings.mjs --apply       # report + repairs
 */

import "dotenv/config";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY || /127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("Need LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY (prod).");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const STOP = new Set(["the","of","and","with","a","an","ml","l","ltr","liter","pl","pet",
  "irish","scotch","ky","tn","fr","eng","ger","mex","cro","mace"]);
const VARIANTS = new Set(["raspberry","strawberry","blueberry","blackberry","cherry","peach",
  "apple","mango","watermelon","pineapple","coconut","banana","citrus","lime","lemon","orange",
  "grapefruit","grape","pomegranate","vanilla","caramel","honey","cinnamon","coffee","espresso",
  "chocolate","peppermint","spiced","salted","cream","punch","tropical","fire","ice","hot"]);
const EDITION = /lions|mclaren|wrexham|collector|edition|ltd\b|lto\b|anniv|holiday|camo|jersey|all star|w\//i;

const toks = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
  .split(/\s+/).filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
function containment(a, b) {
  const A = toks(a); const B = new Set(toks(b));
  if (A.length === 0) return 0;
  return A.filter((t) => B.has(t)).length / A.length;
}
function sizeFromText(s) {
  const m = String(s ?? "").match(/(\d+(?:\.\d+)?)\s*(ml|l)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === "l" ? n * 1000 : n;
}

async function pageAll(table, select, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function main() {
  console.log(`[audit] mode=${APPLY ? "APPLY (conservative repairs)" : "REPORT-ONLY"}`);

  console.log("[audit] loading upc_mappings…");
  const mappings = await pageAll("upc_mappings", "upc, mlcc_code, confidence_source, scan_count, flag_count");
  console.log(`[audit] ${mappings.length} mappings`);

  console.log("[audit] loading mlcc_items…");
  const items = await pageAll("mlcc_items", "code, name, bottle_size_ml, is_active");
  const itemsByCode = new Map();
  for (const it of items) {
    const cur = itemsByCode.get(String(it.code));
    if (!cur || (it.is_active && !cur.is_active)) itemsByCode.set(String(it.code), it);
  }
  console.log(`[audit] ${itemsByCode.size} distinct codes in catalog`);

  console.log("[audit] loading nrs_import (independent source names)…");
  let nrsRows = [];
  try {
    const probe = await supabase.from("nrs_import").select("*").limit(1);
    if (!probe.error && probe.data?.length) {
      const cols = Object.keys(probe.data[0]);
      const nameCol = ["nrs_name","product_name","name","description"].find((c) => cols.includes(c));
      const upcCol = ["upc","barcode","upc_code"].find((c) => cols.includes(c));
      const sizeCol = ["size_ml","bottle_size_ml","size"].find((c) => cols.includes(c));
      if (nameCol && upcCol) {
        nrsRows = await pageAll("nrs_import", `${upcCol}, ${nameCol}${sizeCol ? ", " + sizeCol : ""}`);
        nrsRows = nrsRows.map((r) => ({ upc: String(r[upcCol]), name: r[nameCol], size: sizeCol ? r[sizeCol] : null }));
      }
    }
  } catch { /* table may not exist locally — UNVERIFIED bucket handles it */ }
  const nrsByUpc = new Map(nrsRows.map((r) => [r.upc.replace(/\D/g, "").slice(-12).padStart(12, "0"), r]));
  console.log(`[audit] ${nrsByUpc.size} NRS source names`);

  const rows = [];
  const counts = { OK: 0, DEAD_CODE: 0, SUSPICIOUS: 0, BAD: 0, UNVERIFIED: 0 };
  for (const m of mappings) {
    const item = itemsByCode.get(String(m.mlcc_code));
    const normUpc = String(m.upc).replace(/\D/g, "").slice(-12).padStart(12, "0");
    const nrs = nrsByUpc.get(normUpc);
    let verdict; let reason = ""; let sim = "";

    if (!item || item.is_active === false) {
      verdict = "DEAD_CODE";
      reason = !item ? "mapped code not in catalog (MLCC code rotation?)" : "mapped item inactive";
    } else if (!nrs) {
      verdict = "UNVERIFIED";
      reason = "no independent NRS name for this UPC";
    } else {
      const c1 = containment(nrs.name, item.name);
      const c2 = containment(item.name, nrs.name);
      sim = `${c1.toFixed(2)}/${c2.toFixed(2)}`;
      const nrsSize = Number(nrs.size) || sizeFromText(nrs.name);
      const sizeBad = nrsSize && item.bottle_size_ml &&
        Math.abs(nrsSize - item.bottle_size_ml) > 50;
      const nrsT = new Set(toks(nrs.name)); const mlccT = new Set(toks(item.name));
      const variantConflict =
        [...mlccT].some((t) => VARIANTS.has(t) && !nrsT.has(t)) ||
        [...nrsT].some((t) => VARIANTS.has(t) && !mlccT.has(t));
      const editionMismatch = EDITION.test(item.name) && !EDITION.test(nrs.name);

      if (Math.max(c1, c2) < 0.25) { verdict = "BAD"; reason = "names fundamentally disagree"; }
      else if (editionMismatch) { verdict = "SUSPICIOUS"; reason = "mapped to special edition, source is base product (Lions class)"; }
      else if (variantConflict) { verdict = "SUSPICIOUS"; reason = "flavor/variant conflict"; }
      else if (sizeBad) { verdict = "SUSPICIOUS"; reason = `size mismatch (${nrsSize} vs ${item.bottle_size_ml})`; }
      else if (Math.min(c1, c2) < 0.4) { verdict = "SUSPICIOUS"; reason = "weak name agreement"; }
      else { verdict = "OK"; reason = "verified"; }
    }
    counts[verdict] += 1;
    rows.push({
      verdict, upc: m.upc, mlcc_code: m.mlcc_code,
      mlcc_name: item?.name ?? "", nrs_name: nrs?.name ?? "",
      sim, scan_count: m.scan_count ?? 0, source: m.confidence_source ?? "", reason,
    });
  }

  rows.sort((a, b) =>
    ["BAD","DEAD_CODE","SUSPICIOUS","UNVERIFIED","OK"].indexOf(a.verdict) -
    ["BAD","DEAD_CODE","SUSPICIOUS","UNVERIFIED","OK"].indexOf(b.verdict) ||
    b.scan_count - a.scan_count);

  fs.mkdirSync("tmp", { recursive: true });
  const file = `tmp/upc-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(file, [
    "verdict,upc,mlcc_code,mlcc_name,nrs_name,sim,scan_count,source,reason",
    ...rows.map((r) => [r.verdict, r.upc, r.mlcc_code, r.mlcc_name, r.nrs_name, r.sim, r.scan_count, r.source, r.reason].map(esc).join(",")),
  ].join("\n"));

  console.log("\n══════ AUDIT SUMMARY ══════");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(11)} ${v}`);
  console.log(`  → full detail: ${file}`);
  console.log("\n  Worst offenders (top 15 by scans):");
  for (const r of rows.filter((r) => r.verdict === "BAD" || r.verdict === "SUSPICIOUS").slice(0, 15)) {
    console.log(`  [${r.verdict}] upc=${r.upc} → ${r.mlcc_code} "${r.mlcc_name}" | NRS: "${r.nrs_name}" | scans=${r.scan_count} | ${r.reason}`);
  }

  if (APPLY) {
    const toDelete = rows.filter((r) => r.verdict === "BAD" || r.verdict === "DEAD_CODE");
    console.log(`\n[audit] APPLY: deleting ${toDelete.length} BAD/DEAD_CODE mappings (recoverable — next scan re-resolves)…`);
    let done = 0;
    for (const r of toDelete) {
      const { error } = await supabase.from("upc_mappings").delete().eq("upc", r.upc);
      if (error) console.log(`  delete ${r.upc} failed: ${error.message}`);
      else done += 1;
    }
    console.log(`[audit] deleted ${done}. SUSPICIOUS/UNVERIFIED untouched — review those in the CSV.`);
  }
}

main().catch((e) => { console.error("[audit] fatal", e); process.exit(1); });
