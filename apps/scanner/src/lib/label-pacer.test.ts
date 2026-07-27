/**
 * LabelPacer (2026-07-27): pins the readable-progress law — Tony 7/26:
 * "it said reading your photo then something else i couldnt catch it."
 * Every shown label gets ≥ minMs on screen; bursts collapse to latest;
 * a finished ask never flashes a stale label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LabelPacer } from "./label-pacer";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const make = (minMs = 1200) => {
  const shown: string[] = [];
  const pacer = new LabelPacer((l) => shown.push(l), minMs, () => Date.now());
  return { shown, pacer };
};

describe("LabelPacer", () => {
  it("first label shows immediately", () => {
    const { shown, pacer } = make();
    pacer.push("Reading your photos…");
    expect(shown).toEqual(["Reading your photos…"]);
  });

  it("a fast follow-up is HELD until the first had its minMs on screen", () => {
    const { shown, pacer } = make(1200);
    pacer.push("Reading your photos…");
    vi.advanceTimersByTime(300);
    pacer.push("Matching bottles — 5 of 40 done…");
    expect(shown).toEqual(["Reading your photos…"]); // not yet
    vi.advanceTimersByTime(899);
    expect(shown).toHaveLength(1); // 1199ms — still holding
    vi.advanceTimersByTime(1);
    expect(shown).toEqual([
      "Reading your photos…",
      "Matching bottles — 5 of 40 done…",
    ]);
  });

  it("a burst collapses to the LATEST label (progress is monotonic)", () => {
    const { shown, pacer } = make(1200);
    pacer.push("A");
    vi.advanceTimersByTime(100);
    pacer.push("B");
    pacer.push("C");
    vi.advanceTimersByTime(200);
    pacer.push("D");
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual(["A", "D"]);
  });

  it("a slow tick after the window shows instantly", () => {
    const { shown, pacer } = make(1200);
    pacer.push("A");
    vi.advanceTimersByTime(5000);
    pacer.push("B");
    expect(shown).toEqual(["A", "B"]);
  });

  it("reset(): a finished ask never flashes a held label afterwards", () => {
    const { shown, pacer } = make(1200);
    pacer.push("A");
    vi.advanceTimersByTime(200);
    pacer.push("B"); // held
    pacer.reset();
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual(["A"]);
    // and the pacer is reusable for the next ask
    pacer.push("fresh");
    expect(shown).toEqual(["A", "fresh"]);
  });
});
