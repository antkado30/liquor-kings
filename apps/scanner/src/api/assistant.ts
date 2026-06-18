/**
 * Scanner ↔ /assistant API client.
 *
 * Calls POST /assistant/ask — the Claude tool-use assistant grounded in
 * MLCC catalog, rules, pricing, and (when a store is in context) the
 * store's own order history + inventory.
 *
 * The backend endpoint is stateless: each call is one question. The chat
 * panel keeps the running conversation client-side for display only.
 */
import { fetchWithRetry } from "./catalog";
import { getStoreId } from "./cart";

export type AssistantResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; error: string };

/** Map raw API / network codes to copy suitable for the chat UI. */
export function formatAssistantError(raw: string): string {
  const code = raw.trim();
  if (!code) return "Something went wrong. Please try again.";
  if (code === "network_error") {
    return "Couldn't reach the assistant. Check your connection and try again.";
  }
  if (/^HTTP 5\d\d/.test(code) || code === "HTTP 500" || code === "HTTP 503") {
    return "The assistant is temporarily unavailable. Please try again.";
  }
  if (/timeout|timed out/i.test(code)) {
    return "The request timed out. Try again with a shorter question.";
  }
  return code;
}

/**
 * Ask the Liquor Kings assistant a question.
 * storeId is included when available so store-scoped tools (order
 * history, inventory) work; without it, catalog/rules/pricing answers
 * still resolve fine.
 */
export async function askAssistant(
  question: string,
  imageDataUri?: string,
  history?: { role: "user" | "assistant"; content: string }[],
): Promise<AssistantResult> {
  const trimmed = question.trim();
  const image =
    typeof imageDataUri === "string" && imageDataUri.trim().length > 0
      ? imageDataUri.trim()
      : undefined;
  if (!trimmed && !image) {
    return { ok: false, error: "Question or image is required." };
  }

  let storeId: string | undefined;
  try {
    storeId = getStoreId();
  } catch {
    storeId = undefined;
  }

  let res: Response;
  try {
    res = await fetchWithRetry(
      "/assistant/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          ...(storeId ? { storeId } : {}),
          ...(image ? { imageDataUri: image } : {}),
          ...(history && history.length ? { history } : {}),
        }),
      },
      { maxRetries: 1, baseDelayMs: 600, timeoutMs: 30_000 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: formatAssistantError(msg) };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: formatAssistantError("network_error") };
  }

  if (!res.ok || typeof raw.answer !== "string") {
    const err =
      typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: formatAssistantError(err) };
  }

  return {
    ok: true,
    answer: raw.answer,
    model: typeof raw.model === "string" ? raw.model : "",
  };
}

// ── Bulk order resolve (paste a list → MLCC codes) ─────────────────────────

export interface ResolvedCandidate {
  id: string;
  code: string;
  name: string;
  ada_number: string;
  ada_name: string | null;
  bottle_size_ml: number | null;
  bottle_size_label: string | null;
  case_size: number | null;
  licensee_price: number | null;
  proof: number | null;
  base_price: number | null;
  min_shelf_price: number | null;
}

export interface ResolvedLine {
  input: { name: string; size: string | null; qty: number | null };
  name: string;
  sizeMl: number | null;
  qty: number | null;
  best: ResolvedCandidate | null;
  alternates: ResolvedCandidate[];
  confidence: "high" | "medium" | "review" | "none";
  exactHit: boolean | null;
  total: number;
}

export type ResolveOrderResult =
  | { ok: true; lines: ResolvedLine[] }
  | { ok: false; error: string };

/** Resolve a free-text reorder list to MLCC codes for a verify-then-add flow. */
export async function resolveOrder(text: string): Promise<ResolveOrderResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Paste your order first." };

  let res: Response;
  try {
    res = await fetchWithRetry(
      "/assistant/resolve-order",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      },
      { maxRetries: 1, baseDelayMs: 600, timeoutMs: 30_000 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: formatAssistantError(msg) };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: formatAssistantError("network_error") };
  }

  if (!res.ok || !Array.isArray(raw.lines)) {
    const err = typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: formatAssistantError(err) };
  }

  return { ok: true, lines: raw.lines as ResolvedLine[] };
}
