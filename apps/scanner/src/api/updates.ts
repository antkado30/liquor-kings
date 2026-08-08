/**
 * Updates feed API client (2026-08-05, the bell).
 * GET /home/updates — the full chronology: price changes, new bottles,
 * catalog syncs, order events. Server shapes titles/bodies; the client
 * renders and tracks the unread watermark locally
 * (lib/updates-unread.ts).
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

export type UpdateType = "price_change" | "new_bottle" | "catalog_sync" | "order_event";

export interface UpdateEntry {
  id: string;
  type: UpdateType;
  title: string;
  body: string;
  /** ISO timestamp the event happened. */
  at: string;
  meta?: Record<string, unknown>;
}

export type GetUpdatesResult =
  | { ok: true; updates: UpdateEntry[] }
  | { ok: false; error: string };

export async function getUpdates(): Promise<GetUpdatesResult> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }
  let res: Response;
  try {
    res = await fetchWithRetry(
      "/home/updates",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
        },
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 8_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (await handleAuthFailure(res)) {
    return { ok: false, error: "session_expired" };
  }
  let raw: { ok?: boolean; updates?: unknown; error?: string };
  try {
    raw = (await res.json()) as { ok?: boolean; updates?: unknown; error?: string };
  } catch {
    return { ok: false, error: "Bad response" };
  }
  if (!res.ok || raw.ok !== true || !Array.isArray(raw.updates)) {
    return { ok: false, error: raw.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, updates: raw.updates as UpdateEntry[] };
}
