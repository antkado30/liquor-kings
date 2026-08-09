/**
 * Billing API client (M4 client, 2026-08-09).
 *   GET  /billing/status            → trial/billing state for Settings
 *   POST /billing/checkout-session  → Stripe Checkout URL
 * Mirrors the me.ts auth pattern (bearer + X-Store-Id, bounded fetch).
 */

import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";
import type { BillingStatusPayload } from "../lib/billingCopy";

export type BillingStatusResult =
  | ({ ok: true } & BillingStatusPayload)
  | { ok: false; error: string };

async function authHeaders(): Promise<Record<string, string> | null> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) return null;
  return { Authorization: `Bearer ${bearer}`, "X-Store-Id": storeId };
}

export async function getBillingStatus(): Promise<BillingStatusResult> {
  const headers = await authHeaders();
  if (!headers) return { ok: false, error: "Not signed in" };

  let res: Response;
  try {
    res = await fetchWithRetry(
      "/billing/status",
      { method: "GET", headers },
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 8_000 },
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
  const states = new Set([
    "grandfathered",
    "trial",
    "trial_expired",
    "active",
    "past_due",
    "canceled",
  ]);
  const state = states.has(String(raw.state))
    ? (raw.state as BillingStatusPayload["state"])
    : "unknown";
  return {
    ok: true,
    state,
    days_left: typeof raw.days_left === "number" ? raw.days_left : null,
    configured: raw.configured === true,
    blocked: raw.blocked === true,
  };
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function createCheckoutSession(): Promise<CheckoutResult> {
  const headers = await authHeaders();
  if (!headers) return { ok: false, error: "Not signed in" };

  let res: Response;
  try {
    res = await fetchWithRetry(
      "/billing/checkout-session",
      { method: "POST", headers },
      { maxRetries: 1, timeoutMs: 15_000 },
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
  if (!res.ok || raw.ok !== true || typeof raw.url !== "string") {
    return {
      ok: false,
      error: typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`,
    };
  }
  return { ok: true, url: raw.url };
}
