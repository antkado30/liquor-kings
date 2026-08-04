/**
 * MLCC price-book auto-update.
 *
 * The MLCC price-book-info page publishes the spirits price book as a file
 * whose media URL carries a `?rev=` hash. When MLCC republishes (a quarter
 * update, or a mid-quarter price change), that URL changes. This module
 * detects that change and re-ingests — so the catalog auto-updates whenever
 * MLCC updates, without anyone clicking anything.
 *
 * Trigger model:
 *   - PRIMARY: an external cron service (e.g. cron-job.org) hits
 *     POST /price-book/check-updates once a day. Reliable even though the
 *     Fly machine sleeps when idle — the request wakes it.
 *   - The core logic (checkAndIngestIfPriceBookChanged) is idempotent and
 *     cheap when nothing changed (just one page fetch), so it is safe to
 *     call as often as the cron fires.
 *
 * startPriceBookScheduler() is an optional in-process timer kept for the
 * case where the API runs on an always-on machine. It is NOT wired into
 * index.js today because a setInterval is unreliable on an auto-sleeping
 * machine — the external cron is the mechanism we rely on.
 */

import {
  discoverLatestPriceBookUrl,
  discoverLatestNewItemListUrl,
  discoverLatestRetailPriceChangesUrl,
  discoverLatestAdaChangesUrl,
  ingestMlccPriceBook,
} from "./mlcc-price-book-ingestor.js";
import { runUpcEnrichment } from "./mlcc-price-book-upc-enrichment.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Source URL of the most recent COMPLETED price-book ingest.
 * This is what we compare the currently-published URL against.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ ok: boolean, url: string | null, error?: string }>}
 */
async function getLastCompletedIngestUrl(supabase) {
  // 2026-06-14 full-app sweep: intentionally exact-matches "complete" only
  // (NOT "complete_with_errors", per mlcc-price-book-ingestor.js). A run
  // that finished with chunk-upsert errors must NOT count as "last
  // completed" — otherwise checkAndIngestIfPriceBookChanged() would see
  // lastUrl === currentUrl and skip re-ingesting a catalog we know is
  // partially stale. Leaving lastUrl pointing at the prior good run keeps
  // currentUrl !== lastUrl true, so the next cron tick retries. Do not
  // widen this to .in(["complete", "complete_with_errors"]).
  const { data, error } = await supabase
    .from("mlcc_price_book_runs")
    .select("source_url, completed_at")
    .eq("status", "complete")
    // kind='full' (2026-07-12): New Item Price List runs share this table
    // now. Comparing the live FULL-book URL against a new-item run's URL
    // would re-ingest the full book every cron tick. Full compares to full.
    .eq("kind", "full")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { ok: false, url: null, error: error.message };
  }
  return { ok: true, url: data?.source_url ?? null };
}

/**
 * Last successfully-ingested source URL for ONE between-book kind
 * (2026-08-04). Same shape/rules as getLastCompletedIngestUrl, but each
 * kind compares only against its own ledger — a retail-changes URL must
 * never suppress (or trigger) an ADA-changes ingest.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} kind
 * @returns {Promise<{ ok: boolean, url: string | null, error?: string }>}
 */
async function getLastCompletedIngestUrlOfKind(supabase, kind) {
  const { data, error } = await supabase
    .from("mlcc_price_book_runs")
    .select("source_url, completed_at")
    .eq("status", "complete")
    .eq("kind", kind)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { ok: false, url: null, error: error.message };
  }
  return { ok: true, url: data?.source_url ?? null };
}

/*
  Between-book auto-ingest (2026-08-04, Tony's mandate: "prices always
  automatically up to date with whatever updates mlcc/milo makes in all
  aspects"). MLCC publishes three between-book Excel lists alongside the
  full book: New Item Price List (new SKUs weeks before the next book),
  Retail Price Changes (mid-book price corrections), and ADA Changes
  (distributor reassignments). Until now only the full book was on the
  daily cron — new-item lists were a manual script, the other two were
  ingested by NOTHING, so catalog prices could lag a mid-book correction
  until the next full book landed.
*/
const BETWEEN_BOOK_CHECKS = [
  { kind: "new_item_list", discover: discoverLatestNewItemListUrl },
  { kind: "retail_price_changes", discover: discoverLatestRetailPriceChangesUrl },
  { kind: "ada_changes", discover: discoverLatestAdaChangesUrl },
];

/**
 * Check all three between-book lists and additively ingest any newly
 * published one. Runs on the same daily cron tick as the full-book check
 * (route: POST /price-book/check-updates), AFTER it — if a brand-new full
 * book and its same-day companion lists appear together, the full book
 * lands first and the companions upsert the same values idempotently
 * (numEq sees no delta → no price_changed_at stamp, no memory churn).
 *
 * Fail-soft per kind: one list's discovery/ingest failure never blocks
 * the others. Never throws. No UPC enrichment here (that's TXT-driven
 * and full-book-only). Row-count fence (≤2000) + additive-only upsert
 * are enforced inside ingestMlccPriceBook per kind.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ checked: true, results: Array<object> }>}
 */
