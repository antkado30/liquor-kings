import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME,
  buildMlccSafeFlowMilestoneDiskFilename,
  buildMlccSafeFlowRunOutputDir,
  buildMlccSafeFlowRunSummaryPayload,
  countMlccSafeFlowMilestoneScreenshots,
  mergeSnapshotAndScreenshot,
  tallyMlccEvidenceEntriesByKind,
  writeMlccSafeFlowRunSummaryJson,
} from "../src/workers/mlcc-browser-evidence.js";

describe("mergeSnapshotAndScreenshot", () => {
  it("merges included screenshot fields", () => {
    const out = mergeSnapshotAndScreenshot(
      { url: "https://x", page_available: true },
      { included: true, png_base64: "QUJD", bytes: 3 },
    );

    expect(out.screenshot_png_base64).toBe("QUJD");
    expect(out.screenshot_bytes).toBe(3);
    expect(out.url).toBe("https://x");
  });

  it("records skip reason when over limit", () => {
    const out = mergeSnapshotAndScreenshot(
      { url: "https://x" },
      {
        included: false,
        reason: "over_size_limit",
        bytes: 999999,
        max_bytes: 200000,
      },
    );

    expect(out.screenshot_skipped_reason).toBe("over_size_limit");
    expect(out.screenshot_would_be_bytes).toBe(999999);
    expect(out.screenshot_max_bytes).toBe(200000);
  });
});

describe("MLCC safe-flow disk evidence baseline helpers", () => {
  it("buildMlccSafeFlowRunOutputDir resolves run-scoped folder under base", () => {
    const dir = buildMlccSafeFlowRunOutputDir("/tmp/mlcc-flow", "run-42");
    expect(dir).toBe(path.resolve("/tmp/mlcc-flow", "run-42"));
    expect(buildMlccSafeFlowRunOutputDir("", "x")).toBe(null);
    expect(buildMlccSafeFlowRunOutputDir("/tmp", null)).toBe(null);
  });

  it("buildMlccSafeFlowMilestoneDiskFilename prefixes order and stage slug", () => {
    const n = buildMlccSafeFlowMilestoneDiskFilename(
      4,
      "after_cart_navigation_settle",
      "mlcc_cart_settled.png",
    );
    expect(n).toBe(
      "mlcc_ms_004__after_cart_navigation_settle__cart_settled.png",
    );
    expect(
      buildMlccSafeFlowMilestoneDiskFilename(1, "on_failure", "mlcc_failure.png"),
    ).toBe("mlcc_ms_001__on_failure__failure.png");
  });

  it("tallyMlccEvidenceEntriesByKind and milestone screenshot counter", () => {
    const rows = [
      { kind: "mlcc_step_snapshot" },
      { kind: "mlcc_safe_flow_milestone_screenshot" },
      { kind: "mlcc_safe_flow_milestone_screenshot" },
      {},
    ];
    expect(tallyMlccEvidenceEntriesByKind(rows).mlcc_step_snapshot).toBe(1);
    expect(countMlccSafeFlowMilestoneScreenshots(rows)).toBe(2);
  });

  it("writeMlccSafeFlowRunSummaryJson writes predictable JSON file", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lk-mlcc-summary-"));
    const payload = buildMlccSafeFlowRunSummaryPayload({
      runId: "r1",
      storeId: "s1",
      workerId: "w1",
      outcome: "failure",
      startedAtIso: "2026-04-10T00:00:00.000Z",
      finishedAtIso: "2026-04-10T00:01:00.000Z",
      errorMessage: "boom",
      finalUrl: "https://example.com/x",
      addByCodeProbe: true,
      dryRunSafeMode: true,
      guardStats: { blockedRequestCount: 3 },
      evidenceEntryCount: 5,
      evidenceKindsTally: { a: 2 },
      milestoneScreenshotEvidenceCount: 1,
    });
    const abs = await writeMlccSafeFlowRunSummaryJson(tmp, payload);
    expect(abs).toBe(path.join(tmp, MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME));
    const raw = await fs.readFile(abs, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.outcome).toBe("failure");
    expect(parsed.error_message).toBe("boom");
    expect(parsed.run_summary_basename).toBe(MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME);
    expect(parsed.network_guard_blocked_request_count).toBe(3);
  });
});
