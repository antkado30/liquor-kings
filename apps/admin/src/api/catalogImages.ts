/**
 * Admin → API client for the catalog image curation tool (#69).
 *
 * Backs /admin/images, where Tony pastes canonical bottle image URLs
 * for SKUs whose `mlcc_items.image_url` is still NULL. Endpoints live
 * at `/admin/catalog/*` on the API and use the same X-Admin-Token
 * pattern as the NRS review queue — see VITE_ADMIN_TOKEN docs there.
 */

import { fetchWithRetry } from "./fetchWithRetry";

const BASE = "/admin";

export type UncoveredRow = {
  code: string;
  name: string;
  bottle_size_ml: number | null;
  bottle_size_label: string | null;
  ada_name: string | null;
  category: string | null;
  /** True if this MLCC code appears in any bottles row (someone's shelf). */
  on_shelf: boolean;
};

export type UncoveredResponse = {
  ok: true;
  total: number;
  on_shelf_total: number;
  rows: UncoveredRow[];
  limit: number;
  offset: number;
};

function authHeaders(): Record<string, string> {
  const token = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined)?.trim();
  return token ? { "X-Admin-Token": token } : {};
}

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...authHeaders() };
}

export async function fetchUncovered(opts: {
  limit?: number;
  offset?: number;
  q?: string;
  onShelfOnly?: boolean;
}): Promise<
  | UncoveredResponse
  | { ok: false; error: string }
> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  if (opts.q) params.set("q", opts.q);
  if (opts.onShelfOnly) params.set("on_shelf_only", "true");
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/catalog/uncovered?${params.toString()}`,
      { credentials: "same-origin", headers: authHeaders() },
      { maxRetries: 2, timeoutMs: 15000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  try {
    return (await res.json()) as UncoveredResponse;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setImageUrl(
  code: string,
  imageUrl: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/catalog/${encodeURIComponent(code)}/image`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: jsonHeaders(),
        body: JSON.stringify({ image_url: imageUrl }),
      },
      { maxRetries: 1, timeoutMs: 15000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let body: { ok?: boolean; updated?: number; error?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok || body.ok !== true) {
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, updated: body.updated ?? 0 };
}

export async function clearImageUrl(
  code: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/catalog/${encodeURIComponent(code)}/image`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: authHeaders(),
      },
      { maxRetries: 1, timeoutMs: 15000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let body: { ok?: boolean; updated?: number; error?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok || body.ok !== true) {
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, updated: body.updated ?? 0 };
}
