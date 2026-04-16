/**
 * Canonical `mlcc_execution_readiness` JSON shape for cart detail, cart history list,
 * and (with {@link readinessDedicatedHttpPayload}) the dedicated readiness GET.
 *
 * Input is always the return value of {@link evaluateMlccExecutionReadinessForSubmittedCart}
 * from `cart-execution-payload.service.js`.
 */

/**
 * @param {{ statusCode: number; body?: Record<string, unknown> }} evalResult
 * @returns {{
 *   ready: boolean;
 *   error: string | null;
 *   message: string | null;
 *   blocking_lines: unknown[];
 * }}
 */
export function serializeMlccExecutionReadiness(evalResult) {
  const { statusCode, body = {} } = evalResult;
  if (statusCode !== 200) {
    const err = body.error ?? "readiness_unavailable";
    const message =
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "MLCC readiness could not be evaluated.";
    return {
      ready: false,
      error: typeof err === "string" ? err : "readiness_unavailable",
      message,
      blocking_lines: [],
    };
  }
  if (body.ready === true) {
    return {
      ready: true,
      error: null,
      message: null,
      blocking_lines: [],
    };
  }
  return {
    ready: false,
    error: body.error != null ? String(body.error) : null,
    message: typeof body.message === "string" ? body.message : null,
    blocking_lines: Array.isArray(body.blocking_lines) ? body.blocking_lines : [],
  };
}

/**
 * Dedicated GET `/mlcc-execution-readiness` body: same compact fields plus legacy `ok`
 * (true when evaluator set `body.ok`, i.e. HTTP 200 evaluation path).
 *
 * @param {{ statusCode: number; body?: Record<string, unknown> }} evalResult
 * @returns {Record<string, unknown>}
 */
export function readinessDedicatedHttpPayload(evalResult) {
  const serialized = serializeMlccExecutionReadiness(evalResult);
  return {
    ok: evalResult.body?.ok === true,
    ...serialized,
  };
}
