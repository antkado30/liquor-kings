#!/usr/bin/env node
/**
 * verify:lk:rpa-safety — lightweight static checks on MLCC browser rebuild path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const workerPath = "services/api/src/workers/mlcc-browser-worker.js";
const probePath = "services/api/src/workers/mlcc-browser-add-by-code-probe.js";

const checks = [];

const worker = read(workerPath);
const probe = read(probePath);

if (!worker.includes("export const MLCC_BROWSER_DRY_RUN_SAFE_MODE = true")) {
  checks.push("mlcc-browser-worker.js must export MLCC_BROWSER_DRY_RUN_SAFE_MODE = true");
}

if (!worker.includes("export function assertMlccSubmissionAllowed")) {
  checks.push("mlcc-browser-worker.js must export assertMlccSubmissionAllowed");
}

if (!worker.includes("installMlccSafetyNetworkGuards")) {
  checks.push("mlcc-browser-worker.js must use installMlccSafetyNetworkGuards");
}

if (!probe.includes("export async function installMlccSafetyNetworkGuards")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export installMlccSafetyNetworkGuards");
}

if (!probe.includes("export function shouldBlockHttpRequest")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export shouldBlockHttpRequest");
}

if (!probe.includes("export function classifyMutationBoundaryControl")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export classifyMutationBoundaryControl (Phase 2d)");
}

if (!probe.includes("runAddByCodePhase2dMutationBoundaryMap")) {
  checks.push("mlcc-browser-add-by-code-probe.js must define runAddByCodePhase2dMutationBoundaryMap");
}

if (!probe.includes("runAddByCodePhase2eMutationBoundaryMap")) {
  checks.push("mlcc-browser-add-by-code-probe.js must define runAddByCodePhase2eMutationBoundaryMap (Phase 2e)");
}

if (!probe.includes("collectMutationBoundaryControlsInRoot")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must define collectMutationBoundaryControlsInRoot (Phase 2e scoped scan)",
  );
}

if (!probe.includes("export function parseMutationBoundaryUncertainHints")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export parseMutationBoundaryUncertainHints");
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2E")) {
  checks.push("mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2E (Phase 2e)");
}

if (!worker.includes("MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR")) {
  checks.push("mlcc-browser-worker.js must document MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR");
}

if (!probe.includes("runAddByCodePhase2fSafeOpenConfirm")) {
  checks.push("mlcc-browser-add-by-code-probe.js must define runAddByCodePhase2fSafeOpenConfirm (Phase 2f)");
}

if (!probe.includes("export function parseSafeOpenCandidateSelectors")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export parseSafeOpenCandidateSelectors");
}

if (!probe.includes("export function evaluatePhase2fOpenCandidateEligibility")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export evaluatePhase2fOpenCandidateEligibility");
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2F")) {
  checks.push("mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2F (Phase 2f)");
}

if (!probe.includes("runAddByCodePhase2gTypingPolicyAndRehearsal")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must define runAddByCodePhase2gTypingPolicyAndRehearsal (Phase 2g)",
  );
}

if (!probe.includes("export const PHASE_2G_TYPING_POLICY_VERSION")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export PHASE_2G_TYPING_POLICY_VERSION");
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2G")) {
  checks.push("mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2G (Phase 2g)");
}

if (!probe.includes("runAddByCodePhase2hRealCodeTypingRehearsal")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must define runAddByCodePhase2hRealCodeTypingRehearsal (Phase 2h)",
  );
}

if (!probe.includes("export const PHASE_2H_REAL_CODE_POLICY_VERSION")) {
  checks.push("mlcc-browser-add-by-code-probe.js must export PHASE_2H_REAL_CODE_POLICY_VERSION");
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2H_APPROVED")) {
  checks.push("mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2H_APPROVED (Phase 2h)");
}

// Phase 2b/2c: no product .fill in probe; Phase 2g sentinel; Phase 2h gated real code + clear.
if (/\b\.fill\s*\(/u.test(probe)) {
  const onlyPhase2gSentinel =
    probe.includes("runAddByCodePhase2gTypingPolicyAndRehearsal") &&
    probe.includes("fill(sentinelVal") &&
    probe.includes('fill("",');
  const phase2hRealCode =
    probe.includes("runAddByCodePhase2hRealCodeTypingRehearsal") &&
    probe.includes("fill(testCode") &&
    probe.includes('fill("",');
  if (!onlyPhase2gSentinel && !phase2hRealCode) {
    checks.push(
      "mlcc-browser-add-by-code-probe.js: .fill( allowed only for Phase 2g sentinel or Phase 2h gated real code + clear",
    );
  }
}

// Submission guard must not be invoked in processOneMlccBrowserDryRun body (only defined for future use).
const processStart = worker.indexOf("export async function processOneMlccBrowserDryRun");
if (processStart === -1) {
  checks.push("processOneMlccBrowserDryRun not found");
} else {
  const fnSlice = worker.slice(processStart, processStart + 12000);
  if (/\bassertMlccSubmissionAllowed\s*\(/u.test(fnSlice)) {
    checks.push(
      "processOneMlccBrowserDryRun must not call assertMlccSubmissionAllowed (guard exists for future submit only)",
    );
  }
}

if (checks.length) {
  for (const c of checks) {
    console.error(`[verify:lk:rpa-safety] ${c}`);
  }
  process.exit(1);
}

console.log("[verify:lk:rpa-safety] OK");
process.exit(0);
