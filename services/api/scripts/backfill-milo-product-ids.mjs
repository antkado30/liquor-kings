/**
 * backfill-milo-product-ids — populate mlcc_items.milo_product_id / milo_distributor
 * so the ordering engine can SKIP the per-code /products/code resolve at order time
 * (the per-bottle bottleneck). See migration 20260704193000_add_milo_product_map.sql
 * and services/api/src/rpa/engine/engine-api.js Step 3.
 *
 * SAFETY POSTURE (read this):
 *   - READ-ONLY against MILO: it calls GET /account + POST /products/code/<code>
 *     (a lookup). It NEVER adds to a cart, validates, or submits. No order risk.
 *   - PACED on purpose (default 400ms between codes). Hammering /products/code is
 *     exactly what rate-limited us before and faked us into thinking MILO was slow.
 *     Keep the delay unless you know what you're doing.
 *   - RESUMABLE: by default it only resolves codes we don't have yet, so you can
 *     run it in small batches (--limit) and stop/restart freely.
 *   - Writes ONLY our own DB (mlcc_items), by unique `code`.
 *
 * Creds from the gitignored services/api/.env: MILO_USERNAME, MILO_PASSWORD,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * USAGE (run from services/api):
 *   node scripts/backfill-milo-product-ids.mjs --dry-run --limit 5      # smoke test, writes nothing
 *   node scripts/backfill-milo-product-ids.mjs --codes 9121,11022       # specific bottles (e.g. your regulars)
 *   node scripts/backfill-milo-product-ids.mjs --limit 100              # next 100 un-mapped active bottles
 *   node scripts/backfill-milo-product-ids.mjs --limit 100 --refresh    # re-resolve even already-mapped (ADA drift)
 *   node scripts/backfill-milo-product-ids.mjs --limit 100 --delay-ms 700
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { createClient } from "@supabase/supabase-js";
import { loginToMilo } from "../src/rpa/stages/login.js";
import { loginViaApi, apiCall } from "../src/rpa/engine/engine-api.js";

function parseArgs(argv) {
  const args = { limit: 50, delayMs: 400, dryRun: false, refresh: false, codes: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--refresh") args.refresh = true;
    else if (a === "--limit") args.limit = Math.max(1, parseInt(argv[++i], 10) || 50);
    else if (a === "--delay-ms") args.delayMs = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === "--codes") args.codes = String(argv[++i] || "").split(",").map((c) => c.trim()).filter(Boolean);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function selectTargetCodes(supabase, args) {
  if (args.codes && args.codes.length > 0) return args.codes;
  // Un-mapped (or all, with --refresh) active codes, deterministic order so
  // repeated batches march through the catalog without repeating work.
  let q = supabase
    .from("mlcc_items")
    .select("code")
    .eq("is_active", true)
    .order("code", { ascending: true })
    .limit(args.limit);
  if (!args.refresh) q = q.is("milo_product_id", null);
  const { data, error } = await q;
  if (error) throw new Error(`select target codes failed: ${error.message}`);
  return (data ?? []).map((r) => String(r.code));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!username || !password) throw new Error("Missing MILO_USERNAME / MILO_PASSWORD in services/api/.env");
  if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in services/api/.env");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log("=== BACKFILL MILO PRODUCT IDs (read-only resolve; no add/validate/submit) ===");
  const codes = await selectTargetCodes(supabase, args);
  console.log(`Target: ${codes.length} code(s) | delay ${args.delayMs}ms | ${args.dryRun ? "DRY-RUN (no writes)" : "WRITES ENABLED"} | refresh=${args.refresh}`);
  if (codes.length === 0) {
    console.log("Nothing to do — every active code is already mapped. (Use --refresh to re-resolve.)");
    return;
  }

  console.log("Step 1: browser login (Cloudflare)…");
  const session = await loginToMilo({ username, password }, { headless: true, slowMo: 0, captureArtifacts: false });
  let resolved = 0;
  let failed = 0;
  const failures = [];
  try {
    const token = await loginViaApi(session.page, username, password);
    const account = await apiCall(session.page, "GET", "/account", { token, label: "GET /account", silent: true });
    if (!account.ok) throw new Error(`GET /account failed (${account.status})`);
    const subscriptionId = account.body?.groups?.[0]?.subscriptionId;
    if (!subscriptionId) throw new Error("Missing subscriptionId from /account");

    console.log(`Step 2: resolving ${codes.length} code(s)…`);
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      const r = await apiCall(session.page, "POST", `/products/code/${code}`, {
        token,
        body: { include_pr: subscriptionId },
        label: `products/code/${code}`,
        silent: true,
      });
      if (!r.ok || !r.body?.id || !r.body?.distributor) {
        failed += 1;
        failures.push({ code, status: r.status });
      } else if (!args.dryRun) {
        const { error: upErr } = await supabase
          .from("mlcc_items")
          .update({
            milo_product_id: String(r.body.id),
            milo_distributor: r.body.distributor,
            milo_ids_resolved_at: new Date().toISOString(),
          })
          .eq("code", code);
        if (upErr) {
          failed += 1;
          failures.push({ code, status: `db:${upErr.message}` });
        } else {
          resolved += 1;
        }
      } else {
        resolved += 1; // dry-run: would have written
      }
      if ((i + 1) % 10 === 0 || i === codes.length - 1) {
        console.log(`  ${i + 1}/${codes.length} — ok:${resolved} fail:${failed}`);
      }
      if (i < codes.length - 1) await sleep(args.delayMs);
    }
  } finally {
    if (session?.context) await session.context.close().catch(() => {});
    if (session?.browser) await session.browser.close().catch(() => {});
  }

  console.log("\n=== SUMMARY ===");
  console.log(`resolved+written: ${resolved}${args.dryRun ? " (dry-run, nothing written)" : ""}`);
  console.log(`failed: ${failed}`);
  if (failures.length > 0) {
    console.log("failures (likely discontinued codes or DB errors):");
    for (const f of failures.slice(0, 25)) console.log(`  - ${f.code}: ${f.status}`);
    if (failures.length > 25) console.log(`  …and ${failures.length - 25} more`);
  }
  console.log("\nDone. Re-run with a larger --limit to continue through the catalog.");
}

main().catch((error) => {
  console.error("backfill-milo-product-ids failed:", error?.message || String(error));
  process.exit(1);
});
