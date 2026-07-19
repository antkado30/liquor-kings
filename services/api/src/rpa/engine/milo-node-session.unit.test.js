/**
 * milo-node-session.unit.test.js — the per-store node auth cache (2026-07-18).
 *
 * What these pin, adversarially:
 *   - cache reuse NEVER crosses users and NEVER serves a near-expiry token
 *   - login failures classify correctly (invalid_credentials vs
 *     blocked_or_down) — the worker routes on this, and a wrong
 *     classification either burns a bad-password attempt in the browser
 *     (lockout risk) or fails a run Cloudflare was responsible for
 *   - a failed /account never leaves a half-valid cache entry behind
 *   - invalidation forces a fresh login
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getNodeMiloSession,
  invalidateNodeMiloSession,
  decodeJwtExpMs,
  MiloNodeLoginError,
  __resetNodeMiloSessionForTests,
} from "./milo-node-session.js";

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const tokenWithExp = (msFromNow) =>
  `h.${b64url({ exp: Math.floor((Date.now() + msFromNow) / 1000) })}.s`;

const ACCOUNT = { groups: [{ id: "g-1", subscriptionId: "sub-1" }] };
const STORE = "store-1";
const CREDS = { username: "u", password: "p" };

function makeFakeTransport(routes) {
  const calls = [];
  return {
    __miloTransport: true,
    kind: "node",
    calls,
    call: vi.fn(async (method, path, opts = {}) => {
      calls.push({ method, path, opts });
      const route = routes.find(
        (r) => path.startsWith(r.path) && (!r.method || r.method === method),
      );
      if (!route) throw new Error(`fake transport: unmatched ${method} ${path}`);
      return {
        ms: 1,
        status: route.status ?? 200,
        ok: route.ok ?? true,
        body: route.body,
        ...(route.error ? { error: true } : {}),
      };
    }),
  };
}

const happyRoutes = (tokenMs = 30 * 60_000) => [
  { method: "POST", path: "/auth/login", body: { accessToken: tokenWithExp(tokenMs) } },
  { method: "GET", path: "/account", body: ACCOUNT },
];

beforeEach(() => __resetNodeMiloSessionForTests());

describe("getNodeMiloSession", () => {
  it("fresh login: POST /auth/login + GET /account, returns ids, fromCache=false", async () => {
    const t = makeFakeTransport(happyRoutes());
    const s = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    expect(s.fromCache).toBe(false);
    expect(s.groupId).toBe("g-1");
    expect(s.subscriptionId).toBe("sub-1");
    expect(s.token).toBeTruthy();
    expect(t.calls.map((c) => c.path)).toEqual(["/auth/login", "/account"]);
  });

  it("cache hit inside the margin: ZERO network calls, fromCache=true, same ids", async () => {
    const t = makeFakeTransport(happyRoutes());
    await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    const callsAfterFirst = t.calls.length;
    const s2 = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    expect(s2.fromCache).toBe(true);
    expect(s2.groupId).toBe("g-1");
    expect(t.calls.length).toBe(callsAfterFirst); // nothing new hit the network
  });

  it("near-expiry token (< 5 min margin) is NOT reused — fresh login instead", async () => {
    const t = makeFakeTransport(happyRoutes(4 * 60_000)); // token with only 4 min of life
    await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    const s2 = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    expect(s2.fromCache).toBe(false);
    // two full login+account rounds
    expect(t.calls.filter((c) => c.path === "/auth/login")).toHaveLength(2);
  });

  it("username change → never serves the cached token of another user", async () => {
    const t = makeFakeTransport(happyRoutes());
    await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    const s2 = await getNodeMiloSession({
      storeId: STORE,
      username: "different-user",
      password: "p2",
      transport: t,
    });
    expect(s2.fromCache).toBe(false);
    expect(t.calls.filter((c) => c.path === "/auth/login")).toHaveLength(2);
  });

  it("401 login → MiloNodeLoginError classified invalid_credentials", async () => {
    const t = makeFakeTransport([
      { method: "POST", path: "/auth/login", status: 401, ok: false, body: { error: "bad" } },
    ]);
    const err = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t }).catch((e) => e);
    expect(err).toBeInstanceOf(MiloNodeLoginError);
    expect(err.classification).toBe("invalid_credentials");
    expect(err.status).toBe(401);
  });

  it("503 login → blocked_or_down (Cloudflare-shaped, safe to fall back to browser)", async () => {
    const t = makeFakeTransport([
      { method: "POST", path: "/auth/login", status: 503, ok: false, body: "challenge page" },
    ]);
    const err = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t }).catch((e) => e);
    expect(err).toBeInstanceOf(MiloNodeLoginError);
    expect(err.classification).toBe("blocked_or_down");
  });

  it("network death (status 0, error:true) → blocked_or_down", async () => {
    const t = makeFakeTransport([
      { method: "POST", path: "/auth/login", status: 0, ok: false, body: "fetch failed", error: true },
    ]);
    const err = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t }).catch((e) => e);
    expect(err.classification).toBe("blocked_or_down");
  });

  it("token never leaks into the error message (redaction)", async () => {
    const t = makeFakeTransport([
      {
        method: "POST",
        path: "/auth/login",
        status: 500,
        ok: false,
        body: { debug: "eyJsecret.payload.sig" },
      },
    ]);
    const err = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t }).catch((e) => e);
    expect(String(err.message)).not.toContain("eyJsecret");
  });

  it("/account failure → throws and caches NOTHING (next call starts from login)", async () => {
    const t = makeFakeTransport([
      { method: "POST", path: "/auth/login", body: { accessToken: tokenWithExp(30 * 60_000) } },
      { method: "GET", path: "/account", status: 500, ok: false, body: "boom" },
    ]);
    await expect(getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t })).rejects.toThrow(
      /GET \/account failed/,
    );
    const t2 = makeFakeTransport(happyRoutes());
    const s = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t2 });
    expect(s.fromCache).toBe(false); // nothing half-valid survived
  });

  it("/account missing groupId/subscriptionId → blocked_or_down, nothing cached", async () => {
    const t = makeFakeTransport([
      { method: "POST", path: "/auth/login", body: { accessToken: tokenWithExp(30 * 60_000) } },
      { method: "GET", path: "/account", body: { groups: [{}] } },
    ]);
    const err = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t }).catch((e) => e);
    expect(err).toBeInstanceOf(MiloNodeLoginError);
    expect(err.classification).toBe("blocked_or_down");
  });

  it("invalidateNodeMiloSession forces the next acquire to re-login", async () => {
    const t = makeFakeTransport(happyRoutes());
    await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    expect(invalidateNodeMiloSession(STORE, "test")).toBe(true);
    const s2 = await getNodeMiloSession({ storeId: STORE, ...CREDS, transport: t });
    expect(s2.fromCache).toBe(false);
    expect(t.calls.filter((c) => c.path === "/auth/login")).toHaveLength(2);
  });

  it("guards: missing storeId or creds throw before any network call", async () => {
    const t = makeFakeTransport(happyRoutes());
    await expect(getNodeMiloSession({ username: "u", password: "p", transport: t })).rejects.toThrow(
      /storeId is required/,
    );
    await expect(getNodeMiloSession({ storeId: STORE, transport: t })).rejects.toThrow(
      /username \+ password are required/,
    );
    expect(t.calls).toHaveLength(0);
  });
});

describe("decodeJwtExpMs", () => {
  it("reads exp (seconds) into ms from a well-formed token", () => {
    const exp = Math.floor(Date.now() / 1000) + 1800;
    expect(decodeJwtExpMs(`x.${b64url({ exp })}.y`)).toBe(exp * 1000);
  });

  it("returns null on junk, null, missing segment, or non-numeric exp", () => {
    expect(decodeJwtExpMs("garbage")).toBeNull();
    expect(decodeJwtExpMs(null)).toBeNull();
    expect(decodeJwtExpMs("a.b.c")).toBeNull();
    expect(decodeJwtExpMs(`x.${b64url({ exp: "soon" })}.y`)).toBeNull();
    expect(decodeJwtExpMs(`x.${b64url({ sub: "no-exp" })}.y`)).toBeNull();
  });
});
