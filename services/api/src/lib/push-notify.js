/**
 * push-notify — Web Push sender for the "order needs you" layer (2026-07-05).
 *
 * DORMANT BY DEFAULT, three independent ways:
 *   1. No VAPID env (LK_PUSH_VAPID_PUBLIC_KEY / LK_PUSH_VAPID_PRIVATE_KEY)
 *      → isPushConfigured() false → every call is a cheap no-op.
 *   2. `web-push` package not installed → dynamic import fails → warn once,
 *      stay disabled. Missing dep can NEVER crash boot or a run.
 *   3. No push_subscriptions rows for the store → nothing to send.
 *
 * NEVER THROWS. A failed push is a console.warn, never a failed run — the
 *   notification layer must not be able to invert the meaning of "succeeded".
 *   (Same fire-and-forget contract as the creds-verified stamp in
 *   execution-run.service.js.)
 *
 * Key generation (one-time, run anywhere):
 *   npx web-push generate-vapid-keys
 * Then on Fly (API app only — the sender lives in the API process):
 *   fly secrets set LK_PUSH_VAPID_PUBLIC_KEY=... LK_PUSH_VAPID_PRIVATE_KEY=... -a liquor-kings
 */
import { buildRunFinalPush } from "./run-final-push.js";

const SUBJECT_FALLBACK = "mailto:tonykado30@gmail.com";

export function getVapidPublicKey() {
  return process.env.LK_PUSH_VAPID_PUBLIC_KEY || "";
}

export function isPushConfigured() {
  return Boolean(
    process.env.LK_PUSH_VAPID_PUBLIC_KEY && process.env.LK_PUSH_VAPID_PRIVATE_KEY,
  );
}

let webPushModule; // undefined = not tried, null = unavailable (warned once)
async function getWebPush() {
  if (webPushModule !== undefined) return webPushModule;
  try {
    const mod = await import("web-push");
    webPushModule = mod.default ?? mod;
  } catch (e) {
    webPushModule = null;
    console.warn(
      "[push] web-push package not installed — push notifications disabled",
      { error: e instanceof Error ? e.message : String(e) },
    );
  }
  return webPushModule;
}

/** Endpoint tail for logs — enough to identify, never the full capability URL. */
function endpointTail(endpoint) {
  const s = String(endpoint ?? "");
  return `…${s.slice(-12)}`;
}

/**
 * Send one payload to every subscription registered for a store.
 * Prunes dead subscriptions (404/410 = gone) so the table self-cleans.
 * Never throws; returns { sent, failed, pruned } for observability.
 */
export async function sendPushToStore(supabase, storeId, payload) {
  try {
    if (!isPushConfigured()) return { sent: 0, failed: 0, pruned: 0, skipped: "not_configured" };
    if (!storeId) return { sent: 0, failed: 0, pruned: 0, skipped: "no_store" };

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, keys")
      .eq("store_id", storeId);
    if (error) {
      console.warn("[push] failed to load subscriptions", { storeId, error: error.message });
      return { sent: 0, failed: 0, pruned: 0, skipped: "load_error" };
    }
    if (!subs || subs.length === 0) return { sent: 0, failed: 0, pruned: 0, skipped: "no_subscriptions" };

    const webpush = await getWebPush();
    if (!webpush) return { sent: 0, failed: 0, pruned: 0, skipped: "module_missing" };

    webpush.setVapidDetails(
      process.env.LK_PUSH_VAPID_SUBJECT || SUBJECT_FALLBACK,
      process.env.LK_PUSH_VAPID_PUBLIC_KEY,
      process.env.LK_PUSH_VAPID_PRIVATE_KEY,
    );

    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          body,
          { TTL: 60 * 60 }, // an hour-old run notification is stale — let it drop
        ),
      ),
    );

    let sent = 0;
    let failed = 0;
    const pruneIds = [];
    const sentIds = [];
    results.forEach((r, i) => {
      const sub = subs[i];
      if (r.status === "fulfilled") {
        sent += 1;
        sentIds.push(sub.id);
        return;
      }
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) {
        pruneIds.push(sub.id); // subscription expired/revoked — self-clean
      } else {
        failed += 1;
        console.warn("[push] send failed", {
          storeId,
          endpoint: endpointTail(sub.endpoint),
          statusCode: code ?? null,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    if (pruneIds.length > 0) {
      const { error: delErr } = await supabase
        .from("push_subscriptions")
        .delete()
        .in("id", pruneIds);
      if (delErr) console.warn("[push] prune failed", { storeId, error: delErr.message });
    }
    if (sentIds.length > 0) {
      const { error: touchErr } = await supabase
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .in("id", sentIds);
      if (touchErr) console.warn("[push] last_used_at stamp failed", { storeId, error: touchErr.message });
    }

    return { sent, failed, pruned: pruneIds.length };
  } catch (e) {
    console.warn("[push] sendPushToStore unexpected error", {
      storeId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { sent: 0, failed: 0, pruned: 0, skipped: "unexpected_error" };
  }
}

/**
 * The one call sites use: given a TERMINALLY finalized run row, build the
 * right notification (or nothing) and send it to the store's devices.
 * Fire-and-forget friendly — never throws, always resolves.
 */
export async function notifyRunFinal({ supabase, run }) {
  try {
    if (!isPushConfigured()) return { skipped: "not_configured" };
    const payload = buildRunFinalPush(run);
    if (!payload) return { skipped: "no_notification_for_run" };
    const result = await sendPushToStore(supabase, run.store_id, payload);
    if (result.sent > 0) {
      console.log(
        `[push] run ${run.id} → ${result.sent} device(s) (${payload.data?.kind ?? "?"})`,
      );
    }
    return result;
  } catch (e) {
    console.warn("[push] notifyRunFinal unexpected error", {
      runId: run?.id ?? null,
      error: e instanceof Error ? e.message : String(e),
    });
    return { skipped: "unexpected_error" };
  }
}
