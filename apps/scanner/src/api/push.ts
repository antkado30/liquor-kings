/**
 * Scanner ↔ /push API client — "order needs you" notifications (2026-07-05).
 *
 * GET    /push/config          → is the server armed + VAPID public key
 * POST   /push/subscriptions   → register this device for the current store
 * DELETE /push/subscriptions   → unregister this device
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

export type PushConfigResult =
  | { ok: true; enabled: boolean; publicKey: string | null }
  | { ok: false; error: string };

type SimpleResult = { ok: true } | { ok: false; error: string };

async function authHeaders(): Promise<
  { ok: true; headers: Record<string, string> } | { ok: false; error: string }
> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }
  return {
    ok: true,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "X-Store-Id": storeId,
      "Content-Type": "application/json",
    },
  };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function getPushConfig(): Promise<PushConfigResult> {
  const auth = await authHeaders();
  if (!auth.ok) return auth;
  try {
    const res = await fetchWithRetry(
      "/push/config",
      { method: "GET", headers: auth.headers },
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 8_000 },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't check notification settings") };
    }
    const body = (await res.json()) as {
      data?: { enabled?: boolean; public_key?: string | null };
    };
    return {
      ok: true,
      enabled: body?.data?.enabled === true,
      publicKey: body?.data?.public_key ?? null,
    };
  } catch {
    return { ok: false, error: "Couldn't reach the server" };
  }
}

export async function savePushSubscription(
  subscription: PushSubscriptionJSON,
): Promise<SimpleResult> {
  const auth = await authHeaders();
  if (!auth.ok) return auth;
  try {
    const res = await fetchWithRetry(
      "/push/subscriptions",
      {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({ subscription }),
      },
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 8_000 },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't save this device") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server" };
  }
}

export async function removePushSubscription(endpoint: string): Promise<SimpleResult> {
  const auth = await authHeaders();
  if (!auth.ok) return auth;
  try {
    const res = await fetchWithRetry(
      "/push/subscriptions",
      {
        method: "DELETE",
        headers: auth.headers,
        body: JSON.stringify({ endpoint }),
      },
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 8_000 },
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't remove this device") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server" };
  }
}
