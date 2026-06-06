/**
 * Scanner ↔ /cart API client.
 *
 * AUTH: real Supabase Auth — the user signs in via AuthGate, and the JWT
 * lives in supabase.auth.getSession(). getAuthHeaders() reads it fresh on
 * every call (auto-refresh rotates it during long shifts). Store_id still
 * comes from VITE_SCANNER_STORE_ID for V1 (single-store deployment); the
 * server's resolveAuthenticatedStore middleware enforces the JWT's user
 * actually has membership in that store via the store_users table.
 *
 * Previous dev-bearer-with-service-role model is GONE — that key never
 * touches the client bundle anymore.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

export const CART_API_BASE = "/cart";

type AuthHeaders = {
  Authorization: string;
  "X-Store-Id": string;
};

/**
 * Async — must be awaited at every call site. Throws if there's no current
 * session (callers should not reach this if AuthGate is doing its job).
 *
 * Store id is resolved at RUNTIME from the user's store_users membership
 * (task #85, 2026-06-06). Previously read VITE_SCANNER_STORE_ID at build
 * time which 403'd every API call for any user whose membership store_id
 * didn't match the build-time value (i.e. every new SaaS signup).
 */
export async function getAuthHeaders(): Promise<AuthHeaders> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer) {
    throw new Error(
      "Scanner is not signed in. Sign in via the login screen before making API calls.",
    );
  }
  if (!storeId) {
    throw new Error(
      "Scanner is not linked to a store yet. Sign out and back in if this persists.",
    );
  }
  return {
    Authorization: `Bearer ${bearer}`,
    "X-Store-Id": storeId,
  };
}

export function getStoreId(): string {
  const storeId = getCurrentStoreId();
  if (!storeId)
    throw new Error("No active store. Sign in or complete signup first.");
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
          ...(await getAuthHeaders()),
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
  // JWT validity gate — if the API rejected our token, force sign-out so
  // AuthGate brings the user back to the login screen instead of silently
  // failing every subsequent call.
  if (await handleAuthFailure(res)) {
    return { ok: false, error: "session_expired" };
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
          ...(await getAuthHeaders()),
        },
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 8000 },
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

export type CartValidationResult =
  | {
      ok: true;
      valid: boolean;
      errors: Array<{
        code: string | number;
        reason: string;
        suggestedAlternatives?: number[];
      }>;
      adaBreakdown: Record<string, { liters: number; meetsMinimum: boolean }>;
      unknownCodes?: string[];
    }
  | { ok: false; error: string };

export async function validateCart(
  items: Array<{ code: string; quantity: number }>,
): Promise<CartValidationResult> {
  const url = `${CART_API_BASE}/${encodeURIComponent(getStoreId())}/validate`;
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          ...(await getAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items }),
      },
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
    const err = typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: err };
  }

  return {
    ok: true,
    valid: raw.valid === true,
    errors: Array.isArray(raw.errors)
      ? (raw.errors as Array<{
          code: string | number;
          reason: string;
          suggestedAlternatives?: number[];
        }>)
      : [],
    adaBreakdown:
      raw.adaBreakdown && typeof raw.adaBreakdown === "object"
        ? (raw.adaBreakdown as Record<string, { liters: number; meetsMinimum: boolean }>)
        : {},
    unknownCodes: Array.isArray(raw.unknownCodes) ? (raw.unknownCodes as string[]) : undefined,
  };
}
