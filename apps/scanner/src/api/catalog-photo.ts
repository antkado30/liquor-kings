/**
 * Scanner → catalog photo truth layer API client (2026-06-10).
 *
 * Two calls backing the ProductCard photo affordances:
 *   - uploadBottlePhoto: user snapped the REAL bottle in the store →
 *     becomes the canonical image for that code (image_source='in_store',
 *     overrides any internet backfill).
 *   - reportWrongPhoto: "Wrong photo?" — clears a lying image immediately
 *     and quarantines the code from backfill re-fills.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

type PhotoUploadResult =
  | { ok: true; imageUrl: string }
  | { ok: false; error: string };

type PhotoReportResult = { ok: true } | { ok: false; error: string };

async function authedPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ res: Response | null; error: string | null }> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { res: null, error: "Scanner is not signed in. Sign in and try again." };
  }
  try {
    const res = await fetchWithRetry(
      path,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { maxRetries: 1, baseDelayMs: 500, timeoutMs: 30_000 },
    );
    return { res, error: null };
  } catch (e) {
    return { res: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** @param image - "data:image/jpeg;base64,..." (downscaled client-side) */
export async function uploadBottlePhoto(
  code: string,
  image: string,
): Promise<PhotoUploadResult> {
  const { res, error } = await authedPost(
    `/catalog/items/${encodeURIComponent(code)}/photo`,
    { image },
  );
  if (!res) return { ok: false, error: error ?? "network_error" };
  if (await handleAuthFailure(res)) return { ok: false, error: "session_expired" };
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok || raw.ok !== true || typeof raw.image_url !== "string") {
    return {
      ok: false,
      error: typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`,
    };
  }
  return { ok: true, imageUrl: raw.image_url };
}

export async function reportWrongPhoto(
  code: string,
  reason?: string,
): Promise<PhotoReportResult> {
  const { res, error } = await authedPost(
    `/catalog/items/${encodeURIComponent(code)}/photo-report`,
    reason ? { reason } : {},
  );
  if (!res) return { ok: false, error: error ?? "network_error" };
  if (await handleAuthFailure(res)) return { ok: false, error: "session_expired" };
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok || raw.ok !== true) {
    return {
      ok: false,
      error: typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`,
    };
  }
  return { ok: true };
}
