/**
 * M4 billing scaffold pins (2026-08-08). These test the SAFETY LAWS:
 * fail-open when unconfigured, grandfather for pilot-era stores,
 * past_due grace, and webhook signature honesty. Pure functions only —
 * no env, no network — so this file runs in the sandbox too.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeStripeForm,
  getBillingState,
  isBillingConfigured,
  mapSubscriptionStatus,
  verifyStripeWebhook,
} from "../src/lib/billing.js";

const NOW = Date.parse("2026-08-20T12:00:00Z");
const day = (n) => new Date(NOW + n * 86_400_000).toISOString();

describe("getBillingState — the safety laws", () => {
  it("LAW 1 fail-open: expired trial does NOT block when billing is unconfigured", () => {
    const s = getBillingState(
      { billing_status: "trial", trial_ends_at: day(-3) },
      { nowMs: NOW, configured: false },
    );
    expect(s.state).toBe("trial_expired");
    expect(s.blocked).toBe(false);
  });

  it("LAW 2 grandfather: trial_ends_at NULL never blocks, even configured", () => {
    const s = getBillingState(
      { billing_status: "trial", trial_ends_at: null },
      { nowMs: NOW, configured: true },
    );
    expect(s.state).toBe("grandfathered");
    expect(s.blocked).toBe(false);
  });

  it("LAW 3 grace: past_due does not block", () => {
    const s = getBillingState(
      { billing_status: "past_due", trial_ends_at: day(-40) },
      { nowMs: NOW, configured: true },
    );
    expect(s.blocked).toBe(false);
  });

  it("expired trial blocks when configured", () => {
    const s = getBillingState(
      { billing_status: "trial", trial_ends_at: day(-1) },
      { nowMs: NOW, configured: true },
    );
    expect(s.state).toBe("trial_expired");
    expect(s.blocked).toBe(true);
  });

  it("canceled blocks when configured, not when unconfigured", () => {
    const base = { billing_status: "canceled", trial_ends_at: day(-40) };
    expect(getBillingState(base, { nowMs: NOW, configured: true }).blocked).toBe(true);
    expect(getBillingState(base, { nowMs: NOW, configured: false }).blocked).toBe(false);
  });

  it("active never blocks; live trial reports days_left", () => {
    expect(
      getBillingState(
        { billing_status: "active", trial_ends_at: day(-40) },
        { nowMs: NOW, configured: true },
      ).blocked,
    ).toBe(false);
    const t = getBillingState(
      { billing_status: "trial", trial_ends_at: day(5) },
      { nowMs: NOW, configured: true },
    );
    expect(t.state).toBe("trial");
    expect(t.days_left).toBe(5);
    expect(t.blocked).toBe(false);
  });

  it("missing store row and garbage timestamps fail open", () => {
    expect(getBillingState(null, { configured: true }).blocked).toBe(false);
    expect(
      getBillingState(
        { billing_status: "trial", trial_ends_at: "not-a-date" },
        { nowMs: NOW, configured: true },
      ).blocked,
    ).toBe(false);
  });
});

describe("isBillingConfigured", () => {
  it("requires BOTH secret key and price id", () => {
    expect(isBillingConfigured({})).toBe(false);
    expect(isBillingConfigured({ STRIPE_SECRET_KEY: "sk_x" })).toBe(false);
    expect(isBillingConfigured({ STRIPE_PRICE_ID: "price_x" })).toBe(false);
    expect(
      isBillingConfigured({ STRIPE_SECRET_KEY: "sk_x", STRIPE_PRICE_ID: "price_x" }),
    ).toBe(true);
  });
});

describe("verifyStripeWebhook", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ type: "checkout.session.completed", data: {} });
  const sign = (ts, payload = body, key = secret) =>
    `t=${ts},v1=${crypto
      .createHmac("sha256", key)
      .update(`${ts}.${payload}`, "utf8")
      .digest("hex")}`;

  it("accepts a valid signature and returns the parsed event", () => {
    const ts = Math.floor(NOW / 1000);
    const event = verifyStripeWebhook(body, sign(ts), secret, { nowMs: NOW });
    expect(event?.type).toBe("checkout.session.completed");
  });

  it("rejects a wrong secret, tampered body, and stale timestamp", () => {
    const ts = Math.floor(NOW / 1000);
    expect(
      verifyStripeWebhook(body, sign(ts, body, "whsec_wrong"), secret, { nowMs: NOW }),
    ).toBeNull();
    expect(
      verifyStripeWebhook(body + " ", sign(ts), secret, { nowMs: NOW }),
    ).toBeNull();
    const stale = Math.floor(NOW / 1000) - 3600;
    expect(
      verifyStripeWebhook(body, sign(stale), secret, { nowMs: NOW }),
    ).toBeNull();
  });

  it("rejects malformed headers and missing inputs", () => {
    expect(verifyStripeWebhook(body, "v1=abc", secret, { nowMs: NOW })).toBeNull();
    expect(verifyStripeWebhook(body, null, secret, { nowMs: NOW })).toBeNull();
    expect(verifyStripeWebhook(body, sign(Math.floor(NOW / 1000)), "", { nowMs: NOW })).toBeNull();
  });
});

describe("mapSubscriptionStatus", () => {
  it("maps known statuses and refuses to guess unknowns", () => {
    expect(mapSubscriptionStatus("active")).toBe("active");
    expect(mapSubscriptionStatus("trialing")).toBe("active");
    expect(mapSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapSubscriptionStatus("unpaid")).toBe("past_due");
    expect(mapSubscriptionStatus("canceled")).toBe("canceled");
    expect(mapSubscriptionStatus("incomplete_expired")).toBe("canceled");
    expect(mapSubscriptionStatus("some_future_status")).toBeNull();
  });
});

describe("encodeStripeForm", () => {
  it("form-encodes bracketed keys and drops null/undefined", () => {
    const encoded = encodeStripeForm({
      mode: "subscription",
      "line_items[0][price]": "price_x",
      "line_items[0][quantity]": 1,
      skip: undefined,
      also_skip: null,
    });
    expect(encoded).toContain("mode=subscription");
    expect(encoded).toContain(encodeURIComponent("line_items[0][price]") + "=price_x");
    expect(encoded).not.toContain("skip");
  });
});
