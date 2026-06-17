#!/usr/bin/env node
/**
 * RPA FLEET LOAD-TEST HARNESS — measurement tool for docs/lk/SCALE-READINESS.md
 * (S1 throughput / S3 load-multiplier). Turns the throughput ESTIMATES in that
 * doc into real numbers: per-run queue wait + duration, throughput, failure
 * rate, and OBSERVED concurrency (how many actually ran in parallel).
 *
 * ⚠️  SAFETY — READ BEFORE RUNNING:
 *   • Fires REAL `validate_only` RPA runs against REAL MILO (michigan.gov).
 *     Mode is HARD-LOCKED to validate_only — this harness can NEVER submit an
 *     order (no rpa_run / Stage 5 path exists here).
 *   • DO NOT run within ~24h of a real order day. It competes for the worker
 *     pool and adds load to MILO. Run it on a quiet day, well clear of Thursday.
 *   • Per-store serialization (#21) means N runs for ONE store drain one at a
 *     time. So --cart/--store (single-store) measures per-store + QUEUE behavior
 *     and CONFIRMS serialization (observed concurrency should be 1). To measure
 *     true FLEET parallelism you need multiple stores = multiple real MILO
 *     accounts (--carts), since each store is a separate michigan.gov login.
 *   • Needs LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in
 *     services/api/.env (same as inspect-execution-runs.mjs). Run from your Mac
 *     (sandbox has no egress).
 *
 * USAGE (from services/api/):
 *   # single store: 10 validate_only runs on one real cart, all at once
 *   node scripts/load-test-rpa.mjs --store=<storeId> --cart=<cartId> --runs=10 --confirm
 *
 *   # fleet: spread 20 runs across several stores (one real MILO acct each)
 *   node scripts/load-test-rpa.mjs --carts=<cartA>:<storeA>,<cartB>:<storeB> --runs=20 --confirm
 *
 * FLAGS:
 *   --runs=N         total validate_only runs (default 5, hard cap 100)
 *   --concurrency=K  how many to keep in flight at once (default = runs)
 *   --store= --cart= single-store target (one real cart for that store)
 *   --carts=         fleet: comma list of cartId:storeId pairs
 *   --poll-ms=       run-status poll interval (default 3000)
 *   --timeout-ms=    per-run terminal wait cap (default 16min = reaper bound)
 *   --confirm        REQUIRED — acknowledges this fires real RPA against MILO
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
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
// Map to SUPABASE_* so any transitively-imported config client also gets prod
// creds, THEN dynamic-import the service (after env is in place).
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
const { createExecutionRunFromCart } = await import(
  "../src/services/execution-run.service.js"
);

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const has = (name) => args.includes(`--${name}`);

const RUNS = Math.min(100, Math.max(1, Number(flag("runs") ?? 5)));
const CONCURRENCY = Math.min(RUNS, Math.max(1, Number(flag("concurrency") ?? RUNS)));
const POLL_MS = Math.max(1000, Number(flag("poll-ms") ?? 3000));
const TIMEOUT_MS = Math.max(60_000, Number(flag("timeout-ms") ?? 16 * 60 * 1000));
const TERMINAL = ["succeeded", "failed", "canceled"];

// --- Build target list (cart+store pairs) ---
let targets = [];
const cartsFlag = flag("carts");
if (cartsFlag) {
  const pairs = cartsFlag.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of pairs) {
    const [cartId, storeId] = p.split(":");
    if (!cartId || !storeId) {
      console.error(`Bad --carts entry "${p}" — expected cartId:storeId`);
      process.exit(1);
    }
    targets.push({ cartId, storeId });
  }
} else if (flag("cart") && flag("store")) {
  targets.push({ cartId: flag("cart"), storeId: flag("store") });
} else {
  console.error("Need either --cart=<id> --store=<id> (single-store) or --carts=cartId:storeId,...");
  process.exit(1);
}

if (!has("confirm")) {
  console.error(
    "\n⚠️  This fires REAL validate_only RPA runs against REAL MILO.\n" +
      "   It can NEVER submit an order, but it DOES add load to MILO + the worker pool.\n" +
      "   Do NOT run within ~24h of a real order day.\n" +
      "   Re-run with --confirm once you're sure.\n",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (t) => (t ? new Date(t).getTime() : null);
const fmtS = (m) => (m == null || Number.isNaN(m) ? "-" : `${(m / 1000).toFixed(1)}s`);
const short = (id) => (id ? String(id).slice(0, 8) : "-");
const pct = (arr, p) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};

// Assign each run a target round-robin across the provided carts/stores.
const plan = Array.from({ length: RUNS }, (_, i) => targets[i % targets.length]);

console.log("\n=== RPA LOAD TEST ===");
console.log(`  runs:        ${RUNS}`);
console.log(`  concurrency: ${CONCURRENCY}`);
console.log(`  targets:     ${targets.length} store(s) — ${targets.map((t) => short(t.storeId)).join(", ")}`);
console.log(`  mode:        validate_only (hard-locked — no orders placed)`);
console.log(`  poll:        ${POLL_MS}ms   timeout: ${fmtS(TIMEOUT_MS)}`);
if (targets.length === 1) {
  console.log("  NOTE: single store → per-store serialization (#21) means these drain");
  console.log("        one at a time. Expect observed concurrency = 1. Use --carts for fleet.");
}
console.log("\nStarting in 5s — Ctrl-C to abort...");
await sleep(5000);

async function runOne(target, idx) {
  const t = { idx, storeId: target.storeId, cartId: target.cartId };
  let res;
  try {
    res = await createExecutionRunFromCart(supabase, target.storeId, target.cartId, {
      mode: "validate_only",
    });
  } catch (e) {
    t.status = "ENQUEUE_ERROR";
    t.error = e instanceof Error ? e.message : String(e);
    return t;
  }
  if (res.statusCode !== 201 || !res.body?.data?.id) {
    t.status = "ENQUEUE_REJECTED";
    t.error = `${res.statusCode}: ${JSON.stringify(res.body)}`;
    return t;
  }
  t.runId = res.body.data.id;
  const startWait = Date.now();
  while (Date.now() - startWait < TIMEOUT_MS) {
    await sleep(POLL_MS);
    const { data: row } = await supabase
      .from("execution_runs")
      .select("status, created_at, queued_at, started_at, finished_at, failure_type")
      .eq("id", t.runId)
      .maybeSingle();
    if (!row) continue;
    if (TERMINAL.includes(row.status)) {
      t.status = row.status;
      t.failure_type = row.failure_type;
      t.startedMs = ms(row.started_at);
      t.finishedMs = ms(row.finished_at);
      t.queueWaitMs = t.startedMs != null ? t.startedMs - (ms(row.queued_at) ?? ms(row.created_at)) : null;
      t.durationMs = t.startedMs != null && t.finishedMs != null ? t.finishedMs - t.startedMs : null;
      return t;
    }
  }
  t.status = "TIMEOUT";
  return t;
}

async function pool(items, k, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(k, items.length) }, async () => {
    while (i < items.length) {
      const myI = i++;
      out[myI] = await fn(items[myI], myI);
    }
  });
  await Promise.all(workers);
  return out;
}

// Max observed concurrency: sweep-line over [started, finished] intervals.
function maxConcurrency(results) {
  const events = [];
  for (const r of results) {
    if (Number.isFinite(r.startedMs) && Number.isFinite(r.finishedMs)) {
      events.push([r.startedMs, +1], [r.finishedMs, -1]);
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > max) max = cur;
  }
  return max;
}

const wallStart = Date.now();
const results = await pool(plan, CONCURRENCY, runOne);
const wallMs = Date.now() - wallStart;

console.log("\n── per-run ──");
console.log("  #   store     run       status      queueWait  duration");
for (const r of results) {
  console.log(
    `  ${String(r.idx).padStart(2)}  ${short(r.storeId)}  ${short(r.runId).padEnd(8)}  ` +
      `${String(r.status).padEnd(10)}  ${fmtS(r.queueWaitMs).padStart(8)}  ${fmtS(r.durationMs).padStart(8)}` +
      (r.failure_type ? `  (${r.failure_type})` : "") +
      (r.error ? `  ${r.error}` : ""),
  );
}

const byStatus = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const succeeded = results.filter((r) => r.status === "succeeded");
const queueWaits = succeeded.map((r) => r.queueWaitMs);
const durations = succeeded.map((r) => r.durationMs);

console.log("\n── summary ──");
console.log(`  status:        ${JSON.stringify(byStatus)}`);
console.log(`  wall time:     ${fmtS(wallMs)}`);
console.log(`  throughput:    ${(results.length / (wallMs / 60000)).toFixed(1)} runs/min (${succeeded.length} ok)`);
console.log(`  queue wait:    p50 ${fmtS(pct(queueWaits, 50))}  p95 ${fmtS(pct(queueWaits, 95))}  max ${fmtS(pct(queueWaits, 100))}`);
console.log(`  run duration:  p50 ${fmtS(pct(durations, 50))}  p95 ${fmtS(pct(durations, 95))}  max ${fmtS(pct(durations, 100))}`);
console.log(`  observed max concurrency: ${maxConcurrency(results)}  (1 ⇒ per-store serialization held)`);
console.log(
  `\n  → Plug duration p50 into SCALE-READINESS.md's machines-needed math:\n` +
    `    runs/hour/machine ≈ 3600 / (duration_p50_seconds).  Then machines ≈ (stores × ~2.5 runs) / runs-per-hour-per-machine.\n`,
);
process.exit(0);
