#!/usr/bin/env node
/**
 * load-nrs-import.mjs — (re)load the nrs_import table from an NRS POS CSV
 * export, directly against prod. One command, no admin token, no 25MB curl.
 *
 * WHY: nrs_import is EMPTY in prod (found 2026-06-10), which leaves all
 * ~4.2k UPC mappings UNVERIFIED in the audit — the catalog-truth blocker.
 * The audit (scripts/audit-upc-mappings.mjs) cross-checks every mapping
 * against the NRS description of the same barcode; no rows = no truth.
 *
 * USAGE (services/api/):
 *   node scripts/load-nrs-import.mjs --file=/path/to/nrs-export.csv --dry-run
 *   node scripts/load-nrs-import.mjs --file=/path/to/nrs-export.csv
 *
 * Then re-run the audit:
 *   node scripts/audit-upc-mappings.mjs            # review the CSV
 *   node scripts/audit-upc-mappings.mjs --apply    # delete BAD + DEAD_CODE
 *
 * ENV: LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY (.env).
 * Uses the SAME parser/upsert path as POST /admin/nrs-import
 * (services/api/src/services/nrs-import.service.js) — one source of truth.
 */

import "dotenv/config";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { runNrsImport } from "../src/services/nrs-import.service.js";

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY || /127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error(
    "[nrs-load] Need LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY (prod) in .env.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith("--file="));
const DRY_RUN = args.includes("--dry-run");

if (!fileArg) {
  console.error("[nrs-load] Usage: node scripts/load-nrs-import.mjs --file=/path/to/nrs-export.csv [--dry-run]");
  process.exit(1);
}
const filePath = fileArg.split("=").slice(1).join("=");
if (!fs.existsSync(filePath)) {
  console.error(`[nrs-load] File not found: ${filePath}`);
  process.exit(1);
}

const csvText = fs.readFileSync(filePath, "utf8");
console.log(
  `[nrs-load] target=${SUPABASE_URL.includes("eamoozfhqolshdztbrez") ? "PROD" : SUPABASE_URL} file=${filePath} (${Math.round(csvText.length / 1024)}KB)${DRY_RUN ? " DRY-RUN" : ""}`,
);

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const report = await runNrsImport(supabase, csvText, { dryRun: DRY_RUN });

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error("[nrs-load] FAILED — see report above.");
  process.exit(1);
}
console.log(
  `[nrs-load] DONE${DRY_RUN ? " (dry-run, nothing written)" : ""} — now run: node scripts/audit-upc-mappings.mjs`,
);
