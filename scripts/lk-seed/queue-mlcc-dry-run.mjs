#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { createExecutionRunFromCart } from "../../services/api/src/services/execution-run.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const apiEnvPath = path.join(repoRoot, "services", "api", ".env");

dotenv.config({ path: apiEnvPath });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (services/api/.env).",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const LOCAL_SEED_STORE_NAME = "Local MLCC Dry Run Store";

/**
 * When MLCC_SEED_REPLACE_STALE_QUEUED=true, cancel queued execution_runs for the
 * local seed store only so a fresh dry-run row can be created without manual DB edits.
 * Does not cancel runs for other stores.
 */
const cancelQueuedRunsForLocalSeedStore = async () => {
  const { data: store, error: storeErr } = await supabase
    .from("stores")
    .select("id")
    .eq("store_name", LOCAL_SEED_STORE_NAME)
    .limit(1)
    .maybeSingle();

  if (storeErr) {
    throw new Error(`Failed resolving local seed store: ${storeErr.message}`);
  }
  if (!store?.id) return { canceledIds: [] };

  const { data: queued, error: listErr } = await supabase
    .from("execution_runs")
    .select("id")
    .eq("store_id", store.id)
    .eq("status", "queued");

  if (listErr) {
    throw new Error(`Failed listing queued runs for local seed store: ${listErr.message}`);
  }

  const ids = (queued ?? []).map((r) => r.id);
  if (ids.length === 0) return { canceledIds: [] };

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("execution_runs")
    .update({
      status: "canceled",
      finished_at: now,
      updated_at: now,
      worker_notes:
        "Canceled by local seed (MLCC_SEED_REPLACE_STALE_QUEUED): superseded dry-run queue",
      progress_stage: "canceled",
      progress_message: "Replaced by local MLCC dry-run seed",
    })
    .eq("store_id", store.id)
    .eq("status", "queued");

  if (updErr) {
    throw new Error(`Failed canceling stale queued runs: ${updErr.message}`);
  }

  return { canceledIds: ids };
};

const ensureNoQueuedRuns = async () => {
  const { count, error } = await supabase
    .from("execution_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");

  if (error) throw new Error(`Failed checking queued runs: ${error.message}`);
  if ((count ?? 0) > 0) {
    throw new Error(
      `Refusing to queue another run: found ${count} existing queued execution_runs row(s). ` +
        "Re-run with MLCC_SEED_REPLACE_STALE_QUEUED=true to cancel queued rows for the local seed store only, " +
        "or clear unrelated queued runs manually.",
    );
  }
};

const ensureStore = async () => {
  const seededStoreName = LOCAL_SEED_STORE_NAME;
  const seededMlccUsername =
    process.env.MLCC_SEED_STORE_USERNAME?.trim() || "local_mlcc_user";

  const { data: existing, error: readErr } = await supabase
    .from("stores")
    .select("id, store_name, mlcc_username")
    .eq("store_name", seededStoreName)
    .limit(1)
    .maybeSingle();

  if (readErr) throw new Error(`Failed reading store: ${readErr.message}`);
  if (existing) {
    const { data: updated, error: updateErr } = await supabase
      .from("stores")
      .update({
        mlcc_username: seededMlccUsername,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, store_name, mlcc_username")
      .single();
    if (updateErr) throw new Error(`Failed updating store: ${updateErr.message}`);
    return updated;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("stores")
    .insert({
      store_name: seededStoreName,
      name: seededStoreName,
      mlcc_username: seededMlccUsername,
      is_active: true,
    })
    .select("id, store_name, mlcc_username")
    .single();

  if (insertErr) throw new Error(`Failed creating store: ${insertErr.message}`);
  return inserted;
};

const ensureMlccItem = async (code) => {
  const { data: existing, error: readErr } = await supabase
    .from("mlcc_items")
    .select("id, code")
    .eq("code", code)
    .limit(1)
    .maybeSingle();
  if (readErr) throw new Error(`Failed reading mlcc item: ${readErr.message}`);
  if (existing) return existing;

  const { data: inserted, error: insertErr } = await supabase
    .from("mlcc_items")
    .insert({
      code,
      name: "Local Dry Run Bottle",
      size_ml: 750,
      mlcc_item_no: `LK-${Date.now()}`,
      state_min_price: 12.34,
    })
    .select("id, code")
    .single();
  if (insertErr) throw new Error(`Failed creating mlcc item: ${insertErr.message}`);
  return inserted;
};

const createBottle = async (storeId, mlccItemId, code) => {
  const { data: bottle, error } = await supabase
    .from("bottles")
    .insert({
      name: "Local Dry Run Bottle",
      mlcc_code: code,
      size_ml: 750,
      is_active: true,
      store_id: storeId,
      mlcc_item_id: mlccItemId,
      upc: `LK${String(Date.now()).slice(-10)}`,
    })
    .select("id, mlcc_code, mlcc_item_id")
    .single();
  if (error) throw new Error(`Failed creating bottle: ${error.message}`);
  return bottle;
};

const createSubmittedValidatedCart = async (storeId) => {
  const now = new Date().toISOString();
  const { data: cart, error } = await supabase
    .from("carts")
    .insert({
      store_id: storeId,
      status: "submitted",
      validation_status: "validated",
      execution_status: null,
      validation_requested_at: now,
      validation_completed_at: now,
      validation_error: null,
    })
    .select("id, store_id, status, validation_status")
    .single();
  if (error) throw new Error(`Failed creating cart: ${error.message}`);
  return cart;
};

const createCartItem = async (cartId, storeId, bottleId, mlccItemId) => {
  const { error } = await supabase.from("cart_items").insert({
    cart_id: cartId,
    store_id: storeId,
    bottle_id: bottleId,
    mlcc_item_id: mlccItemId,
    quantity: 1,
  });
  if (error) throw new Error(`Failed creating cart item: ${error.message}`);
};

const main = async () => {
  const replaceStale = process.env.MLCC_SEED_REPLACE_STALE_QUEUED === "true";
  if (replaceStale) {
    const { canceledIds } = await cancelQueuedRunsForLocalSeedStore();
    if (canceledIds.length > 0) {
      process.stderr.write(
        `Canceled ${canceledIds.length} stale queued run(s) for local seed store: ${canceledIds.join(", ")}\n`,
      );
    }
  }

  await ensureNoQueuedRuns();

  const store = await ensureStore();
  const code = `LK-DRYRUN-${Date.now()}`;
  const mlccItem = await ensureMlccItem(code);
  const bottle = await createBottle(store.id, mlccItem.id, code);
  const cart = await createSubmittedValidatedCart(store.id);
  await createCartItem(cart.id, store.id, bottle.id, mlccItem.id);

  const creation = await createExecutionRunFromCart(supabase, store.id, cart.id, {
    userId: null,
  });

  if (creation.statusCode !== 201 || !creation.body?.data?.id) {
    throw new Error(
      `Failed to queue execution run: status=${creation.statusCode} body=${JSON.stringify(creation.body)}`,
    );
  }

  const run = creation.body.data;
  process.stdout.write(
    `${JSON.stringify(
      {
        success: true,
        store_id: store.id,
        cart_id: cart.id,
        run_id: run.id,
        status: run.status,
        payload_store_mlcc_username:
          run.payload_snapshot?.store?.mlcc_username ?? null,
      },
      null,
      2,
    )}\n`,
  );
};

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
