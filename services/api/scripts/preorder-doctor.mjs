#!/usr/bin/env node
/**
 * preorder-doctor.mjs — ONE command that says GO / CHECK / STOP before a real
 * MLCC order. Built for real-order day: instead of remembering five separate
 * things to verify (armed? creds? price book fresh? worker alive? right store?),
 * you run this and get a single verdict with the exact store_id to build on.
 *
 * It is READ-ONLY. It changes nothing. Safe to run as many times as you want.
 *
 * What it checks (and why each one can sink an order):
 *   1. Store + arming      — allow_order_submission must be true or the worker
 *                            validates but never submits. Also surfaces the
 *                            DUPLICATE Colony rows so you build on the right one.
 *   2. MLCC credentials    — no encrypted password = the RPA can't log in.
 *                            Shows last verify status/age too.
 *   3. Price book          — stale prices = wrong shelf prices / missing SKUs.
 *                            Also confirms the catalog actually loaded.
 *   4. Automation health   — recent execution_runs: any failures, last success.
 *                            A clean recent run is the best proof the worker is
 *                            alive (the one thing SQL can confirm).
 *
 * The worker MACHINE itself can't be seen over SQL — the footer reminds you to
 * run `fly status` for that. Everything else is here.
 *
 * Runs on your Mac vs PROD (sandbox has no egress). Needs LK_PROD_SUPABASE_URL /
 * LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_* fallback) in services/api/.env.
 *
 * USAGE (from services/api/):
 *   node scripts/preorder-doctor.mjs                  # checks Colony (samkado)
 *   node scripts/preorder-doctor.mjs --username=samkado
 *   node scripts/preorder-doctor.mjs --store=<uuid>   # pin one specific store
 *   node scripts/preorder-doctor.mjs --stale-days=10  # price-book staleness cutoff
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

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

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const USERNAME = flag("username") ?? "samkado";
const STORE = flag("store");
const STALE_DAYS = Number(flag("stale-days") ?? 7);

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

// ── status plumbing (ASCII tags, no emoji — clean in a terminal, aligns) ──
const TAG = { ok: "[ OK ]", warn: "[WARN]", stop: "[STOP]", info: "[ -- ]" };
const RANK = { ok: 0, info: 0, warn: 1, stop: 2 };
let worst = "ok";
function note(level, label, detail) {
  if (RANK[level] > RANK[worst]) worst = level;
  console.log(`  ${TAG[level]}  ${label}${detail ? "  —  " + detail : ""}`);
}
const short = (id) => (id ? `${id.slice(0, 8)}…` : "?");
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);
const ago = (iso) => {
  if (!iso) return "never";
  const d = daysAgo(iso);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
};
const section = (t) => console.log(`\n${t}`);

async function main() {
  console.log("\n══════════ LK pre-order doctor ══════════");
  console.log(`  target:  ${STORE ? `store ${STORE}` : `username "${USERNAME}"`}`);
  console.log(`  prod:    ${SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0]}`);

  // ── 1. Store + arming ──────────────────────────────────────────────
  section("1. Store & arming");
  let storesQ = supabase.from("stores").select("*");
  storesQ = STORE ? storesQ.eq("id", STORE) : storesQ.eq("mlcc_username", USERNAME);
  const { data: stores, error: storesErr } = await storesQ;
  if (storesErr) {
    note("stop", "stores query failed", storesErr.message);
    return verdict();
  }
  if (!stores?.length) {
    note("stop", "No store found", `for ${STORE ? `id ${STORE}` : `username "${USERNAME}"`}`);
    return verdict();
  }

  // Per-store run stats so we can name the PRIMARY (the one really in use).
  for (const s of stores) {
    const { count } = await supabase
      .from("execution_runs")
      .select("*", { count: "exact", head: true })
      .eq("store_id", s.id);
    const { data: last } = await supabase
      .from("execution_runs")
      .select("status, created_at, finished_at, failure_type, error_message")
      .eq("store_id", s.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    s._runs = count ?? 0;
    s._last = last ?? null;
  }
  stores.sort((a, b) => b._runs - a._runs);
  const primary = stores[0];

  if (stores.length > 1) {
    note("warn", `${stores.length} store rows share this account`, "build your cart on the PRIMARY below; merge the extras AFTER the order");
  }
  for (const s of stores) {
    const tag = s.allow_order_submission ? "ok" : "stop";
    const role = s === primary ? "PRIMARY" : "duplicate";
    note(
      tag,
      `${role}  ${short(s.id)}  ${s.name ?? "(no name)"}`,
      `armed=${s.allow_order_submission}  license=${s.liquor_license ?? "?"}  runs=${s._runs}  last=${ago(s._last?.created_at)}`,
    );
  }
  const armedCount = stores.filter((s) => s.allow_order_submission).length;
  if (armedCount === 0) note("stop", "Nothing is armed", "no store will submit — set allow_order_submission=true");

  console.log(`\n  → BUILD THE ORDER ON:  ${primary.id}  (${primary.name ?? "Colony"})`);

  // ── 2. MLCC credentials ────────────────────────────────────────────
  section("2. MLCC credentials (RPA login)");
  for (const s of stores.filter((s) => s.allow_order_submission)) {
    const hasPw = !!s.mlcc_password_encrypted;
    const hasUser = !!s.mlcc_username;
    if (!hasUser || !hasPw) {
      note("stop", `${short(s.id)} missing credentials`, `username=${hasUser} password=${hasPw} — RPA cannot log in`);
      continue;
    }
    // Credential status is one of: success | invalid_credentials |
    // captcha_required | timeout | network_error | security_violation |
    // unknown_error | null. Only "success" is a clean pass; null just means
    // "never ran the explicit verify" (recent real runs already prove the
    // login works), so that's INFO, not a false CHECK.
    const lastStatus = s.mlcc_credentials_last_status;
    const verifiedAt = s.mlcc_credentials_last_verified_at ?? s.mlcc_credentials_verified_at;
    if (lastStatus === "success") {
      note("ok", `${short(s.id)} user "${s.mlcc_username}"`, `last verify=success (${ago(verifiedAt)})`);
    } else if (!lastStatus) {
      note("info", `${short(s.id)} user "${s.mlcc_username}"`, "creds present; never test-verified (real runs prove login). Optional: test in-app");
    } else {
      note(
        "warn",
        `${short(s.id)} user "${s.mlcc_username}"`,
        `last verify=${lastStatus} (${ago(verifiedAt)})${s.mlcc_credentials_last_error_code ? `  err=${s.mlcc_credentials_last_error_code}` : ""}`,
      );
      note("info", "  re-verify in-app", "Settings → MLCC credentials → test/save before ordering");
    }
  }

  // ── 3. Price book freshness + catalog presence ─────────────────────
  section("3. Price book & catalog");
  const { data: pb, error: pbErr } = await supabase
    .from("mlcc_price_book_runs")
    .select("completed_at, source_url, status")
    .in("status", ["complete", "complete_with_errors"])
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pbErr) {
    note("warn", "price-book runs query failed", pbErr.message);
  } else if (!pb?.completed_at) {
    note("stop", "No completed price-book run found", "prices/SKUs may be missing — run the price-book update");
  } else {
    const d = daysAgo(pb.completed_at);
    note(
      d > STALE_DAYS ? "warn" : "ok",
      `Last price book ${ago(pb.completed_at)}`,
      `${pb.status}${d > STALE_DAYS ? `  — older than ${STALE_DAYS}d, consider refreshing` : ""}`,
    );
  }
  const { count: itemCount, error: itemErr } = await supabase
    .from("mlcc_items")
    .select("*", { count: "exact", head: true });
  if (itemErr) note("warn", "mlcc_items count failed", itemErr.message);
  else if (!itemCount) note("stop", "Catalog is EMPTY", "mlcc_items has 0 rows — resolver/cart will find nothing");
  else note(itemCount > 10000 ? "ok" : "warn", `Catalog loaded`, `${itemCount.toLocaleString()} SKUs`);

  // ── 4. Recent automation health (worker proxy) ─────────────────────
  section("4. Recent automation health");
  const ids = stores.map((s) => s.id);
  const { data: recent, error: recErr } = await supabase
    .from("execution_runs")
    .select("id, store_id, status, failure_type, created_at, finished_at, error_message")
    .in("store_id", ids)
    .order("created_at", { ascending: false })
    .limit(15);
  if (recErr) {
    note("warn", "execution_runs query failed", recErr.message);
  } else if (!recent?.length) {
    note("info", "No runs yet for this store", "first order will be the first run — that's fine");
  } else {
    const tally = recent.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
    const tallyStr = Object.entries(tally).map(([k, v]) => `${k}:${v}`).join("  ");
    note("info", `Last ${recent.length} runs`, tallyStr);

    const FAIL = new Set(["failed", "error", "errored", "cancelled", "canceled", "timeout"]);
    const recentFails = recent.filter((r) => FAIL.has(r.status) && daysAgo(r.created_at) <= 2);
    if (recentFails.length) {
      note("warn", `${recentFails.length} failed run(s) in last 48h`, "inspect before relying on the worker");
      for (const r of recentFails.slice(0, 3)) {
        note("info", `  ${short(r.id)} ${r.status}`, `${r.failure_type ?? "-"}  ${ago(r.created_at)}  ${(r.error_message ?? "").slice(0, 60)}`);
      }
      console.log(`\n     → drill in:  node scripts/inspect-execution-runs.mjs <run-id>`);
    }

    const lastGood = recent.find((r) => ["succeeded", "success", "completed", "submitted", "done"].includes(r.status));
    if (lastGood) note("ok", "Last successful run", `${lastGood.status}  ${ago(lastGood.created_at)}`);
    else note("warn", "No clearly-successful run in recent history", "worker health unproven — watch the first submit closely");
  }

  return verdict();
}

function verdict() {
  console.log("\n══════════════════════════════════════════");
  if (worst === "ok") {
    console.log("  VERDICT:  GO  ✓   all pre-order checks passed");
  } else if (worst === "warn") {
    console.log("  VERDICT:  CHECK     review the [WARN] lines above — likely fine, but eyeball them");
  } else {
    console.log("  VERDICT:  STOP      fix the [STOP] lines above before ordering");
  }
  console.log("\n  SQL can't see the worker machine or MILO itself. Also do:");
  console.log("    • fly status -a liquor-kings-worker     (machine started?)");
  console.log("    • fly status -a liquor-kings            (api up?)");
  console.log("    • once you have the list:  node scripts/resolve-order-codes.mjs  (lock every code)");
  console.log("");
  process.exit(worst === "stop" ? 1 : 0);
}

main().catch((e) => {
  console.error("\n[preorder-doctor] fatal", e);
  process.exit(1);
});
