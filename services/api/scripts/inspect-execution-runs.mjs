#!/usr/bin/env node
/**
 * Stage-timing inspector for execution_runs (2026-06-13/14) — built for
 * TONY-WANTS #1 ACTIVE FOCUS: "validating the whole cart takes longer than
 * scanning the bottles. It should be 30 seconds max." This is the
 * investigation script the want describes: "pull that run's ID in Command
 * Deck Review — stage timings + failure type tell us where the time went."
 * Run it locally (sandbox has no egress to Supabase) — needs
 * LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or the
 * SUPABASE_* fallbacks) in services/api/.env.
 *
 * USAGE (services/api/):
 *   node scripts/inspect-execution-runs.mjs                 # list recent runs
 *   node scripts/inspect-execution-runs.mjs --limit=30       # more rows
 *   node scripts/inspect-execution-runs.mjs --store=<uuid>   # filter by store
 *   node scripts/inspect-execution-runs.mjs <run-id>          # full stage timeline for one run
 *   node scripts/inspect-execution-runs.mjs --slowest         # detail on the slowest finished run
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("This points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const has = (name) => args.includes(`--${name}`);
const positional = args.find((a) => !a.startsWith("--"));

const LIMIT = Number(flag("limit") ?? 20);
const STORE = flag("store");

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const fmtS = (ms) => (ms == null ? "-" : `${(ms / 1000).toFixed(1)}s`);
const itemCount = (run) => {
  const items = run.payload_snapshot?.items;
  return Array.isArray(items) ? items.length : null;
};

function printTimeline(run) {
  console.log(`\n══════ run ${run.id} ══════`);
  console.log(`  store:        ${run.store_id}`);
  console.log(`  status:       ${run.status}${run.failure_type ? ` (${run.failure_type})` : ""}`);
  console.log(`  items:        ${itemCount(run) ?? "?"}`);
  console.log(`  worker_notes: ${run.worker_notes ?? "-"}`);
  console.log(`  error:        ${run.error_message ?? "-"}`);
  console.log(`  retry_count:  ${run.retry_count ?? 0}`);

  const created = run.created_at ? new Date(run.created_at) : null;
  const queued = run.queued_at ? new Date(run.queued_at) : created;
  const started = run.started_at ? new Date(run.started_at) : null;
  const finished = run.finished_at ? new Date(run.finished_at) : null;

  console.log(`\n  created_at:   ${run.created_at}`);
  console.log(`  queued_at:    ${run.queued_at ?? "-"}`);
  console.log(`  started_at:   ${run.started_at ?? "-"}`);
  console.log(`  finished_at:  ${run.finished_at ?? "-"}`);
  if (queued && started) {
    console.log(`  >> queue wait (created->started): ${fmtS(started - queued)}`);
  }
  if (started && finished) {
    console.log(`  >> total run time (started->finished): ${fmtS(finished - started)}`);
  }

  const evidence = Array.isArray(run.evidence) ? run.evidence : [];
  const steps = evidence.filter((e) => e.kind === "worker_step_event" && e.created_at);
  if (!steps.length) {
    console.log("\n  (no worker_step_event evidence on this run)");
    return;
  }

  console.log("\n  stage timeline:");
  let prev = started ?? new Date(steps[0].created_at);
  for (const step of steps) {
    const ts = new Date(step.created_at);
    const delta = ts - prev;
    console.log(
      `    +${fmtS(ts - (started ?? ts))}  (Δ ${fmtS(delta)})  [${step.stage}] ${step.message}`,
    );
    prev = ts;
  }
  if (finished) {
    const lastTs = new Date(steps[steps.length - 1].created_at);
    const tail = finished - lastTs;
    if (tail > 1000) {
      console.log(`    +${fmtS(finished - (started ?? finished))}  (Δ ${fmtS(tail)})  [finalize] run marked ${run.status}`);
    }
  }
}

async function main() {
  if (positional || has("slowest")) {
    let run;
    if (positional) {
      const { data, error } = await supabase
        .from("execution_runs")
        .select("*")
        .eq("id", positional)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        console.error(`No run found with id ${positional}`);
        process.exit(1);
      }
      run = data;
    } else {
      // Slowest finished run in the recent window.
      let q = supabase
        .from("execution_runs")
        .select("*")
        .not("started_at", "is", null)
        .not("finished_at", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (STORE) q = q.eq("store_id", STORE);
      const { data, error } = await q;
      if (error) throw error;
      run = (data ?? [])
        .map((r) => ({ r, dur: new Date(r.finished_at) - new Date(r.started_at) }))
        .sort((a, b) => b.dur - a.dur)[0]?.r;
      if (!run) {
        console.error("No finished runs found in the last 200.");
        process.exit(1);
      }
    }
    printTimeline(run);
    return;
  }

  let q = supabase
    .from("execution_runs")
    .select("id, store_id, status, failure_type, payload_snapshot, created_at, queued_at, started_at, finished_at, retry_count")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (STORE) q = q.eq("store_id", STORE);
  const { data, error } = await q;
  if (error) throw error;

  console.log(`[inspect] ${data.length} most recent runs${STORE ? ` (store=${STORE})` : ""}\n`);
  console.log("  status      failure_type             items  queue_wait  duration   id");
  for (const r of data) {
    const queued = r.queued_at ? new Date(r.queued_at) : new Date(r.created_at);
    const started = r.started_at ? new Date(r.started_at) : null;
    const finished = r.finished_at ? new Date(r.finished_at) : null;
    const queueWait = started ? fmtS(started - queued) : "-";
    const duration = started && finished ? fmtS(finished - started) : "-";
    console.log(
      `  ${r.status.padEnd(11)} ${(r.failure_type ?? "-").padEnd(24)} ${String(itemCount(r) ?? "?").padStart(5)}  ${queueWait.padStart(10)}  ${duration.padStart(8)}   ${r.id}`,
    );
  }
  console.log("\n  → for a stage-by-stage timeline: node scripts/inspect-execution-runs.mjs <run-id>");
  console.log("  → or the slowest finished run:   node scripts/inspect-execution-runs.mjs --slowest");
}

main().catch((e) => {
  console.error("[inspect] fatal", e);
  process.exit(1);
});
