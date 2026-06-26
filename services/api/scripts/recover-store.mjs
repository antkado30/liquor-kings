#!/usr/bin/env node
/**
 * recover-store.mjs — free a store from a stuck/running validate so a fresh
 * re-validate can start, WITHOUT waiting for the 15-min reaper. Deploy-free
 * version of POST /execution-runs/recover/:storeId.
 *
 * SAFE: it cancels running runs for the store, but SKIPS anything at/after
 * checkout (a submit may have placed a real order — never auto-cancel that).
 * Validate runs carry no order risk, so cancelling them just lets you retry.
 *
 * Runs on your Mac vs PROD. Needs LK_PROD_SUPABASE_URL /
 * LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_* fallback) in services/api/.env.
 *
 * USAGE (from services/api/):
 *   node scripts/recover-store.mjs                 # Colony (samkado primary)
 *   node scripts/recover-store.mjs <storeId>
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(URL)) {
  console.error("Points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}

const storeId = process.argv[2] || "e594fc3a-17b7-45d0-9dde-943ebbfa5391"; // Colony primary
const SUBMIT_STAGE_RE = /checkout|submit|finaliz/i;
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: running, error } = await supabase
  .from("execution_runs")
  .select("id, progress_stage, heartbeat_at, created_at")
  .eq("store_id", storeId)
  .eq("status", "running");
if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}

console.log("");
if (!running || running.length === 0) {
  console.log("No running runs for this store — it's already free.");
  console.log("If the app still spins, fully close + reopen it (stale client latch) and re-validate.");
  process.exit(0);
}

const nowIso = new Date().toISOString();
let freed = 0;
for (const r of running) {
  const stage = String(r.progress_stage ?? "");
  if (SUBMIT_STAGE_RE.test(stage)) {
    console.log(`  SKIP ${r.id} — stage "${stage}" is submit-side; not auto-cancelling (order-safety).`);
    continue;
  }
  const { data: upd, error: updErr } = await supabase
    .from("execution_runs")
    .update({
      status: "canceled",
      finished_at: nowIso,
      updated_at: nowIso,
      progress_message: "Canceled via recover-store to free the store for re-validate",
      failure_type: "LK_RUN_RECOVERED_BY_USER",
    })
    .eq("id", r.id)
    .eq("status", "running")
    .select("id")
    .maybeSingle();
  if (updErr) {
    console.error("  update failed:", updErr.message);
    process.exit(1);
  }
  if (upd) {
    freed += 1;
    console.log(`  FREED ${r.id} (was at stage "${stage || "running"}")`);
  }
}
console.log(`\nDone — freed ${freed} stuck run(s). Now re-validate in the app.\n`);
process.exit(0);
