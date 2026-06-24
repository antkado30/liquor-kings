#!/usr/bin/env node
/**
 * audit-resolver.mjs — measure the matcher across the WHOLE MLCC catalog.
 *
 * "Smart for every bottle" needs measurement of every bottle. For each SKU we
 * derive a how-an-owner-would-type-it query (its distinctive words + size) and
 * check resolveOrderLine returns THAT exact bottle. Reports top-1 / top-3
 * accuracy + a sample of real misses ([terms] want → got) so we fix the
 * failure patterns, then re-run.
 *
 * Round-trip from the catalog name is a proxy for real typing, but it reliably
 * surfaces ranking bugs (a flavor/variant outranking the bottle itself,
 * cross-brand matches, etc.). Genuinely ambiguous names (a brand with several
 * aged expressions, when only the brand is typed) will always need the "needs
 * your eye" flag — those aren't bugs.
 *
 * Runs on your Mac vs prod (LK_PROD_* in services/api/.env). Read-only, no deploy.
 *
 * USAGE (services/api/):
 *   node scripts/audit-resolver.mjs --all          # sweep the ENTIRE catalog
 *   node scripts/audit-resolver.mjs                 # quick sample of 500
 *   node scripts/audit-resolver.mjs --limit=2000 --offset=4000   # one window
 *   node scripts/audit-resolver.mjs --all --misses=60            # more miss examples
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
const has = (n) => process.argv.includes(`--${n}`);
const ALL = has("all");
const LIMIT = Math.min(20000, Math.max(1, Number(flag("limit") ?? 500)));
const OFFSET = Math.max(0, Number(flag("offset") ?? 0));
const SHOW = Math.max(0, Number(flag("misses") ?? 30));
const CONCURRENCY = 8;
const PAGE_SIZE = 1000; // Supabase per-read cap

const GENERIC = new Set([
  "vodka", "rum", "gin", "whiskey", "whisky", "tequila", "bourbon", "brandy",
  "liqueur", "wine", "cognac", "scotch", "schnapps", "spirit", "spirits", "cordial",
]);

async function fetchPage(offset, size) {
  const { data, error } = await supabase
    .from("mlcc_items")
    .select("code,name,bottle_size_ml")
    .order("code")
    .range(offset, offset + size - 1);
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }
  return (data || []).filter((b) => b.name && b.code != null);
}

function buildCases(bottles) {
  const cases = [];
  for (const b of bottles) {
    // len>=2 matches tokenizeName (keeps 2-letter brands UV/AD/G4 + ages);
    // tokenizeName already dropped 1-char tokens and bottle sizes.
    const distinctive = tokenizeName(b.name).filter((t) => t.length >= 2 && !GENERIC.has(t));
    if (distinctive.length === 0) continue;
    cases.push({ b, terms: distinctive.slice(0, 5) });
  }
  return cases;
}

const stats = { testable: 0, top1: 0, top3: 0, misses: [] };

async function resolveCases(cases) {
  let idx = 0;
  async function worker() {
    while (idx < cases.length) {
      const { b, terms } = cases[idx++];
      const r = await resolveOrderLine(supabase, { terms, sizeMl: b.bottle_size_ml });
      const picks = [r.best, ...(r.alternates || [])].filter(Boolean);
      stats.testable++;
      if (picks[0]?.code === b.code) stats.top1++;
      if (picks.slice(0, 3).some((c) => c.code === b.code)) stats.top3++;
      else if (stats.misses.length < SHOW) {
        stats.misses.push({
          terms,
          want: `${b.code} · ${b.name} [${b.bottle_size_ml ?? "?"}ml]`,
          got: picks[0] ? `${picks[0].code} · ${picks[0].name} [${picks[0].bottle_size_ml ?? "?"}ml]` : "(none)",
        });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

if (ALL) {
  console.log(`\nSweeping the ENTIRE catalog (pages of ${PAGE_SIZE}) — calls prod per bottle, ~a few minutes...\n`);
  let offset = 0;
  let page = 0;
  for (;;) {
    const bottles = await fetchPage(offset, PAGE_SIZE);
    if (bottles.length === 0) break;
    await resolveCases(buildCases(bottles));
    page++;
    process.stdout.write(`  …page ${page} done (${stats.testable} bottles, ${(100 * stats.top1 / (stats.testable || 1)).toFixed(1)}% top-1 so far)\n`);
    if (bottles.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
} else {
  console.log(`\nAuditing up to ${LIMIT} bottles (offset ${OFFSET}) — calls prod per bottle...\n`);
  await resolveCases(buildCases(await fetchPage(OFFSET, LIMIT)));
}

const n = stats.testable || 1;
console.log("\n──────────────────────────────────────────");
console.log(`Audited ${stats.testable} bottles${ALL ? " (full catalog)" : ""}.`);
console.log(`  top-1 (exact bottle IS the pick):  ${stats.top1}/${stats.testable}  ${((100 * stats.top1) / n).toFixed(1)}%`);
console.log(`  top-3 (exact bottle in top 3):     ${stats.top3}/${stats.testable}  ${((100 * stats.top3) / n).toFixed(1)}%`);
console.log(`\nSample misses (not in top 3) — [typed terms] want → got:`);
if (stats.misses.length === 0) console.log("  (none in this run 🎉)");
for (const m of stats.misses) {
  console.log(`  [${m.terms.join(" ")}]`);
  console.log(`     want: ${m.want}`);
  console.log(`     got:  ${m.got}`);
}
console.log("");
process.exit(0);
