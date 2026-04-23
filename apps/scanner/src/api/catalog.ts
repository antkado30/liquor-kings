/**
 * Scanner → price-book API client.
 *
 * Client env:
 * - VITE_UPC_CONFIRM_TOKEN — optional Bearer token for POST /price-book/upc/:upc/confirm
 *
 * Server-side counterparts (documented on API): LK_CONFIDENT_MIN, LK_ADMIN_TOKEN, etc.
 */
import type { MlccProduct, ProductFamily, UpcCandidateScore, UpcLookupResponse } from "../types";

const BASE = "/price-book";

type FetchRetryConfig = {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  config?: FetchRetryConfig,
): Promise<Response> {
  const maxRetries = config?.maxRetries ?? 3;
  const baseDelayMs = config?.baseDelayMs ?? 1000;
  const timeoutMs = config?.timeoutMs ?? 8000;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status >= 400 && res.status < 500) {
        return res;
      }
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < maxRetries - 1) {
          const waitMs = baseDelayMs * 2 ** attempt;
          if (import.meta.env.DEV) {
            console.log("[catalog][retry]", JSON.stringify({ url, attempt, waitMs, status: res.status }));
          }
          await delay(waitMs);
          continue;
        }
        throw new Error(`Network error after ${maxRetries} retries`);
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < maxRetries - 1) {
        const waitMs = baseDelayMs * 2 ** attempt;
        if (import.meta.env.DEV) {
          console.log("[catalog][retry]", JSON.stringify({ url, attempt, waitMs, network: true }));
        }
        await delay(waitMs);
        continue;
      }
    }
  }
  throw new Error(
    `Network error after ${maxRetries} retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mapRow(row: Record<string, unknown>): MlccProduct {
  const imageUrlRaw = row.imageUrl ?? row.image_url;
  const imageUrl =
    imageUrlRaw != null && String(imageUrlRaw).trim() !== "" ? String(imageUrlRaw).trim() : null;
  return {
    id: String(row.id ?? ""),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    brand_family: str(row.brand_family),
    category: str(row.category),
    ada_number: str(row.ada_number) ?? "",
    ada_name: str(row.ada_name) ?? "",
    proof: num(row.proof),
    bottle_size_label: str(row.bottle_size_label),
    bottle_size_ml: num(row.bottle_size_ml) != null ? Math.round(Number(row.bottle_size_ml)) : null,
    case_size: num(row.case_size) != null ? Math.round(Number(row.case_size)) : null,
    licensee_price: num(row.licensee_price),
    min_shelf_price: num(row.min_shelf_price),
    base_price: num(row.base_price),
    is_new_item: Boolean(row.is_new_item),
    imageUrl,
  };
}

export async function searchProducts(
  query: string,
  options?: { adaNumber?: string; limit?: number },
): Promise<MlccProduct[]> {
  const limit = options?.limit ?? 20;
  const params = new URLSearchParams();
  params.set("search", query);
  params.set("limit", String(limit));
  params.set("page", "1");
  if (options?.adaNumber) params.set("adaNumber", options.adaNumber);
  const res = await fetchWithRetry(`${BASE}/items?${params.toString()}`, { credentials: "same-origin" });
  const data = (await res.json()) as { ok?: boolean; items?: unknown[] };
  if (!res.ok || !data.ok || !Array.isArray(data.items)) return [];
  return data.items.map((r) => mapRow(r as Record<string, unknown>));
}

function mapUpcLookupBody(raw: Record<string, unknown>, resOk: boolean): UpcLookupResponse {
  const out: UpcLookupResponse = {
    ok: Boolean(raw.ok),
    matchMode:
      raw.matchMode === "confident" || raw.matchMode === "ambiguous"
        ? raw.matchMode
        : undefined,
    needsUserConfirmation: Boolean(raw.needsUserConfirmation),
    message:
      raw.message != null && String(raw.message).trim() !== "" ? String(raw.message) : undefined,
    error: raw.error != null ? String(raw.error) : undefined,
    productName: raw.productName != null ? String(raw.productName) : undefined,
    upcProductNameRaw: raw.upcProductNameRaw != null ? String(raw.upcProductNameRaw) : undefined,
    hint: raw.hint != null ? String(raw.hint) : undefined,
    upcProductName: raw.upcProductName != null ? String(raw.upcProductName) : undefined,
    upcBrand: raw.upcBrand != null ? String(raw.upcBrand) : undefined,
    confidenceWarning:
      raw.confidenceWarning != null ? String(raw.confidenceWarning) : undefined,
    cached: typeof raw.cached === "boolean" ? raw.cached : undefined,
    cacheQuality:
      raw.cacheQuality === "high" || raw.cacheQuality === "provisional"
        ? raw.cacheQuality
        : undefined,
    source: raw.source != null ? String(raw.source) : undefined,
    confidenceSource:
      raw.confidenceSource != null ? String(raw.confidenceSource) : undefined,
    scanCount:
      raw.scanCount != null && Number.isFinite(Number(raw.scanCount))
        ? Math.round(Number(raw.scanCount))
        : undefined,
    upc: raw.upc != null && String(raw.upc).trim() !== "" ? String(raw.upc).trim() : undefined,
  };
  if (raw.confidenceScore != null) {
    const n = Number(raw.confidenceScore);
    if (Number.isFinite(n)) out.confidenceScore = Math.round(n);
  }
  if (raw.scoringBreakdown != null && typeof raw.scoringBreakdown === "object" && !Array.isArray(raw.scoringBreakdown)) {
    const b = raw.scoringBreakdown as Record<string, unknown>;
    const breakdown: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === "number" && Number.isFinite(v)) breakdown[k] = v;
      else if (typeof v === "string") breakdown[k] = v;
      else if (v === null) breakdown[k] = null;
      else if (typeof v === "boolean") breakdown[k] = v ? 1 : 0;
    }
    if (Object.keys(breakdown).length > 0) out.scoringBreakdown = breakdown;
  }
  if (Array.isArray(raw.allCandidateScores)) {
    out.allCandidateScores = raw.allCandidateScores.map((row): UpcCandidateScore | null => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const score = Number(o.score);
      return {
        code: String(o.code ?? ""),
        name: String(o.name ?? ""),
        score: Number.isFinite(score) ? score : 0,
        disqualified: Boolean(o.disqualified),
        reasons: Array.isArray(o.reasons) ? o.reasons.map((r) => String(r)) : [],
      };
    }).filter((x): x is UpcCandidateScore => x != null);
  }
  if (raw.product && typeof raw.product === "object") {
    out.product = mapRow(raw.product as Record<string, unknown>);
  }
  if (Array.isArray(raw.candidates)) {
    out.candidates = raw.candidates.map((c) => mapRow(c as Record<string, unknown>));
  }
  if (!resOk && !out.error) {
    out.ok = false;
    out.error = "network_error";
  }
  return out;
}

export async function getProductByUpc(upc: string): Promise<UpcLookupResponse> {
  const u = upc.trim();
  if (!u) return { ok: false, error: "invalid_upc" };
  const res = await fetchWithRetry(`${BASE}/upc/${encodeURIComponent(u)}`, { credentials: "same-origin" });
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "network_error" };
  }
  return mapUpcLookupBody(raw, res.ok);
}

export async function confirmUpcMapping(
  upc: string,
  mlccCode: string,
  upcProductName?: string,
  upcBrand?: string,
  confirmedBy?: string,
): Promise<MlccProduct | null> {
  const u = upc.trim();
  if (!u) return null;
  const token = import.meta.env.VITE_UPC_CONFIRM_TOKEN as string | undefined;
  /** @type {Record<string, string>} */
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token != null && String(token).trim() !== "") {
    const t = String(token).trim();
    headers.Authorization = t.startsWith("Bearer ") ? t : `Bearer ${t}`;
  }
  const body: Record<string, unknown> = { mlccCode, upcProductName, upcBrand };
  if (confirmedBy != null && String(confirmedBy).trim() !== "") {
    body.confirmedBy = String(confirmedBy).trim();
  }
  const res = await fetchWithRetry(`${BASE}/upc/${encodeURIComponent(u)}/confirm`, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; product?: unknown };
  if (!res.ok || !data.ok || !data.product || typeof data.product !== "object") return null;
  return mapRow(data.product as Record<string, unknown>);
}

export async function getProductByCode(mlccCode: string): Promise<MlccProduct | null> {
  const code = mlccCode.trim();
  if (!code) return null;
  const items = await searchProducts(code, { limit: 50 });
  const exact = items.find((i) => i.code === code);
  if (exact) return exact;
  if (/^\d+$/.test(code) && code.length >= 8) {
    const upcRes = await getProductByUpc(code);
    if (upcRes.ok && upcRes.product && !upcRes.needsUserConfirmation) return upcRes.product;
  }
  return null;
}

export async function flagIncorrectMatch(
  upc: string,
  reason: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const u = upc.trim();
  if (!u) return { ok: false, message: "Invalid UPC" };
  const res = await fetchWithRetry(`${BASE}/upc/${encodeURIComponent(u)}/flag`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  let raw: Record<string, unknown> = {};
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "Could not flag match right now, please try again" };
  }
  if (!res.ok || raw.ok !== true) {
    const err = raw.error != null ? String(raw.error) : "Could not flag match right now, please try again";
    return { ok: false, message: err };
  }
  return {
    ok: true,
    message:
      raw.message != null && String(raw.message).trim() !== ""
        ? String(raw.message)
        : "Match flagged thank you for helping improve the system",
  };
}

export async function reportUpcNoMatch(
  upc: string,
  upcProductName?: string,
  upcBrand?: string,
): Promise<boolean> {
  const u = upc.trim();
  if (!u) return false;
  try {
    const res = await fetchWithRetry(`${BASE}/upc/${encodeURIComponent(u)}/report-no-match`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upcProductName, upcBrand }),
    });
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(res.ok && data.ok);
  } catch {
    return false;
  }
}

export async function getProductFamily(mlccCode: string): Promise<ProductFamily | null> {
  const code = mlccCode.trim();
  if (!code) return null;
  const res = await fetchWithRetry(`${BASE}/items/${encodeURIComponent(code)}/family`, {
    credentials: "same-origin",
  });
  const data = (await res.json()) as {
    ok?: boolean;
    baseName?: unknown;
    sizes?: unknown[];
    error?: string;
  };
  if (!res.ok || !data.ok || !Array.isArray(data.sizes)) {
    return null;
  }
  const sizes = data.sizes.map((r) => mapRow(r as Record<string, unknown>));
  const baseName =
    typeof data.baseName === "string" && data.baseName.trim() !== ""
      ? data.baseName.trim()
      : sizes[0]?.name ?? "";
  return { baseName, sizes };
}

export type PriceBookStatusResponse = {
  ok: boolean;
  priceBookDate?: string | null;
  daysSinceUpdate?: number | null;
  status?: "fresh" | "aging" | "stale";
  latestRun?: unknown;
  error?: string;
};

export async function getPriceBookStatus(): Promise<PriceBookStatusResponse> {
  const res = await fetchWithRetry(`${BASE}/status`, { credentials: "same-origin" });
  try {
    const raw = (await res.json()) as PriceBookStatusResponse;
    if (!res.ok) return { ok: false, error: raw.error ?? "status_failed" };
    return raw;
  } catch {
    return { ok: false, error: "network_error" };
  }
}
