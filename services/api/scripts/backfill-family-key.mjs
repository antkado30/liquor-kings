#!/usr/bin/env node
/**
 * backfill-family-key.mjs — fill mlcc_items.family_key / container /
 * pack_count / is_combo for EVERY active row, from the validated engine
 * (src/mlcc/family-key.js — 16 unit tests + full-catalog audit 2026-07-01:
 * 644 orphans healed, 0 over-merges).
 *
 * SAFE BY CONSTRUCTION:
 *   - Requires migration 20260702011500 (additive columns) to be applied.
 *   - Writes ONLY the four new columns, row-by-row keyed on id. Never touches
 *     name/code/price/ADA — the columns nothing in the app reads yet.
 *   - Default is DRY-RUN (prints what it would write). Pass --apply to write.
 *   - Idempotent: re-running recomputes and rewrites identical values.
 *   - --verify mode: reads every row back and checks the stored values match
 *     a fresh local computation. Run it after --apply. Exit 1 on any mismatch.
 *
 * Usage (Tony's Mac, after applying the migration):
 *   node services/api/scripts/backfill-family-key.mjs            # dry-run
 *   node services/api/scripts/backfill-family-key.mjs --apply    # write
 *   node services/api/scripts/backfill-family-key.mjs --verify   # prove it
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { computeFamilyIdentity } from "../src/mlcc/family-key.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(2);
}

const mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--verify")
    ? "verify"
    : "dry-run";

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

// ─── Load every active row ───────────────────────────────────────────────────
const PAGE = 1000;
const rows = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from("mlcc_items")
    .select("id, name, family_key, container, pack_count, is_combo")
    .eq("is_active", true)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error(`Fetch failed at offset ${from}: ${error.message}`);
    if (/family_key.*does not exist|column .* does not exist/i.test(error.message)) {
      console.error("→ The migration hasn't been applied yet. Run the SQL in supabase/migrations/20260702011500_add_family_key_columns.sql first.");
    }
    process.exit(1);
  }
  rows.push(...(data ?? []));
  process.stdout.write(`\rFetched ${rows.length} active rows…`);
  if (!data || data.length < PAGE) break;
}
console.log("");

// ─── Compute targets ─────────────────────────────────────────────────────────
const targets = rows.map((r) => {
  const id = computeFamilyIdentity(r.name);
  return {
    rowId: r.id,
    name: r.name,
    next: {
      family_key: id.familyKey,
      container: id.container,
      pack_count: id.packCount,
      is_combo: id.isCombo,
    },
    current: {
      family_key: r.family_key ?? null,
      container: r.container ?? null,
      pack_count: r.pack_count ?? null,
      is_combo: r.is_combo ?? null,
    },
  };
});

const differs = (t) =>
  t.current.family_key !== t.next.family_key ||
  t.current.container !== t.next.container ||
  t.current.pack_count !== t.next.pack_count ||
  t.current.is_combo !== t.next.is_combo;

const pending = targets.filter(differs);
const families = new Set(targets.map((t) => t.next.family_key)).size;

console.log(`\nRows: ${targets.length} · distinct families: ${families} · rows needing write: ${pending.length}`);

if (mode === "verify") {
  if (pending.length === 0) {
    console.log("VERIFY: PASS — every row's stored family identity matches a fresh computation.");
    process.exit(0);
  }
  console.log(`VERIFY: FAIL — ${pending.length} row(s) differ. First 10:`);
  for (const t of pending.slice(0, 10)) {
    console.log(`  ${t.rowId} · ${t.name}`);
    console.log(`    stored:   ${JSON.stringify(t.current)}`);
    console.log(`    expected: ${JSON.stringify(t.next)}`);
  }
  process.exit(1);
}

if (mode === "dry-run") {
  console.log("\nDRY-RUN (no writes). Sample of what --apply would set:");
  for (const t of pending.slice(0, 15)) {
    console.log(`  ${t.name}  →  [${t.next.family_key}] ${t.next.container}${t.next.pack_count ? ` ${t.next.pack_count}pk` : ""}${t.next.is_combo ? " COMBO" : ""}`);
  }
  console.log(`\nRun with --apply to write ${pending.length} rows.`);
  process.exit(0);
}

// ─── Apply (chunked, concurrent, retried) ────────────────────────────────────
const CONCURRENCY = 25;
let written = 0;
let failures = 0;

async function writeOne(t, attempt = 1) {
  const { error } = await supabase.from("mlcc_items").update(t.next).eq("id", t.rowId);
  if (error) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      return writeOne(t, attempt + 1);
    }
    failures += 1;
    console.error(`\n  ✗ ${t.rowId} (${t.name}): ${error.message}`);
    return;
  }
  written += 1;
  if (written % 500 === 0) process.stdout.write(`\rWrote ${written}/${pending.length}…`);
}

for (let i = 0; i < pending.length; i += CONCURRENCY) {
  await Promise.all(pending.slice(i, i + CONCURRENCY).map((t) => writeOne(t)));
}
console.log(`\rWrote ${written}/${pending.length} rows · failures: ${failures}`);

if (failures > 0) {
  console.error("Some rows failed — re-run --apply (idempotent) then --verify.");
  process.exit(1);
}
console.log("Backfill complete. Now run --verify to prove every row matches.");
