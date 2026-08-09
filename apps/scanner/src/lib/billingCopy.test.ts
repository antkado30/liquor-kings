/**
 * Billing panel copy pins (M4 client, 2026-08-09). The panel's words
 * ARE the product here — a store owner reads exactly these lines when
 * money is involved, so the mapping is pinned.
 */
import { describe, expect, it } from "vitest";
import { describeBillingState } from "./billingCopy";

const base = { days_left: null, configured: true, blocked: false } as const;

describe("describeBillingState", () => {
  it("founding store: warm, no button, ever", () => {
    const c = describeBillingState({ ...base, state: "grandfathered", configured: true });
    expect(c.showAddButton).toBe(false);
    expect(c.tone).toBe("ok");
    expect(c.title).toContain("Founding");
  });

  it("active: ok tone, no button", () => {
    const c = describeBillingState({ ...base, state: "active" });
    expect(c.showAddButton).toBe(false);
    expect(c.tone).toBe("ok");
    expect(c.body).toContain("$149");
  });

  it("trial with plenty of days: info tone, button only when configured", () => {
    const on = describeBillingState({ ...base, state: "trial", days_left: 10 });
    expect(on.tone).toBe("info");
    expect(on.showAddButton).toBe(true);
    expect(on.title).toContain("10 days");

    const off = describeBillingState({
      ...base,
      state: "trial",
      days_left: 10,
      configured: false,
    });
    expect(off.showAddButton).toBe(false);
    expect(off.body).toContain("No card needed yet");
  });

  it("trial endgame: warn tone at 3 days or less, singular day at 1", () => {
    expect(describeBillingState({ ...base, state: "trial", days_left: 3 }).tone).toBe("warn");
    expect(describeBillingState({ ...base, state: "trial", days_left: 1 }).title).toContain("1 day left");
  });

  it("trial_expired: alert + button when configured; calm when not", () => {
    const on = describeBillingState({ ...base, state: "trial_expired", blocked: true });
    expect(on.tone).toBe("alert");
    expect(on.showAddButton).toBe(true);
    expect(on.body).toContain("stay free");

    const off = describeBillingState({
      ...base,
      state: "trial_expired",
      configured: false,
    });
    expect(off.tone).toBe("info");
    expect(off.showAddButton).toBe(false);
  });

  it("past_due: warn, reassures ordering still works, update label", () => {
    const c = describeBillingState({ ...base, state: "past_due" });
    expect(c.tone).toBe("warn");
    expect(c.body).toContain("ordering still works");
    expect(c.buttonLabel).toBe("Update billing");
  });

  it("canceled: restart label when configured", () => {
    const c = describeBillingState({ ...base, state: "canceled" });
    expect(c.tone).toBe("alert");
    expect(c.buttonLabel).toBe("Restart billing");
  });

  it("unknown: never a button, never alarming", () => {
    const c = describeBillingState({ ...base, state: "unknown" });
    expect(c.showAddButton).toBe(false);
    expect(c.tone).toBe("info");
  });
});
