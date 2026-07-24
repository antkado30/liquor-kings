#!/usr/bin/env node
/**
 * audit-corpus-2026-07-23.mjs — run Tony's REAL 2026-07-23 weekly list
 * through resolveOrderLine exactly as the assistant does, and print best
 * match + alternates + confidence per line.
 *
 * Purpose: the 2026-07-23 live test produced named misses (Jameson →
 * Natterjack, Skrewball → Porter's, Stoli → Burnett's/Grainger's, Ketel One
 * → Lone Light, Bacardi plain → Spiced, Fireball → Catch Fire, Smirnoff
 * 200ml → Tito's, Platinum 7X 1750 → a 100ML). Before touching scoring we
 * capture the resolver's CURRENT verdict for every corpus line — evidence
 * first, surgery second (docs/lk/assistant-resolver-corpus-2026-07-23.md).
 *
 * READ-ONLY catalog lookups. Runs on Tony's Mac against prod
 * (LK_PROD_* in services/api/.env). USAGE (from services/api/):
 *   node scripts/audit-corpus-2026-07-23.mjs
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
console.log(`target: ${new URL(SUPABASE_URL).host} (read-only resolver audit)`);
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

/*
 * The corpus, phrased as the assistant's parse layer would emit each line
 * ({name without size words, size string}). Known-wrong live results from
 * the 2026-07-23 card are noted in `saw` so the output reads as a diff.
 */
const LINES = [
  { name: "Tito's", size: "half pint", qty: 12 },
  { name: "Smirnoff", size: "half pint", qty: 12, saw: "TITO'S 7128 (wrong brand!)" },
  { name: "Red Stag", size: "half pint", qty: 12 },
  { name: "Jack Daniel's honey", size: "half pint", qty: 12 },
  { name: "Skyy vodka", size: "fifth", qty: 3 },
  { name: "Jack Daniel's fire", size: "fifth", qty: 3 },
  { name: "Jack Daniel's fire", size: "liter", qty: 3 },
  { name: "Fireball", size: "pint", qty: null, saw: "CATCH FIRE 27082 (wrong brand)" },
  { name: "Fireball double shot", size: null, qty: null, saw: "CATCH FIRE 100014 (wrong brand + size term unmapped)" },
  { name: "Glenfidich 18 year", size: null, qty: 1 },
  { name: "Jameson", size: "fifth", qty: 1, saw: "NATTERJACK 28885 (wrong brand)" },
  { name: "Evan Williams honey", size: "fifth", qty: 3 },
  { name: "Carolans", size: "fifth", qty: 3 },
  { name: "Limoncello", size: "fifth", qty: 6, saw: "multiple brands — ambiguity is FAIR here" },
  { name: "Limoncello", size: "pint", qty: 6 },
  { name: "Dewars white label", size: "pint", qty: 3 },
  { name: "Johny walker red label", size: "fifth", qty: 3 },
  { name: "Skrewball", size: "fifth", qty: 3, saw: "PORTER'S PEANUT BUTTER 23292 (wrong brand)" },
  { name: "Casamigos reposado", size: "fifth", qty: 3 },
  { name: "Ocho tequila anejo", size: "fifth", qty: 6 },
  { name: "Ocho tequila reposado", size: "fifth", qty: 6 },
  { name: "Casamigos reposado", size: "liter", qty: 3 },
  { name: "Tito's double shot", size: null, qty: null, saw: "asked 50ml case qty (behavior OK; size term unmapped)" },
  { name: "Bacardi rum plastic", size: "fifth", qty: 12, saw: "BACARDI SPICED 7938 (flavor beat plain)" },
  { name: "Bacardi rum plastic", size: "half gallon", qty: 6, saw: "BACARDI SPICED 7940 review" },
  { name: "Bacardi rum", size: "liter", qty: 3, saw: "BACARDI SPICED 7939 (flavor beat plain)" },
  { name: "Blue chair rum coconut cream", size: "fifth", qty: 3 },
  { name: "Blue chair rum key lime cream", size: "fifth", qty: 3 },
  { name: "Olive cherry vodka", size: "fifth", qty: 3, saw: "VEIL CHERRY 27399 (typo guess — plausibly right, Tony to confirm)" },
  { name: "Smirnoff red white berry", size: "fifth", qty: 3 },
  { name: "Smirnoff pink lemonade", size: "fifth", qty: 3 },
  { name: "Platinum 7x plastic", size: "1/2 gallon", qty: 3, saw: "card best = 100 ML 6937 (SIZE LIE — worst class)" },
  { name: "Svedka vodka plastic", size: "half gallon", qty: 3 },
  { name: "Ketel one", size: "half gallon", qty: 3, saw: "LONE LIGHT 30850 (wrong brand)" },
  { name: "Stoli vanilla", size: "fifth", qty: 6, saw: "BURNETT'S VANILLA 85740 (wrong brand)" },
  { name: "Stoli vanilla", size: "liter", qty: 6, saw: "GRAINGER'S ORG VANILLA 28710 (wrong brand)" },
  { name: "Stoli vanilla", size: "1/2 gallon", qty: 3 },
];

const fmt = (c) =>
  c
    ? `${c.code} · ${c.name} · ${c.bottle_size_label ?? (c.bottle_size_ml ? c.bottle_size_ml + "ml" : "?")}`
    : "(none)";

const main = async () => {
  let flagged = 0;
  for (const line of LINES) {
    const sizeMl = sizeFromText(String(line.size || "")) ?? sizeFromText(line.name) ?? null;
    const r = await resolveOrderLine(supabase, {
      name: line.name,
      sizeMl,
      prefer: preferFromText(line.name),
    });
    const alts = (r.alternates || []).slice(0, 3).map(fmt).join(" | ");
    console.log(`\n>> "${line.name}" size=${line.size ?? "-"} (sizeMl=${sizeMl ?? "-"})`);
    console.log(`   conf=${r.confidence}  best: ${fmt(r.best)}`);
    if (alts) console.log(`   alts: ${alts}`);
    if (line.saw) {
      flagged += 1;
      console.log(`   LIVE CARD SAW: ${line.saw}`);
    }
  }
  console.log(`\ndone — ${LINES.length} lines, ${flagged} with live-card notes. Paste this whole output back.`);
};

main().catch((e) => {
  console.error(`audit failed: ${e?.message ?? e}`);
  process.exit(1);
});
