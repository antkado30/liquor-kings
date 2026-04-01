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
const phase2iPolicyPath = "services/api/src/workers/mlcc-phase-2i-policy.js";
const phase2kPolicyPath = "services/api/src/workers/mlcc-phase-2k-policy.js";
const phase2mPolicyPath = "services/api/src/workers/mlcc-phase-2m-policy.js";
const phasesDocPath = "docs/lk/architecture/rpa-rebuild-phases.md";

const checks = [];

const worker = read(workerPath);
const probe = read(probePath);
const phase2iPolicy = read(phase2iPolicyPath);
const phase2kPolicy = read(phase2kPolicyPath);
const phase2mPolicy = read(phase2mPolicyPath);
const phasesDoc = read(phasesDocPath);

if (worker.includes("mlcc-phase-2m-policy")) {
  checks.push(
    "mlcc-browser-worker.js must not import mlcc-phase-2m-policy.js (Phase 2m manifest is echoed from the probe for Phase 2n only)",
  );
}

if (!probe.includes("mlcc-phase-2m-policy")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must import mlcc-phase-2m-policy.js for Phase 2n add/apply-line gate manifest echo",
  );
}

if (worker.includes("mlcc-phase-2k-policy")) {
  checks.push(
    "mlcc-browser-worker.js must not import mlcc-phase-2k-policy.js (Phase 2k manifest is echoed from the probe for Phase 2l only)",
  );
}

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

if (!probe.includes("runAddByCodePhase2jQuantityTypingRehearsal")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must define runAddByCodePhase2jQuantityTypingRehearsal (Phase 2j)",
  );
}

if (!probe.includes("export const PHASE_2J_QUANTITY_POLICY_VERSION")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must export PHASE_2J_QUANTITY_POLICY_VERSION (Phase 2j)",
  );
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2J_APPROVED")) {
  checks.push(
    "mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2J_APPROVED (Phase 2j)",
  );
}

if (!probe.includes("runAddByCodePhase2lCombinedCodeQuantityTypingRehearsal")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must define runAddByCodePhase2lCombinedCodeQuantityTypingRehearsal (Phase 2l)",
  );
}

if (!probe.includes("export const PHASE_2L_COMBINED_POLICY_VERSION")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must export PHASE_2L_COMBINED_POLICY_VERSION (Phase 2l)",
  );
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2L_APPROVED")) {
  checks.push(
    "mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2L_APPROVED (Phase 2l)",
  );
}

if (!probe.includes("export function evaluatePhase2nAddApplyCandidateEligibility")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must export evaluatePhase2nAddApplyCandidateEligibility (Phase 2n)",
  );
}

if (!probe.includes("export async function runAddByCodePhase2nAddApplyLineSingleClick")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must export runAddByCodePhase2nAddApplyLineSingleClick (Phase 2n)",
  );
}

if (!probe.includes("export const PHASE_2N_ADD_APPLY_POLICY_VERSION")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must export PHASE_2N_ADD_APPLY_POLICY_VERSION (Phase 2n)",
  );
}

if (!probe.includes("export function parsePhase2nAddApplyCandidateSelectors")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must export parsePhase2nAddApplyCandidateSelectors (Phase 2n)",
  );
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2N_APPROVED")) {
  checks.push(
    "mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2N_APPROVED (Phase 2n)",
  );
}

if (!worker.includes("MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS")) {
  checks.push(
    "mlcc-browser-worker.js must document MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS (Phase 2n)",
  );
}

if (!phasesDoc.includes("Phase 2n")) {
  checks.push("rpa-rebuild-phases.md must document Phase 2n");
}

if (!probe.includes("mlcc-phase-2k-policy")) {
  checks.push(
    "mlcc-browser-add-by-code-probe.js must import mlcc-phase-2k-policy.js for Phase 2l evidence (Phase 2k manifest echo)",
  );
}

if (!phase2iPolicy.includes("export const PHASE_2I_POLICY_VERSION")) {
  checks.push("mlcc-phase-2i-policy.js must export PHASE_2I_POLICY_VERSION (Phase 2i)");
}

if (!phase2iPolicy.includes("export function buildPhase2iQuantityFutureGateManifest")) {
  checks.push("mlcc-phase-2i-policy.js must export buildPhase2iQuantityFutureGateManifest");
}

if (!phase2iPolicy.includes("export function buildPhase2iBroaderInteractionLadder")) {
  checks.push("mlcc-phase-2i-policy.js must export buildPhase2iBroaderInteractionLadder");
}

if (!phase2iPolicy.includes("out_of_scope_until_separate_approval")) {
  checks.push(
    "mlcc-phase-2i-policy.js must tag ladder steps with out_of_scope_until_separate_approval",
  );
}

if (!phasesDoc.includes("Phase 2i")) {
  checks.push("rpa-rebuild-phases.md must document Phase 2i");
}

if (!phasesDoc.includes("Phase 2j")) {
  checks.push("rpa-rebuild-phases.md must document Phase 2j");
}

if (!/planning[- ]only/i.test(phasesDoc)) {
  checks.push("rpa-rebuild-phases.md must state Phase 2i is planning-only");
}

