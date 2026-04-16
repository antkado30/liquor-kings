/**
 * MLCC phase runner scaffolding (rebuild phase 1+).
 * Wraps existing phase functions without changing their internals.
 */

import {
  runAddByCodeProbePhase,
  runAddByCodePhase2cFieldHardening,
  runAddByCodePhase2dMutationBoundaryMap,
  runAddByCodePhase2eMutationBoundaryMap,
  runAddByCodePhase2fSafeOpenConfirm,
} from "./mlcc-browser-add-by-code-probe.js";

export const MLCC_PHASE_RUNNER_MODEL_VERSION = "mlcc-phase-runner-v1";

/**
 * @typedef {object} MlccPhaseContext
 * @property {import('playwright').Page} page
 * @property {object} config
 * @property {(args: { progressStage: string, progressMessage: string }) => Promise<void>} heartbeat
 * @property {Function} buildStepEvidence
 * @property {Function} buildEvidence
 * @property {unknown[]} evidenceCollected
 * @property {((stage: string, filename: string) => Promise<unknown>) | null | undefined} [safeFlowShot]
 * @property {{ blockedRequestCount?: number } | null | undefined} [guardStats] — Layer 2 counter ref (same object as worker `guardStats`)
 * @property {{ phase2bResult?: unknown }} [runnerScratch] — set by phase 2b for downstream phases in the same pipeline
 */

/**
 * Shared factory for the context object passed to `runMlccPhasePipeline`.
 * @param {object} args
 * @param {import('playwright').Page} args.page
 * @param {object} args.config
 * @param {(args: { progressStage: string, progressMessage: string }) => Promise<void>} args.heartbeat
 * @param {Function} args.buildStepEvidence
 * @param {Function} args.buildEvidence
 * @param {unknown[]} args.evidenceCollected
 * @param {((stage: string, filename: string) => Promise<unknown>) | null | undefined} [args.safeFlowShot]
 * @param {{ blockedRequestCount?: number } | null | undefined} [args.guardStats]
 * @returns {MlccPhaseContext}
 */
export function buildMlccPhaseContext({
  page,
  config,
  heartbeat,
  buildStepEvidence,
  buildEvidence,
  evidenceCollected,
  safeFlowShot,
  guardStats,
}) {
  return {
    page,
    config,
    heartbeat,
    buildStepEvidence,
    buildEvidence,
    evidenceCollected,
    safeFlowShot: safeFlowShot ?? null,
    guardStats: guardStats ?? null,
    runnerScratch: {},
  };
}

/**
 * @typedef {object} MlccPhaseDescriptor
 * @property {string} name
 * @property {(ctx: MlccPhaseContext) => Promise<unknown>} run
 * @property {(ctx: MlccPhaseContext, result: unknown) => Promise<boolean>} verify
 * @property {(ctx: MlccPhaseContext, result: unknown) => Promise<void>} emitEvidence
 */

/**
 * @param {object} args
 * @param {MlccPhaseDescriptor[]} args.phases
 * @param {MlccPhaseContext} args.context
 * @param {(entry: { event: string, name?: string, verify_ok?: boolean, error?: string }) => void} [args.log]
 * @returns {Promise<{ results: Array<{ name: string, result: unknown, verify_ok: boolean }> }>}
 */
