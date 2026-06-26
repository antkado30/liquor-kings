import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  acquireSession,
  attachFreshSession,
  releaseSession,
  forceCloseAll,
  getSessionManagerStats,
  configureSessionManager,
  __resetForTestsOnly,
} from "../src/workers/rpa-session-manager.js";

/**
 * Tests for the RPA persistent session manager (task #46 Phase A,
 * 2026-05-31). The manager is module-level singleton state — every
 * test resets it in beforeEach so we don't leak between cases.
 *
 * No real Playwright browser is created. Sessions are mocked with a
 * fake `browser` object (close: noop) and a fake `page` (url: noop).
 * The manager's contract is shape-based, not behavior-of-browser.
 */

/**
 * Build a fake "session" matching the shape the worker uses. The only
 * surfaces the session manager touches are:
 *   - session.browser.close()  → on teardown
 *   - session.page.url()       → on liveness probe
 *   - session.page.isClosed()  → on liveness probe (optional)
 *   - session.page.evaluate()  → on deep probe (2026-06-12 CDP liveness check)
 * Everything else (currentUrl, selectedLicense, …) is irrelevant here.
 *
 * The deep probe (acquireSession → page.evaluate("1"), raced vs a 2s cap)
 * proves the session can actually execute before reuse. A real Playwright
 * page has .evaluate; the mock must too, or every happy-path reuse test
 * falsely fails with cdp_probe_failed. evaluate resolves fast (1) so a
 * healthy fake session passes the probe. The intentional dead-session
 * mocks below (urlImpl throws, isClosedImpl true, idle, busy) all fail at
 * an EARLIER gate, so they never reach evaluate — this default doesn't
 * rescue them.
 */
function fakeSession({ closeImpl, urlImpl, isClosedImpl, evaluateImpl } = {}) {
  const close = vi.fn(async () => {
    if (closeImpl) await closeImpl();
  });
  const url = vi.fn(() => {
    if (urlImpl) return urlImpl();
    return "https://www.michigan.gov/milo/products";
  });
  const isClosed = vi.fn(() => {
    if (isClosedImpl) return isClosedImpl();
    return false;
  });
  const evaluate = vi.fn(async () => {
    if (evaluateImpl) return evaluateImpl();
    // page.evaluate("1") on a live page resolves to 1. Fast + healthy.
    return 1;
  });
  return {
    browser: { close },
    page: { url, isClosed, evaluate },
  };
}

beforeEach(() => {
  __resetForTestsOnly();
  // Default config; tests can override per-case.
  configureSessionManager({ maxIdleMs: 10 * 60 * 1000, verbose: false });
});

afterEach(async () => {
  await forceCloseAll("test_cleanup");
  __resetForTestsOnly();
});

describe("acquireSession with no held session", () => {
  it("returns reused=false with reason 'no_held_session'", async () => {
    const r = await acquireSession({
      storeId: "store-A",
      licenseNumber: "430342",
    });
    expect(r.reused).toBe(false);
    expect(r.reason).toBe("no_held_session");
  });

  it("returns reused=false when storeId is missing", async () => {
    const r = await acquireSession({ storeId: "", licenseNumber: "430342" });
    expect(r.reused).toBe(false);
    expect(r.reason).toBe("missing_store_id");
  });
});

describe("attachFreshSession", () => {
  it("attaches a fresh session and returns a sessionId", async () => {
    const session = fakeSession();
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    expect(att.ok).toBe(true);
    expect(att.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const stats = getSessionManagerStats();
    expect(stats.hasHeldSession).toBe(true);
    expect(stats.storeId).toBe("store-A");
    expect(stats.licenseNumber).toBe("430342");
    expect(stats.busy).toBe(true);
  });

  it("rejects an invalid session payload", async () => {
    const r = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session: {},
    });
    expect(r.ok).toBe(false);
  });

  it("closes the prior session when attaching for a different store", async () => {
    const sessionA = fakeSession();
    const sessionB = fakeSession();
    await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session: sessionA,
    });
    await attachFreshSession({
      storeId: "store-B",
      licenseNumber: "555555",
      session: sessionB,
    });
    // The first session must have been closed.
    expect(sessionA.browser.close).toHaveBeenCalledTimes(1);
    const stats = getSessionManagerStats();
    expect(stats.storeId).toBe("store-B");
  });
});

