/**
 * resolveFromCartRunMode — pure creation-time decision for the metadata.mode
 * stamped on a from-cart run. This is the money-path gate at run CREATION.
 *
 * Real submission requires (each enforced independently, re-checked downstream
 * — defense in depth):
 *   1. metadata.mode === "submit"  ← decided HERE (only set after the
 *      deliberate check → place-gate → confirm flow on the client)
 *   2. store.allow_order_submission === true  ← "this is a real store"
 *      (caller reads the DB, passes in as storeArmed)
 *   3. env LK_ALLOW_ORDER_SUBMISSION is NOT "no"  ← the break-glass kill
 *      (caller reads process.env, passes in as envKilled). 2026-07-23: env
 *      retired from a required arm to an emergency kill only — its absence
 *      permits, so no laptop is needed to arm. See
 *      docs/lk/architecture/submit-arming-model.md.
 * The worker re-reads #2 from the DB and #3 from process.env at runtime, and
 * checkout.js / submitCartViaApi gate again. This helper is the creation layer.
 *
 * Rule: mode is "submit" ONLY when the caller explicitly requested "submit"
 * AND the store is a real-ordering store AND the kill is not set. ANY
 * ambiguity → "dry_run". Bias is always toward dry_run: a false "submit"
 * risks a real order; a false "dry_run" only costs a practice run.
 *
 * @param {object} args
 * @param {string} args.requestedMode  "submit" requests real submission; anything else is dry_run.
 * @param {boolean} args.envKilled     env LK_ALLOW_ORDER_SUBMISSION === "no" (break-glass kill engaged).
 * @param {boolean} args.storeArmed    store.allow_order_submission === true (caller reads the DB).
 * @returns {{ mode: "submit" | "dry_run", downgradedFromSubmit: boolean }}
 */
export function resolveFromCartRunMode({ requestedMode, envKilled, storeArmed }) {
  if (requestedMode === "submit") {
    const armed = envKilled !== true && storeArmed === true;
    return { mode: armed ? "submit" : "dry_run", downgradedFromSubmit: !armed };
  }
  return { mode: "dry_run", downgradedFromSubmit: false };
}
