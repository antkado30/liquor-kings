/**
 * Admin → API client for the LK Founder Console (task #81, 2026-06-06).
 *
 * Single call to /admin/founder-console returns the company-wide
 * aggregate snapshot powering Tony's god-view dashboard.
 */

const BASE = "/admin";

export type FounderConsoleData = {
  generated_at: string;
  stores: {
    total: number;
    active: number;
    new_today: number;
    new_this_week: number;
    new_this_month: number;
  };
  users: {
    active: number;
  };
  runs: {
    last_24h_total: number;
    last_24h_failed: number;
    success_rate_pct: number | null;
  };
  activity: {
    confirmations_last_7d: number;
    gmv_last_7d_usd: number;
    active_stores_last_7d: number;
  };
  financials: {
    estimated_mrr_usd: number;
    price_per_store_usd: number;
  };
  recent_stores: Array<{
    id: string;
    store_name: string;
    liquor_license: string;
    mlcc_username: string;
    is_active: boolean;
    created_at: string;
    mlcc_credentials_last_verified_at: string | null;
  }>;
  recent_failures: Array<{
    id: string;
    store_id: string | null;
    store_name: string;
    status: string;
    failure_type: string | null;
    error_message: string | null;
    finished_at: string | null;
    worker_notes: string | null;
  }>;
};

export type SystemHealth = {
  status: "ok" | "degraded";
  reasons: string[];
  checks: {
    queued: number;
    running: number;
    stuck: number;
    runs24h: number;
    failed24h: number;
    succeeded24h: number;
    failureRatePct: number;
  };
  recentFailures: Array<{
    id: string;
    store_id: string | null;
    store_name: string;
    failure_type: string | null;
    error_message: string | null;
    finished_at: string | null;
  }>;
  generatedAt: string;
};

function authHeaders(): Record<string, string> {
  const token = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined)?.trim();
  return token ? { "X-Admin-Token": token } : {};
}

export async function fetchFounderConsole(): Promise<
  | { ok: true; data: FounderConsoleData }
  | { ok: false; error: string }
> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/founder-console`, {
      credentials: "same-origin",
      headers: authHeaders(),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let raw: { ok?: boolean; error?: string; [k: string]: unknown };
  try {
    raw = (await res.json()) as typeof raw;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok || raw.ok !== true) {
    return { ok: false, error: raw.error ?? `HTTP ${res.status}` };
  }
  const { ok: _, ...rest } = raw;
  return { ok: true, data: rest as unknown as FounderConsoleData };
}

/**
 * System health — one call answering "is everything OK right now?" (stuck
 * runs, queue backlog, 24h failure rate). Powers the health strip at the top
 * of the console so a degraded system is impossible to miss.
 */
export async function fetchSystemHealth(): Promise<
  { ok: true; data: SystemHealth } | { ok: false; error: string }
> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/health`, {
      credentials: "same-origin",
      headers: authHeaders(),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let raw: { ok?: boolean; error?: string; [k: string]: unknown };
  try {
    raw = (await res.json()) as typeof raw;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok || raw.ok !== true) {
    return { ok: false, error: raw.error ?? `HTTP ${res.status}` };
  }
  const { ok: _, ...rest } = raw;
  return { ok: true, data: rest as unknown as SystemHealth };
}
