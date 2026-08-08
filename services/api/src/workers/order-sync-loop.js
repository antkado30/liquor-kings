/**
 * ORDER-SYNC IDLE LOOP (#36 Phase A, 2026-08-08).
 *
 * Runs INSIDE the RPA worker's existing loop, only on idle polls (queue
 * empty), so a sync can never stand in front of a real check or order.
 * Self-throttled: the loop calls maybeRunOrderSyncTick() every idle
 * iteration; the tick no-ops until CHECK_EVERY_MS has passed, then asks
 * "which stores are due?" and syncs them (bounded per tick).
 *
 * A store is due when:
 *   - the owner tapped Sync (stores.order_sync_requested_at newer than
 *     last_order_sync_at) — picked up within ~one check interval; or
 *   - it has a confirmation in the last RECENT_WINDOW days and hasn't
 *     synced in SYNC_EVERY_MS (the standing cadence that catches ADA
 *     edits nobody asked about — the 8/5 lesson).
 *
 * Safety:
 *   - READ-ONLY against MILO. This loop cannot submit; it never touches
 *     carts or checkout. The submission arming gate is irrelevant to it.
 *   - Kill switch: LK_ORDER_SYNC="no" disables the loop entirely
 *     (kill-only pattern, same shape as the submission env: absent = on).
 *   - Never throws into the worker loop; failures log one line, drop the
 *     cached MILO session, and wait for the next interval.
 */

import { createClient } from "@supabase/supabase-js";
import { makeBoundedFetch, resolveDbFetchTimeoutMs } from "../lib/bounded-fetch.js";
import { runMiloOrderSyncForStore } from "../rpa/engine/engine-order-sync.js";
import { invalidateNodeMiloSession } from "../rpa/engine/milo-node-session.js";

/*
  The credentials service transitively imports config/supabase.js, which
  builds a client from env AT MODULE LOAD — importing it at the top here
  would make this module (and every test that touches it) require prod
  env to even parse. Loaded lazily inside the tick instead; unit tests
  inject deps.loadCredentials and never hit the dynamic import.
*/
let credsModulePromise = null;
function loadCredentialsLazy(supabase, storeId) {
  credsModulePromise ??= import("../services/store-mlcc-credentials.service.js");
  return credsModulePromise.then((m) =>
    m.loadDecryptedStoreMlccCredentials(supabase, storeId),
  );
}

/** How often the tick scans for SCHEDULED-due stores (the 6h cadence).
    Owner-requested syncs are checked EVERY idle tick (~2.5s) — one tiny
    indexed stores read — because "tap Sync, wait a minute" felt broken
    the first night it shipped (Tony, 2026-08-08 1am: "we have to make
    syncing faster"). Tap-to-fresh is now ~5s. */
export const CHECK_EVERY_MS = 60_000;
/** Standing cadence: re-sync stores with recent orders this often. */
export const SYNC_EVERY_MS = 6 * 60 * 60_000;
/** "Recent" = a confirmation placed inside this window. */
export const RECENT_WINDOW_MS = 21 * 24 * 60 * 60_000;
/** Never sync more than this many stores in one tick. */
export const MAX_STORES_PER_TICK = 3;

/**
 * Pure due-ness verdict for one store.
 * @returns {{due: boolean, reason: "requested"|"scheduled"|null}}
 */
export function syncDueVerdict({
  requestedAtMs,
  lastSyncAtMs,
  newestConfirmationMs,
  nowMs,
  everyMs = SYNC_EVERY_MS,
  recentWindowMs = RECENT_WINDOW_MS,
}) {
  const requested = Number.isFinite(requestedAtMs)
    ? !Number.isFinite(lastSyncAtMs) || requestedAtMs > lastSyncAtMs
    : false;
  if (requested) return { due: true, reason: "requested" };

  const hasRecent =
    Number.isFinite(newestConfirmationMs) && nowMs - newestConfirmationMs <= recentWindowMs;
  if (hasRecent) {
    if (!Number.isFinite(lastSyncAtMs) || nowMs - lastSyncAtMs >= everyMs) {
      return { due: true, reason: "scheduled" };
    }
  }
  return { due: false, reason: null };
}

const msOrNull = (iso) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? t : null;
};

/**
 * FAST PATH — stores whose owner tapped Sync (requested newer than last
 * sync). One tiny stores read; runs every idle tick so a tap is served
 * in seconds, not at the next scheduled scan.
 */
export async function findRequestedSyncStores(supabase) {
  const { data, error } = await supabase
    .from("stores")
    .select("id, order_sync_requested_at, last_order_sync_at")
    .not("order_sync_requested_at", "is", null)
    .limit(50);
  if (error) throw new Error(`stores read failed: ${error.message}`);
  return (Array.isArray(data) ? data : [])
    .filter((s) => {
      const req = msOrNull(s.order_sync_requested_at);
      const last = msOrNull(s.last_order_sync_at);
      return req != null && (last == null || req > last);
    })
    .slice(0, MAX_STORES_PER_TICK)
    .map((s) => ({ storeId: s.id, reason: "requested" }));
}

