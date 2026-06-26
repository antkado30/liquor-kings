/**
 * Is a REAL MLCC order submission wired into the app? FALSE until P2.
 *
 * The scanner's order path (from-cart) hardcodes metadata.mode="dry_run"
 * server-side, so every "order" is a dry-run practice check regardless of the
 * store flag or the env gate. The UI must present itself as a practice check,
 * never a real order, until this is true.
 *
 * P2 replaces this with a server-provided "armed" signal (mode==="submit" +
 * store.allow_order_submission + env LK_ALLOW_ORDER_SUBMISSION) and the copy
 * flips everywhere at once.
 */
export const REAL_SUBMISSION_WIRED = false;
