#!/usr/bin/env node
/**
 * audit-family-siblings-2026-07-25.mjs — "make sure 100% of the bottles are
 * coded with the correct siblings" (Tony, 2026-07-25, after the size-flip
 * shipped on family_key).
 *
 * Grades EVERY active catalog row's stored family columns against the
 * canonical computeFamilyIdentity() (src/mlcc/family-key.js) and hunts the
 * failure modes that would break the card's size chip:
 *
 *   NULL KEY      no family_key → that bottle NEVER shows a size chip.
 *   STALE KEY     stored key ≠ what today's function computes from the name
 *                 → backfill drift; siblings can be missed or wrong.
 *   CONTAINER/PACK DRIFT   stored container/pack ≠ computed → chip labels lie.
 *   SPLIT FAMILY  two keys that differ only by punctuation/spacing → one
 *                 product line split into trees that can't see each other.
 *   MERGE SMELL   one family with duplicate (size,container,pack) triplets —
 *                 possible false merge (or a legit relist; eyeball the sample).
 *   CHIP REACH    % of bottles whose family has ≥2 members (chip appears).
 *
 * DB RULES NOTE (Tony's check, 2026-07-25): read-only; prints target host
 * first; Tony runs it. This script PAGES THE FULL CATALOG by design — a
 * catalog-wide audit cannot be 1,000-row-capped. Per the amended DB rule
 * (to be written into RULEBOOK at closeout): ad-hoc queries stay count-only/
 * capped; DATED READ-ONLY AUDIT SCRIPTS may page the catalog; writes never.
 *
 * USAGE (from services/api/):  node scripts/audit-family-siblings-2026-07-25.mjs
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { computeFamilyIdentity } from "../src/mlcc/family-key.js";

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
console.log(`target: ${new URL(SUPABASE_URL).host} (read-only family-sibling audit)`);
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const squash = (s) => norm(s).replace(/[^A-Z0-9]/g, ""); // split-detection lens

async function fetchAll() {
  const rows = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code, name, bottle_size_ml, container, pack_count, is_combo, family_key")
      .eq("is_active", true)
      .order("code", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`page ${page}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const main = async () => {
  const t0 = Date.now();
  const all = await fetchAll();
  const rows = all.filter((r) => r.name && r.name.trim());
  console.log(`catalog: ${rows.length} active rows (${all.length - rows.length} nameless skipped)`);

  const nullKey = [];
  const staleKey = [];
  const containerDrift = [];
  const packDrift = [];
  const byStored = new Map(); // stored family_key -> rows (non-combo)

  for (const r of rows) {
    const ident = computeFamilyIdentity(r.name);
    const stored = norm(r.family_key);
    const computed = norm(ident.familyKey);

    if (!stored) {
      nullKey.push(r);
    } else if (stored !== computed) {
      staleKey.push({ r, computed });
    }
    if (r.container != null && ident.container !== r.container) {
      containerDrift.push({ r, computed: ident.container });
    }
    const storedPack = r.pack_count ?? null;
    if (storedPack !== (ident.packCount ?? null)) {
      packDrift.push({ r, computed: ident.packCount ?? null });
    }
    if (r.is_combo !== true && stored) {
      if (!byStored.has(stored)) byStored.set(stored, []);
      byStored.get(stored).push(r);
    }
  }

  // SPLIT FAMILIES: distinct stored keys that collapse under squash().
  const bySquash = new Map();
  for (const key of byStored.keys()) {
    const sq = squash(key);
    if (!bySquash.has(sq)) bySquash.set(sq, new Set());
    bySquash.get(sq).add(key);
  }
  const splits = [...bySquash.values()].filter((set) => set.size > 1);

  // MERGE SMELL: same family, duplicate (size, container, pack) triplet.
  const mergeSmell = [];
  for (const [key, members] of byStored) {
    if (members.length < 2) continue;
    const seen = new Map();
    for (const m of members) {
      const trip = `${m.bottle_size_ml ?? "?"}|${m.container ?? "?"}|${m.pack_count ?? "-"}`;
      if (seen.has(trip)) {
        mergeSmell.push({ key, a: seen.get(trip), b: m });
        break; // one example per family is enough
      }
      seen.set(trip, m);
    }
  }

  // CHIP REACH: bottles whose family has ≥2 members see the size chip.
  const nonCombo = rows.filter((r) => r.is_combo !== true);
  let inMultiFamily = 0;
  for (const r of nonCombo) {
    const stored = norm(r.family_key);
    if (stored && (byStored.get(stored)?.length ?? 0) >= 2) inMultiFamily += 1;
  }

  const pct = (n, d) => (d ? ((100 * n) / d).toFixed(2) + "%" : "-");
  console.log(`\n===== FAMILY-SIBLING SCORECARD (${((Date.now() - t0) / 1000).toFixed(0)}s) =====`);
  console.log(`NULL family_key        : ${nullKey.length}  (${pct(nullKey.length, rows.length)}) — these NEVER show a size chip`);
  console.log(`STALE family_key       : ${staleKey.length}  (${pct(staleKey.length, rows.length)}) — stored ≠ today's computeFamilyIdentity`);
  console.log(`container drift        : ${containerDrift.length}  (${pct(containerDrift.length, rows.length)})`);
  console.log(`pack_count drift       : ${packDrift.length}  (${pct(packDrift.length, rows.length)})`);
  console.log(`SPLIT family groups    : ${splits.length}  (distinct keys that collapse under punctuation/space squash)`);
  console.log(`MERGE-smell families   : ${mergeSmell.length}  (dup size+container+pack inside one family — eyeball)`);
  console.log(`families (non-combo)   : ${byStored.size}`);
  console.log(`CHIP REACH             : ${inMultiFamily}/${nonCombo.length} bottles (${pct(inMultiFamily, nonCombo.length)}) have ≥1 sibling → size chip appears`);

  const show = (label, arr, fmt, cap = 15) => {
    if (!arr.length) return;
    console.log(`\n--- ${label} (first ${Math.min(cap, arr.length)} of ${arr.length}) ---`);
    for (const x of arr.slice(0, cap)) console.log(fmt(x));
  };
  show("NULL KEY", nullKey, (r) => `${r.code} · ${r.name}`);
  show("STALE KEY", staleKey, ({ r, computed }) => `${r.code} · ${r.name}\n    stored:   "${norm(r.family_key)}"\n    computed: "${computed}"`, 20);
  show("CONTAINER DRIFT", containerDrift, ({ r, computed }) => `${r.code} · ${r.name} · stored=${r.container} computed=${computed}`);
  show("PACK DRIFT", packDrift, ({ r, computed }) => `${r.code} · ${r.name} · stored=${r.pack_count ?? "null"} computed=${computed ?? "null"}`);
  show("SPLIT FAMILIES", splits, (set) => [...set].map((k) => `"${k}"`).join("  ≠  "), 15);
  show("MERGE SMELL", mergeSmell, ({ key, a, b }) => `"${key}": ${a.code} ${a.name} (${a.bottle_size_ml}ml) vs ${b.code} ${b.name} (${b.bottle_size_ml}ml)`, 10);

  console.log(`\nVERDICT GUIDE: NULL+STALE are the real size-chip breakers (fix = re-run the`);
  console.log(`family backfill — a WRITE, planned separately, Tony-run). SPLITs hide siblings`);
  console.log(`from each other. MERGE smell is often legit relists — eyeball before acting.`);
  console.log(`done — paste this whole output back.`);
};

main().catch((e) => {
  console.error(`family audit failed: ${e?.message ?? e}`);
  process.exit(1);
});
