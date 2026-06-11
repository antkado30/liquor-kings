/**
 * Scanner ↔ /auth/me/stores — multi-store list + add-store (V1).
 *
 * GET  — stores linked to the signed-in owner (switcher UI).
 * POST — register another store under the same owner account.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";
import { humanizeNetworkError } from "./me";

const BASE = "/auth/me/stores";

export type StoreListItem = {
  store_id: string;
  store_name: string;
  license_tail: string | null;
};

export type GetMyStoresResult =
  | { ok: true; stores: StoreListItem[] }
  | { ok: false; error: string };

export type CreateStorePayload = {
  store_name: string;
  liquor_license: string;
  mlcc_username: string;
  mlcc_password: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
};

export type CreateStoreResult =
  | { ok: true; store_id: string; store_name: string }
  | { ok: false; error: string };

export async function getMyStores(): Promise<GetMyStoresResult> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }

  let res: Response;
  try {
    res = await fetchWithRetry(
      BASE,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
        },
      },
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 8_000 },
    );
  } catch (e) {
    return {
      ok: false,
      error: humanizeNetworkError(
        e instanceof Error ? e.message : String(e),
      ),
    };
  }

  if (await handleAuthFailure(res)) {
    return { ok: false, error: "session_expired" };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: humanizeNetworkError("network_error") };
  }

  if (!res.ok || raw.ok !== true) {
    const err =
      typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: humanizeNetworkError(err) };
  }

  const rows = Array.isArray(raw.stores) ? raw.stores : [];
  const stores: StoreListItem[] = rows
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        store_id: String(row.store_id ?? ""),
        store_name: String(row.store_name ?? ""),
        license_tail:
          row.license_tail == null ? null : String(row.license_tail),
      };
    })
    .filter((s) => s.store_id.length > 0);

  return { ok: true, stores };
}

export async function createStore(
  payload: CreateStorePayload,
): Promise<CreateStoreResult> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }

  const body: Record<string, string> = {
    store_name: payload.store_name.trim(),
    liquor_license: payload.liquor_license.trim(),
    mlcc_username: payload.mlcc_username.trim(),
    mlcc_password: payload.mlcc_password,
  };
  if (payload.address_line1?.trim()) {
    body.address_line1 = payload.address_line1.trim();
  }
  if (payload.city?.trim()) body.city = payload.city.trim();
  if (payload.state?.trim()) body.state = payload.state.trim();
  if (payload.postal_code?.trim()) {
    body.postal_code = payload.postal_code.trim();
  }

  let res: Response;
  try {
    res = await fetchWithRetry(
      BASE,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { maxRetries: 1, baseDelayMs: 500, timeoutMs: 12_000 },
    );
  } catch (e) {
    return {
      ok: false,
      error: humanizeNetworkError(
        e instanceof Error ? e.message : String(e),
      ),
    };
  }

  if (await handleAuthFailure(res)) {
    return { ok: false, error: "session_expired" };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: humanizeNetworkError(`HTTP ${res.status}`) };
  }

  if (!res.ok || raw.ok !== true) {
    const err = typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: humanizeCreateStoreError(err) };
  }

  const id = typeof raw.store_id === "string" ? raw.store_id : "";
  if (!id) {
    return { ok: false, error: "Invalid response from server." };
  }

  return {
    ok: true,
    store_id: id,
    store_name:
      typeof raw.store_name === "string" ? raw.store_name : body.store_name,
  };
}

export function humanizeCreateStoreError(code: string): string {
  switch (code) {
    case "license_already_registered":
      return "That license is already registered to an account. Sign in to that store or use a different license number.";
    case "liquor_license_invalid":
      return "Liquor license must be 5–10 digits.";
    case "mlcc_credentials_required":
      return "MLCC username and password are required.";
    case "store_name_required":
      return "Store name is required.";
    case "credential_encryption_failed":
      return "We couldn't securely save your MLCC credentials. Please try again.";
    case "owner_session_required":
      return "Sign in with your owner account to add a store.";
    default:
      return humanizeNetworkError(code);
  }
}
