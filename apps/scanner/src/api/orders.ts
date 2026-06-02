/**
 * Orders API client (task #41, 2026-06-02). Fetches MILO order
 * confirmations persisted by the Stage 5 worker. Auth-gated via the
 * existing Supabase JWT pattern used by cart.ts.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";

const BASE = "/orders";

export type MiloOrderListItem = {
  id: string;
  store_id: string;
  execution_run_id: string | null;
  ada_number: string | null;
  ada_name: string | null;
  confirmation_number: string;
  order_number: string | null;
  placed_at: string | null;
  delivery_date: string | null;
  submitted_at: string;
  net_total: number | null;
  gross_total: number | null;
  line_item_count: number;
  distributor_raw: string | null;
  status_at_placement: string | null;
  created_at: string;
};

export type MiloOrderLineItem = {
  liquorCode?: string | null;
  productName?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  bottleSizeMl?: number | null;
};

export type MiloOrderDetail = MiloOrderListItem & {
  liquor_tax: number | null;
  discount: number | null;
  line_items: MiloOrderLineItem[];
};

async function authHeaders(): Promise<Record<string, string>> {
  const bearer = await getAuthBearer();
  const storeId = import.meta.env.VITE_SCANNER_STORE_ID as string | undefined;
  if (!bearer) throw new Error("Not signed in");
  if (!storeId) throw new Error("VITE_SCANNER_STORE_ID env var not set");
  return {
    Authorization: `Bearer ${bearer}`,
    "X-Store-Id": storeId,
  };
}

export type ListOrdersResult =
  | { ok: true; orders: MiloOrderListItem[]; nextCursor: string | null }
  | { ok: false; error: string };

export async function listOrders(opts?: {
  limit?: number;
  cursor?: string | null;
  adaNumber?: string | null;
}): Promise<ListOrdersResult> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.adaNumber) params.set("ada_number", opts.adaNumber);
  const qs = params.toString();
  const url = qs ? `${BASE}?${qs}` : BASE;

  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
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
    orders: Array.isArray(raw.orders) ? (raw.orders as MiloOrderListItem[]) : [],
    nextCursor: typeof raw.nextCursor === "string" ? raw.nextCursor : null,
  };
}

export type GetOrderResult =
  | { ok: true; order: MiloOrderDetail }
  | { ok: false; error: string };

export async function getOrder(id: string): Promise<GetOrderResult> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/${encodeURIComponent(id)}`,
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
  return { ok: true, order: raw.order as MiloOrderDetail };
}

export type OrdersSummary = {
  sinceIso: string;
  totalConfirmations: number;
  distinctOrders: number;
  netSpend: number;
  grossSpend: number;
};

export type GetOrdersSummaryResult =
  | { ok: true; summary: OrdersSummary }
  | { ok: false; error: string };

export async function getOrdersSummary(): Promise<GetOrdersSummaryResult> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/summary/recent`,
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
    summary: {
      sinceIso: String(raw.sinceIso ?? ""),
      totalConfirmations: Number(raw.totalConfirmations ?? 0),
      distinctOrders: Number(raw.distinctOrders ?? 0),
      netSpend: Number(raw.netSpend ?? 0),
      grossSpend: Number(raw.grossSpend ?? 0),
    },
  };
}
