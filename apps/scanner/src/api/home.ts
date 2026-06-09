/**
 * Smart cards API client (task #63, 2026-06-02).
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

export type SmartCardKind =
  | "price_change"
  | "reorder_suggestion"
  | "price_book_stale";

export type SmartCard = {
  id: string;
  kind: SmartCardKind;
  title: string;
  body: string;
  productCode: string | null;
  priority: number;
  createdAt: string;
};

export type StoreVerificationMeta = {
  /** Store display name — for the pre-submit verification modal (#89). */
  store_name?: string | null;
  /** Liquor license # — for the pre-submit verification modal (#89). */
  liquor_license?: string | null;
  mlcc_credentials_last_verified_at: string | null;
};

export type GetSmartCardsResult =
  | {
      ok: true;
      cards: SmartCard[];
      store_meta?: StoreVerificationMeta;
    }
  | { ok: false; error: string };

export async function getSmartCards(): Promise<GetSmartCardsResult> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }
  let res: Response;
  try {
    res = await fetchWithRetry(
      "/home/smart-cards",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
        },
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 8_000 },
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
    cards: Array.isArray(raw.cards) ? (raw.cards as SmartCard[]) : [],
    store_meta:
      raw.store_meta && typeof raw.store_meta === "object"
        ? (raw.store_meta as StoreVerificationMeta)
        : undefined,
  };
}

/* ─── Analytics dashboard (task #77, 2026-06-06) ───────────────── */

export type AdaBreakdownRow = {
  ada_number: string;
  ada_name: string;
  net_total: number;
  orders: number;
};

export type TopSkuRow = {
  code: string;
  name: string;
  units: number;
  dollars: number;
  orders: number;
};

export type MoverRow = {
  code: string;
  name: string;
  this_week_units: number;
  avg_weekly_units: number;
  /** Percent change vs. trailing 4-week average. Positive = trending up. */
  change_pct: number;
};

export type AnalyticsDashboard = {
  generated_at: string;
  this_week: {
    starts_at: string;
    spend: number;
    order_count: number;
    bottle_count: number;
    ada_breakdown: AdaBreakdownRow[];
  };
  last_week: {
    starts_at: string;
    spend: number;
    order_count: number;
  };
  /** Null when last week's spend was 0 (can't compute percent change). */
  wow_change_pct: number | null;
  top_by_units: TopSkuRow[];
  top_by_dollars: TopSkuRow[];
  biggest_movers: MoverRow[];
};

export type GetAnalyticsResult =
  | { ok: true; data: AnalyticsDashboard }
  | { ok: false; error: string };

export async function getAnalytics(): Promise<GetAnalyticsResult> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }
  let res: Response;
  try {
    res = await fetchWithRetry(
      "/home/analytics",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
        },
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 8_000 },
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
  // Strip the ok field; the dashboard fields are at the response root.
  // Keeping the shape on the type avoids leaking `ok` into AnalyticsDashboard.
  const { ok: _ok, ...rest } = raw as { ok: boolean; [k: string]: unknown };
  return { ok: true, data: rest as unknown as AnalyticsDashboard };
}

/** Throws on failure — for useCachedResource fetchers. */
export async function fetchAnalyticsDashboard(): Promise<AnalyticsDashboard> {
  const r = await getAnalytics();
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** True when the store has no submitted order history in the lookback window. */
export function isAnalyticsEmpty(data: AnalyticsDashboard): boolean {
  return (
    data.this_week.order_count === 0 &&
    data.last_week.order_count === 0 &&
    data.top_by_units.length === 0 &&
    data.top_by_dollars.length === 0
  );
}
