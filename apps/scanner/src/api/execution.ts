/**
 * Scanner ↔ /execution-runs API client.
 *
 * Triggers the same RPA pipeline that placed yesterday's first production
 * order. Default mode is dry_run (Stage 5 four-gate safety architecture
 * refuses checkout). Real submit comes later behind explicit env gates.
 *
 * AUTH: real Supabase Auth JWT — see apps/scanner/src/lib/supabase.ts.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";

const EXECUTION_API_BASE = "/execution-runs";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const bearer = await getAuthBearer();
  const storeId = import.meta.env.VITE_SCANNER_STORE_ID as string | undefined;
  if (!bearer) {
    throw new Error(
      "Scanner is not signed in. Sign in via the login screen before triggering RPA runs.",
    );
  }
  if (!storeId) {
    throw new Error(
      "Scanner is missing VITE_SCANNER_STORE_ID. Set it in apps/scanner/.env.",
    );
  }
  return {
    Authorization: `Bearer ${bearer}`,
    "X-Store-Id": storeId,
  };
}

function getStoreId(): string {
  const storeId = import.meta.env.VITE_SCANNER_STORE_ID as string | undefined;
  if (!storeId) throw new Error("VITE_SCANNER_STORE_ID env var not set");
  return storeId;
}

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RunSummary = {
  id: string;
  status: RunStatus;
  progress_stage: string | null;
  progress_message: string | null;
  failure_type: string | null;
  timestamps?: {
    queued_at?: string | null;
    started_at?: string | null;
    heartbeat_at?: string | null;
    finished_at?: string | null;
  };
};

export type TriggerRpaRunResult =
  | { ok: true; runId: string; status: RunStatus }
  | { ok: false; error: string };

export async function triggerRpaRunFromCart(args: {
  cartId: string;
}): Promise<TriggerRpaRunResult> {
  const storeId = getStoreId();
  const url = `${EXECUTION_API_BASE}/from-cart/${encodeURIComponent(storeId)}/${encodeURIComponent(args.cartId)}`;
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
        body: JSON.stringify({ mode: "rpa_run" }),
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 15_000 },
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
  const data = raw.data as Record<string, unknown> | undefined;
  if (!data || typeof data.id !== "string") {
    return { ok: false, error: "invalid_response_shape" };
  }
  return {
    ok: true,
    runId: data.id,
    status: (data.status as RunStatus) ?? "queued",
  };
}

export type GetRunSummaryResult =
  | { ok: true; summary: RunSummary }
  | { ok: false; error: string };

export async function getRunSummary(args: {
  runId: string;
}): Promise<GetRunSummaryResult> {
  const url = `${EXECUTION_API_BASE}/${encodeURIComponent(args.runId)}/summary`;
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
  return { ok: true, summary: raw.data as RunSummary };
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