if (!phasesDoc.includes("mlcc-phase-2i-policy.js")) {
  checks.push("rpa-rebuild-phases.md must reference mlcc-phase-2i-policy.js");
}

if (!phase2kPolicy.includes("export const PHASE_2K_POLICY_VERSION")) {
  checks.push("mlcc-phase-2k-policy.js must export PHASE_2K_POLICY_VERSION (Phase 2k)");
}

if (!phase2kPolicy.includes("export function buildPhase2kCombinedInteractionFutureGateManifest")) {
  checks.push(
    "mlcc-phase-2k-policy.js must export buildPhase2kCombinedInteractionFutureGateManifest",
  );
}

if (!phase2kPolicy.includes("export function buildPhase2kPostCombinedInteractionLadder")) {
  checks.push(
    "mlcc-phase-2k-policy.js must export buildPhase2kPostCombinedInteractionLadder",
  );
}

if (!phase2kPolicy.includes("out_of_scope_until_separate_approval")) {
  checks.push(
    "mlcc-phase-2k-policy.js must tag ladder steps with out_of_scope_until_separate_approval",
  );
}

if (!phase2kPolicy.includes("combined_code_quantity_rehearsal")) {
  checks.push(
    "mlcc-phase-2k-policy.js must define combined_code_quantity_rehearsal ladder step",
  );
}

if (!phase2kPolicy.includes("combined_clear_revert")) {
  checks.push("mlcc-phase-2k-policy.js must define combined_clear_revert ladder step");
}

if (!phasesDoc.includes("Phase 2k")) {
  checks.push("rpa-rebuild-phases.md must document Phase 2k");
}

if (!phasesDoc.includes("Phase 2l")) {
  checks.push("rpa-rebuild-phases.md must document Phase 2l");
}

if (!phasesDoc.includes("mlcc-phase-2k-policy.js")) {
  checks.push("rpa-rebuild-phases.md must reference mlcc-phase-2k-policy.js");
}

if (!phase2mPolicy.includes("export const PHASE_2M_POLICY_VERSION")) {
  checks.push("mlcc-phase-2m-policy.js must export PHASE_2M_POLICY_VERSION (Phase 2m)");
}

if (!phase2mPolicy.includes("export function buildPhase2mAddApplyLineFutureGateManifest")) {
  checks.push(
    "mlcc-phase-2m-policy.js must export buildPhase2mAddApplyLineFutureGateManifest",
  );
}

if (!phase2mPolicy.includes("export function buildPhase2mPostAddApplyLadder")) {
  checks.push("mlcc-phase-2m-policy.js must export buildPhase2mPostAddApplyLadder");
}

if (!phase2mPolicy.includes("out_of_scope_until_separate_approval")) {
  checks.push(
    "mlcc-phase-2m-policy.js must tag ladder steps with out_of_scope_until_separate_approval",
  );
}

if (!phase2mPolicy.includes("add_apply_line_rehearsal")) {
  checks.push(
    "mlcc-phase-2m-policy.js must define add_apply_line_rehearsal ladder step",
  );
}

if (!phase2mPolicy.includes("post_add_apply_observation")) {
  checks.push(
    "mlcc-phase-2m-policy.js must define post_add_apply_observation ladder step",
  );
}

if (!phasesDoc.includes("Phase 2m")) {
  checks.push("rpa-rebuild-phases.md must document Phase 2m");
}

if (!phasesDoc.includes("mlcc-phase-2m-policy.js")) {
  checks.push("rpa-rebuild-phases.md must reference mlcc-phase-2m-policy.js");
}

// Phase 2b/2c: no product .fill in probe; Phase 2g sentinel; Phase 2h/2j single-field; Phase 2l combined two-field + reverse clear.
if (/\b\.fill\s*\(/u.test(probe)) {
  const onlyPhase2gSentinel =
    probe.includes("runAddByCodePhase2gTypingPolicyAndRehearsal") &&
    probe.includes("fill(sentinelVal") &&
    probe.includes('fill("",');
  const phase2hRealCode =
    probe.includes("runAddByCodePhase2hRealCodeTypingRehearsal") &&
    probe.includes("fill(testCode") &&
    probe.includes('fill("",');
  const phase2jQuantity =
    probe.includes("runAddByCodePhase2jQuantityTypingRehearsal") &&
    probe.includes("fill(testQuantity") &&
    probe.includes('fill("",');
  const phase2lCombined =
    probe.includes("runAddByCodePhase2lCombinedCodeQuantityTypingRehearsal") &&
    probe.includes("fill(testCode") &&
    probe.includes("fill(testQuantity") &&
    probe.includes('fill("",');
  if (
    !onlyPhase2gSentinel &&
    !phase2hRealCode &&
    !phase2jQuantity &&
    !phase2lCombined
  ) {
    checks.push(
      "mlcc-browser-add-by-code-probe.js: .fill( allowed only for Phase 2g sentinel, Phase 2h, Phase 2j, or Phase 2l gated fill/clear paths",
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
