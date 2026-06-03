/**
 * Smart cards API client (task #63, 2026-06-02).
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";

export type SmartCardKind =
  | "price_change"
  | "reorder_suggestion"
  | "price_book_stale";

export type SmartCard = {
  id: string;
  kind: SmartCardKind;
  title: string;
  body: string;
  productCode: string | null;
  priority: number;
  createdAt: string;
};

export type GetSmartCardsResult =
  | { ok: true; cards: SmartCard[] }
  | { ok: false; error: string };

export async function getSmartCards(): Promise<GetSmartCardsResult> {
  const bearer = await getAuthBearer();
  const storeId = import.meta.env.VITE_SCANNER_STORE_ID as string | undefined;
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }
  let res: Response;
  try {
    res = await fetchWithRetry(
      "/home/smart-cards",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
        },
      },
      { maxRetries: 2, baseDelayMs: 500, timeoutMs: 8_000 },
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
    return {
      ok: false,
      error: typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`,
    };
  }
  return {
    ok: true,
    cards: Array.isArray(raw.cards) ? (raw.cards as SmartCard[]) : [],
  };
}
