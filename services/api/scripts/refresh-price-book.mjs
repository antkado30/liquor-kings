#!/usr/bin/env node
/**
 * refresh-price-book.mjs — pull the current MLCC price book into PROD, now.
 *
 * Why this exists: the pre-order doctor flagged "price book 42 days old." That
 * number only advances when we actually INGEST a new book — so 42 days can mean
 * either (a) MLCC simply hasn't republished (we're current, nothing to do) or
 * (b) the daily cron is dead and we've missed a real update. This script tells
 * you WHICH, and fixes (b) on the spot.
 *
 * It runs the exact same logic as the daily cron (checkAndIngestIfPriceBook-
 * Changed): discover the URL MLCC is publishing right now, compare to our last
 * completed ingest, and ingest only if it changed. Cheap when nothing changed
 * (one page fetch); a full ~13.8k-row upsert + UPC enrichment when it did.
 *
 * Runs on your Mac vs PROD (sandbox has no egress). Needs LK_PROD_SUPABASE_URL /
 * LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_* fallback) in services/api/.env.
 *
 * USAGE (from services/api/):
 *   node scripts/refresh-price-book.mjs            # ingest only if MLCC changed
 *   node scripts/refresh-price-book.mjs --force    # re-ingest even if unchanged
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { checkAndIngestIfPriceBookChanged } from "../src/mlcc/mlcc-price-book-scheduler.js";

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("This points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}

const force = process.argv.includes("--force");
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

console.log(`\n[refresh-price-book] prod=${SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0]}  force=${force}`);
console.log("[refresh-price-book] discovering current MLCC price book… (downloads + upserts only if changed)\n");

const result = await checkAndIngestIfPriceBookChanged(supabase, { force });

console.log(JSON.stringify(result, null, 2));
console.log("");
if (result.ingested) {
  console.log("✓ Ingested a fresh price book. Catalog + prices are now current.");
} else if (/no change/i.test(result.reason || "")) {
  console.log("✓ No change — what MLCC publishes right now is what we already have.");
  console.log("  The '42 days old' age is benign: MLCC just hasn't republished. You're current.");
} else {
  console.log("⚠ Did NOT ingest. Read the reason above before ordering.");
}
console.log("");
process.exit(result.ingested || /no change/i.test(result.reason || "") ? 0 : 1);
