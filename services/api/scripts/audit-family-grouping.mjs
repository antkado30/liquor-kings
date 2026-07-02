#!/usr/bin/env node
/**
 * audit-family-grouping.mjs — grade the NEXT-GEN family key (src/mlcc/
 * family-key.js) against the ENTIRE prod MLCC catalog, before a single line
 * of it is wired into the app. The doctrine loop that fixed search matching
 * (78% → 95%+), pointed at family grouping.
 *
 * READ-ONLY: pages mlcc_items via SELECT, computes everything locally,
 * writes report files to ./family-audit/ (gitignored). Never writes to the
 * DB, never calls MILO, never touches the app.
 *
 * Usage (Tony's Mac, repo root or services/api):
 *   node services/api/scripts/audit-family-grouping.mjs
 * Env: LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY in
 * services/api/.env (same as inspect-execution-runs.mjs).
 *
 * What it measures:
 *   1. HEALED SPLITS — rows the OLD logic isolated (family of 1) that the
 *      NEW key correctly reunites with siblings. The plastic-pint-of-Jack
 *      number. Bigger = more of Tony's bug fixed.
 *   2. ADA-HEALED — variants split today ONLY because the old logic demands
 *      the same distributor.
 *   3. CONTAINER EXTRACTION — how many rows carry a plastic/glass mark, with
 *      samples for eyeballing (catches over-stripping).
 *   4. SUSPECT OVER-MERGES — the zero-tolerance check: unusually large new
 *      families + aggressive two-token strips, listed for human eyes. Any
 *      real false merge = fix the token rules before wiring ANY UI.
 *   5. KNOWN-CASE CARDS — Jack Daniel's, Tito's, Smirnoff 80, Mohawk,
 *      Fireball: prints each family as the app WOULD show it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { computeFamilyIdentity } from "../src/mlcc/family-key.js";
import { normalizeMlccNameBaseForFamily } from "../src/mlcc/mlcc-product-family.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

// ─── 1. Page the whole catalog ───────────────────────────────────────────────
const PAGE = 1000;
const rows = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from("mlcc_items")
    .select("id, code, name, size, category, ada_name, ada_number, brand_family, is_active")
    .eq("is_active", true)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error(`Page fetch failed at offset ${from}: ${error.message}`);
    process.exit(1);
  }
  rows.push(...(data ?? []));
  process.stdout.write(`\rFetched ${rows.length} active rows…`);
  if (!data || data.length < PAGE) break;
}
console.log("");

// ─── 2. Compute OLD and NEW identities per row ───────────────────────────────
// OLD identity mirrors the live heuristic path: normalized base + category +
// ADA name (rowInSameFamilyAsAnchor's constraints). NEW: familyKey + category.
const oldGroups = new Map();
const newGroups = new Map();
const perRow = new Map();
for (const r of rows) {
  const oldBase = normalizeMlccNameBaseForFamily(r.name ?? "").toLowerCase();
  const cat = String(r.category ?? "").trim().toLowerCase();
  const ada = String(r.ada_name ?? "").trim().toLowerCase();
  const oldKey = `${oldBase}│${cat}│${ada}`;

  const id = computeFamilyIdentity(r.name);
  const newKey = `${id.familyKey}│${cat}`;

  perRow.set(r.id, { oldKey, newKey, identity: id });
  if (!oldGroups.has(oldKey)) oldGroups.set(oldKey, []);
  oldGroups.get(oldKey).push(r);
  if (!newGroups.has(newKey)) newGroups.set(newKey, []);
  newGroups.get(newKey).push(r);
}

// Distinct codes per group (same code across ADAs = one size entry after dedupe).
const codesOf = (list) => new Set(list.map((r) => String(r.code)));

// ─── 3. Healed splits ────────────────────────────────────────────────────────
const healed = [];
for (const r of rows) {
  const { oldKey, newKey } = perRow.get(r.id);
  const oldCodes = codesOf(oldGroups.get(oldKey));
  const newCodes = codesOf(newGroups.get(newKey));
  if (oldCodes.size === 1 && newCodes.size > 1) {
    healed.push(r);
  }
}

// ADA-healed subset: would have grouped on name+category, split purely by ADA.
const adaHealed = healed.filter((r) => {
  const { newKey } = perRow.get(r.id);
  const family = newGroups.get(newKey);
  const myOldBase = normalizeMlccNameBaseForFamily(r.name ?? "").toLowerCase();
  return family.some(
    (o) =>
      o.id !== r.id &&
      normalizeMlccNameBaseForFamily(o.name ?? "").toLowerCase() === myOldBase &&
      String(o.ada_name ?? "").trim().toLowerCase() !== String(r.ada_name ?? "").trim().toLowerCase(),
  );
});

// ─── 4. Container + suspicious strips ────────────────────────────────────────
const plastics = rows.filter((r) => perRow.get(r.id).identity.container === "plastic");
const containerStripped = rows.filter((r) =>
  perRow.get(r.id).identity.strippedTokens.some((t) => ["PL", "PET", "PLST", "PLASTIC", "TRAV", "TRAVELER", "TRAVELLER", "GLS", "GLASS"].includes(t)),
);
const aggressiveStrips = rows.filter((r) =>
  perRow.get(r.id).identity.strippedTokens.some((t) => /^\d{1,2} (?:ML|L)$/i.test(t)),
);
const bigFamilies = [...newGroups.entries()]
  .map(([k, list]) => ({ key: k, codes: codesOf(list).size, names: [...new Set(list.map((r) => r.name))] }))
  .filter((f) => f.codes >= 7)
  .sort((a, b) => b.codes - a.codes);

// ─── 5. Known-case cards ─────────────────────────────────────────────────────
const KNOWN = ["JACK DANIELS", "TITO", "SMIRNOFF 80", "MOHAWK VODKA", "FIREBALL"];
const knownCards = KNOWN.map((probe) => {
  const hits = rows.filter((r) => String(r.name ?? "").toUpperCase().includes(probe));
  const fams = new Map();
  for (const r of hits) {
    const { newKey, identity } = perRow.get(r.id);
    if (!fams.has(newKey)) fams.set(newKey, []);
    fams.get(newKey).push(
      `${r.code} · ${r.size ?? "?"} · ${identity.container}${identity.packCount ? ` · ${identity.packCount}pk` : ""} · ${r.name}`,
    );
  }
  return { probe, families: [...fams.entries()].map(([k, members]) => ({ key: k, members: [...new Set(members)].sort() })) };
});

// ─── 6. Report ───────────────────────────────────────────────────────────────
const outDir = path.resolve(process.cwd(), "family-audit");
mkdirSync(outDir, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  activeRows: rows.length,
  distinctCodes: codesOf(rows).size,
  brandFamilyPopulatedPct: Math.round((rows.filter((r) => String(r.brand_family ?? "").trim()).length / rows.length) * 1000) / 10,
  newFamilies: newGroups.size,
  newMultiCodeFamilies: [...newGroups.values()].filter((l) => codesOf(l).size > 1).length,
  healedSplitRows: healed.length,
  adaHealedRows: adaHealed.length,
  plasticRows: plastics.length,
  containerStrippedRows: containerStripped.length,
  aggressiveTwoTokenStrips: aggressiveStrips.length,
  bigFamilies7plus: bigFamilies.length,
};

console.log("\n══ FAMILY GROUPING AUDIT ══");
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);

console.log("\n── Healed-split samples (old logic isolated these; new key reunites) ──");
for (const r of healed.slice(0, 25)) {
  const { identity } = perRow.get(r.id);
  console.log(`  ${String(r.code).padEnd(7)} ${r.name}  →  [${identity.familyKey}] (${identity.container})`);
}

console.log("\n── Container-strip samples (eyeball: is each one REALLY the same bottle in plastic/glass?) ──");
for (const r of containerStripped.slice(0, 25)) {
  const { identity } = perRow.get(r.id);
  console.log(`  ${String(r.code).padEnd(7)} ${r.name}  →  [${identity.familyKey}] (${identity.container})`);
}

if (aggressiveStrips.length > 0) {
  console.log("\n── ⚠ Aggressive two-token strips (SEAGRAMS-7-class risk — eyeball every one) ──");
  for (const r of aggressiveStrips.slice(0, 25)) {
    const { identity } = perRow.get(r.id);
    console.log(`  ${String(r.code).padEnd(7)} ${r.name}  →  [${identity.familyKey}] stripped: ${identity.strippedTokens.join(", ")}`);
  }
}

console.log("\n── Biggest new families (over-merge eyeball, ≥7 codes) ──");
for (const f of bigFamilies.slice(0, 10)) {
  console.log(`  ${f.codes} codes → ${f.key}`);
  for (const n of f.names.slice(0, 8)) console.log(`      ${n}`);
}

console.log("\n── Known-case cards (what the app WOULD show) ──");
for (const card of knownCards) {
  console.log(`  ▸ ${card.probe}: ${card.families.length} famil${card.families.length === 1 ? "y" : "ies"}`);
  for (const f of card.families.slice(0, 6)) {
    console.log(`      [${f.key}]`);
    for (const m of f.members.slice(0, 10)) console.log(`        ${m}`);
  }
}

const reportPath = path.join(outDir, `family-audit-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      summary,
      healedSamples: healed.slice(0, 400).map((r) => ({ code: r.code, name: r.name, key: perRow.get(r.id).newKey })),
      containerStripped: containerStripped.slice(0, 400).map((r) => ({ code: r.code, name: r.name, container: perRow.get(r.id).identity.container })),
      aggressiveStrips: aggressiveStrips.map((r) => ({ code: r.code, name: r.name, stripped: perRow.get(r.id).identity.strippedTokens })),
      bigFamilies: bigFamilies.slice(0, 50),
      knownCards,
    },
    null,
    2,
  ),
);
console.log(`\nFull report: ${reportPath}`);
