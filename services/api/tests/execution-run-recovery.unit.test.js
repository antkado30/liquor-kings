import { describe, it, expect } from "vitest";
import {
  shouldRecoverStuckRun,
  reapThresholdMinutes,
} from "../src/services/execution-run.service.js";

/*
 * Safety predicate for the user "Start over" escape hatch (2026-06-25).
 * Two rules must NEVER regress:
 *   1. A fresh-heartbeat (alive) run is never recovered — two live runs on one
 *      store collide over the single MILO cart.
 *   2. A run at/after checkout is never recovered — it may have SUBMITTED, and
 *      clearing it could mask a real order / enable a double order.
 */
const NOW = Date.parse("2026-06-25T12:00:00.000Z");
const ago = (sec) => new Date(NOW - sec * 1000).toISOString();

describe("shouldRecoverStuckRun — recovers confirmed-dead pre-submit runs", () => {
  it("recovers a pre-submit run with a stale heartbeat (>90s)", () => {
    const d = shouldRecoverStuckRun({ progress_stage: "rpa_login", heartbeat_at: ago(120) }, NOW);
    expect(d.recover).toBe(true);
    expect(d.reason).toBe("stale_heartbeat");
  });
  it("recovers a run stuck at the claim-default 'running' stage when stale", () => {
    expect(
      shouldRecoverStuckRun({ progress_stage: "running", heartbeat_at: ago(200) }, NOW).recover,
    ).toBe(true);
  });
  it("treats a missing heartbeat as stale (recover)", () => {
    expect(
      shouldRecoverStuckRun({ progress_stage: "rpa_add_items", heartbeat_at: null }, NOW).recover,
    ).toBe(true);
  });
});

describe("shouldRecoverStuckRun — never kills a LIVE run", () => {
  it("does NOT recover a fresh-heartbeat run", () => {
    const d = shouldRecoverStuckRun({ progress_stage: "rpa_add_items", heartbeat_at: ago(10) }, NOW);
    expect(d.recover).toBe(false);
    expect(d.reason).toBe("recent_heartbeat");
  });
  it("does NOT recover exactly at the 90s boundary", () => {
    expect(
      shouldRecoverStuckRun({ progress_stage: "rpa_login", heartbeat_at: ago(90) }, NOW).recover,
    ).toBe(false);
  });
});

describe("reapThresholdMinutes — pre-submit recovers fast, submit keeps the long window", () => {
  for (const stage of ["running", "rpa_login", "rpa_navigate", "rpa_add_items", "rpa_validate", "validate"]) {
    it(`pre-submit stage ${stage} → 3 min`, () => {
      expect(reapThresholdMinutes(stage)).toBe(3);
    });
  }
  for (const stage of ["rpa_checkout", "checkout", "rpa_submit", "submitting", "rpa_finalizing"]) {
    it(`submit-side stage ${stage} → 15 min (never fast-reap a possible order)`, () => {
      expect(reapThresholdMinutes(stage)).toBe(15);
    });
  }
  it("unknown/empty defaults to the short window (reaped runs are never auto-retried anyway)", () => {
    expect(reapThresholdMinutes(null)).toBe(3);
    expect(reapThresholdMinutes("")).toBe(3);
  });
});

describe("shouldRecoverStuckRun — SUBMIT SAFETY (never recover, even if ancient)", () => {
  for (const stage of ["rpa_checkout", "rpa_submit", "submitting", "rpa_finalizing"]) {
    it(`never recovers ${stage} (double-order safety)`, () => {
      const d = shouldRecoverStuckRun({ progress_stage: stage, heartbeat_at: ago(99999) }, NOW);
      expect(d.recover).toBe(false);
      expect(d.reason).toBe("submit_stage");
    });
  }
});
