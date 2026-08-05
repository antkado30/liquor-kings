/**
 * Retry pins for the store-meta fetch (2026-08-05). The Place button's
 * visibility rides on this payload — one transient failure must never
 * hide an armed store for a whole session again.
 */
import { describe, expect, it, vi } from "vitest";
import { fetchWithRetries } from "./store-meta-retry";

const instantSleep = () => Promise.resolve();

describe("fetchWithRetries", () => {
  it("returns the first successful payload without extra calls", async () => {
    const get = vi.fn().mockResolvedValue({ armed: true });
    const r = await fetchWithRetries(get, { sleep: instantSleep });
    expect(r).toEqual({ armed: true });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("a thrown first attempt retries and succeeds (the 4:14pm scare)", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ armed: true });
    const r = await fetchWithRetries(get, { sleep: instantSleep });
    expect(r).toEqual({ armed: true });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("null/undefined payloads count as misses and retry", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: true });
    const r = await fetchWithRetries(get, { sleep: instantSleep });
    expect(r).toEqual({ ok: true });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("gives up quietly with null after the last try (fail-soft preserved)", async () => {
    const get = vi.fn().mockRejectedValue(new Error("still down"));
    const r = await fetchWithRetries(get, { tries: 3, sleep: instantSleep });
    expect(r).toBe(null);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("stops immediately once cancelled (unmounted page never keeps polling)", async () => {
    let cancelled = false;
    const get = vi.fn().mockRejectedValue(new Error("down"));
    const sleep = vi.fn().mockImplementation(() => {
      cancelled = true; // flips between attempts, like an unmount
      return Promise.resolve();
    });
    const r = await fetchWithRetries(get, {
      tries: 5,
      sleep,
      cancelled: () => cancelled,
    });
    expect(r).toBe(null);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("waits between attempts but never after the last one", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(null);
    await fetchWithRetries(get, { tries: 3, delayMs: 250, sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });
});
