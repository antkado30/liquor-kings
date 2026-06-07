#!/usr/bin/env node
/**
 * Backfill milo_order_confirmations from past execution_runs evidence
 * (task #41 follow-up, 2026-06-02).
 *
 * Why: the Stage 5 worker only started writing milo_order_confirmations
 * on the same day this table shipped. Historic successful submits
 * (notably 2026-05-28's first real Colony order — NWS #30765405 +
 * General Wine #5654920) have their confirmation numbers buried in
 * the execution_runs.evidence jsonb column. This script extracts them.
 *
 * What gets backfilled (best-effort — depends on what evidence has):
 *   - store_id, execution_run_id
 *   - ada_number, ada_name (KNOWN_ADAS map lookup)
 *   - confirmation_number (load-bearing)
 *   - placed_at (defaults to execution_run.created_at when not in evidence)
 *
 * What we CAN'T backfill from old runs:
 *   - line_items (worker pre-2026-06-02 didn't write historyOrders to
 *     evidence; the data was in checkedOut at runtime but never persisted)
 *   - net_total / gross_total / liquor_tax / discount
 *   - delivery_date / order_number / status_at_placement
 *   These fields stay NULL on backfilled rows. Going-forward rows have
 *   them all populated.
 *
 * Idempotent: upserts on the (execution_run_id, ada_number) unique
 * partial index. Re-run safely whenever.
 *
 * Usage:
 *   cd services/api
 *   SUPABASE_URL=https://eamoozfhqolshdztbrez.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/backfill-milo-order-confirmations.mjs
 *
 * Add --dry-run to print what WOULD be inserted without writing.
 */

import { createClient } from "@supabase/supabase-js";
import { KNOWN_ADAS } from "../src/mlcc/milo-ordering-rules.js";

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[backfill] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Pluck the rpa_run_summary evidence entry out of an evidence array.
 * That's the entry the worker wrote on Stage 5 success with
 * confirmation_numbers in attributes.
 */
function findRpaRunSummary(evidence) {
  if (!Array.isArray(evidence)) return null;
  for (const ev of evidence) {
    if (
      ev &&
      typeof ev === "object" &&
      ev.kind === "rpa_run_summary" &&
      ev.attributes &&
      typeof ev.attributes === "object"
    ) {
      return ev;
    }
  }
  return null;
}

/**
 * Build the row(s) to upsert from one execution_run.
 * Returns [] if the run has no confirmation data to backfill.
 */
function buildRowsForRun(run) {
  const ev = findRpaRunSummary(run.evidence);
  if (!ev) return [];
  const cmap = ev.attributes.confirmation_numbers;
  if (!cmap || typeof cmap !== "object") return [];

  // Use the run's created_at as the placed_at fallback. The actual
  // MILO placed_at isn't recorded in evidence; this gets us "around
  // the right time" so the Orders page can group by day.
  const placedAt = run.created_at ?? null;

  const rows = [];
  for (const [adaKey, confNumber] of Object.entries(cmap)) {
    if (!confNumber || typeof confNumber !== "string") continue;
    // adaKey is either an ADA number string like "321" or a fallback
    // like "ada_1" / "default" — only treat numeric-looking keys as
    // real ADA numbers.
    const adaNumber = /^\d{3,4}$/.test(adaKey) ? adaKey : null;
    const adaName = adaNumber ? KNOWN_ADAS[adaNumber] ?? null : null;
    rows.push({
      store_id: run.store_id,
      execution_run_id: run.id,
      ada_number: adaNumber,
      ada_name: adaName,
      confirmation_number: String(confNumber),
      order_number: null,
      placed_at: placedAt,
      delivery_date: null,
      // submitted_at uses table default (now())
      net_total: null,
      gross_total: null,
      liquor_tax: null,
      discount: null,
      line_items: [],
      line_item_count: 0,
      distributor_raw: null,
      status_at_placement: "backfilled_from_evidence",
    });
  }
  return rows;
}

async function main() {
  console.log(
    `[backfill] DRY_RUN=${DRY_RUN} — querying succeeded execution_runs…`,
  );
  // Pull only succeeded runs (failed runs never produced confirmation
  // numbers). No limit — at Tony's scale there are dozens, not millions.
  const { data: runs, error } = await supabase
    .from("execution_runs")
    .select("id, store_id, status, created_at, evidence")
    .eq("status", "succeeded")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[backfill] query failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`[backfill] inspected ${runs?.length ?? 0} succeeded runs`);

  const allRows = [];
  let runsWithData = 0;
  for (const r of runs ?? []) {
    const rows = buildRowsForRun(r);
    if (rows.length > 0) {
      runsWithData += 1;
      allRows.push(...rows);
    }
  }

  console.log(
    `[backfill] found ${allRows.length} confirmation row(s) across ${runsWithData} run(s)`,
  );

  if (allRows.length === 0) {
    console.log("[backfill] nothing to backfill.");
    return;
  }

  if (DRY_RUN) {
    console.log("[backfill] DRY_RUN — rows that WOULD be inserted:");
    for (const row of allRows) {
      console.log(
        `  ${row.ada_name ?? "(unknown ADA)"} (${row.ada_number ?? "—"}) → #${row.confirmation_number} from run ${row.execution_run_id}`,
      );
    }
    return;
  }

  // Upsert via the unique partial index on (execution_run_id, ada_number).
  // Re-running is safe — same rows just update updated_at.
  const { data: upserted, error: upErr } = await supabase
    .from("milo_order_confirmations")
    .upsert(allRows, {
      onConflict: "execution_run_id,ada_number",
      ignoreDuplicates: false,
    })
    .select("id");

  if (upErr) {
    console.error(`[backfill] upsert failed: ${upErr.message}`);
    process.exit(1);
  }
  console.log(
    `[backfill] persisted ${upserted?.length ?? allRows.length} row(s) successfully.`,
  );
}

main().catch((err) => {
  console.error(`[backfill] fatal: ${err?.message ?? err}`);
  process.exit(1);
});
