/**
 * Admin app → API client for the Tier 2 ambiguous NRS review queue.
 *
 * Endpoints live at /admin/nrs-review/* on the API and are protected by
 * X-Admin-Token (matches LK_ADMIN_TOKEN env). Local dev typically leaves
 * the env unset so calls are unauthenticated; prod sets VITE_ADMIN_TOKEN
 * at build time so this client attaches the header.
 *
 * VITE_ADMIN_TOKEN is build-time only — never log it, never put it in URLs.
 */

const BASE = "/admin";

export type NrsReviewCandidate = {
  code: string;
  name: string;
  score: number;
  // Enriched from mlcc_items on the server — may be null if the code was
  // dropped from catalog between import and review (rare).
  size_ml?: number | null;
  bottle_size_label?: string | null;
  ada_name?: string | null;
  category?: string | null;
  licensee_price?: number | null;
  base_price?: number | null;
};

export type CatalogSearchResult = {
  code: string;
  name: string;
  size_ml: number | null;
  bottle_size_label: string | null;
  ada_name: string | null;
  category: string | null;
  licensee_price: number | null;
  base_price: number | null;
};

export type NrsReviewRow = {
  id: string;
  upc: string;
  nrs_name: string;
  size_ml: number | null;
  top_candidates: NrsReviewCandidate[];
  created_at: string;
};

export type NrsReviewPendingResponse = {
  ok: boolean;
  items: NrsReviewRow[];
  total: number;
  limit: number;
  offset: number;
  error?: string;
};

export type NrsReviewResolveResponse = {
  ok: boolean;
  upc?: string;
  mlccCode?: string;
  mlccName?: string;
  error?: string;
};

export type NrsReviewSkipResponse = {
  ok: boolean;
  error?: string;
};

function authHeaders(): Record<string, string> {
  const token = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined)?.trim();
  return token ? { "X-Admin-Token": token } : {};
}

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...authHeaders() };
}

export async function fetchPendingReviews(
  limit = 50,
  offset = 0,
): Promise<NrsReviewPendingResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${BASE}/nrs-review/pending?${params.toString()}`, {
    credentials: "same-origin",
    headers: authHeaders(),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      total: 0,
      limit,
      offset,
      error: typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
    };
  }
  return {
    ok: Boolean(body.ok),
    items: Array.isArray(body.items) ? (body.items as NrsReviewRow[]) : [],
    total: typeof body.total === "number" ? body.total : 0,
    limit: typeof body.limit === "number" ? body.limit : limit,
    offset: typeof body.offset === "number" ? body.offset : offset,
  };
}

export async function resolveReview(
  reviewId: string,
  mlccCode: string,
  confirmedBy?: string,
): Promise<NrsReviewResolveResponse> {
  const res = await fetch(`${BASE}/nrs-review/${encodeURIComponent(reviewId)}/resolve`, {
    method: "POST",
    credentials: "same-origin",
    headers: jsonHeaders(),
    body: JSON.stringify({ mlccCode, confirmedBy: confirmedBy ?? "operator_review_ui" }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return {
    ok: Boolean(body.ok),
    upc: typeof body.upc === "string" ? body.upc : undefined,
    mlccCode: typeof body.mlccCode === "string" ? body.mlccCode : undefined,
    mlccName: typeof body.mlccName === "string" ? body.mlccName : undefined,
    error: !body.ok ? (typeof body.error === "string" ? body.error : `HTTP ${res.status}`) : undefined,
  };
}

/**
 * Search the MLCC catalog when none of the top 3 candidates match.
 * Reuses the same /price-book/items endpoint the scanner uses.
 * Returns up to `limit` matching items (default 20).
 */
export async function searchMlccCatalog(
  query: string,
  limit = 20,
): Promise<CatalogSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams();
  params.set("search", q);
  params.set("limit", String(limit));
  const res = await fetch(`/price-book/items?${params.toString()}`, {
    credentials: "same-origin",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { ok?: boolean; items?: unknown[] };
  if (!body.ok || !Array.isArray(body.items)) return [];
  return body.items
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => ({
      code: String(it.code ?? ""),
      name: String(it.name ?? ""),
      size_ml: typeof it.size_ml === "number" ? it.size_ml : null,
      bottle_size_label:
        typeof it.bottle_size_label === "string" ? it.bottle_size_label : null,
      ada_name: typeof it.ada_name === "string" ? it.ada_name : null,
      category: typeof it.category === "string" ? it.category : null,
      licensee_price:
        typeof it.licensee_price === "number" ? it.licensee_price : null,
      base_price: typeof it.base_price === "number" ? it.base_price : null,
    }))
    .filter((it) => it.code !== "");
}

export async function skipReview(
  reviewId: string,
  reason?: string,
): Promise<NrsReviewSkipResponse> {
  const res = await fetch(`${BASE}/nrs-review/${encodeURIComponent(reviewId)}/skip`, {
    method: "POST",
    credentials: "same-origin",
    headers: jsonHeaders(),
    body: JSON.stringify({ reason: reason ?? "" }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return {
    ok: Boolean(body.ok),
    error: !body.ok ? (typeof body.error === "string" ? body.error : `HTTP ${res.status}`) : undefined,
  };
}
