/**
 * Gate 3 — MLCC execution enqueue: allow `execution_run` creation only when shared
 * readiness evaluation says `ready === true` (same path as GET mlcc-execution-readiness).
 */

import { serializeMlccExecutionReadiness } from "./mlcc-execution-readiness-serialize.js";
import { MLCC_EXECUTION_ITEM_ID_MESSAGE } from "../utils/mlcc-execution-item-guard.js";

/**
 * @param {{ statusCode: number; body?: Record<string, unknown> }} evalResult
 *   Return value of {@link evaluateMlccExecutionReadinessForSubmittedCart}.
 * @returns { { ok: true; readiness: ReturnType<typeof serializeMlccExecutionReadiness> }
 *   | { ok: false; statusCode: number; body: Record<string, unknown> } }
 */
export function assertMlccExecutionReadinessForEnqueue(evalResult) {
  const readiness = serializeMlccExecutionReadiness(evalResult);

  if (evalResult.statusCode !== 200) {
    if (evalResult.statusCode === 404) {
      return {
        ok: false,
        statusCode: 404,
        body: { error: readiness.error },
      };
    }
    const body = { error: readiness.error };
    if (
      readiness.message != null &&
      String(readiness.message) !== String(readiness.error)
    ) {
      body.message = readiness.message;
    }
    return {
      ok: false,
      statusCode: evalResult.statusCode,
      body,
    };
  }

  if (readiness.ready !== true) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: readiness.error ?? "MLCC_ITEM_ID_REQUIRED",
        message: readiness.message ?? MLCC_EXECUTION_ITEM_ID_MESSAGE,
        blocking_lines: Array.isArray(readiness.blocking_lines)
          ? readiness.blocking_lines
          : [],
      },
    };
  }

  return { ok: true, readiness };
}
