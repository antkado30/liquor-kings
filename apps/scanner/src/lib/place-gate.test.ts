/**
 * Adversarial tests for the Place gate (two-step ordering, 2026-07-11).
 * Every locked state must name its reason; unlock requires EVERY
 * condition simultaneously — Tony's 2026-07-01 decided design.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePlaceGate,
  CHECK_TRUST_WINDOW_MS,
  type PlaceGateInput,
} from "./place-gate";

const NOW = 1_800_000_000_000;

function baseInput(overrides: Partial<PlaceGateInput> = {}): PlaceGateInput {
  return {
    armed: true,
    currentCartHash: "1234:2|555:1",
    lastGreenCheck: { cartHash: "1234:2|555:1", at: NOW - 60_000, runId: "run-1" },
    nowMs: NOW,
    rulesValid: true,
    busy: false,
    ...overrides,
  };
}

describe("resolvePlaceGate", () => {
  it("unlocks when armed + fresh green check + identical cart + rules pass + not busy", () => {
    const r = resolvePlaceGate(baseInput());
    expect(r).toEqual({ ready: true, checkedAgoMs: 60_000 });
  });

  it("locks in practice mode regardless of everything else", () => {
    const r = resolvePlaceGate(baseInput({ armed: false }));
    expect(r).toEqual({ ready: false, reason: "Practice mode — placing is off." });
  });

  it("locks while busy (no double-fire)", () => {
    expect(resolvePlaceGate(baseInput({ busy: true })).ready).toBe(false);
  });

  it("locks on local rule violations", () => {
    expect(resolvePlaceGate(baseInput({ rulesValid: false })).ready).toBe(false);
  });

  it("locks with NO check at all — 'Check with MLCC first'", () => {
    const r = resolvePlaceGate(baseInput({ lastGreenCheck: null }));
    expect(r).toEqual({ ready: false, reason: "Check with MLCC first." });
  });

  it("Tony rule 2: ANY cart change locks Place until re-checked", () => {
    const r = resolvePlaceGate(
      baseInput({ currentCartHash: "1234:3|555:1" }), // one qty changed
    );
    expect(r).toEqual({
      ready: false,
      reason: "Cart changed — check with MLCC again.",
    });
  });

  it("Tony rule 1: a check right at the 10-minute edge no longer counts", () => {
    const atEdge = baseInput({
      lastGreenCheck: {
        cartHash: "1234:2|555:1",
        at: NOW - CHECK_TRUST_WINDOW_MS,
        runId: "run-1",
      },
    });
    expect(resolvePlaceGate(atEdge)).toEqual({
      ready: false,
      reason: "Check expired — check with MLCC again.",
    });

    const justInside = baseInput({
      lastGreenCheck: {
        cartHash: "1234:2|555:1",
        at: NOW - CHECK_TRUST_WINDOW_MS + 1_000,
        runId: "run-1",
      },
    });
    expect(resolvePlaceGate(justInside).ready).toBe(true);
  });

  it("a check from the FUTURE (device clock anomaly) locks, never trusts", () => {
    const r = resolvePlaceGate(
      baseInput({
        lastGreenCheck: { cartHash: "1234:2|555:1", at: NOW + 60_000, runId: "r" },
      }),
    );
    expect(r.ready).toBe(false);
  });

  it("empty cart hash locks even with a matching empty-string check (never place nothing)", () => {
    const r = resolvePlaceGate(
      baseInput({
        currentCartHash: "",
        lastGreenCheck: { cartHash: "", at: NOW - 1_000, runId: "r" },
      }),
    );
    expect(r).toEqual({ ready: false, reason: "Cart is empty." });
  });

  it("malformed check record (missing fields) is treated as no check", () => {
    const r = resolvePlaceGate(
      baseInput({
        lastGreenCheck: { cartHash: "", at: Number.NaN, runId: "" },
      }),
    );
    expect(r.ready).toBe(false);
  });

  it("NaN timestamp with a MATCHING hash still locks (NaN beats every comparison — fail closed)", () => {
    const r = resolvePlaceGate(
      baseInput({
        lastGreenCheck: {
          cartHash: "1234:2|555:1",
          at: Number.NaN,
          runId: "corrupted",
        },
      }),
    );
    expect(r).toEqual({
      ready: false,
      reason: "Check expired — check with MLCC again.",
    });
  });

  it("custom window is respected", () => {
    const r = resolvePlaceGate(
      baseInput({
        windowMs: 30_000,
        lastGreenCheck: { cartHash: "1234:2|555:1", at: NOW - 31_000, runId: "r" },
      }),
    );
    expect(r).toEqual({
      ready: false,
      reason: "Check expired — check with MLCC again.",
    });
  });
});
