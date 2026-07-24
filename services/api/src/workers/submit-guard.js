/**
 * submit-guard — the last-inch, fail-closed guarantee that a CHECK never
 * submits (Tony's invariant, 2026-07-23).
 *
 * The submit machinery (checkoutOnMilo / submitCartViaApi) is reachable ONLY
 * from a real order run (`run_type === "rpa_run"`). A Check / preview
 * (`validate_only`) and a cart reset (`cart_reset_only`) short-circuit long
 * before it. That has always been TRUE structurally — but structure is an
 * accident a future refactor could silently break. This guard makes it a
 * HARD RUNTIME LAW: called immediately before every submit call site, it
 * throws loudly if the run isn't an order run, so a check can never slip into
 * the submit path even if the control flow above it is one day rearranged.
 *
 * Pure + dependency-free on purpose: it can be unit-tested without loading the
 * worker, and it can ONLY prevent a submit — it can never cause one.
 *
 * This is defense in depth, not the primary gate. The real submit still
 * requires the deliberate flow (fresh green check + unchanged cart + explicit
 * confirmation) and the per-store real-ordering setting downstream. This guard
 * exists so the ONE thing Tony said to "make sure of" — check never submits —
 * is impossible to regress.
 */

/** The only run_type permitted to reach the submit machinery. */
export const SUBMIT_ALLOWED_RUN_TYPE = "rpa_run";

/**
 * Throw unless this run is a real order run. Call IMMEDIATELY before any
 * submit / checkout call.
 *
 * @param {object} args
 * @param {string|null|undefined} args.runType  payload.metadata.run_type
 * @param {string} [args.site]  short label for which call site (for the error)
 * @throws {Error} with a loud, attributable message when runType !== "rpa_run"
 */
export function assertSubmitMachineryAllowed({ runType, site = "submit" } = {}) {
  if (runType !== SUBMIT_ALLOWED_RUN_TYPE) {
    const err = new Error(
      `SUBMIT MACHINERY BLOCKED at ${site}: run_type="${String(runType)}" reached the submit path, ` +
        `but only "${SUBMIT_ALLOWED_RUN_TYPE}" (a real order) may submit. A check/preview must NEVER reach here.`,
    );
    err.code = "LK_CHECK_NEVER_SUBMITS_VIOLATION";
    throw err;
  }
}
