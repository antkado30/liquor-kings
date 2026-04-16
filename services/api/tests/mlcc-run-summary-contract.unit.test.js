/**
 * DB-free contract tests: on-disk run summary JSON shape matches
 * docs/contracts/rpa-run-summary.md (mirror fields here; do not parse markdown at runtime).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
  MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME,
  buildMlccSafeFlowRunSummaryPayload,
} from "../src/workers/mlcc-browser-evidence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, "../src/workers/mlcc-browser-worker.js");

/** Keys and types per docs/contracts/rpa-run-summary.md (schema version 1). */
const RUN_SUMMARY_CONTRACT = {
  schema_version: "number",
  run_id: "string",
  store_id: "string",
  worker_id: "string-or-null",
  outcome: "string",
  started_at_iso: "string",
  finished_at_iso: "string",
  error_message: "string-or-null",
  final_page_url: "string-or-null",
  mlcc_dry_run_safe_mode: "boolean",
  add_by_code_probe_enabled: "boolean",
  network_guard_blocked_request_count: "number-or-null",
  evidence_entry_count: "number",
  evidence_kinds_tally: "object",
  milestone_screenshot_evidence_entries: "number",
  run_summary_basename: "string",
};

function assertContractShape(payload, label) {
  for (const [key, kind] of Object.entries(RUN_SUMMARY_CONTRACT)) {
    expect(payload, `${label}: missing ${key}`).toHaveProperty(key);
    const v = payload[key];
    if (kind === "number") expect(typeof v, key).toBe("number");
    else if (kind === "string") expect(typeof v, key).toBe("string");
    else if (kind === "boolean") expect(typeof v, key).toBe("boolean");
    else if (kind === "object") expect(v && typeof v, key).toBe("object");
    else if (kind === "string-or-null")
      expect(v === null || typeof v === "string", key).toBe(true);
    else if (kind === "number-or-null")
      expect(v === null || typeof v === "number", key).toBe(true);
  }
}

describe("mlcc_run_summary contract (docs/contracts/rpa-run-summary.md)", () => {
  it("success payload includes every required field with correct types", () => {
    const payload = buildMlccSafeFlowRunSummaryPayload({
      runId: "run-a",
      storeId: "store-b",
      workerId: "worker-c",
      outcome: "success",
      startedAtIso: "2026-04-11T00:00:00.000Z",
      finishedAtIso: "2026-04-11T00:10:00.000Z",
      errorMessage: null,
      finalUrl: "https://example.test/done",
      addByCodeProbe: true,
      dryRunSafeMode: true,
      guardStats: { blockedRequestCount: 0 },
      evidenceEntryCount: 10,
      evidenceKindsTally: { mlcc_add_by_code_probe: 10 },
      milestoneScreenshotEvidenceCount: 0,
    });
    assertContractShape(payload, "success");
    expect(payload.error_message).toBeNull();
    expect(payload.outcome).toBe("success");
    expect(payload.run_summary_basename).toBe(MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME);
    expect(payload.mlcc_dry_run_safe_mode).toBe(true);
  });

  it("failure payload keeps error_message and preserves dry-run SAFE MODE flag", () => {
    const payload = buildMlccSafeFlowRunSummaryPayload({
      runId: "run-fail",
      storeId: "store-b",
      workerId: null,
      outcome: "failure",
      startedAtIso: "2026-04-11T01:00:00.000Z",
      finishedAtIso: "2026-04-11T01:00:05.000Z",
      errorMessage: "Phase blocked: selector",
      finalUrl: "https://example.test/error",
      addByCodeProbe: false,
      dryRunSafeMode: true,
      guardStats: null,
      evidenceEntryCount: 3,
      evidenceKindsTally: { mlcc_add_by_code_probe: 2, x: 1 },
      milestoneScreenshotEvidenceCount: 1,
    });
    assertContractShape(payload, "failure");
    expect(payload.outcome).toBe("failure");
    expect(payload.error_message).toBe("Phase blocked: selector");
    expect(payload.worker_id).toBeNull();
    expect(payload.network_guard_blocked_request_count).toBeNull();
  });

  it("worker still exports compile-time SAFE MODE true (drift guard)", () => {
    const src = fs.readFileSync(WORKER, "utf8");
    expect(src).toMatch(/export const MLCC_BROWSER_DRY_RUN_SAFE_MODE = true\b/);
  });
});
