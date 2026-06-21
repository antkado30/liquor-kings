#!/usr/bin/env node
/**
 * resolve-order-codes.mjs — bulk-resolve a hand-written order list to MLCC codes.
 *
 * Built 2026-06-16 because the in-app assistant can't do bulk lookups yet
 * (stateless endpoint + 8-iteration tool cap). This runs on YOUR Mac, where
 * prod IS reachable, and resolves the whole list in one shot.
 *
 * It does NOT place anything. Read-only catalog lookups. ALWAYS eyeball the
 * match before you order — MLCC names are weird and codes rotate.
 *
 * Needs LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in
 * services/api/.env (same as inspect-execution-runs.mjs).
 *
 * USAGE (from services/api/):
 *   node scripts/resolve-order-codes.mjs
 *
 * Edit the ORDER array below to change the list. Each entry:
 *   { line, terms:[words ALL must appear in the MLCC name], sizeMl, qty, note? }
 * Sizes: fifth=750, pint=375, half-pint=200, 1/2 gallon=1750, liter=1000, 50ml mini.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  resolveOrderLine,
  sizeFromText,
  preferFromText,
} from "../src/lib/resolve-order-lines.js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("Points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

// ── Tony + mom's order, 2026-06-16. Edit freely. ───────────────────────────
const ORDER = [
  { line: "Crown Royal Apple — fifth",            terms: ["crown", "royal", "apple"], sizeMl: 750,  qty: 6 },
  { line: "Crown Royal Apple — pint",             terms: ["crown", "royal", "apple"], sizeMl: 375,  qty: 6 },
  { line: "Crown Royal (regular) — 1/2 gal",      terms: ["crown", "royal"],          sizeMl: 1750, qty: 1, note: "pick PLAIN Crown Royal (ignore flavored variants)" },
  { line: "Svedka — 1/2 gal",                     terms: ["svedka"],                  sizeMl: 1750, qty: 6 },
  { line: "Jack Daniel's — 1/2 pint (CASE)",      terms: ["daniels"],                 sizeMl: 200,  qty: null, note: "1 CASE. MLCC name is usually 'J DANIELS OLD 7 BLACK'" },
  { line: "Jack Daniel's 'double shots' (CASE)",  terms: ["daniels"],                 sizeMl: null, qty: null, note: "AMBIGUOUS — which product/size are 'double shots'? clarify" },
  { line: "Tito's — pint",                        terms: ["tito"],                    sizeMl: 375,  qty: 12 },
  { line: "Tito's — 1/2 gal",                     terms: ["tito"],                    sizeMl: 1750, qty: 6 },
  { line: "Belvedere — 1/2 gal",                  terms: ["belvedere"],               sizeMl: 1750, qty: 1 },
  { line: "Platinum 7X — 1/2 gal",                terms: ["platinum"],                sizeMl: 1750, qty: 6, note: "Platinum 7X vodka" },
  { line: "Skyy vodka — 1/2 gal",                 terms: ["skyy"],                    sizeMl: 1750, qty: 6 },
  { line: "Kirkland American vodka — 1/2 gal",    terms: ["kirkland"],                sizeMl: 1750, qty: 60, note: "MLCC may NOT carry Kirkland (Costco label) — verify" },
  { line: "Don Julio Reposado — 1/2 gal",         terms: ["don", "julio", "reposado"],sizeMl: 1750, qty: 3 },
  { line: "Smirnoff (plastic) — 1/2 gal",         terms: ["smirnoff"],                sizeMl: 1750, qty: 3, prefer: "plastic", note: "regular red label = 80 proof; confirm vs the 90.4/100 proof versions" },
  { line: "Jim Beam (glass) — fifth",             terms: ["jim", "beam"],             sizeMl: 750,  qty: 3, prefer: "glass", note: "glass = the non-'PL' code" },
  { line: "Jim Beam (plastic) — fifth",           terms: ["jim", "beam"],             sizeMl: 750,  qty: 3, prefer: "plastic", note: "plastic = the 'PL' code" },
  { line: "Bacardi (light/Superior) — 1/2 gal",   terms: ["bacardi"],                 sizeMl: 1750, qty: 6, note: "'light' = Superior/Silver" },
  { line: "Blue Chair Bay Banana Cream — fifth",  terms: ["blue", "chair", "banana"], sizeMl: 750,  qty: 3 },
  { line: "Dr McGillicuddy's Coffee/Espresso — fifth", terms: ["mcgillicuddy"],       sizeMl: 750,  qty: 3, note: "coffee/espresso variant — confirm exact name from candidates" },
  { line: "Dr McGillicuddy's Root Beer — fifth",  terms: ["mcgillicuddy", "root"],    sizeMl: 750,  qty: 3 },
  { line: "Mohawk (plastic) — fifth",             terms: ["mohawk"],                  sizeMl: 750,  qty: 6, note: "which Mohawk product? (vodka/gin/brandy?) — pick from candidates" },
  { line: "Mohawk (plastic) — 1/2 gal",           terms: ["mohawk"],                  sizeMl: 1750, qty: 3, note: "which Mohawk product? — pick from candidates" },
  { line: "Seagram 7 — 1/2 gal",                  terms: ["seagram"],                 sizeMl: 1750, qty: 3 },
  { line: "Seagram 7 — fifth",                    terms: ["seagram"],                 sizeMl: 750,  qty: 3 },
  { line: "Canadian Club — fifth",                terms: ["canadian", "club"],        sizeMl: 750,  qty: 3 },
];

const money = (cents) => (cents == null ? "" : `$${Number(cents).toFixed(2)}`);

// Ad-hoc mode: pass bottle queries as args to test ANY item against prod, e.g.
//   node scripts/resolve-order-codes.mjs "jack daniels 1.75" "titos 750"
// No args → resolves the default ORDER above.
const argItems = process.argv.slice(2).filter((a) => a && !a.startsWith("--"));
const items =
  argItems.length > 0
    ? argItems.map((a) => ({
        line: a,
        name: a,
        sizeMl: sizeFromText(a),
        prefer: preferFromText(a) || undefined,
      }))
    : ORDER;

// Resolve via the SHARED engine (services/api/src/lib/resolve-order-lines.js) —
// the EXACT matcher the app deploys, so this is a true prod test. Run it before
// shipping a matcher change to confirm it's right against the real catalog.
async function resolve(item) {
  try {
    const r = await resolveOrderLine(supabase, {
      name: item.name,
      terms: item.terms,
      sizeMl: item.sizeMl,
      prefer: item.prefer,
    });
    if (r.error) return { item, error: r.error, picks: [], total: 0, exactHit: null };
    const picks = [r.best, ...(r.alternates || [])].filter(Boolean);
    return { item, picks, total: r.total, exactHit: r.exactHit, confidence: r.confidence };
  } catch (e) {
    return { item, error: e.message, picks: [], total: 0, exactHit: null };
  }
}

console.log(`\nResolving ${items.length} line(s) against prod mlcc_items...\n`);
let resolved = 0;
let needsEyes = 0;
for (const item of items) {
  const r = await resolve(item);
  const qtyTag = item.qty == null ? "[CASE/?]" : `[${item.qty}x]`;
  console.log(`${qtyTag} ${item.line}`);
  if (item.note) console.log(`   note: ${item.note}`);
  if (r.error) {
    console.log(`   ⚠ query error: ${r.error}\n`);
    needsEyes++;
    continue;
  }
  if (r.picks.length === 0) {
    console.log(`   ⚠ NO MATCH — [${(item.terms || []).join(", ") || item.name}] found nothing. Likely: not carried by MLCC, different spelling, or wrong terms.\n`);
    needsEyes++;
    continue;
  }
  if (item.sizeMl && r.exactHit === false) {
    console.log(`   ⚠ no exact ${item.sizeMl}ml match — showing all sizes found, pick the right one:`);
    needsEyes++;
  } else {
    resolved++;
  }
  r.picks.forEach((c, i) => {
    const marker = i === 0 && (r.exactHit || !item.sizeMl) ? " →" : "  ";
    console.log(
      `   ${marker} ${String(c.code).padEnd(7)} ${c.name}  [${c.bottle_size_label || c.bottle_size_ml + "ml"}] ADA ${c.ada_number ?? "?"} ${money(c.licensee_price)}`,
    );
  });
  if (r.total > r.picks.length) console.log(`     (+${r.total - r.picks.length} more — narrow the terms if the right one isn't shown)`);
  console.log("");
}

console.log("──────────────────────────────────────────");
console.log(`Clean single-size matches: ${resolved} / ${items.length}`);
console.log(`Need your eyes (ambiguous / no-exact-size / no-match): ${needsEyes}`);
console.log(`\nALWAYS verify each code in-app before submitting — names are messy and codes rotate.\n`);
process.exit(0);
