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
  | { ok: true; answer: string; model: string; resolvedOrder?: ResolvedOrderLine[] }
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
  if (/timeout|timed out|abort/i.test(code)) {
    // "Fetch is aborted" is our own AbortController timeout firing — show
    // timeout copy, not the raw retry-wrapper text (Order Day 2026-07-16).
    return "The request timed out. Try again — or use Paste an order for long lists.";
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
      // 90s (was 30s — Order Day 2026-07-16): a long pasted order sends the
      // tool-use loop through multiple Anthropic calls + resolve_bottles, which
      // routinely runs past 30s. The 30s AbortController was killing its own
      // request ("Fetch is aborted") on every big paste. maxRetries stays 1 —
      // never re-fire an LLM run that's still working server-side.
      { maxRetries: 1, baseDelayMs: 600, timeoutMs: 90_000 },
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

  // If the assistant resolved specific bottles, surface them so the chat can
  // render an inline "Add to cart" card.
  let resolvedOrder: ResolvedOrderLine[] | undefined;
  const toolCalls = Array.isArray(raw.toolCalls)
    ? (raw.toolCalls as Array<{ tool?: string; result?: { results?: ResolvedOrderLine[] } }>)
    : [];
  const rb = [...toolCalls].reverse().find((t) => t?.tool === "resolve_bottles");
  if (rb?.result?.results && Array.isArray(rb.result.results) && rb.result.results.length > 0) {
    resolvedOrder = rb.result.results;
  }

  return {
    ok: true,
    answer: raw.answer,
    model: typeof raw.model === "string" ? raw.model : "",
    ...(resolvedOrder ? { resolvedOrder } : {}),
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
  /** Identity truth (2026-07-12): the verify card must distinguish a
      12-pack from a single and plastic from glass BEFORE add-to-cart. */
  container?: string | null;
  pack_count?: number | null;
}

/** One line from the chat's resolve_bottles tool (in-chat add-to-cart card). */
export interface ResolvedOrderLine {
  requested: { name: string; size: string | null; qty: number | null };
  confidence: "high" | "medium" | "review" | "none";
  best: ResolvedCandidate | null;
  alternates: ResolvedCandidate[];
  match_count: number;
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
      // 60s (was 30s — Order Day 2026-07-16): resolve-order is DB-only (no
      // LLM) and normally finishes in seconds; the extra headroom covers a
      // cold machine + a 40-line paste without the client aborting.
      { maxRetries: 1, baseDelayMs: 600, timeoutMs: 60_000 },
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