export async function checkAndIngestBetweenBookLists(supabase) {
  const results = [];
  for (const { kind, discover } of BETWEEN_BOOK_CHECKS) {
    try {
      const disc = await discover();
      if (!disc.ok) {
        // Absence of a list on the page is normal between publishes —
        // report, don't alarm.
        results.push({ kind, ingested: false, reason: `discovery: ${disc.error}` });
        continue;
      }
      const currentUrl = disc.url;
      const last = await getLastCompletedIngestUrlOfKind(supabase, kind);
      if (!last.ok) {
        results.push({ kind, ingested: false, reason: `ledger read failed: ${last.error}`, currentUrl });
        continue;
      }
      if (last.url && last.url === currentUrl) {
        results.push({ kind, ingested: false, reason: "no change", currentUrl });
        continue;
      }
      console.log(
        `[price-book-scheduler] new ${kind} list detected — ingesting. current=${currentUrl} last=${last.url ?? "(none)"}`,
      );
      const ingest = await ingestMlccPriceBook(supabase, { kind, url: currentUrl });
      results.push(
        ingest.ok
          ? {
              kind,
              ingested: true,
              currentUrl,
              totalItems: ingest.totalItems ?? null,
              updatedItems: ingest.updatedItems ?? null,
            }
          : { kind, ingested: false, reason: `ingest failed: ${ingest.error}`, currentUrl },
      );
    } catch (e) {
      results.push({
        kind,
        ingested: false,
        reason: `unexpected: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return { checked: true, results };
}

/**
 * Check whether MLCC has published a price book newer than our last
 * successful ingest, and ingest it if so.
 *
 * "Newer" = the URL discovered on the live MLCC page differs from the
 * `source_url` of our most recent COMPLETED `mlcc_price_book_runs` row.
 * MLCC's media URLs carry a `?rev=` hash that changes on republish, so a
 * URL difference is a reliable "something changed" signal.
 *
 * Cost profile:
 *   - nothing changed  → one lightweight HTML page fetch, then return.
 *   - something changed → download (~870KB) + full catalog upsert
 *     (~13.8k rows) + UPC enrichment. Happens only when MLCC actually
 *     publishes — typically monthly-ish, not daily.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ force?: boolean }} [options] - force=true ingests even if the
 *   URL is unchanged (manual override; not used by the cron path).
 * @returns {Promise<object>} structured result — always resolves, never throws.
 */
export async function checkAndIngestIfPriceBookChanged(supabase, options = {}) {
  const startedAt = new Date().toISOString();
  const force = options.force === true;

  // 1. What is MLCC publishing right now?
  const disc = await discoverLatestPriceBookUrl();
  if (!disc.ok) {
    return {
      checked: true,
      ingested: false,
      reason: `MLCC page discovery failed: ${disc.error}`,
      startedAt,
    };
  }
  const currentUrl = disc.url;

  // 2. What did we last successfully ingest?
  const last = await getLastCompletedIngestUrl(supabase);
  if (!last.ok) {
    return {
      checked: true,
      ingested: false,
      reason: `could not read last ingest run: ${last.error}`,
      currentUrl,
      startedAt,
    };
  }
  const lastUrl = last.url;

  // 3. Unchanged → nothing to do (the common case).
  if (lastUrl && lastUrl === currentUrl && !force) {
    return {
      checked: true,
      ingested: false,
      reason: "no change — currently published price book already ingested",
      currentUrl,
      startedAt,
    };
  }

  // 4. New (or first-ever, or forced) → ingest.
  console.log(
    `[price-book-scheduler] new price book detected — ingesting. current=${currentUrl} last=${lastUrl ?? "(none)"}${force ? " (forced)" : ""}`,
  );
  const ingestResult = await ingestMlccPriceBook(supabase, { url: currentUrl });
  if (!ingestResult.ok) {
    return {
      checked: true,
      ingested: false,
      reason: `ingest failed: ${ingestResult.error}`,
      currentUrl,
      previousUrl: lastUrl,
      startedAt,
    };
  }

  // 5. Mirror POST /price-book/ingest: refresh UPCs after the catalog
  // upsert (new SKUs need UPCs). Best-effort — a UPC-enrichment failure
  // does NOT undo a good catalog ingest.
  let upcEnrichment = null;
  try {
    upcEnrichment = await runUpcEnrichment(supabase);
  } catch (e) {
    upcEnrichment = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    checked: true,
    ingested: true,
    reason: "ingested newly published MLCC price book",
    currentUrl,
    previousUrl: lastUrl,
    ingest: {
      totalItems: ingestResult.totalItems ?? null,
      newItems: ingestResult.newItems ?? null,
      updatedItems: ingestResult.updatedItems ?? null,
    },
    upcEnrichment: upcEnrichment
      ? { ok: Boolean(upcEnrichment.ok), error: upcEnrichment.error ?? null }
      : null,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Optional in-process daily check. NOT wired into index.js — kept for the
 * case where the API later runs on an always-on machine. The reliable
 * trigger is the external cron hitting POST /price-book/check-updates.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {() => void} stop function
 */
export function startPriceBookScheduler(supabase) {
  console.log("[price-book-scheduler] in-process daily check started");

  async function tick() {
    try {
      const result = await checkAndIngestIfPriceBookChanged(supabase);
      console.log("[price-book-scheduler] tick:", result.reason);
    } catch (e) {
      console.log(
        "[price-book-scheduler] tick error:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const id = setInterval(tick, DAY_MS);

  return () => {
    clearInterval(id);
    console.log("[price-book-scheduler] stopped");
  };
}
