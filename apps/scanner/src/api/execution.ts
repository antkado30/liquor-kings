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
import { getCurrentStoreId } from "../lib/currentStore";

const EXECUTION_API_BASE = "/execution-runs";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer) {
    throw new Error(
      "Scanner is not signed in. Sign in via the login screen before triggering RPA runs.",
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

function getStoreId(): string {
  const storeId = getCurrentStoreId();
  if (!storeId)
    throw new Error("No active store. Sign in or complete signup first.");
  return storeId;
}

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Mode passed to /execution-runs/from-cart. Phase 1 Week 1 of V1 roadmap
 * (2026-05-30) introduced "validate_only" so the scanner can mirror MLCC's
 * actual flow: user clicks Validate → backend runs Stages 1-4 against
 * MILO → returns live cart state (in-stock / out-of-stock / totals)
 * without ever entering Stage 5. After review the user clicks Submit
 * separately, which triggers a "rpa_run" run for the real checkout.
 */
export type RunMode = "rpa_run" | "validate_only" | "submit";

/**
 * Live cart state surfaced by the backend after a validate_only run
 * finalizes. Captured from MILO directly via Stages 1-4 and lifted into
 * the run summary so the scanner can render it without an extra fetch.
 */
export type ValidateResult = {
  validated: boolean | null;
  can_checkout: boolean | null;
  ada_breakdown:
    | Array<{
        adaNumber?: string;
        adaName?: string;
        items?: Array<unknown>;
        liters?: number;
        meetsMinimum?: boolean;
      }>
    | null;
  order_summary: {
    grossTotal?: number;
    liquorTax?: number;
    discount?: number;
    netTotal?: number;
  } | null;
  items_added: Array<unknown> | null;
  items_rejected: Array<unknown> | null;
  out_of_stock_items: Array<{
    code?: string;
    productName?: string;
    quantity?: number;
    reason?: string;
  }> | null;
  validate_messages: string[] | null;
  validate_errors: string[] | null;
};

export type RunSummary = {
  id: string;
  status: RunStatus;
  progress_stage: string | null;
  progress_message: string | null;
  failure_type: string | null;
  /** Raw failure detail from the worker — server has sent this all along;
   * the client used to drop it (fixed 2026-06-12, quality mandate). */
  failure_message?: string | null;
  timestamps?: {
    queued_at?: string | null;
    started_at?: string | null;
    heartbeat_at?: string | null;
    finished_at?: string | null;
  };
  /**
   * Populated by the backend ONLY when this run was a validate_only
   * pipeline AND it reached the validate_only_complete step. Null in
   * every other case (rpa_run runs, in-flight validate_only, failed
   * validate_only that never reached Stage 4).
   */
  validate_result?: ValidateResult | null;
  /**
   * Populated for terminal rpa_run (submit) pipelines from the worker's
   * rpa_run_summary evidence (audit #15, 2026-06-12). `submitted` is the
   * ONLY trustworthy signal that a real MILO order was placed — a run can
   * finalize "succeeded" in dry_run mode when the triple gate downgrades
   * it. The UI must never claim "order submitted" without this.
   */
  submit_result?: SubmitResult | null;
};

export type SubmitResult = {
  mode: string | null;
  submitted: boolean;
  confirmation_numbers: string[] | null;
  dry_run_reason: string | null;
};

export type TriggerRpaRunResult =
  | { ok: true; runId: string; status: RunStatus }
  | { ok: false; error: string };

export async function triggerRpaRunFromCart(args: {
  cartId: string;
  /**
   * Optional. Defaults to "rpa_run" to preserve existing callers.
   * Pass "validate_only" to run Stages 1-4 only (no checkout).
   */
  mode?: RunMode;
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
        body: JSON.stringify({ mode: args.mode ?? "rpa_run" }),
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
  /**
   * Onboarding activation override (task #84). When set, sends this
   * value as X-Store-Id instead of the build-time scanner store id.
   * Required for polling activation runs of brand-new signups whose
   * store doesn't match VITE_SCANNER_STORE_ID.
   */
  overrideStoreId?: string;
}): Promise<GetRunSummaryResult> {
  const url = `${EXECUTION_API_BASE}/${encodeURIComponent(args.runId)}/summary`;
  let res: Response;
  let headers: Record<string, string>;
  if (args.overrideStoreId) {
    const bearer = await getAuthBearer();
    if (!bearer) return { ok: false, error: "no_session" };
    headers = {
      Authorization: `Bearer ${bearer}`,
      "X-Store-Id": args.overrideStoreId,
    };
  } else {
    headers = await getAuthHeaders();
  }
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers,
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

/**
 * Trigger a cart_reset_only execution run (task #57, 2026-06-04).
 * Logs in to MILO and clears the cart server-side via RPA. Poll with
 * getRunSummary({ runId }) until isTerminalStatus(status) is true.
 *
 * @param overrideStoreId — Optional. When provided, used instead of
 *   the build-time VITE_SCANNER_STORE_ID. Required for the onboarding
 *   activation flow (task #84, 2026-06-06): brand-new signups need to
 *   probe THEIR newly-created store, not the build-time store.
 *   IMPORTANT: when overrideStoreId is set we also skip sending the
 *   X-Store-Id header — `resolveAuthenticatedStore` middleware would
 *   reject the call as "Not a member of specified store" if the
 *   header pointed at the wrong store (the build-time one).
 */
export async function triggerMlccCartReset(
  overrideStoreId?: string,
): Promise<TriggerRpaRunResult> {
  const storeId = overrideStoreId ?? getStoreId();
  const url = `${EXECUTION_API_BASE}/cart-reset/${encodeURIComponent(storeId)}`;
  // Build headers. For the override path we must NOT send X-Store-Id
  // because the scanner's build-time VITE_SCANNER_STORE_ID points at a
  // different store and the middleware compares header → membership.
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (overrideStoreId) {
    const bearer = await getAuthBearer();
    if (!bearer) return { ok: false, error: "no_session" };
    baseHeaders.Authorization = `Bearer ${bearer}`;
    baseHeaders["X-Store-Id"] = overrideStoreId;
  } else {
    Object.assign(baseHeaders, await getAuthHeaders());
  }
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: baseHeaders,
        body: "{}",
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

export interface RecoverStoreResult {
  ok: boolean;
  recovered?: string[];
  stillLive?: Array<{ id: string; reason: string }>;
  error?: string;
}

/**
 * "Start over" escape hatch (2026-06-25). Asks the server to free THIS store
 * from a confirmed-dead (stale-heartbeat) run so the user isn't trapped behind
 * a wedged validate. Safe server-side: never kills a live or submitting run, so
 * it's safe to call even if the run turns out to be fine (it just no-ops).
 */
export async function recoverStore(): Promise<RecoverStoreResult> {
  const storeId = getStoreId();
  const url = `${EXECUTION_API_BASE}/recover/${encodeURIComponent(storeId)}`;
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: "{}",
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
  if (!res.ok || raw.ok !== true) {
    const err = typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: err };
  }
  return {
    ok: true,
    recovered: Array.isArray(raw.recovered) ? (raw.recovered as string[]) : [],
    stillLive: Array.isArray(raw.stillLive)
      ? (raw.stillLive as Array<{ id: string; reason: string }>)
      : [],
  };
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
