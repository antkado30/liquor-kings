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
  // Accepts a single data URI (legacy) OR an array (2026-07-17, multi-photo).
  images?: string | string[],
  history?: { role: "user" | "assistant"; content: string }[],
): Promise<AssistantResult> {
  const trimmed = question.trim();
  const imageList = (Array.isArray(images) ? images : images ? [images] : [])
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter((u) => u.length > 0);
  if (!trimmed && imageList.length === 0) {
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
          // Always send the plural; server keeps singular back-compat too.
          ...(imageList.length ? { imageDataUris: imageList } : {}),
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
  /** Family identity (2026-07-24, size flip): same key = same product line. */
  family_key?: string | null;
}

/** One line from the chat's resolve_bottles tool (in-chat add-to-cart card). */
export interface ResolvedOrderLine {
  requested: { name: string; size: string | null; qty: number | null; raw?: string };
  confidence: "high" | "medium" | "review" | "none";
  best: ResolvedCandidate | null;
  alternates: ResolvedCandidate[];
  match_count: number;
  /** Size honesty (2026-07-23): the requested size doesn't exist for this
      product — `best` is a DIFFERENT size. The card must say so loudly. */
  size_mismatch?: boolean;
  requested_size_ml?: number | null;
  size_note?: string;
  /** Case intent (2026-07-23): the line said "case" — suggested_qty is one
      full case of the matched bottle. The card prefills qty with it. */
  case_intent?: boolean;
  suggested_qty?: number;
  qty_note?: string;
  /** Store memory (2026-07-24, the moat): this store previously corrected
      this exact phrase — the match is their own saved choice, pinned. */
  remembered?: boolean;
  /** Size flip (2026-07-24): every size MLCC carries of the matched
      bottle's family — the card can flip the line between them. */
  sizes?: ResolvedCandidate[];
  /** 2026-07-25: the BRAND word matched nothing — the bottle is likely not
      in the current MLCC book; `best` is only the closest DIFFERENT product. */
  brand_absent?: boolean;
}

/** One learned correction: what the owner SAID → the code they chose. */
export interface AssistantMemoryCorrection {
  name: string;
  size?: string | null;
  raw?: string | null;
  mlcc_code: string;
}

/**
 * Teach the store's memory from resolve-card swaps (fire-and-forget — the
 * card never blocks add-to-cart on this). Every swap teaches silently
 * (Tony's call, 2026-07-24); next time the phrase pins "★ remembered".
 */
export async function recordAssistantMemory(
  corrections: AssistantMemoryCorrection[],
): Promise<void> {
  if (!corrections.length) return;
  let storeId: string | undefined;
  try {
    storeId = getStoreId();
  } catch {
    return; // no store in context — nothing to teach
  }
  try {
    await fetchWithRetry(
      "/assistant/memory",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, corrections }),
      },
      { maxRetries: 1, baseDelayMs: 500, timeoutMs: 10_000 },
    );
  } catch {
    // Silent by design: learning is a bonus; a miss costs one future swap.
  }
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
