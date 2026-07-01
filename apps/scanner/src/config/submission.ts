/**
 * Is a REAL MLCC order submission wired into the app?
 *
 * FLIPPED TRUE 2026-07-01 for the supervised Colony go-live (runbook:
 * docs/lk/runbooks/order-day-2026-07-02.md). SAFE while the env gates are
 * off: both the ARMED copy and the "submit" run mode require the
 * server-signaled armed state (env LK_ALLOW_ORDER_SUBMISSION=yes AND
 * stores.allow_order_submission=true) on top of this flag —
 * `submissionArmed = allowOrderSubmission && REAL_SUBMISSION_WIRED`
 * (CartDrawer). With env disarmed, every run stays a practice check with
 * practice copy, and the server + worker + checkout each re-gate
 * independently regardless of what the client asks for.
 */
export const REAL_SUBMISSION_WIRED = true;
