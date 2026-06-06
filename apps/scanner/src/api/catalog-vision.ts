/**
 * Scanner → /catalog/identify-from-image API client (task #37, 2026-06-01).
 *
 * Used by the "Take a photo" fallback when the barcode scanner can't
 * read a label. Posts a base64 image to the backend, which forwards it
 * to Claude vision and returns top MlccProduct candidates from a fuzzy
 * catalog match. Auth-gated like the rest of the cart/* and bottles/*
 * routes — the JWT lives in the Supabase session.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";
import type { MlccProduct } from "../types";

const ENDPOINT = "/catalog/identify-from-image";

export type VisionExtracted = {
  brand: string;
  product_name: string;
  size_label: string;
  confidence: "high" | "medium" | "low";
};

export type IdentifyFromImageResult =
  | {
      ok: true;
      extracted: VisionExtracted;
      candidates: MlccProduct[];
      /** UI-ready hint when no candidates matched or the model saw nothing. */
      hint: string | null;
    }
  | { ok: false; error: string; raw?: string };

/**
 * POST a base64 image (JPEG, with or without data URI prefix) and get
 * back top catalog candidates. Returns ok:false on any error so callers
 * can render a recoverable failure state instead of throwing.
 *
 * @param image - "data:image/jpeg;base64,..." or raw base64
 */
export async function identifyFromImage(image: string): Promise<IdentifyFromImageResult> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return {
      ok: false,
      error: "Scanner is not signed in. Sign in and try again.",
    };
  }
  let res: Response;
  try {
    res = await fetchWithRetry(
      ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image }),
      },
      // Vision calls take ~3-6s; 30s timeout covers a slow MLCC day +
      // Claude API latency. Retries are 1 only — we don't want to
      // double-charge for a transient error AND keep the user waiting.
      { maxRetries: 1, baseDelayMs: 500, timeoutMs: 30_000 },
    );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (await handleAuthFailure(res)) {
    return { ok: false, error: "session_expired" };
  }
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
      raw: typeof raw.raw === "string" ? raw.raw : undefined,
    };
  }
  return {
    ok: true,
    extracted: raw.extracted as VisionExtracted,
    candidates: Array.isArray(raw.candidates) ? (raw.candidates as MlccProduct[]) : [],
    hint: typeof raw.hint === "string" ? raw.hint : null,
  };
}
