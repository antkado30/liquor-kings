/**
 * Loop watchdog (2026-07-28 — the 12-hour silent wedge). Pins the law:
 * a worker loop that stops completing iterations gets the process
 * killed for a clean Fly restart. The Stage-1 dead-man catches runs
 * that FAIL; this catches everything that HANGS.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LOOP_WEDGE_LIMIT_MS,
  WATCHDOG_CHECK_INTERVAL_MS,
  loopWedgeVerdict,
  startLoopWatchdog,
} from "../src/workers/loop-watchdog.js";

describe("loopWedgeVerdict", () => {
  it("a loop inside the 20-minute limit is alive", () => {
    expect(loopWedgeVerdict(1_000_000, 1_000_000).wedged).toBe(false);
    expect(loopWedgeVerdict(1_000_000 + LOOP_WEDGE_LIMIT_MS, 1_000_000).wedged).toBe(false);
  });

  it("one ms past the limit = wedged, with the stall measured", () => {
    const v = loopWedgeVerdict(1_000_000 + LOOP_WEDGE_LIMIT_MS + 1, 1_000_000);
    expect(v.wedged).toBe(true);
    expect(v.stalledMs).toBe(LOOP_WEDGE_LIMIT_MS + 1);
  });

  it("clock weirdness (tick in the future) never reads as wedged", () => {
    const v = loopWedgeVerdict(1_000_000, 2_000_000);
    expect(v.wedged).toBe(false);
    expect(v.stalledMs).toBe(0);
  });

  it("the limit is 20 minutes — far above any legitimate iteration, below a lost night", () => {
    expect(LOOP_WEDGE_LIMIT_MS).toBe(20 * 60_000);
  });
});

describe("startLoopWatchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a breathing loop never triggers the handler", () => {
    let lastTick = Date.now();
    const onWedged = vi.fn();
    const timer = startLoopWatchdog({ getLastTickMs: () => lastTick, onWedged });
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(WATCHDOG_CHECK_INTERVAL_MS);
      lastTick = Date.now(); // the loop keeps completing iterations
    }
    expect(onWedged).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("a frozen loop trips the handler once past the limit, message names the stall", () => {
    const frozenAt = Date.now();
    const onWedged = vi.fn();
    const timer = startLoopWatchdog({ getLastTickMs: () => frozenAt, onWedged });
    vi.advanceTimersByTime(LOOP_WEDGE_LIMIT_MS - WATCHDOG_CHECK_INTERVAL_MS);
    expect(onWedged).not.toHaveBeenCalled(); // still inside the limit
    vi.advanceTimersByTime(WATCHDOG_CHECK_INTERVAL_MS * 2);
    expect(onWedged).toHaveBeenCalled();
    expect(String(onWedged.mock.calls[0][0])).toMatch(/WATCHDOG/);
    expect(String(onWedged.mock.calls[0][0])).toMatch(/wedged/);
    clearInterval(timer);
  });
});
