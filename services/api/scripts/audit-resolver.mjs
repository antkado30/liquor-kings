#!/usr/bin/env node
/**
 * audit-resolver.mjs — measure the matcher across the WHOLE MLCC catalog.
 *
 * "Fix it for every bottle" needs measurement of every bottle. For each SKU we
 * derive a how-an-owner-would-type-it query (its 2 most distinctive words +
 * size) and check resolveOrderLine returns THAT exact bottle. Reports top-1 /
 * top-3 accuracy + a sample of real misses (terms → wanted vs got) so we can
 * fix the failure patterns, then re-run until it's near-perfect.
 *
 * Round-trip from the catalog name is a proxy for real typing, but it reliably
 * surfaces ranking bugs (a flavor/variant outranking the bottle itself,
 * cross-brand matches, etc.). Genuinely ambiguous names will always need the
 * "needs your eye" flag — those aren't bugs.
 *
 * Runs on your Mac vs prod (LK_PROD_* in services/api/.env). Read-only, no deploy.
 *
 * USAGE (services/api/):
 *   node scripts/audit-resolver.mjs                       # sample 500 (by code)
 *   node scripts/audit-resolver.mjs --limit=3000          # bigger sample
 *   node scripts/audit-resolver.mjs --offset=3000 --limit=3000   # page through all
 *   node scripts/audit-resolver.mjs --misses=50           # show more miss examples
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { resolveOrderLine, tokenizeName } from "../src/lib/resolve-order-lines.js";

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

const flag = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const LIMIT = Math.min(20000, Math.max(1, Number(flag("limit") ?? 500)));
const OFFSET = Math.max(0, Number(flag("offset") ?? 0));
const SHOW = Math.max(0, Number(flag("misses") ?? 25));
const CONCURRENCY = 8;

const GENERIC = new Set([
  "vodka", "rum", "gin", "whiskey", "whisky", "tequila", "bourbon", "brandy",
  "liqueur", "wine", "cognac", "scotch", "schnapps", "spirit", "spirits", "cordial",
]);

const { data, error } = await supabase
  .from("mlcc_items")
  .select("code,name,bottle_size_ml")
  .order("code")
  .range(OFFSET, OFFSET + LIMIT - 1);
if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}
const bottles = (data || []).filter((b) => b.name && b.code != null);

// Build the testable queries: type the bottle's own distinctive words (brand +
// variant), in order, capped — a fair "can the matcher find THIS exact bottle
// from its words" round-trip. Skip bottles with no distinctive word to type.
const cases = [];
for (const b of bottles) {
  const distinctive = tokenizeName(b.name).filter(
    (t) => (t.length >= 3 || /^\d{2,}$/.test(t)) && !GENERIC.has(t),
  );
  if (distinctive.length === 0) continue;
  const terms = distinctive.slice(0, 5);
  cases.push({ b, terms });
}

console.log(`\nAuditing ${cases.length} bottles (offset ${OFFSET}, limit ${LIMIT}) — this calls prod per bottle, give it a moment...\n`);

let top1 = 0;
let top3 = 0;
const misses = [];

// Simple concurrency pool.
let idx = 0;
async function worker() {
  while (idx < cases.length) {
    const my = idx++;
    const { b, terms } = cases[my];
    const r = await resolveOrderLine(supabase, { terms, sizeMl: b.bottle_size_ml });
    const picks = [r.best, ...(r.alternates || [])].filter(Boolean);
    if (picks[0]?.code === b.code) top1++;
    if (picks.slice(0, 3).some((c) => c.code === b.code)) top3++;
    else if (misses.length < SHOW) {
      misses.push({
        terms,
        want: `${b.code} · ${b.name} [${b.bottle_size_ml ?? "?"}ml]`,
        got: picks[0] ? `${picks[0].code} · ${picks[0].name} [${picks[0].bottle_size_ml ?? "?"}ml]` : "(none)",
      });
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const n = cases.length || 1;
console.log("──────────────────────────────────────────");
console.log(`top-1 (exact bottle IS the pick):  ${top1}/${cases.length}  ${((100 * top1) / n).toFixed(1)}%`);
console.log(`top-3 (exact bottle in top 3):     ${top3}/${cases.length}  ${((100 * top3) / n).toFixed(1)}%`);
console.log(`\nSample misses (not in top 3) — [typed terms] want → got:`);
if (misses.length === 0) console.log("  (none in this sample 🎉)");
for (const m of misses) {
  console.log(`  [${m.terms.join(" ")}]`);
  console.log(`     want: ${m.want}`);
  console.log(`     got:  ${m.got}`);
}
console.log("");
process.exit(0);
