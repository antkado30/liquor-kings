/** Paths are relative; Vite dev proxies /operator-review → API (session cookies). */

const BASE = "/operator-review";

export async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getSession(): Promise<Response> {
  return fetch(`${BASE}/session`, { credentials: "same-origin" });
}

export async function postSession(body: {
  accessToken: string;
  storeId?: string | null;
}): Promise<Response> {
  return fetch(`${BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
}

export async function patchSessionStore(storeId: string): Promise<Response> {
  return fetch(`${BASE}/session/store`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ storeId }),
  });
}

export async function deleteSession(): Promise<Response> {
  return fetch(`${BASE}/session`, { method: "DELETE", credentials: "same-origin" });
}

export async function getRuns(query: string): Promise<Response> {
  const q = query ? `?${query}` : "";
  return fetch(`${BASE}/api/runs${q}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
}

export async function getReviewBundle(runId: string): Promise<Response> {
  return fetch(`${BASE}/api/runs/${encodeURIComponent(runId)}/review-bundle`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
}

export async function postRunAction(
  runId: string,
  body: { action: string; reason: string | null; note: string | null },
): Promise<Response> {
  return fetch(`${BASE}/api/runs/${encodeURIComponent(runId)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
}

/** Operator session required. Query: days, diag_limit, run_limit (optional). */
export async function getDiagnosticsOverview(query?: string): Promise<Response> {
  const q = query && query.length > 0 ? `?${query}` : "";
  return fetch(`${BASE}/api/diagnostics/overview${q}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
}
