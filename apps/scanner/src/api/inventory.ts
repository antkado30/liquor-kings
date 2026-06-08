/**
 * Inventory API client (2026-06-07). Wires the scanner to the existing
 * /inventory routes (services/api/src/routes/inventory.routes.js) — the
 * backend was already built; this is the missing front-end glue that
 * promotes Inventory from "Coming Soon" to a real page.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

const BASE = "/inventory";

function storeId(): string {
  const id = getCurrentStoreId();
  if (!id) throw new Error("No active store. Sign in first.");
  return id;
}

async function authHeaders(): Promise<Record<string, string>> {
  const bearer = await getAuthBearer();
  const id = getCurrentStoreId();
  if (!bearer) throw new Error("Not signed in.");
  if (!id) throw new Error("No active store.");
  return { Authorization: `Bearer ${bearer}`, "X-Store-Id": id };
}

/** Bottle metadata joined onto each inventory row. */
export type InventoryBottle = {
  id: string;
  name: string | null;
  mlcc_code: string | null;
  upc: string | null;
  image_url: string | null;
  size: string | null;
  size_ml: number | null;
  category: string | null;
  subcategory: string | null;
  state_min_price: number | null;
  shelf_price: number | null;
  is_active: boolean | null;
};

export type InventoryRow = {
  id: string;
  store_id: string;
  bottle_id: string;
  quantity: number | null;
  low_stock_threshold: number | null;
  par_level: number | null;
  reorder_point: number | null;
  reorder_quantity: number | null;
  shelf_price: number | null;
  cost: number | null;
  location: string | null;
  location_note: string | null;
  last_counted_at: string | null;
  updated_at: string | null;
  is_active: boolean | null;
  bottles: InventoryBottle | null;
};

export type InventorySummary = { totalRows: number; totalQuantity: number };

type ListResult =
  | { ok: true; rows: InventoryRow[] }
  | { ok: false; error: string };

async function getJson(
  path: string,
): Promise<{ ok: true; raw: Record<string, unknown> } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}${path}`,
      { method: "GET", headers: await authHeaders() },
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
  if (!res.ok || raw.success !== true) {
    return {
      ok: false,
      error: typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`,
    };
  }
  return { ok: true, raw };
}

/** Full inventory list (optionally filtered by query). */
export async function listInventory(q?: string): Promise<ListResult> {
  const suffix = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=200` : `?limit=200`;
  const r = await getJson(`/${encodeURIComponent(storeId())}${suffix}`);
  if (!r.ok) return r;
  return { ok: true, rows: Array.isArray(r.raw.data) ? (r.raw.data as InventoryRow[]) : [] };
}

/** Low-stock + reorder-candidate rows for the alerts strip. */
export async function listLowStock(): Promise<ListResult> {
  const r = await getJson(`/${encodeURIComponent(storeId())}/low-stock`);
  if (!r.ok) return r;
  return { ok: true, rows: Array.isArray(r.raw.data) ? (r.raw.data as InventoryRow[]) : [] };
}

export async function getInventorySummary(): Promise<
  { ok: true; summary: InventorySummary } | { ok: false; error: string }
> {
  const r = await getJson(`/${encodeURIComponent(storeId())}/summary`);
  if (!r.ok) return r;
  const s = (r.raw.summary as InventorySummary | undefined) ?? {
    totalRows: 0,
    totalQuantity: 0,
  };
  return { ok: true, summary: s };
}

async function patch(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}${path}`,
      {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 10_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (await handleAuthFailure(res)) return { ok: false, error: "session_expired" };
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const raw = (await res.json()) as Record<string, unknown>;
      if (typeof raw.error === "string") msg = raw.error;
    } catch {
      /* ignore */
    }
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export function updateInventoryQuantity(inventoryId: string, quantity: number) {
  return patch(`/${encodeURIComponent(storeId())}/${encodeURIComponent(inventoryId)}/quantity`, {
    quantity,
  });
}

export function updateReorderSettings(
  inventoryId: string,
  settings: { lowStockThreshold?: number | null; reorderPoint?: number | null },
) {
  return patch(
    `/${encodeURIComponent(storeId())}/${encodeURIComponent(inventoryId)}/reorder-settings`,
    settings,
  );
}
