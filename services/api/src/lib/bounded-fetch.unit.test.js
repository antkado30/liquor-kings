/**
 * Unit tests for bounded-fetch — the hard time bound on every Supabase
 * call (claim-latency dig, 2026-07-11; the 2026-06-14 wedge class).
 *
 * Real timers with tiny durations on purpose: AbortSignal.timeout uses
 * Node-internal timers that fake-timer shims don't reliably control, and
 * a test that fakes the clock around the exact primitive under test
 * would prove nothing (the run_type lesson: test the REAL mechanism).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DB_FETCH_TIMEOUT_MS,
  resolveDbFetchTimeoutMs,
  composeAbortSignals,
  makeBoundedFetch,
} from "./bounded-fetch.js";

/** A fetch that never resolves on its own but rejects when aborted. */
function hangingFetch() {
  const calls = [];
  const impl = (input, init) => {
    calls.push({ input, init });
    return new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) return; // hangs forever — the pre-fix behavior
      if (signal.aborted) {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        { once: true },
      );
    });
  };
  return { impl, calls };
}

describe("resolveDbFetchTimeoutMs", () => {
  it("uses the env value when sane, default otherwise", () => {
    expect(resolveDbFetchTimeoutMs("30000")).toBe(30_000);
    expect(resolveDbFetchTimeoutMs(undefined)).toBe(DEFAULT_DB_FETCH_TIMEOUT_MS);
    expect(resolveDbFetchTimeoutMs("")).toBe(DEFAULT_DB_FETCH_TIMEOUT_MS);
    expect(resolveDbFetchTimeoutMs("nope")).toBe(DEFAULT_DB_FETCH_TIMEOUT_MS);
    // Below the 1s floor / above the 5min ceiling → default (a 5ms bound
    // would fail every real call; an hour bound is no bound at all).
    expect(resolveDbFetchTimeoutMs("5")).toBe(DEFAULT_DB_FETCH_TIMEOUT_MS);
    expect(resolveDbFetchTimeoutMs("3600000")).toBe(DEFAULT_DB_FETCH_TIMEOUT_MS);
  });
});

describe("makeBoundedFetch", () => {
  it("aborts a hanging call at the bound (the wedge-class kill)", async () => {
    const { impl } = hangingFetch();
    const bounded = makeBoundedFetch(40, impl);
    const started = Date.now();
    await expect(bounded("https://db.example/rest")).rejects.toMatchObject({
      name: expect.stringMatching(/AbortError|TimeoutError/),
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(2_000); // bounded — never the old forever-hang
  });

  it("passes method/headers/body through untouched and always attaches a signal", async () => {
    const { impl, calls } = hangingFetch();
    const bounded = makeBoundedFetch(30, impl);
    const init = {
      method: "POST",
      headers: { apikey: "k" },
      body: JSON.stringify({ a: 1 }),
    };
    await bounded("https://db.example/rest", init).catch(() => {});
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ apikey: "k" });
    expect(calls[0].init.body).toBe(init.body);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a caller-provided signal still aborts the call (composed, not clobbered)", async () => {
    const { impl } = hangingFetch();
    const bounded = makeBoundedFetch(5_000, impl); // generous bound — caller fires first
    const caller = new AbortController();
    const p = bounded("https://db.example/rest", { signal: caller.signal });
    const started = Date.now();
    setTimeout(() => caller.abort(new Error("caller cancelled")), 20);
    await expect(p).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a pre-aborted caller signal rejects immediately", async () => {
    const { impl } = hangingFetch();
    const bounded = makeBoundedFetch(5_000, impl);
    const caller = new AbortController();
    caller.abort(new Error("already dead"));
    await expect(
      bounded("https://db.example/rest", { signal: caller.signal }),
    ).rejects.toBeTruthy();
  });
});

describe("composeAbortSignals", () => {
  it("aborts when the FIRST of the two signals fires", async () => {
    const a = new AbortController();
    const b = new AbortController();
    const composed = composeAbortSignals(a.signal, b.signal);
    expect(composed.aborted).toBe(false);
    b.abort(new Error("b first"));
    // AbortSignal.any propagates synchronously; the manual fallback does too.
    expect(composed.aborted).toBe(true);
  });

  it("is already aborted when one input was aborted up front", () => {
    const a = new AbortController();
    a.abort(new Error("pre"));
    const b = new AbortController();
    expect(composeAbortSignals(a.signal, b.signal).aborted).toBe(true);
  });
});