/**
 * Find due stores. One stores read + one newest-confirmation read per
 * store — trivially cheap at current scale; revisit with a single RPC
 * when the fleet grows past tens of stores.
 */
export async function findDueSyncStores(supabase, { nowMs }) {
  const { data: stores, error } = await supabase
    .from("stores")
    .select("id, order_sync_requested_at, last_order_sync_at")
    .limit(200);
  if (error) throw new Error(`stores read failed: ${error.message}`);

  const due = [];
  for (const s of Array.isArray(stores) ? stores : []) {
    const { data: newest, error: confErr } = await supabase
      .from("milo_order_confirmations")
      .select("placed_at, submitted_at")
      .eq("store_id", s.id)
      .order("submitted_at", { ascending: false })
      .limit(1);
    if (confErr) continue;
    const top = Array.isArray(newest) ? newest[0] : null;
    const newestMs = msOrNull(top?.placed_at) ?? msOrNull(top?.submitted_at);
    const verdict = syncDueVerdict({
      requestedAtMs: msOrNull(s.order_sync_requested_at),
      lastSyncAtMs: msOrNull(s.last_order_sync_at),
      newestConfirmationMs: newestMs,
      nowMs,
    });
    if (verdict.due) due.push({ storeId: s.id, reason: verdict.reason });
    if (due.length >= MAX_STORES_PER_TICK) break;
  }
  return due;
}

let nextScheduledScanAtMs = 0;
let sharedSupabase = null;

function getSupabase() {
  if (sharedSupabase) return sharedSupabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  sharedSupabase = createClient(url, key, {
    global: { fetch: makeBoundedFetch(resolveDbFetchTimeoutMs(process.env.LK_DB_FETCH_TIMEOUT_MS)) },
  });
  return sharedSupabase;
}

/**
 * The idle-time tick. Cheap no-op most calls; every CHECK_EVERY_MS it
 * looks for due stores and syncs them. NEVER throws.
 *
 * @param {object} [deps] injectable for tests: { supabase, nowMs,
 *   loadCredentials, runSync }
 * @returns {Promise<{ran: boolean, synced?: number, reason?: string}>}
 */
export async function maybeRunOrderSyncTick(deps = {}) {
  try {
    if (process.env.LK_ORDER_SYNC === "no") return { ran: false, reason: "disabled" };
    const nowMs = deps.nowMs ?? Date.now();

    const supabase = deps.supabase ?? getSupabase();
    if (!supabase) return { ran: false, reason: "no_supabase_env" };

    // Owner taps are checked EVERY tick (~2.5s) — the scheduled 6h-cadence
    // scan (heavier: per-store confirmation reads) stays on the 60s throttle.
    let due = await findRequestedSyncStores(supabase);
    if (due.length === 0) {
      if (nowMs < nextScheduledScanAtMs) return { ran: false, reason: "throttled" };
      nextScheduledScanAtMs = nowMs + CHECK_EVERY_MS;
      due = await findDueSyncStores(supabase, { nowMs });
    }
    if (due.length === 0) return { ran: false, reason: "none_due" };

    const loadCredentials = deps.loadCredentials ?? loadCredentialsLazy;
    const runSync = deps.runSync ?? runMiloOrderSyncForStore;

    let synced = 0;
    for (const { storeId, reason } of due) {
      try {
        const creds = await loadCredentials(supabase, storeId);
        let username;
        let password;
        if (creds.ok) {
          username = creds.credentials.username;
          password = creds.credentials.password;
        } else if (creds.code !== "LK_DECRYPT_FAILED") {
          // Same env fallback the RPA path honors (test stores).
          username = process.env.MILO_USERNAME;
          password = process.env.MILO_PASSWORD;
        }
        if (!username || !password) {
          console.warn(`[order-sync] store ${storeId}: no MILO credentials — skipping`);
          continue;
        }
        const summary = await runSync({ supabase, storeId, username, password });
        if (summary?.ok) {
          synced += 1;
          console.log(
            `[order-sync] store ${storeId} (${reason}): ${summary.miloOrders} MILO orders, ` +
              `${summary.updated} updated, ${summary.imported} imported, ` +
              `${summary.unmatchedLocal} local-only, ${summary.ms}ms`,
          );
        } else {
          console.warn(`[order-sync] store ${storeId} sync failed: ${summary?.reason ?? "unknown"}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[order-sync] store ${storeId} sync threw: ${msg}`);
        invalidateNodeMiloSession(storeId, "order_sync_error");
      }
    }
    return { ran: true, synced };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[order-sync] tick failed (continuing): ${msg}`);
    return { ran: false, reason: "tick_error" };
  }
}

/** Test helper — reset the throttle + shared client. Unit tests only. */
export function __resetOrderSyncLoopForTests() {
  nextScheduledScanAtMs = 0;
  sharedSupabase = null;
}
