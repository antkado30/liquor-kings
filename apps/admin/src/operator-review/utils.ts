export const CONFIRM_ACTIONS = new Set(["retry_now", "cancel", "resolve_without_retry"]);

export function buildQuery(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length > 0) p.set(k, v);
  }
  return p.toString();
}