describe("acquire reuse path", () => {
  it("reuses a held session when storeId + license + idle window all match", async () => {
    const session = fakeSession();
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    // Simulate the run completing and releasing for reuse.
    const rel = await releaseSession({
      sessionId: att.sessionId,
      healthy: true,
    });
    expect(rel.action).toBe("held_for_reuse");

    const acq = await acquireSession({
      storeId: "store-A",
      licenseNumber: "430342",
    });
    expect(acq.reused).toBe(true);
    expect(acq.sessionId).toBe(att.sessionId);
    expect(acq.session).toBe(session);
    // Liveness probe must have been called.
    expect(session.page.url).toHaveBeenCalled();
  });

  it("does NOT reuse when storeId differs — and closes the held session", async () => {
    const session = fakeSession();
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    await releaseSession({ sessionId: att.sessionId, healthy: true });

    const acq = await acquireSession({
      storeId: "store-B",
      licenseNumber: "430342",
    });
    expect(acq.reused).toBe(false);
    expect(acq.reason).toBe("store_mismatch");
    expect(session.browser.close).toHaveBeenCalledTimes(1);
  });

  it("does NOT reuse when license differs — and closes the held session", async () => {
    const session = fakeSession();
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    await releaseSession({ sessionId: att.sessionId, healthy: true });

    const acq = await acquireSession({
      storeId: "store-A",
      licenseNumber: "999999",
    });
    expect(acq.reused).toBe(false);
    expect(acq.reason).toBe("license_mismatch");
    expect(session.browser.close).toHaveBeenCalledTimes(1);
  });

  it("does NOT reuse when idle exceeds maxIdleMs — and closes the held session", async () => {
    configureSessionManager({ maxIdleMs: 50, verbose: false });
    const session = fakeSession();
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    await releaseSession({ sessionId: att.sessionId, healthy: true });
    await new Promise((r) => setTimeout(r, 80)); // exceed 50ms idle

    const acq = await acquireSession({
      storeId: "store-A",
      licenseNumber: "430342",
    });
    expect(acq.reused).toBe(false);
    expect(acq.reason).toBe("idle_timeout");
    expect(session.browser.close).toHaveBeenCalledTimes(1);
  });

  it("does NOT reuse when liveness probe throws — and closes the held session", async () => {
    const session = fakeSession({
      urlImpl: () => {
        throw new Error("browser closed");
      },
    });
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    await releaseSession({ sessionId: att.sessionId, healthy: true });

    const acq = await acquireSession({
      storeId: "store-A",
      licenseNumber: "430342",
    });
    expect(acq.reused).toBe(false);
    expect(acq.reason).toBe("liveness_probe_failed");
    expect(session.browser.close).toHaveBeenCalledTimes(1);
  });

  it("does NOT reuse when page is reported closed", async () => {
    const session = fakeSession({ isClosedImpl: () => true });
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    await releaseSession({ sessionId: att.sessionId, healthy: true });

    const acq = await acquireSession({
      storeId: "store-A",
      licenseNumber: "430342",
    });
    expect(acq.reused).toBe(false);
    expect(acq.reason).toBe("liveness_probe_failed");
  });

  it("refuses to reuse a busy session and leaves it alone", async () => {
    const session = fakeSession();
    // Attach leaves the session busy=true (acquired but not yet released).
    await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });

    const acq = await acquireSession({
      storeId: "store-A",
      licenseNumber: "430342",
    });
    expect(acq.reused).toBe(false);
    expect(acq.reason).toBe("session_busy");
    // Must NOT have torn down the in-use session.
    expect(session.browser.close).not.toHaveBeenCalled();
  });
});

describe("releaseSession", () => {
  it("closes the session when healthy=false", async () => {
    const session = fakeSession();
    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    const rel = await releaseSession({
      sessionId: att.sessionId,
      healthy: false,
      reason: "stage4_failed",
    });
    expect(rel.action).toBe("closed_unhealthy");
    expect(session.browser.close).toHaveBeenCalledTimes(1);
    expect(getSessionManagerStats().hasHeldSession).toBe(false);
  });

  it("is a no-op for an unknown sessionId (idempotent finally block)", async () => {
    const r = await releaseSession({
      sessionId: "nonexistent-uuid",
      healthy: true,
    });
    expect(r.action).toBe("ignored_unknown_session_id");
  });
});

describe("forceCloseAll", () => {
  it("closes any held session and clears state", async () => {
    const session = fakeSession();
    await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    await forceCloseAll("test");
    expect(session.browser.close).toHaveBeenCalledTimes(1);
    expect(getSessionManagerStats().hasHeldSession).toBe(false);
  });

  it("is safe to call when no session is held", async () => {
    const r = await forceCloseAll("test");
    expect(r.ok).toBe(true);
  });
});

describe("end-to-end happy path lifecycle", () => {
  it("attach → release(healthy) → acquire(reuse) → release(healthy) → forceCloseAll", async () => {
    const session = fakeSession();

    const att = await attachFreshSession({
      storeId: "store-A",
      licenseNumber: "430342",
      session,
    });
    expect(att.ok).toBe(true);

    const r1 = await releaseSession({ sessionId: att.sessionId, healthy: true });
    expect(r1.action).toBe("held_for_reuse");

    const acq = await acquireSession({
      storeId: "store-A",
      licenseNumber: "430342",
    });
    expect(acq.reused).toBe(true);
    expect(acq.session).toBe(session);

    const r2 = await releaseSession({ sessionId: acq.sessionId, healthy: true });
    expect(r2.action).toBe("held_for_reuse");

    await forceCloseAll("shutdown");
    expect(session.browser.close).toHaveBeenCalledTimes(1);
  });
});
