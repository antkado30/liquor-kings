/**
 * M4 billing scaffold (2026-08-08) — Stripe with ZERO new dependencies.
 *
 * Terms locked 8/8: $149/store/month flat · 14-day free trial · no card
 * until the trial ends. Scan/browse/assistant stay free forever — ONLY
 * order execution (Check/Place) is ever gated.
 *
 * Talks to Stripe's REST API with bare fetch (form-encoded) and
 * verifies webhook signatures with node crypto — no `stripe` npm
 * package, so batch day adds no dependency risk.
 *
 * ENV (all three on the API Fly app; absent = billing OFF, fail-open):
 *   STRIPE_SECRET_KEY      sk_live_... / sk_test_...
 *   STRIPE_PRICE_ID        price_... ($149/mo recurring price)
 *   STRIPE_WEBHOOK_SECRET  whsec_... (from the webhook endpoint config)
 *
 * THE SAFETY LAWS (tested in test/billing.test.js):
 *   1. FAIL-OPEN: if isBillingConfigured() is false, nothing is ever
 *      blocked — the scaffold cannot lock out the pilot by existing.
 *   2. GRANDFATHER: trial_ends_at NULL (pilot-era stores, e.g. Colony)
 *      is never gated even with billing configured.
 *   3. GRACE: past_due does NOT gate (Stripe retries cards for days);
 *      only canceled and trial_expired-with-no-subscription gate.
 *   4. billing_status is written ONLY by the webhook handler — the
 *      client can never talk itself into 'active'.
 */

import crypto from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export function isBillingConfigured(env = process.env) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}

/**
 * Pure billing decision. `store` needs billing_status + trial_ends_at.
 * Returns { state, days_left, blocked } where `blocked` already folds
 * in the fail-open + grandfather laws.
 */
export function getBillingState(store, { nowMs = Date.now(), configured } = {}) {
  const isConfigured =
    configured === undefined ? isBillingConfigured() : configured;

  if (!store) return { state: "unknown", days_left: null, blocked: false };

  const status = store.billing_status ?? "trial";

  if (status === "active") {
    return { state: "active", days_left: null, blocked: false };
  }
  if (status === "past_due") {
    // Grace: Stripe's smart retries run for days. A store owner whose
    // card hiccuped should not lose Wednesday ordering. Stripe flips
    // the subscription to canceled if retries exhaust — THAT gates.
    return { state: "past_due", days_left: null, blocked: false };
  }
  if (status === "canceled") {
    return { state: "canceled", days_left: null, blocked: isConfigured };
  }

  // status === 'trial' (default)
  const endsAtRaw = store.trial_ends_at;
  if (!endsAtRaw) {
    // GRANDFATHER: pilot-era store — never gated.
    return { state: "grandfathered", days_left: null, blocked: false };
  }
  const endsAtMs = Date.parse(endsAtRaw);
  if (Number.isNaN(endsAtMs)) {
    // Unparseable timestamp: honesty over lockout — treat as
    // grandfathered and let a human notice via diagnostics.
    return { state: "grandfathered", days_left: null, blocked: false };
  }
  if (nowMs <= endsAtMs) {
    const days = Math.max(0, Math.ceil((endsAtMs - nowMs) / 86_400_000));
    return { state: "trial", days_left: days, blocked: false };
  }
  return { state: "trial_expired", days_left: 0, blocked: isConfigured };
}

/** Form-encode a flat object of bracketed Stripe keys. */
export function encodeStripeForm(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  return params.toString();
}

async function stripeRequest(path, fields, env = process.env) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeStripeForm(fields),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `stripe_http_${res.status}`;
    throw new Error(msg);
  }
  return body;
}

/** Create (or reuse) the Stripe customer for a store. Returns cus_ id. */
export async function ensureStripeCustomer(store, env = process.env) {
  if (store.stripe_customer_id) return store.stripe_customer_id;
  const customer = await stripeRequest(
    "/customers",
    {
      email: store.owner_email ?? undefined,
      name: store.store_name ?? store.name ?? undefined,
      "metadata[store_id]": store.id,
    },
    env,
  );
  return customer.id;
}

/**
 * Create a subscription Checkout Session for the $149/mo price.
 * client_reference_id carries the store id back on the webhook.
 */
export async function createCheckoutSession(
  { customerId, storeId, successUrl, cancelUrl },
  env = process.env,
) {
  return stripeRequest(
    "/checkout/sessions",
    {
      mode: "subscription",
      customer: customerId,
      client_reference_id: storeId,
      "line_items[0][price]": env.STRIPE_PRICE_ID,
      "line_items[0][quantity]": 1,
      "subscription_data[metadata][store_id]": storeId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    env,
  );
}

/**
 * Verify a Stripe webhook signature (Stripe-Signature header:
 * "t=<unix>,v1=<hmac>[,v1=...]"). HMAC-SHA256 of `${t}.${rawBody}`
 * with the webhook secret; constant-time compare; ±tolerance seconds.
 * Returns the parsed event on success, null on any failure.
 */
export function verifyStripeWebhook(
  rawBody,
  signatureHeader,
  secret,
  { nowMs = Date.now(), toleranceSec = 300 } = {},
) {
  if (!rawBody || !signatureHeader || !secret) return null;
  const parts = String(signatureHeader)
    .split(",")
    .map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1s = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || v1s.length === 0) return null;

  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return null;
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSec) return null;

  const payload = `${t}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const match = v1s.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, "utf8");
    return (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    );
  });
  if (!match) return null;

  try {
    return JSON.parse(String(rawBody));
  } catch {
    return null;
  }
}

/**
 * Map a Stripe subscription status string to our coarse billing_status.
 * Unknown statuses map to null (caller skips the write — never guess).
 */
export function mapSubscriptionStatus(stripeStatus) {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}
