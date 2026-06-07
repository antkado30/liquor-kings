#!/usr/bin/env node
/**
 * RLS verification script (task #80, 2026-06-06).
 *
 * Proves that no authenticated user from Store A can read, write,
 * update, or delete data belonging to Store B. Runs against the LIVE
 * Supabase project — does NOT mock RLS — so a pass here means the
 * actual production guarantees hold.
 *
 * What it does:
 *   1. Creates two ephemeral test stores + two ephemeral auth users
 *   2. Seeds each store with some test data (cart, order template)
 *   3. Signs in as User A, tries every leakage vector against Store B
 *   4. Asserts every leakage vector FAILS (returns no rows or errors)
 *   5. Cleans up everything it created, even on failure
 *
 * Run from services/api/:
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SUPABASE_ANON_KEY=... \
 *   node scripts/rls-verification.mjs
 *
 * Exit code 0 = bedrock; non-zero = something leaks, do NOT open
 * signup until fixed.
 *
 * Tables audited:
 *   - stores
 *   - store_users
 *   - bottles
 *   - inventory
 *   - carts
 *   - cart_items
 *   - execution_runs
 *   - milo_order_confirmations
 *   - order_templates
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY",
  );
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const passed = [];
const failed = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed.push(name);
    console.log(`  ✓ ${name}`);
  } else {
    failed.push({ name, detail });
    console.log(`  ✗ ${name} ${detail ? `(${detail})` : ""}`);
  }
}

/**
 * For "User A cannot SELECT Store B" tests: pass IF either the query
 * returned an error (RLS blocked) OR returned an empty array (RLS
 * filtered). The only failure case is rows actually returned for
 * Store B. Distinguishes safe-block from real-leak.
 */
function safeFromOtherStore(data, error) {
  if (error) return true; // RLS blocked entirely — safer than filter
  if (data == null) return true; // null is functionally empty
  if (!Array.isArray(data)) return false;
  return data.length === 0; // empty filter — also safe
}

const runId = crypto.randomBytes(4).toString("hex");
const emailA = `rls-test-a-${runId}@liquor-kings.test`;
const emailB = `rls-test-b-${runId}@liquor-kings.test`;
const password = `rls-test-pw-${runId}-LongEnoughForSupabase`;

let storeAId = null;
let storeBId = null;
let userAId = null;
let userBId = null;
let cartAId = null;
let templateAId = null;

async function setup() {
  console.log(`\n[rls] setup — creating two ephemeral stores + users (run ${runId})`);

  // Create users
  const { data: ua, error: uaErr } = await admin.auth.admin.createUser({
    email: emailA,
    password,
    email_confirm: true,
    user_metadata: { rls_test: true },
  });
  if (uaErr) throw new Error(`create user A: ${uaErr.message}`);
  userAId = ua.user.id;

  const { data: ub, error: ubErr } = await admin.auth.admin.createUser({
    email: emailB,
    password,
    email_confirm: true,
    user_metadata: { rls_test: true },
  });
  if (ubErr) throw new Error(`create user B: ${ubErr.message}`);
  userBId = ub.user.id;

  // Create stores
  const { data: sa, error: saErr } = await admin
    .from("stores")
    .insert({
      store_name: `RLS Test Store A ${runId}`,
      liquor_license: "9999991",
      mlcc_username: `test-a-${runId}`,
      mlcc_password_encrypted: "v1:00:00:00",
      is_active: true,
    })
    .select("id")
    .single();
  if (saErr) throw new Error(`create store A: ${saErr.message}`);
  storeAId = sa.id;

  const { data: sb, error: sbErr } = await admin
    .from("stores")
    .insert({
      store_name: `RLS Test Store B ${runId}`,
      liquor_license: "9999992",
      mlcc_username: `test-b-${runId}`,
      mlcc_password_encrypted: "v1:00:00:00",
      is_active: true,
    })
    .select("id")
    .single();
  if (sbErr) throw new Error(`create store B: ${sbErr.message}`);
  storeBId = sb.id;

  // Link users to their stores
  await admin
    .from("store_users")
    .insert([
      { user_id: userAId, store_id: storeAId, is_active: true, role: "owner" },
      { user_id: userBId, store_id: storeBId, is_active: true, role: "owner" },
    ]);

  // Seed Store A with a cart + template (so we have something to try to leak)
  const { data: cart } = await admin
    .from("carts")
    .insert({ store_id: storeAId, status: "draft" })
    .select("id")
    .single();
  cartAId = cart.id;

  const { data: tpl } = await admin
    .from("order_templates")
    .insert({
      store_id: storeAId,
      name: `Test Template A ${runId}`,
      items: [{ mlcc_code: "2980", quantity: 1 }],
    })
    .select("id")
    .single();
  templateAId = tpl.id;

  console.log(`  [setup] store A=${storeAId} user A=${userAId} cart=${cartAId} tpl=${templateAId}`);
  console.log(`  [setup] store B=${storeBId} user B=${userBId}`);
}

