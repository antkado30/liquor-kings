/**
 * Saved-matches API client (2026-07-28) — the Settings audit door for
 * THE MOAT. Read + forget only; teaching happens on the resolve card
 * and in chat, never here.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

export type SavedMatch = {
  phrase: string;
  size_ml: number | null;
  mlcc_code: string;
  product_name: string | null;
  bottle_size_label: string | null;
  source: string | null;
  times_used: number;
  updated_at: string | null;
};

export type GetSavedMatchesResult =
  | { ok: true; items: SavedMatch[] }
  | { ok: false; error: string };

async function authedHeaders(): Promise<Record<string, string> | null> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) return null;
  return {
    Authorization: `Bearer ${bearer}`,
    "X-Store-Id": storeId,
    "Content-Type": "application/json",
  };
}

export async function getSavedMatches(): Promise<GetSavedMatchesResult> {
  const headers = await authedHeaders();
  if (!headers) return { ok: false, error: "Not signed in" };
  let res: Response;
  try {
    res = await fetchWithRetry(
      "/store-memory",
      { method: "GET", headers },
      { maxRetries: 2, baseDelayMs: 400, timeoutMs: 10_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (await handleAuthFailure(res)) return { ok: false, error: "session_expired" };
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok || raw.ok !== true) {
    return { ok: false, error: typeof raw.error === "string" ? raw.error : `HTTP ${res.status}` };
  }
  return { ok: true, items: Array.isArray(raw.items) ? (raw.items as SavedMatch[]) : [] };
}

export async function forgetSavedMatch(
  phrase: string,
  sizeMl: number | null,
): Promise<{ ok: boolean; deleted?: boolean; error?: string }> {
  const headers = await authedHeaders();
  if (!headers) return { ok: false, error: "Not signed in" };
  let res: Response;
  try {
    res = await fetchWithRetry(
      "/store-memory/forget",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ phrase, ...(sizeMl != null ? { sizeMl } : {}) }),
      },
      // maxRetries 1: forget is idempotent but there's no reason to hammer.
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 10_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (await handleAuthFailure(res)) return { ok: false, error: "session_expired" };
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok || raw.ok !== true) {
    return { ok: false, error: typeof raw.error === "string" ? raw.error : `HTTP ${res.status}` };
  }
  return { ok: true, deleted: raw.deleted === true };
}
