/**
 * Scanner ↔ /cart API client.
 *
 * AUTH (dev-only): VITE_SCANNER_DEV_BEARER (Supabase service role) +
 * VITE_SCANNER_STORE_ID (target store UUID). Phase B #4 replaces these
 * with a real Supabase JWT from a logged-in user. Headers shape stays the same.
 */
import { fetchWithRetry } from "./catalog";

export const CART_API_BASE = "/cart";

type AuthHeaders = {
  Authorization: string;
  "X-Store-Id": string;
};

function getAuthHeaders(): AuthHeaders {
  const bearer = import.meta.env.VITE_SCANNER_DEV_BEARER as string | undefined;
  const storeId = import.meta.env.VITE_SCANNER_STORE_ID as string | undefined;
  if (!bearer || !storeId) {
    throw new Error(
      "Scanner is missing dev auth env vars. Set VITE_SCANNER_DEV_BEARER and VITE_SCANNER_STORE_ID in apps/scanner/.env",
    );
  }
  return {
    Authorization: bearer.startsWith("Bearer ") ? bearer : `Bearer ${bearer}`,
    "X-Store-Id": storeId,
  };
}

export function getStoreId(): string {
  const storeId = import.meta.env.VITE_SCANNER_STORE_ID as string | undefined;
  if (!storeId) throw new Error("VITE_SCANNER_STORE_ID env var not set");
  return storeId;
}

export type ServerCartItem = {
  id: string;
  cart_id: string;
  bottle_id: string;
  mlcc_item_id: string | null;
  quantity: number;
  store_id: string;
};

export type ServerCart = {
  id: string;
  store_id: string;
  status: string;
};

export type AddCartLineResult =
  | { ok: true; cart: ServerCart; item: ServerCartItem }
  | { ok: false; error: string; details?: unknown };

export async function addCartLine(args: {
  mlccCode: string;
  quantity: number;
}): Promise<AddCartLineResult> {
  const storeId = getStoreId();
  const url = `${CART_API_BASE}/${encodeURIComponent(storeId)}/items`;
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mlccCode: args.mlccCode,
          quantity: args.quantity,
        }),
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 12_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok || raw.success !== true) {
    const err =
      typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: err, details: raw.details };
  }
  return {
    ok: true,
    cart: raw.cart as ServerCart,
    item: raw.item as ServerCartItem,
  };
}

export type GetActiveCartResult =
  | { ok: true; cart: ServerCart | null; items: ServerCartItem[] }
  | { ok: false; error: string };

export async function getActiveCart(): Promise<GetActiveCartResult> {
  const storeId = getStoreId();
  const url = `${CART_API_BASE}/${encodeURIComponent(storeId)}`;
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: {
          ...getAuthHeaders(),
        },
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 8000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok || raw.success !== true) {
    const err =
      typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: err };
  }
  return {
    ok: true,
    cart: (raw.cart as ServerCart | null) ?? null,
    items: Array.isArray(raw.items) ? (raw.items as ServerCartItem[]) : [],
  };
}