export async function runMlccPhasePipeline({ phases, context, log }) {
  const logFn = typeof log === "function" ? log : () => {};
  /** @type {Array<{ name: string, result: unknown, verify_ok: boolean }>} */
  const results = [];

  for (const phase of phases) {
    logFn({ event: "phase_start", name: phase.name });
    let result;
    let verifyOk = false;
    try {
      result = await phase.run(context);
      verifyOk = await phase.verify(context, result);
      await phase.emitEvidence(context, result);
    } catch (err) {
      logFn({
        event: "phase_error",
        name: phase.name,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    logFn({ event: "phase_end", name: phase.name, verify_ok: verifyOk });
    results.push({ name: phase.name, result, verify_ok: verifyOk });
  }

  return { results };
}

/**
 * Read one phase's result from a completed pipeline (`results.find` + null fallback).
 * @param {{ results: Array<{ name: string, result: unknown, verify_ok: boolean }> }} pipeline
 * @param {string} phaseName — descriptor `name`
 * @returns {unknown}
 */
export function getMlccPipelinePhaseResult(pipeline, phaseName) {
  return pipeline.results.find((r) => r.name === phaseName)?.result ?? null;
}

/**
 * Phase 2b — existing add-by-code probe; logic lives in runAddByCodeProbePhase.
 * @returns {MlccPhaseDescriptor}
 */
export function createMlccPhase2bDescriptor() {
  return {
    name: "phase_2b_add_by_code_probe",
    run: async (ctx) => {
      const result = await runAddByCodeProbePhase({
        page: ctx.page,
        config: ctx.config,
        heartbeat: ctx.heartbeat,
        buildStepEvidence: ctx.buildStepEvidence,
        buildEvidence: ctx.buildEvidence,
        evidenceCollected: ctx.evidenceCollected,
      });
      if (ctx.runnerScratch && typeof ctx.runnerScratch === "object") {
        ctx.runnerScratch.phase2bResult = result;
      }
      return result;
    },
    verify: async (ctx, result) =>
      result != null && typeof result === "object" && "add_by_code_ui_reached" in result,
    /** Intentionally empty: Phase 2b already emits full probe evidence; avoid duplicate runner rows until migration. */
    emitEvidence: async () => {},
  };
}

/**
 * Phase 2c — field hardening; logic lives in runAddByCodePhase2cFieldHardening.
 * Uses `ctx.runnerScratch.phase2bResult` from phase 2b when run in the same pipeline.
 * @returns {MlccPhaseDescriptor}
 */
export function createMlccPhase2cDescriptor() {
  return {
    name: "phase_2c_field_hardening",
    run: async (ctx) => {
      const phase2bFieldInfo = ctx.runnerScratch?.phase2bResult?.field_info ?? null;
      try {
        return await runAddByCodePhase2cFieldHardening({
          page: ctx.page,
          config: ctx.config,
          heartbeat: ctx.heartbeat,
          buildEvidence: ctx.buildEvidence,
          evidenceCollected: ctx.evidenceCollected,
          buildStepEvidence: ctx.buildStepEvidence,
          phase2bFieldInfo,
          safeFlowShot: ctx.safeFlowShot,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new Error(`MLCC add-by-code phase 2c failed: ${m}`);
      }
    },
    verify: async (ctx, result) =>
      result != null &&
      typeof result === "object" &&
      "phase_2c_safe_no_cart_mutation" in result,
    /** Intentionally empty: Phase 2c already emits full evidence from the probe implementation. */
    emitEvidence: async () => {},
  };
}

/**
 * Phase 2d — broad mutation-boundary map (read-only scan). Mutually exclusive with 2e in worker config.
 * @returns {MlccPhaseDescriptor}
 */
export function createMlccPhase2dDescriptor() {
  return {
    name: "phase_2d_mutation_boundary_map",
    run: async (ctx) => {
      try {
        return await runAddByCodePhase2dMutationBoundaryMap({
          page: ctx.page,
          config: ctx.config,
          heartbeat: ctx.heartbeat,
          buildEvidence: ctx.buildEvidence,
          evidenceCollected: ctx.evidenceCollected,
          guardStats: ctx.guardStats,
          buildStepEvidence: ctx.buildStepEvidence,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new Error(`MLCC add-by-code phase 2d failed: ${m}`);
      }
    },
    verify: async (ctx, result) =>
      result != null &&
      typeof result === "object" &&
      "phase_2d_boundary_mapping_success" in result,
    /** Intentionally empty: Phase 2d already emits full evidence from the probe implementation. */
    emitEvidence: async () => {},
  };
}

/**
 * Phase 2e — scoped mutation-boundary map (read-only). Mutually exclusive with 2d in worker config.
 * Delegates to runAddByCodePhase2eMutationBoundaryMap (default maxControls = 100).
 * @returns {MlccPhaseDescriptor}
 */
export function createMlccPhase2eDescriptor() {
  return {
    name: "phase_2e_scoped_mutation_boundary_map",
    run: async (ctx) => {
      try {
        return await runAddByCodePhase2eMutationBoundaryMap({
          page: ctx.page,
          config: ctx.config,
          heartbeat: ctx.heartbeat,
          buildEvidence: ctx.buildEvidence,
          evidenceCollected: ctx.evidenceCollected,
          guardStats: ctx.guardStats,
          buildStepEvidence: ctx.buildStepEvidence,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new Error(`MLCC add-by-code phase 2e failed: ${m}`);
      }
    },
    verify: async (ctx, result) =>
      result != null &&
      typeof result === "object" &&
      "phase_2e_boundary_mapping_success" in result,
    /** Intentionally empty: Phase 2e already emits full evidence from the probe implementation. */
    emitEvidence: async () => {},
  };
}

/**
 * Phase 2f — bounded safe-open confirmation (at most one click). Mutually independent of 2d/2e ordering after boundary phase.
 * @returns {MlccPhaseDescriptor}
 */
export function createMlccPhase2fDescriptor() {
  return {
    name: "phase_2f_safe_open_confirm",
    run: async (ctx) => {
      try {
        return await runAddByCodePhase2fSafeOpenConfirm({
          page: ctx.page,
          config: ctx.config,
          heartbeat: ctx.heartbeat,
          buildEvidence: ctx.buildEvidence,
          evidenceCollected: ctx.evidenceCollected,
          guardStats: ctx.guardStats,
          buildStepEvidence: ctx.buildStepEvidence,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new Error(`MLCC add-by-code phase 2f failed: ${m}`);
      }
    },
    verify: async (ctx, result) =>
      result != null &&
      typeof result === "object" &&
      "expected_ui_state_after_phase_2f" in result,
    /** Intentionally empty: Phase 2f already emits full evidence from the probe implementation. */
    emitEvidence: async () => {},
  };
}
