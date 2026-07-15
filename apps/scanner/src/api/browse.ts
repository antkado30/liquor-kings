/**
 * Browse API client (task #64, 2026-06-03).
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";
import type { FamilyGroup, MlccProduct } from "../types";

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
  /** Advanced filters (2026-07-15 spec — Tony's "very advanced" ask). */
  container?: "glass" | "plastic" | null;
  packs?: "singles" | "packs" | null;
  /** Only bottles THIS store has ordered before (store_item_order_stats). */
  ordered_only?: boolean;
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
  if (f.container) params.set("container", f.container);
  if (f.packs) params.set("packs", f.packs);
  if (f.ordered_only) params.set("ordered", "1");
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

export type BrowseFamiliesResult =
  | { ok: true; groups: FamilyGroup[]; hasMore: boolean }
  | { ok: false; error: string };

/**
 * Family-first catalog scrolling (2026-07-12): one card per product line
 * across the whole catalog, offset-paginated. `error: "rpc_missing"`
 * means the DB migration isn't applied yet — the caller keeps the flat
 * grid (never a dead tab). Search and the size filter don't come through
 * here by design: search uses the grouped search endpoint, and a size
 * filter means the user wants specific bottles (flat).
 */
export async function browseFamilies(args: {
  filters?: Omit<BrowseFilters, "q" | "bottle_size_ml">;
  sort?: BrowseSort;
  limit?: number;
  offset?: number;
}): Promise<BrowseFamiliesResult> {
  const params = new URLSearchParams();
  const f = args.filters ?? {};
  if (f.category) params.set("category", f.category);
  if (f.ada_number) params.set("ada_number", f.ada_number);
  if (f.min_price != null) params.set("min_price", String(f.min_price));
  if (f.max_price != null) params.set("max_price", String(f.max_price));
  if (f.min_proof != null) params.set("min_proof", String(f.min_proof));
  if (f.max_proof != null) params.set("max_proof", String(f.max_proof));
  if (f.new_only) params.set("new_only", "1");
  if (f.container) params.set("container", f.container);
  if (f.packs) params.set("packs", f.packs);
  if (f.ordered_only) params.set("ordered", "1");
  if (args.sort) params.set("sort", args.sort);
  if (args.limit) params.set("limit", String(args.limit));
  if (args.offset) params.set("offset", String(args.offset));

  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/families?${params.toString()}`,
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
  const groups: FamilyGroup[] = [];
  for (const rawG of Array.isArray(raw.groups) ? raw.groups : []) {
    if (!rawG || typeof rawG !== "object") continue;
    const g = rawG as Record<string, unknown>;
    const rep = g.representative as MlccProduct | null | undefined;
    if (!rep || typeof rep !== "object" || !rep.code) continue;
    groups.push({
      familyKey: typeof g.groupId === "string" ? g.groupId : String(rep.code),
      category: rep.category ?? null,
      baseName:
        typeof g.baseName === "string" && g.baseName.trim() !== ""
          ? g.baseName.trim()
          : rep.name,
      sizeCount:
        typeof g.sizeCount === "number" && Number.isFinite(g.sizeCount)
          ? Math.max(1, Math.round(g.sizeCount))
          : 1,
      sizes: Array.isArray(g.sizes)
        ? (g.sizes.filter((s) => typeof s === "string" && s.trim() !== "") as string[])
        : undefined,
      minPrice: typeof g.minPrice === "number" && Number.isFinite(g.minPrice) ? g.minPrice : null,
      maxPrice: typeof g.maxPrice === "number" && Number.isFinite(g.maxPrice) ? g.maxPrice : null,
      mixedContainers: g.mixedContainers === true,
      isCombo: g.isCombo === true,
      representative: rep,
    });
  }
  return { ok: true, groups, hasMore: raw.hasMore === true };
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
