/**
 * Browse API client (task #64, 2026-06-03).
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";
import type { MlccProduct } from "../types";

const BASE = "/catalog/browse";

export type BrowseSort =
  | "name"
  | "price_asc"
  | "price_desc"
  | "newest"
  | "proof_asc"
  | "proof_desc";

export type BrowseFilters = {
  category?: string | null;
  ada_number?: string | null;
  bottle_size_ml?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  min_proof?: number | null;
  max_proof?: number | null;
  new_only?: boolean;
  q?: string | null;
};

export type BrowseFacets = {
  categories: Array<{ name: string; count: number }>;
  adas: Array<{ number: string; name: string; count: number }>;
  sizes: Array<{ ml: number; label: string; count: number }>;
  priceRange: { min: number; max: number };
  proofRange: { min: number; max: number };
};

async function authHeaders(): Promise<Record<string, string>> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer) throw new Error("Not signed in");
  if (!storeId) throw new Error("No active store");
  return {
    Authorization: `Bearer ${bearer}`,
    "X-Store-Id": storeId,
  };
}

export type BrowseResult =
  | {
      ok: true;
      products: MlccProduct[];
      nextCursor: string | null;
      total: number | null;
    }
  | { ok: false; error: string };

export async function browseProducts(args: {
  filters?: BrowseFilters;
  sort?: BrowseSort;
  limit?: number;
  cursor?: string | null;
}): Promise<BrowseResult> {
  const params = new URLSearchParams();
  const f = args.filters ?? {};
  if (f.category) params.set("category", f.category);
  if (f.ada_number) params.set("ada_number", f.ada_number);
  if (f.bottle_size_ml != null)
    params.set("bottle_size_ml", String(f.bottle_size_ml));
  if (f.min_price != null) params.set("min_price", String(f.min_price));
  if (f.max_price != null) params.set("max_price", String(f.max_price));
  if (f.min_proof != null) params.set("min_proof", String(f.min_proof));
  if (f.max_proof != null) params.set("max_proof", String(f.max_proof));
  if (f.new_only) params.set("new_only", "1");
  if (f.q) params.set("q", f.q);
  if (args.sort) params.set("sort", args.sort);
  if (args.limit) params.set("limit", String(args.limit));
  if (args.cursor) params.set("cursor", args.cursor);

  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}?${params.toString()}`,
      { method: "GET", headers: await authHeaders() },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 10_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    };
  }
  return {
    ok: true,
    products: Array.isArray(raw.products) ? (raw.products as MlccProduct[]) : [],
    nextCursor: typeof raw.nextCursor === "string" ? raw.nextCursor : null,
    total: typeof raw.total === "number" ? raw.total : null,
  };
}

export type GetBrowseFacetsResult =
  | { ok: true; facets: BrowseFacets }
  | { ok: false; error: string };

export async function getBrowseFacets(): Promise<GetBrowseFacetsResult> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/facets`,
      { method: "GET", headers: await authHeaders() },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 10_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    };
  }
  return { ok: true, facets: raw.facets as BrowseFacets };
}
