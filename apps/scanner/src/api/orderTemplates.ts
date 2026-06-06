/**
 * Scanner → API client for order templates (task #72, 2026-06-04).
 *
 * Templates let the user save a recurring cart (e.g. dad's Thursday
 * weekly staples) and reload it later with one tap. Backend lives at
 * /order-templates and is gated by resolveAuthenticatedStore.
 */

import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

const BASE = "/order-templates";

async function authHeaders(): Promise<Record<string, string>> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    throw new Error("Not signed in");
  }
  return {
    Authorization: `Bearer ${bearer}`,
    "X-Store-Id": storeId,
  };
}

export type OrderTemplateItem = {
  mlcc_code: string;
  quantity: number;
  name?: string;
  bottle_size_ml?: number;
};

export type OrderTemplate = {
  id: string;
  name: string;
  items: OrderTemplateItem[];
  created_at: string;
  updated_at: string;
  last_loaded_at: string | null;
  is_archived: boolean;
  schedule_dow: number | null;
  schedule_time_local: string | null;
  last_scheduled_run_at: string | null;
  last_scheduled_load_consumed_at: string | null;
  /**
   * Computed server-side: true when the scheduler marked this template
   * "ready" more recently than the user loaded it. Drives the scanner
   * home banner.
   */
  needs_review: boolean;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function parseResponse<T>(
  res: Response,
  pluck: (raw: Record<string, unknown>) => T,
): Promise<Result<T>> {
  if (await handleAuthFailure(res)) {
    return { ok: false, error: "session_expired" };
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok || raw.ok !== true) {
    const err =
      typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: err };
  }
  return { ok: true, data: pluck(raw) };
}

export async function listOrderTemplates(): Promise<
  Result<OrderTemplate[]>
> {
  let res: Response;
  try {
    res = await fetchWithRetry(BASE, {
      headers: await authHeaders(),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return parseResponse(res, (raw) =>
    Array.isArray(raw.templates) ? (raw.templates as OrderTemplate[]) : [],
  );
}

export async function createOrderTemplate(args: {
  name: string;
  items: OrderTemplateItem[];
  schedule_dow?: number | null;
  schedule_time_local?: string | null;
}): Promise<Result<OrderTemplate>> {
  let res: Response;
  try {
    res = await fetchWithRetry(BASE, {
      method: "POST",
      headers: {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return parseResponse(res, (raw) => raw.template as OrderTemplate);
}

export async function updateOrderTemplate(
  id: string,
  patch: Partial<{
    name: string;
    items: OrderTemplateItem[];
    is_archived: boolean;
    schedule_dow: number | null;
    schedule_time_local: string | null;
  }>,
): Promise<Result<OrderTemplate>> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return parseResponse(res, (raw) => raw.template as OrderTemplate);
}

export async function archiveOrderTemplate(
  id: string,
): Promise<Result<{ archived: string | null }>> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return parseResponse(res, (raw) => ({
    archived: typeof raw.archived === "string" ? raw.archived : null,
  }));
}

/**
 * Loaded template payload. Backend hydrates each stored item with the
 * full mlcc_items product row so the client can call cart.addItem
 * directly without N+1 catalog fetches. missingCodes carries any
 * SKUs MLCC has dropped since the template was saved.
 */
export type LoadedTemplate = {
  template: { id: string; name: string };
  items: Array<{
    product: import("../types").MlccProduct;
    quantity: number;
  }>;
  missingCodes: Array<{
    code: string;
    quantity: number;
    name: string | null;
  }>;
};

/**
 * Marks the template as loaded (updates last_loaded_at) and returns
 * its items so the caller can add them to the cart.
 */
export async function loadOrderTemplate(
  id: string,
): Promise<Result<LoadedTemplate>> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE}/${encodeURIComponent(id)}/load`, {
      method: "POST",
      headers: await authHeaders(),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return parseResponse(res, (raw) => ({
    template: raw.template as { id: string; name: string },
    items: Array.isArray(raw.items)
      ? (raw.items as LoadedTemplate["items"])
      : [],
    missingCodes: Array.isArray(raw.missingCodes)
      ? (raw.missingCodes as LoadedTemplate["missingCodes"])
      : [],
  }));
}
