/**
 * resolveFromCartRunMode — pure creation-time decision for the metadata.mode
 * stamped on a from-cart run. This is the money-path gate at run CREATION.
 *
 * Real submission requires THREE gates, each enforced independently and
 * re-checked downstream (defense in depth):
 *   1. metadata.mode === "submit"  ← decided HERE
 *   2. store.allow_order_submission === true  ← read by the caller, passed in
 *   3. env LK_ALLOW_ORDER_SUBMISSION === "yes" ← read by the caller, passed in
 * The worker (execution-worker.js) re-reads #2 from the DB and #3 from
 * process.env at runtime, and checkout.js gates a third time. This helper is
 * only the creation-time layer.
 *
 * Rule: mode is "submit" ONLY when the caller explicitly requested "submit"
 * AND both gates are armed. ANY ambiguity (wrong requestedMode, undefined
 * flags, false flags) → "dry_run". Bias is always toward dry_run: a false
 * "submit" would risk a real order; a false "dry_run" only costs a practice
 * run.
 *
 * @param {object} args
 * @param {string} args.requestedMode  "submit" requests real submission; anything else is dry_run.
 * @param {boolean} args.envArmed      env LK_ALLOW_ORDER_SUBMISSION === "yes" (caller reads process.env).
 * @param {boolean} args.storeArmed    store.allow_order_submission === true (caller reads the DB).
 * @returns {{ mode: "submit" | "dry_run", downgradedFromSubmit: boolean }}
 */
export function resolveFromCartRunMode({ requestedMode, envArmed, storeArmed }) {
  if (requestedMode === "submit") {
    const armed = envArmed === true && storeArmed === true;
    return { mode: armed ? "submit" : "dry_run", downgradedFromSubmit: !armed };
  }
  return { mode: "dry_run", downgradedFromSubmit: false };
}
