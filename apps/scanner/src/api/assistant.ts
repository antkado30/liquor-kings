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

/**
 * Ask the Liquor Kings assistant a question.
 * storeId is included when available so store-scoped tools (order
 * history, inventory) work; without it, catalog/rules/pricing answers
 * still resolve fine.
 */
export async function askAssistant(
  question: string,
  imageDataUri?: string,
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
        }),
      },
      { maxRetries: 1, baseDelayMs: 600, timeoutMs: 30_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }

  if (!res.ok || typeof raw.answer !== "string") {
    const err = typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: err };
  }

  return {
    ok: true,
    answer: raw.answer,
    model: typeof raw.model === "string" ? raw.model : "",
  };
}
