/**
 * milo-node-transport.unit.test.js — makeNodeMiloTransport + resolveMiloTransport
 * (2026-07-18, the Node-direct dig).
 *
 * The node transport must be shape-identical to the page transport
 * ({ ms, status, ok, body }, error:true + status:0 on network death, never
 * throws on HTTP failure) — the entire engine is built on those semantics.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

import {
  makeNodeMiloTransport,
  makePageMiloTransport,
  resolveMiloTransport,
} from "./engine-api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

describe("makeNodeMiloTransport", () => {
  it("GET: hits apiBase+path, carries the Bearer header, parses JSON", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ hello: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = makeNodeMiloTransport({ apiBase: "https://x.test/api" });
    const r = await t.call("GET", "/account", { token: "tok", silent: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ hello: 1 });
    expect(r.ms).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x.test/api/account");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.body).toBeUndefined();
  });

  it("POST: serializes the body; no token → no Authorization header", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accessToken: "t" }));
    vi.stubGlobal("fetch", fetchMock);
    const t = makeNodeMiloTransport({ apiBase: "https://x.test/api" });
    await t.call("POST", "/auth/login", { body: { username: "u", password: "p" }, silent: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ username: "u", password: "p" });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("non-JSON response body comes back as raw text with ok/status intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>challenge</html>", { status: 403 })),
    );
    const t = makeNodeMiloTransport({ apiBase: "https://x.test/api" });
    const r = await t.call("GET", "/account", { silent: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body).toBe("<html>challenge</html>");
  });

  it("HTTP failure does NOT throw — { ok:false, status } (engine soft-fail contract)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 500)));
    const t = makeNodeMiloTransport({ apiBase: "https://x.test/api" });
    const r = await t.call("PUT", "/inventory/check?groupid=1", { body: [], silent: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
  });

  it("network death → { status: 0, ok: false, error: true }, never throws, message REDACTED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket died carrying eyJsecret.token.here");
      }),
    );
    const t = makeNodeMiloTransport({ apiBase: "https://x.test/api" });
    const r = await t.call("GET", "/account", { token: "tok", silent: true });
    expect(r.error).toBe(true);
    expect(r.status).toBe(0);
    expect(r.ok).toBe(false);
    expect(String(r.body)).not.toContain("eyJsecret");
  });
});

describe("resolveMiloTransport", () => {
  const fakeTransport = { __miloTransport: true, kind: "node", call: async () => ({}) };

  it("passes through { transport } and a bare transport", () => {
    expect(resolveMiloTransport({ transport: fakeTransport })).toBe(fakeTransport);
    expect(resolveMiloTransport(fakeTransport)).toBe(fakeTransport);
  });

  it("wraps { page } as a page transport", () => {
    const page = { evaluate: async () => ({ ms: 1, status: 200, ok: true, body: {} }) };
    const t = resolveMiloTransport({ page });
    expect(t.kind).toBe("page");
    expect(t.__miloTransport).toBe(true);
  });

  it("returns null for shapes offering neither (callers throw their own named error)", () => {
    expect(resolveMiloTransport(null)).toBeNull();
    expect(resolveMiloTransport({})).toBeNull();
    expect(resolveMiloTransport({ transport: { call: async () => ({}) } })).toBeNull(); // untagged
  });

  it("page transport delegates through apiCall semantics (evaluate contract intact)", async () => {
    const seen = [];
    const page = {
      evaluate: async (_fn, args) => {
        seen.push(args);
        return { ms: 1, status: 200, ok: true, body: { fine: true } };
      },
    };
    const t = makePageMiloTransport(page);
    const r = await t.call("GET", "/account", { token: "tok", silent: true });
    expect(r.body).toEqual({ fine: true });
    expect(seen[0].method).toBe("GET");
    expect(seen[0].url.endsWith("/account")).toBe(true);
    expect(seen[0].token).toBe("tok");
  });
});
