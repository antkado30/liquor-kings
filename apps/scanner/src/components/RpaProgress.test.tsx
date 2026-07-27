/**
 * The ONE progress panel (2026-07-27, Tony's 7/5 want completed).
 * Pins: stage lists match the worker's progress_stage ids, index math,
 * the honest slow-MILO ladder, and that a mid-run pill tap renders the
 * FULL checklist (done/active/pending), not a thin line.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  RPA_STAGES_SUBMIT,
  RPA_STAGES_VALIDATE,
  RpaProgressPanel,
  STUCK_RETRY_THRESHOLD_SEC,
  honestSlowMessage,
  stageIndexFor,
  stagesForMode,
} from "./RpaProgress";
import { RunResultSheet } from "./RunResultSheet";

describe("stage lists (ids must match the worker heartbeat values)", () => {
  it("validate ladder is stages 1-4; submit adds rpa_checkout", () => {
    expect(RPA_STAGES_VALIDATE.map((s) => s.id)).toEqual([
      "rpa_login",
      "rpa_navigate",
      "rpa_add_items",
      "rpa_validate",
    ]);
    expect(RPA_STAGES_SUBMIT.map((s) => s.id)).toEqual([
      "rpa_login",
      "rpa_navigate",
      "rpa_add_items",
      "rpa_validate",
      "rpa_checkout",
    ]);
  });

  it("stagesForMode: only an armed submit shows the 5-step ladder", () => {
    expect(stagesForMode("submit")).toBe(RPA_STAGES_SUBMIT);
    expect(stagesForMode("validate_only")).toBe(RPA_STAGES_VALIDATE);
    expect(stagesForMode(null)).toBe(RPA_STAGES_VALIDATE);
  });

  it("stageIndexFor: null/unknown → -1 (pre-stage), known id → its index", () => {
    expect(stageIndexFor(RPA_STAGES_VALIDATE, null)).toBe(-1);
    expect(stageIndexFor(RPA_STAGES_VALIDATE, "nonsense")).toBe(-1);
    expect(stageIndexFor(RPA_STAGES_VALIDATE, "rpa_add_items")).toBe(2);
    expect(stageIndexFor(RPA_STAGES_SUBMIT, "rpa_checkout")).toBe(4);
  });
});

describe("honestSlowMessage ladder", () => {
  it("quiet under 30s, patient note at 30s, most-patient tone at the stuck threshold", () => {
    expect(honestSlowMessage(29)).toBeNull();
    expect(honestSlowMessage(30)).toMatch(/longer than usual/);
    expect(honestSlowMessage(STUCK_RETRY_THRESHOLD_SEC)).toMatch(/slow today/);
  });
});

describe("RpaProgressPanel render", () => {
  it("mid-run: earlier stages done, current active (aria-current), rest pending", () => {
    const { container } = render(
      <RpaProgressPanel
        headline={{ title: "MILO is checking this cart" }}
        stages={RPA_STAGES_VALIDATE}
        currentStageIndex={2}
        preStage={false}
      />,
    );
    expect(container.querySelectorAll(".rpa-progress__step--done")).toHaveLength(2);
    const active = container.querySelectorAll(".rpa-progress__step--active");
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("aria-current")).toBe("step");
    expect(container.querySelectorAll(".rpa-progress__step--pending")).toHaveLength(1);
  });

  it("pre-stage: every stage pending (worker has not claimed yet)", () => {
    const { container } = render(
      <RpaProgressPanel
        headline={{ title: "t" }}
        stages={RPA_STAGES_SUBMIT}
        currentStageIndex={-1}
        preStage={true}
      />,
    );
    expect(container.querySelectorAll(".rpa-progress__step--pending")).toHaveLength(5);
  });
});

describe("RunResultSheet LIVE view (the 7/5 want, both halves)", () => {
  it("a mid-run tap shows the FULL stage checklist with the live stage active", () => {
    const { container } = render(
      <RunResultSheet
        result={null}
        live={{
          title: "Checking your cart",
          sub: "Adding your items · 0:41",
          progressStage: "rpa_add_items",
          progressMessage: null,
          startedAtMs: Date.now() - 41_000,
        }}
        mode="validate_only"
        onClose={() => {}}
      />,
    );
    // All four validate stages render…
    expect(screen.getByText("Logging into MLCC")).toBeTruthy();
    expect(screen.getByText("Validating cart")).toBeTruthy();
    // …with real statuses: 2 done, adding-items active, validate pending.
    expect(container.querySelectorAll(".rpa-progress__step--done")).toHaveLength(2);
    expect(container.querySelectorAll(".rpa-progress__step--active")).toHaveLength(1);
    // Elapsed clock is live (0:41-ish, ticking).
    expect(container.querySelector(".rpa-progress__elapsed")?.textContent).toMatch(/^0:4\d$/);
  });

  it("before the worker claims: all pending + honest starting-up copy", () => {
    const { container } = render(
      <RunResultSheet
        result={null}
        live={{ title: "Checking your cart", sub: null, progressStage: null, startedAtMs: Date.now() }}
        mode="validate_only"
        onClose={() => {}}
      />,
    );
    expect(container.querySelectorAll(".rpa-progress__step--pending")).toHaveLength(4);
    expect(screen.getByText(/Starting up — sending your cart/)).toBeTruthy();
  });
});
