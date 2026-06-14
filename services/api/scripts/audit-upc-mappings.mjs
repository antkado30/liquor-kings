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
 *   2. Find the independent source name for that UPC (from --nrs-file, an
 *      NRS POS CSV export — the store's own description of what that
 *      barcode is). NOTE (2026-06-13): there is no "nrs_import" DB table —
 *      that was a stale assumption from an earlier prototype. Without
 *      --nrs-file every mapping lands in UNVERIFIED (no second opinion,
 *      not "all clear" — the script says this loudly).
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
 *   node scripts/audit-upc-mappings.mjs                                  # DEAD_CODE check only, rest UNVERIFIED
 *   node scripts/audit-upc-mappings.mjs --nrs-file=/path/to/export.csv   # full OK/SUSPICIOUS/BAD verification
 *   node scripts/audit-upc-mappings.mjs --nrs-file=... --apply           # + repairs
 */

import "dotenv/config";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { parseNrsCsv, extractSizeFromName } from "../src/services/nrs-import.service.js";

const APPLY = process.argv.includes("--apply");
const NRS_FILE_ARG = process.argv.find((a) => a.startsWith("--nrs-file="));
const NRS_FILE = NRS_FILE_ARG ? NRS_FILE_ARG.split("=").slice(1).join("=") : null;

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

// Brand-naming synonyms: same liquid, different word the retailer's POS vs.
// MLCC's catalog use. Without these, real/correct mappings score as BAD
// purely on vocabulary, drowning out genuinely wrong mappings in the noise.
// Canonicalize the RIGHT-hand word to the LEFT-hand word before tokenizing.
const SYNONYM_PAIRS = [
  ["silver", "blanco"], ["silver", "plata"], // tequila "white" expressions
];

const toks = (s) => {
  let norm = String(s ?? "").toLowerCase();
  for (const [a, b] of SYNONYM_PAIRS) {
    norm = norm.replace(new RegExp(`\\b${b}\\b`, "g"), a);
  }
  // Strip apostrophes (straight ' and curly ') entirely, not to a space —
  // "BAILEY'S" -> "baileys", "SEAGRAM'S" -> "seagrams", matching the
  // un-punctuated spellings ("BAILEYS CHOCOLATE", "Seagrams Vodka") that
  // NRS/MLCC data alternates between. Replacing with a space instead
  // fragments these into a spurious trailing "s" token that never matches.
  return norm.replace(/['’]/g, "").replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/).filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
};
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

// Squashed-string near-match: strips everything but letters/digits so
// "RumChata" vs "Rum Chata" or "1800 ANEJO" vs "1800 a ejo" (NRS typo,
// missing the 'n') compare as near-identical even though token-set
// containment sees them as unrelated words. Used as a tiebreaker so
// spelling/typo/spacing variance doesn't masquerade as "names fundamentally
// disagree" — that bucket should be reserved for genuinely different products.
const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}
function squashedNearMatch(a, b) {
  const sa = squash(a); const sb = squash(b);
  if (!sa || !sb) return false;
  // One fully contains the other (handles "RumChata" vs "RumChata1L").
  if (sa.includes(sb) || sb.includes(sa)) return true;
  // Otherwise allow a small edit distance relative to length (handles a
  // single dropped/typo'd letter, e.g. "1800anejo" vs "1800aejo").
  const dist = levenshtein(sa, sb);
  return dist <= Math.max(1, Math.floor(Math.min(sa.length, sb.length) * 0.12));
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

  // NOTE (2026-06-13): there is NO "nrs_import" database table — that was a
  // stale assumption from an earlier prototype. The real independent source
  // is Tony's NRS POS CSV export (Department/Name/Upc/Size columns), parsed
  // the same way the live /admin/nrs-import endpoint does. Without --nrs-file
  // every mapping falls into UNVERIFIED — that's not "all good", it just
  // means we have no second opinion. Say so loudly instead of silently
  // reporting 0/0/0/0.
  let nrsRows = [];
  if (NRS_FILE) {
    console.log(`[audit] loading NRS POS export (independent source names): ${NRS_FILE}`);
    if (!fs.existsSync(NRS_FILE)) {
      console.error(`[audit] fatal: --nrs-file not found: ${NRS_FILE}`);
      process.exit(1);
    }
    const csvText = fs.readFileSync(NRS_FILE, "utf8");
    const { liquorRows, stats } = parseNrsCsv(csvText);
    if (stats.error) {
      console.error(`[audit] fatal: failed to parse --nrs-file: ${stats.error}`);
      process.exit(1);
    }
    nrsRows = liquorRows.map((r) => ({
      upc: r.upc,
      name: r.name,
      size: extractSizeFromName(r.name) ?? extractSizeFromName(r.sizeColumn),
    }));
    console.log(`[audit] ${nrsRows.length} liquor rows parsed from NRS export`);
  } else {
    console.log(
      "[audit] no --nrs-file given — running WITHOUT an independent source. " +
        "Every mapping will land in UNVERIFIED (no OK/SUSPICIOUS/BAD signal). " +
        "Re-run with --nrs-file=/path/to/nrs-export.csv for real verification.",
    );
  }
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

      if (Math.max(c1, c2) < 0.25) {
        if (squashedNearMatch(nrs.name, item.name)) {
          verdict = "SUSPICIOUS";
          reason = "spelling/synonym variance (squashed names near-identical) — likely correct, eyeball it";
        } else {
          verdict = "BAD"; reason = "names fundamentally disagree";
        }
      }
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
