#!/usr/bin/env node
/**
 * build-brand-flagships.mjs — derive the flagship for EVERY brand from the
 * catalog's own size-ladder signal and fill public.brand_flagships.
 *
 * (2026-08-12, Tony: "that shouldnt only work for captain morgan it has to
 * work for EVERY bottle every single bottle idc how long it takes.")
 *
 * What it does:
 *   1. Pages the whole active catalog (code, name, size, is_combo).
 *   2. Clusters rows into brands — truncation-aware (CAPT MORGAN and
 *      CAPTAIN MORGAN are one brand; JACKSON MORGAN stays separate).
 *   3. Picks each brand's flagship line by size-ladder depth, demoting
 *      flavors/proof-lines/aged/variety/combo packs.
 *   4. CONFIDENT picks upsert into brand_flagships (source='heuristic';
 *      rows with source='curated' are never touched).
 *      AMBIGUOUS picks (top two lines within the margin) go ONLY to the
 *      review CSV — a knowledge table must not guess.
 *   5. Writes brand-flagships-review.csv next to this script either way.
 *
 * READ-ONLY unless --write is passed. Run from services/api/:
 *   node scripts/build-brand-flagships.mjs            (dry run + CSV)
 *   node scripts/build-brand-flagships.mjs --write    (upsert + CSV)
 *
 * Needs LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or the
 * plain SUPABASE_* pair) in services/api/.env — same as resolve-order-codes.
 * Requires sql/2026-08-12-brand-flagships.sql applied first.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  clusterBrands,
  chooseFlagship,
  brandKeysOf,
} from "../src/lib/brand-flagships.js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or LK_PROD_*) in env");
  process.exit(1);
}
const WRITE = process.argv.includes("--write");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Same generic-word set the resolver uses for bare-brand detection —
// kept inline so the script has zero import risk from resolver churn.
const GENERIC = new Set([
  "vodka", "rum", "gin", "whiskey", "whisky", "tequila", "bourbon", "brandy",
  "liqueur", "wine", "cognac", "scotch", "schnapps", "spirit", "spirits",
  "cordial", "blended", "straight",
]);

async function fetchCatalog() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code, name, bottle_size_ml, is_combo")
      .eq("is_active", true)
      .order("code", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`catalog page failed at ${from}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const csvEscape = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  console.log(`Fetching active catalog…`);
  const rows = await fetchCatalog();
  console.log(`${rows.length} active items`);

  const clusters = clusterBrands(rows);
  console.log(`${clusters.size} brand clusters`);

  const upserts = [];
  const review = [];
  for (const [lead, clusterRows] of clusters) {
    const pick = chooseFlagship(clusterRows);
    if (!pick) continue;
    const keys = brandKeysOf(clusterRows, GENERIC);
    const line = {
      lead,
      lineKey: pick.lineKey,
      aliasTerms: pick.aliasTerms.join(" "),
      code: pick.flagshipCode,
      score: pick.score,
      runnerUp: pick.runnerUp ? `${pick.runnerUp.lineKey} (${pick.runnerUp.score})` : "",
      reasons: pick.reasons.join("|"),
      confident: pick.confident,
      keys: keys.join("|"),
    };
    review.push(line);
    // Single-line brands need no alias — the resolver finds them fine;
    // writing them would just bloat the table. Multi-line brands only.
    if (pick.confident && pick.runnerUp != null) {
      for (const key of keys) {
        upserts.push({
          brand_key: key,
          alias_terms: pick.aliasTerms,
          flagship_code: pick.flagshipCode,
          flagship_name: pick.lineKey,
          source: "heuristic",
          confident: true,
          score: pick.score,
          runner_up: pick.runnerUp?.lineKey ?? null,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  const ambiguous = review.filter((r) => !r.confident);
  console.log(
    `${review.length} brands scored → ${upserts.length} alias keys ready, ${ambiguous.length} ambiguous (review-only)`,
  );

  const here = dirname(fileURLToPath(import.meta.url));
  const csvPath = join(here, "brand-flagships-review.csv");
  const header = "confident,lead,flagship_line,alias_terms,code,score,runner_up,reasons,keys";
  const csv = [
    header,
    ...review
      .sort((a, b) => Number(a.confident) - Number(b.confident) || a.lead.localeCompare(b.lead))
      .map((r) =>
        [r.confident, r.lead, r.lineKey, r.aliasTerms, r.code, r.score, r.runnerUp, r.reasons, r.keys]
          .map(csvEscape)
          .join(","),
      ),
  ].join("\n");
  writeFileSync(csvPath, csv);
  console.log(`Review CSV: ${csvPath} (ambiguous rows sort to the top)`);

  if (!WRITE) {
    console.log(`DRY RUN — nothing written. Re-run with --write to upsert.`);
    return;
  }

  // Never clobber curated rows: fetch curated keys once, filter them out.
  const { data: curatedRows, error: curErr } = await supabase
    .from("brand_flagships")
    .select("brand_key")
    .eq("source", "curated");
  if (curErr) throw new Error(`curated fetch failed: ${curErr.message}`);
  const curated = new Set((curatedRows ?? []).map((r) => r.brand_key));
  const writable = upserts.filter((u) => !curated.has(u.brand_key));

  const CHUNK = 500;
  for (let i = 0; i < writable.length; i += CHUNK) {
    const slice = writable.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("brand_flagships")
      .upsert(slice, { onConflict: "brand_key" });
    if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
    console.log(`upserted ${Math.min(i + CHUNK, writable.length)}/${writable.length}`);
  }
  console.log(
    `DONE. ${writable.length} keys written (${upserts.length - writable.length} skipped as curated).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
