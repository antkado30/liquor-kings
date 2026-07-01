#!/usr/bin/env node
/**
 * order-day-preflight.mjs — ONE command that answers "are we actually ready
 * to place a real order?" with GO / NO-GO and the exact reason for any ✗.
 *
 * Built 2026-07-01 (the night we armed for real and got surprised by slow
 * machine cycles + a stale secret). Every check is READ-ONLY: `fly machines
 * list`, `fly ssh ... echo $VAR`, and one SELECT against prod Supabase.
 * It never sets a secret, never restarts anything, never writes.
 *
 * Two modes (the gate expectations flip, everything else is identical):
 *   node services/api/scripts/order-day-preflight.mjs                 # morning: expect DISARMED
 *   node services/api/scripts/order-day-preflight.mjs --expect armed  # right before placing
 *
 * What it checks:
 *   1. API app (liquor-kings): every machine started + health checks passing
 *   2. Worker app (liquor-kings-worker): machines started, and COUNT — more
 *      than 1 machine makes the HAR capture land on a random machine (warn)
 *   3. API env gate  LK_ALLOW_ORDER_SUBMISSION  (must match --expect)
 *   4. Worker env: gate (must match --expect), LK_RPA_PERSIST_SESSION
 *      (must be "no" on capture day or the recording never flushes),
 *      LK_ORDER_ENGINE (reported, informational)
 *   5. Colony store flag stores.allow_order_submission in prod Supabase
 *      (needs LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in
 *      services/api/.env — SKIPs with instructions if absent)
 *
 * What it can NOT check: the deployed client bundle's REAL_SUBMISSION_WIRED
 * flag — verify that on the phone (armed = "This goes to MILO immediately
 * and can't be unsent"). The script says so in its output.
 *
 * Exit codes: 0 = GO, 1 = NO-GO, 2 = usage/config error.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const API_APP = "liquor-kings";
const WORKER_APP = "liquor-kings-worker";
const COLONY_STORE_ID = "e594fc3a-17b7-45d0-9dde-943ebbfa5391";

// ─── args ────────────────────────────────────────────────────────────────────
let expectArmed = false;
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === "--expect" && i + 1 < process.argv.length) {
    const v = process.argv[i + 1].toLowerCase();
    if (v === "armed") expectArmed = true;
    else if (v === "disarmed") expectArmed = false;
    else {
      console.error(`--expect must be "armed" or "disarmed", got "${v}"`);
      process.exit(2);
    }
    i += 1;
  } else if (a === "--help" || a === "-h") {
    console.log("Usage: order-day-preflight.mjs [--expect armed|disarmed]   (default: disarmed)");
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${a}`);
    process.exit(2);
  }
}
const expectedGate = expectArmed ? "yes" : "no";

// ─── helpers ─────────────────────────────────────────────────────────────────
const results = []; // { name, ok: true|false|null (null = skip/info), detail }
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === true ? "✓" : ok === false ? "✗" : "–";
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fly(args, timeoutMs = 30_000) {
  return execFileSync("fly", args, { encoding: "utf8", timeout: timeoutMs }).toString();
}

/** One ssh round-trip per app: echo every env var we care about, labeled. */
function readRemoteEnv(app) {
  const cmd =
    "sh -lc 'echo GATE=${LK_ALLOW_ORDER_SUBMISSION:-unset}; " +
    "echo PERSIST=${LK_RPA_PERSIST_SESSION:-unset}; " +
    "echo ENGINE=${LK_ORDER_ENGINE:-unset}'";
  const out = fly(["ssh", "console", "-a", app, "-C", cmd], 45_000);
  const env = {};
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(GATE|PERSIST|ENGINE)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function machineSummary(app) {
  const raw = fly(["machines", "list", "-a", app, "--json"], 30_000);
  const machines = JSON.parse(raw);
  const started = machines.filter((m) => m?.state === "started");
  const checksBad = [];
  for (const m of machines) {
    for (const c of m?.checks ?? []) {
      if (c?.status && c.status !== "passing") checksBad.push(`${m.id}:${c.name}=${c.status}`);
    }
  }
  return { total: machines.length, started: started.length, checksBad };
}

// ─── run the checks ──────────────────────────────────────────────────────────
console.log(`\nORDER-DAY PREFLIGHT — expecting ${expectArmed ? "ARMED (about to place)" : "DISARMED (standby)"}\n`);

// 1 + 2: machine health
for (const [app, label] of [
  [API_APP, "API app healthy"],
  [WORKER_APP, "Worker app healthy"],
]) {
  try {
    const s = machineSummary(app);
    const healthy = s.total > 0 && s.started === s.total && s.checksBad.length === 0;
    record(
      label,
      healthy,
      `${s.started}/${s.total} started${s.checksBad.length ? `, failing checks: ${s.checksBad.join(", ")}` : ""}`,
    );
    if (app === WORKER_APP) {
      record(
        "Worker machine count = 1 (deterministic HAR capture)",
        s.total === 1,
        s.total === 1 ? undefined : `${s.total} machines — the recording lands on whichever ran the order; scale to 1: fly scale count 1 -a ${WORKER_APP}`,
      );
    }
  } catch (e) {
    record(label, false, `could not read machines: ${String(e?.message || e).slice(0, 160)}`);
    if (app === WORKER_APP) record("Worker machine count = 1 (deterministic HAR capture)", false, "unknown (machines list failed)");
  }
}

// 3: API env gate
try {
  const env = readRemoteEnv(API_APP);
  record(
    `API gate LK_ALLOW_ORDER_SUBMISSION = "${expectedGate}"`,
    env.GATE === expectedGate,
    `live value: ${env.GATE ?? "unreadable"}`,
  );
} catch (e) {
  record(`API gate LK_ALLOW_ORDER_SUBMISSION = "${expectedGate}"`, false, `ssh failed: ${String(e?.message || e).slice(0, 160)}`);
}

// 4: worker env (gate + persist + engine)
try {
  const env = readRemoteEnv(WORKER_APP);
  record(
    `Worker gate LK_ALLOW_ORDER_SUBMISSION = "${expectedGate}"`,
    env.GATE === expectedGate,
    `live value: ${env.GATE ?? "unreadable"}`,
  );
  record(
    'Worker LK_RPA_PERSIST_SESSION = "no" (capture switch — recording flushes)',
    env.PERSIST === "no",
    `live value: ${env.PERSIST ?? "unreadable"}${env.PERSIST !== "no" ? " — the submit run's HAR will NOT save" : ""}`,
  );
  record("Worker LK_ORDER_ENGINE (info)", null, env.ENGINE ?? "unreadable");
} catch (e) {
  record(`Worker gate LK_ALLOW_ORDER_SUBMISSION = "${expectedGate}"`, false, `ssh failed: ${String(e?.message || e).slice(0, 160)}`);
  record('Worker LK_RPA_PERSIST_SESSION = "no" (capture switch — recording flushes)', false, "unknown (ssh failed)");
}

// 5: store flag in prod
const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  record(
    "Colony stores.allow_order_submission = true",
    null,
    "SKIPPED — set LK_PROD_SUPABASE_URL + LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env to enable",
  );
} else if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  record("Colony stores.allow_order_submission = true", null, "SKIPPED — SUPABASE_URL points at localhost, not prod");
} else {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from("stores")
      .select("allow_order_submission, store_name")
      .eq("id", COLONY_STORE_ID)
      .maybeSingle();
    if (error) {
      record("Colony stores.allow_order_submission = true", false, `query failed: ${error.message}`);
    } else if (!data) {
      record("Colony stores.allow_order_submission = true", false, `no store row for ${COLONY_STORE_ID}`);
    } else {
      record(
        "Colony stores.allow_order_submission = true",
        data.allow_order_submission === true,
        `live value: ${String(data.allow_order_submission)} (${data.store_name ?? "unnamed"})`,
      );
    }
  } catch (e) {
    record("Colony stores.allow_order_submission = true", false, `query threw: ${String(e?.message || e).slice(0, 160)}`);
  }
}

// ─── verdict ─────────────────────────────────────────────────────────────────
const failures = results.filter((r) => r.ok === false);
const skips = results.filter((r) => r.ok === null);
console.log("");
console.log("  NOTE: the deployed client flag (REAL_SUBMISSION_WIRED) can't be read remotely —");
console.log(`  verify on the phone: ${expectArmed ? 'confirm modal MUST say "This goes to MILO immediately and can\'t be unsent"' : 'button should read "Check Order" with practice copy'}.`);
console.log("");
if (failures.length === 0) {
  console.log(`VERDICT: GO — every readable check matches "${expectArmed ? "armed" : "disarmed"}"${skips.length ? ` (${skips.length} skipped)` : ""}.`);
  process.exit(0);
} else {
  console.log(`VERDICT: NO-GO — ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(1);
}