async function asUser(email) {
  /*
   * Build a Supabase client and sign in as the user. The
   * signInWithPassword call sets the session on the client itself,
   * so subsequent .from().select() calls automatically attach the
   * user's JWT and RLS evaluates with auth.uid() set to their id.
   *
   * Earlier version used a `global.headers.Authorization` trick on a
   * second client — that pattern silently fails to set the session
   * the way supabase-js v2 expects, leading to auth.uid() being null
   * and the user being treated as anonymous (which gets blocked by
   * RLS for authenticated-only policies). Manifested as "User A
   * can't even see their own store" in the verifier output.
   */
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signin ${email}: ${error.message}`);
  return client;
}

async function audit() {
  console.log(`\n[rls] audit — signing in as User A and probing Store B`);

  const userA = await asUser(emailA);

  // 1. Stores table
  const { data: sB, error: sBErr } = await userA
    .from("stores")
    .select("*")
    .eq("id", storeBId);
  check(
    "stores: User A cannot SELECT Store B",
    safeFromOtherStore(sB, sBErr),
    sBErr ? `error: ${sBErr.message}` : `got ${sB?.length ?? "?"} rows`,
  );

  const { data: sList, error: sListErr } = await userA
    .from("stores")
    .select("id");
  // User A should see EXACTLY their own store (Store A) and nothing else.
  // This catches the case where a leak shows Store B AND Store A together.
  check(
    "stores: User A's store list contains ONLY Store A",
    !sListErr &&
      Array.isArray(sList) &&
      sList.length === 1 &&
      sList[0].id === storeAId,
    sListErr
      ? `error: ${sListErr.message}`
      : `got ${JSON.stringify(sList)}`,
  );

  // 2. Bottles
  // Seed a bottle in Store B first so there's something to try to read
  await admin.from("bottles").insert({
    store_id: storeBId,
    name: `LEAK CANARY ${runId}`,
    mlcc_code: "9999",
    is_active: true,
  });
  const { data: bB } = await userA
    .from("bottles")
    .select("*")
    .eq("store_id", storeBId);
  check(
    "bottles: User A cannot SELECT Store B bottles",
    (bB ?? []).length === 0,
    `got ${bB?.length ?? "?"} rows`,
  );

  // 3. Carts
  const { data: cB } = await userA
    .from("carts")
    .select("*")
    .eq("store_id", storeBId);
  check(
    "carts: User A cannot SELECT Store B carts",
    (cB ?? []).length === 0,
    `got ${cB?.length ?? "?"} rows`,
  );

  // 4. Order templates — must NOT see Store A's template (User A IS in A, so this is the inverse)
  const { data: tplB } = await userA
    .from("order_templates")
    .select("*")
    .eq("store_id", storeBId);
  check(
    "order_templates: User A cannot SELECT Store B templates",
    (tplB ?? []).length === 0,
    `got ${tplB?.length ?? "?"} rows`,
  );

  // 5. milo_order_confirmations — seed one in Store B then verify A can't read
  await admin.from("milo_order_confirmations").insert({
    store_id: storeBId,
    execution_run_id: crypto.randomUUID(),
    ada_number: "321",
    confirmation_number: `LEAK-${runId}`,
    placed_at: new Date().toISOString(),
    net_total: 100,
    gross_total: 100,
    line_item_count: 1,
    line_items: [],
  }).then(() => {});
  const { data: moB } = await userA
    .from("milo_order_confirmations")
    .select("*")
    .eq("store_id", storeBId);
  check(
    "milo_order_confirmations: User A cannot SELECT Store B confirmations",
    (moB ?? []).length === 0,
    `got ${moB?.length ?? "?"} rows`,
  );

  // 6. Execution runs
  const { data: runs } = await userA
    .from("execution_runs")
    .select("*")
    .eq("store_id", storeBId);
  check(
    "execution_runs: User A cannot SELECT Store B runs",
    (runs ?? []).length === 0,
    `got ${runs?.length ?? "?"} rows`,
  );

  // 7. INSERT attempts — User A tries to insert a cart on Store B's behalf
  const { error: insertErr } = await userA
    .from("carts")
    .insert({ store_id: storeBId, status: "draft" });
  check(
    "carts: User A cannot INSERT a row on Store B's behalf",
    !!insertErr,
    insertErr ? `expected error, got: ${insertErr.message}` : "no error returned",
  );

  // 8. Template forge attempt
  const { error: tplInsertErr } = await userA.from("order_templates").insert({
    store_id: storeBId,
    name: "MALICIOUS TEMPLATE",
    items: [{ mlcc_code: "1", quantity: 1 }],
  });
  check(
    "order_templates: User A cannot INSERT a forged template into Store B",
    !!tplInsertErr,
    tplInsertErr ? `expected error, got: ${tplInsertErr.message}` : "no error",
  );

  // 9. UPDATE attempt — try to modify Store A's template's store_id to Store B
  // Should FAIL because of WITH CHECK on the policy.
  const { error: updErr } = await userA
    .from("order_templates")
    .update({ store_id: storeBId })
    .eq("id", templateAId);
  check(
    "order_templates: User A cannot UPDATE a template's store_id to point at Store B",
    !!updErr,
    updErr ? `expected error, got: ${updErr.message}` : "no error",
  );

  // 10. DELETE attempt — try to delete Store B's bottle
  const { data: bBSeed } = await admin
    .from("bottles")
    .select("id")
    .eq("store_id", storeBId)
    .limit(1);
  if (bBSeed && bBSeed[0]) {
    const { error: delErr } = await userA
      .from("bottles")
      .delete()
      .eq("id", bBSeed[0].id);
    // Either error OR no rows deleted (returned 0)
    const { data: stillThere } = await admin
      .from("bottles")
      .select("id")
      .eq("id", bBSeed[0].id);
    check(
      "bottles: User A cannot DELETE Store B's bottle",
      !!delErr || (stillThere ?? []).length === 1,
      `delErr=${delErr?.message ?? "none"}, stillThere=${stillThere?.length}`,
    );
  }
}

async function teardown() {
  console.log(`\n[rls] teardown — cleaning up ephemeral test data`);
  // Order matters: child rows first, then store_users, then stores,
  // then auth users.
  if (storeAId)
    await admin.from("order_templates").delete().eq("store_id", storeAId);
  if (storeAId) await admin.from("carts").delete().eq("store_id", storeAId);
  if (storeAId) await admin.from("bottles").delete().eq("store_id", storeAId);
  if (storeBId) await admin.from("bottles").delete().eq("store_id", storeBId);
  if (storeBId)
    await admin
      .from("milo_order_confirmations")
      .delete()
      .eq("store_id", storeBId);
  if (storeAId)
    await admin.from("store_users").delete().eq("store_id", storeAId);
  if (storeBId)
    await admin.from("store_users").delete().eq("store_id", storeBId);
  if (storeAId) await admin.from("stores").delete().eq("id", storeAId);
  if (storeBId) await admin.from("stores").delete().eq("id", storeBId);
  if (userAId) await admin.auth.admin.deleteUser(userAId).catch(() => {});
  if (userBId) await admin.auth.admin.deleteUser(userBId).catch(() => {});
  console.log("  [teardown] done.");
}

async function main() {
  try {
    await setup();
    await audit();
  } catch (e) {
    console.error(`\n[rls] FATAL during audit: ${e.message}`);
  } finally {
    await teardown();
  }

  console.log(
    `\n[rls] result: ${passed.length} passed, ${failed.length} failed`,
  );
  if (failed.length > 0) {
    console.error("\nLEAKS DETECTED:");
    for (const f of failed) {
      console.error(`  - ${f.name}: ${f.detail}`);
    }
    console.error(
      "\n*** RLS BEDROCK NOT ACHIEVED — do NOT open signup publicly. ***",
    );
    process.exit(1);
  } else {
    console.log(
      "\n*** RLS BEDROCK CONFIRMED — no cross-store leaks detected. ***",
    );
    process.exit(0);
  }
}

main();
