/** Paths are relative; Vite dev proxies /operator-review → API (session cookies). */

import { fetchWithRetry } from "./fetchWithRetry";

const BASE = "/operator-review";

export async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * AUDIT #28 (P1, §6, 2026-06-13): this is the call OperatorSessionContext's
 * loadSession() makes on EVERY app boot. A stalled response used to leave
 * AppShell stuck on "Checking session…" forever (loadSession's `finally`
 * never ran). Now timed out + retried once so the boot path always resolves.
 */
export async function getSession(): Promise<Response> {
  return fetchWithRetry(
    `${BASE}/session`,
    { credentials: "same-origin" },
    { maxRetries: 2, timeoutMs: 10000 },
  );
}

export async function postSession(body: {
  accessToken: string;
  storeId?: string | null;
}): Promise<Response> {
  return fetchWithRetry(
    `${BASE}/session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    },
    { maxRetries: 1, timeoutMs: 10000 },
  );
}

export async function patchSessionStore(storeId: string): Promise<Response> {
  return fetchWithRetry(
    `${BASE}/session/store`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ storeId }),
    },
    { maxRetries: 1, timeoutMs: 10000 },
  );
}

export async function deleteSession(): Promise<Response> {
  return fetchWithRetry(
    `${BASE}/session`,
    { method: "DELETE", credentials: "same-origin" },
    { maxRetries: 1, timeoutMs: 10000 },
  );
}

export async function getRuns(query: string): Promise<Response> {
  const q = query ? `?${query}` : "";
  return fetchWithRetry(
    `${BASE}/api/runs${q}`,
    {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    },
    { maxRetries: 2, timeoutMs: 15000 },
  );
}

export async function getReviewBundle(runId: string): Promise<Response> {
  return fetchWithRetry(
    `${BASE}/api/runs/${encodeURIComponent(runId)}/review-bundle`,
    {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    },
    { maxRetries: 2, timeoutMs: 15000 },
  );
}

export async function postRunAction(
  runId: string,
  body: { action: string; reason: string | null; note: string | null },
): Promise<Response> {
  return fetchWithRetry(
    `${BASE}/api/runs/${encodeURIComponent(runId)}/actions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    },
    { maxRetries: 1, timeoutMs: 15000 },
  );
}

/** Operator session required. Query: days, diag_limit, run_limit (optional). */
export async function getDiagnosticsOverview(query?: string): Promise<Response> {
  const q = query && query.length > 0 ? `?${query}` : "";
  return fetchWithRetry(
    `${BASE}/api/diagnostics/overview${q}`,
    {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    },
    { maxRetries: 2, timeoutMs: 15000 },
  );
}

export async function getPilotOpsStores(query?: string): Promise<Response> {
  const q = query && query.length > 0 ? `?${query}` : "";
  return fetchWithRetry(
    `${BASE}/api/pilot-ops/stores${q}`,
    {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    },
    { maxRetries: 2, timeoutMs: 15000 },
  );
}

export async function getPilotOpsStoreOverview(
  storeId: string,
  query?: string,
): Promise<Response> {
  const q = query && query.length > 0 ? `?${query}` : "";
  return fetchWithRetry(
    `${BASE}/api/pilot-ops/stores/${encodeURIComponent(storeId)}${q}`,
    {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    },
    { maxRetries: 2, timeoutMs: 15000 },
  );
}

export async function patchPilotOpsStoreWorkflowState(
  storeId: string,
  body: {
    pilot_ops_status: "unreviewed" | "watching" | "escalated" | "resolved";
    operator_note?: string | null;
  },
): Promise<Response> {
  return fetchWithRetry(
    `${BASE}/api/pilot-ops/stores/${encodeURIComponent(storeId)}/workflow-state`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { maxRetries: 1, timeoutMs: 10000 },
  );
}

export async function getPilotOpsNotifications(query?: string): Promise<Response> {
  const q = query && query.length > 0 ? `?${query}` : "";
  return fetchWithRetry(
    `${BASE}/api/pilot-ops/notifications${q}`,
    {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    },
    { maxRetries: 2, timeoutMs: 15000 },
  );
}

export async function getPilotOpsQualitySummary(query?: string): Promise<Response> {
  const q = query && query.length > 0 ? `?${query}` : "";
  return fetchWithRetry(
    `${BASE}/api/pilot-ops/quality-summary${q}`,
    {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    },
    { maxRetries: 2, timeoutMs: 15000 },
  );
}
