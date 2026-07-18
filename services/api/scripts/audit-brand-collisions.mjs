#!/usr/bin/env node
/**
 * audit-brand-collisions — grounded photo-truth audit (2026-07-18).
 *
 * The Royal Canadian ↔ Crown Royal bug (2026-07-17): a low-profile budget
 * brand shares a distinctive word with a DOMINANT premium brand, so image
 * search returns the premium brand's bottle and the low-profile SKU ends up
 * wearing the wrong photo. That one was caught on-device by luck. This finds
 * the rest BEFORE a customer does — using the catalog's own signals, no guessing.
 *
 * Heuristic (deliberately high-precision, low-noise):
 *   - Collapse active items to product-line families (family_key).
 *   - A family is a COLLISION RISK when it HAS an image, is low-profile
 *     (low scan_count), and shares a DISTINCTIVE token (a word used by only
 *     a few families) with a MUCH higher-scan family. The high-scan family
 *     is the likely impostor source.
 *   - Ranked by risk = scan_gap × token_rarity so the worst offenders lead.
 *
 * READ-ONLY. Never writes. Prints a review list + ready-to-paste
 * COLLISION_NEGATIVES suggestions. Run locally (LK_PROD_* in services/api/.env).
 *
 * USAGE (services/api/):
 *   node scripts/audit-brand-collisions.mjs                 # top 30
 *   node scripts/audit-brand-collisions.mjs --top=60         # more
 *   node scripts/audit-brand-collisions.mjs --max-scans=40   # "low-profile" ceiling
 *   node scripts/audit-brand-collisions.mjs --token-max=6    # "distinctive" ceiling
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL;
const SUPABASE_KEY = process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("LK_PROD_SUPABASE_URL points at the LOCAL dev stack — refusing.");
  process.exit(1);
}
console.log("target:", new URL(SUPABASE_URL).host);

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const TOP = Math.max(1, Number.parseInt(arg("top", "40"), 10) || 40);
// A word is "distinctive" (brand-ish, not a category) when ≤ this many
// product lines use it. Bump with --token-max to widen the net.
const TOKEN_MAX_FAMILIES = Math.max(2, Number.parseInt(arg("token-max", "6"), 10) || 6);

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Words that carry no brand identity: sizes, containers, MLCC suffixes, filler.
const STOP = new Set([
  "the", "and", "of", "a", "with", "for", "in", "co", "inc", "llc", "ltd",
  "ml", "l", "liter", "litre", "pt", "pint", "qt", "quart", "gal", "gallon",
  "pl", "plastic", "glass", "pk", "pack", "case", "bottle", "bottles",
  "proof", "yr", "yrs", "year", "years", "old", "no", "vsop", "xo",
  // Broad category words — shared by hundreds of families, never a brand.
  "vodka", "whiskey", "whisky", "rum", "gin", "tequila", "bourbon", "brandy",
  "cognac", "liqueur", "cordial", "schnapps", "wine", "blend", "blended",
  "spiced", "flavored", "dry", "spirits", "American", "canadian", "irish",
  "scotch", "kentucky", "straight", "reserve", "premium", "select", "classic",
]);

function tokens(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

async function loadFamilies() {
  const PAGE = 1000;
  /** @type {Map<string,{name:string,scans:number,hasImage:boolean,code:string}>} */
  const fams = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("mlcc_items")
      .select("code, name, family_key, scan_count, image_url, is_active")
      .eq("is_active", true)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("read failed:", error.message);
      process.exit(1);
    }
    for (const r of data ?? []) {
      const key = String(r.family_key ?? "").trim() || `code:${r.code}`;
      const cur = fams.get(key) ?? { name: r.name ?? "", scans: 0, hasImage: false, code: r.code };
      // Representative name: prefer the shortest (base line, not a variant).
      if (r.name && (!cur.name || r.name.length < cur.name.length)) cur.name = r.name;
      cur.scans = Math.max(cur.scans, Number(r.scan_count ?? 0) || 0);
      cur.hasImage = cur.hasImage || (r.image_url != null && String(r.image_url).trim() !== "");
      fams.set(key, cur);
    }
    if (!data || data.length < PAGE) break;
  }
  return fams;
}

const fams = await loadFamilies();
console.log(`[audit] ${fams.size} product-line families loaded`);

// token → families using it
const tokenIndex = new Map();
for (const [key, f] of fams) {
  for (const t of new Set(tokens(f.name))) {
    if (!tokenIndex.has(t)) tokenIndex.set(t, []);
    tokenIndex.get(t).push(key);
  }
}

/*
  CLUSTER mode (recalibrated 2026-07-18): this is a pre-launch catalog with
  tiny scan counts (top bottles ~14 scans), so "dominant brand by scans" is a
  dead signal — Crown Royal out-FAMES Royal Canadian on Google, it doesn't
  out-scan it here. Instead we cluster families by a shared DISTINCTIVE word
  (used by only a few families) where ≥2 members carry a photo. Each such
  cluster is a place two different product lines could be wearing each other's
  bottle. Human decides which is the impostor; the audit just points the light.
*/
const clusters = [];
for (const [token, keys] of tokenIndex) {
  if (keys.length < 2 || keys.length > TOKEN_MAX_FAMILIES) continue; // distinctive
  const members = keys
    .map((k) => ({ key: k, ...fams.get(k) }))
    .filter((m) => m.hasImage);
  if (members.length < 2) continue; // need ≥2 imaged lines to collide
  // Kill the dominant noise source: two sizes/expressions of the SAME brand
  // (Corzo Silver/Anejo, Kirk & Sweeney 12yr/23yr) share a word harmlessly.
  // A real cross-brand collision has members with DIFFERENT brand roots, AND
  // the shared word is NOT everyone's first (brand) word — exactly the Royal
  // Canadian ("royal" first) vs Crown Royal ("royal" second) signature.
  const firstTokenOf = (n) => tokens(n)[0] ?? "";
  const distinctRoots = new Set(members.map((m) => firstTokenOf(m.name)));
  if (distinctRoots.size < 2) continue; // all same brand root → skip
  const isSomeonesRoot = members.some((m) => firstTokenOf(m.name) === token);
  const isSomeonesNonRoot = members.some((m) => firstTokenOf(m.name) !== token && tokens(m.name).includes(token));
  if (!(isSomeonesRoot && isSomeonesNonRoot)) continue; // not the subset signature
  members.sort((a, b) => b.scans - a.scans);
  clusters.push({ token, members, rarity: 1 / keys.length, size: members.length });
}

// Rank: rarer shared word first (stronger brand-collision signal), then more
// imaged members (more ways to be wrong).
clusters.sort((a, b) => b.rarity - a.rarity || b.size - a.size);
const top = clusters.slice(0, TOP);

console.log(`\n[audit] ${clusters.length} distinctive-word clusters with ≥2 photographed lines. Top ${top.length}:\n`);
for (const c of top) {
  console.log(`  "${c.token}" — ${c.members.length} lines share this word & have photos:`);
  for (const m of c.members) {
    console.log(`      • ${m.name}  (#${m.code}, ${m.scans} scans)`);
  }
  console.log("");
}

console.log(
  `[audit] Review each cluster on device (catalog → search the word). Where a line wears a DIFFERENT line's bottle, add a COLLISION_NEGATIVES row — e.g. for the Royal case:\n` +
    `  { when: /\\broyal canadian\\b/i, unless: /\\bcrown royal\\b/i, negatives: ['-"crown royal"'] },`,
);
console.log("\n[audit] read-only — nothing was written.");
