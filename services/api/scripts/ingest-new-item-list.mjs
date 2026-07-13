/**
 * Ingest MLCC's between-book "New Item Price List" into mlcc_items (PROD).
 *
 * WHY (2026-07-12, Option A): MLCC publishes new SKUs in these lists weeks
 * before the next full price book. The daily cron ingests full books only,
 * so a June release stayed invisible to scan/search/AI until the next full
 * book. This script closes that hole ON DEMAND — deliberately manual for
 * now (cron wiring is a post-2026-07-16 decision; nothing about the daily
 * automation changes until then).
 *
 * WHAT IT DOES: discovers the newest New Item Price List .xlsx on the LCC
 * info page (or takes --url=), downloads + parses it with the SAME parser
 * as the full book, and ADDITIVELY upserts the rows (composite code+ADA
 * key, family identity computed, is_new_item=true). It can never
 * deactivate or remove anything, refuses row counts that smell like a
 * full book (>2000), and records an mlcc_price_book_runs row with
 * kind='new_item_list' so the scheduler + staleness card (which filter
 * kind='full') are never confused.
 *
 * KNOWN LIMIT: UPCs come from the full book's TXT enrichment, so a
 * new-item SKU is searchable/browsable/AI-resolvable immediately but
 * scannable only after the next full book (or a manual UPC mapping).
 *
 * SAFETY: targets PROD via LK_PROD_* env ONLY, prints the target host,
 * refuses localhost. DRY-RUN by default — shows the discovered URL, row
 * count, and how many codes are genuinely new to the catalog. Writing
 * requires --apply.
 *
 * USAGE (from services/api/):
 *   node scripts/ingest-new-item-list.mjs                 # dry-run, discovery
 *   node scripts/ingest-new-item-list.mjs --url=https://… # dry-run, exact file
 *   node scripts/ingest-new-item-list.mjs --apply         # real ingest
 *   node scripts/ingest-new-item-list.mjs --apply --date=2026-06-07
 *     (--date stamps price_book_date/last_price_book_date for the run;
 *      defaults to today. Use the list's published date when known.)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { ingestMlccPriceBook } from "../src/mlcc/mlcc-price-book-ingestor.js";

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const APPLY = argv.apply === "true";
const URL_OVERRIDE = typeof argv.url === "string" && argv.url !== "true" ? argv.url : undefined;
let priceBookDate;
if (typeof argv.date === "string" && argv.date !== "true") {
  const d = new Date(`${argv.date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    console.error(`--date="${argv.date}" is not a valid YYYY-MM-DD date.`);
    process.exit(1);
  }
  priceBookDate = d;
}

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env — " +
      "this script targets PROD explicitly and refuses to guess.",
  );
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("LK_PROD_SUPABASE_URL points at the LOCAL dev stack — refusing.");
  process.exit(1);
}

console.log("target:", new URL(SUPABASE_URL).host);
console.log(
  `[new-item-ingest] mode=${APPLY ? "APPLY (writes prod)" : "DRY-RUN (no writes — pass --apply to write)"}` +
    (URL_OVERRIDE ? ` url=${URL_OVERRIDE}` : " url=(discover from LCC page)") +
    (priceBookDate ? ` date=${argv.date}` : ""),
);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const result = await ingestMlccPriceBook(supabase, {
  kind: "new_item_list",
  url: URL_OVERRIDE,
  priceBookDate,
  dryRun: !APPLY,
});

if (!result.ok) {
  console.error("[new-item-ingest] FAILED:", result.error);
  process.exit(1);
}

if (result.dryRun) {
  console.log(
    `[new-item-ingest] DRY-RUN OK — ${result.totalItems} row(s) in the list, ` +
      `${result.newToCatalog} code(s) the catalog does NOT know yet.`,
  );
  console.log("[new-item-ingest] file:", result.url);
  console.log("[new-item-ingest] happy with the above? re-run with --apply");
} else {
  console.log(
    `[new-item-ingest] APPLIED — run ${result.runId}: ${result.totalItems} row(s) upserted, ` +
      `${result.newItems} new to catalog, ${result.updatedItems} price-updated, ` +
      `${result.chunkUpsertErrors} chunk error(s).`,
  );
  console.log(
    "[new-item-ingest] new SKUs are live in search/browse/AI now; UPC scan coverage arrives with the next full book.",
  );
}
