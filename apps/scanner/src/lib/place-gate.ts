/**
 * place-gate — the pure decision for whether "Place Order" is unlocked
 * (two-step Check → SEE → Place, Tony's design decided 2026-07-01,
 * built 2026-07-11).
 *
 * The rhythm mirrors MILO: check the cart → SEE MILO's answer → then
 * deliberately place. Tony's two rules, verbatim from TONY-WANTS:
 *   1. "Place trusts a fresh check" — recent green check (<~10 min) for
 *      a byte-identical cart → Place sends immediately.
 *   2. "Any cart edit LOCKS Place until re-checked" — you can never send
 *      a cart MILO hasn't blessed.
 *
 * This gate is UX honesty, not a safety layer: the server's Stage-5
 * triple gate re-validates regardless of what this returns. It still
 * gets money-path rigor because a WRONGLY-UNLOCKED Place misleads the
 * user about what MILO blessed — so every input is checked strictly and
 * every locked state names its reason in one human sentence (doctrine
 * §5/§16: nothing fails silently).
 */

/** Tony's trust window: a green check older than this can't back a Place. */
export const CHECK_TRUST_WINDOW_MS = 10 * 60 * 1000;

export type LastGreenCheck = {
  /** hashCart() of the exact lines MILO blessed. */
  cartHash: string;
  /** Epoch ms when the green result landed. */
  at: number;
  /** The run behind it — for provenance/debugging. */
  runId: string;
};

export type PlaceGateInput = {
  /** Both arming gates as the client understands them (env-driven flag). */
  armed: boolean;
  /** hashCart() of the cart lines currently on screen. */
  currentCartHash: string;
  lastGreenCheck: LastGreenCheck | null;
  nowMs: number;
  /** Local MLCC rule engine verdict (9L/ADA/etc.) — instant, client-side. */
  rulesValid: boolean;
  /** A run is being fired or is already in flight — no double-fire. */
  busy: boolean;
  windowMs?: number;
};

export type PlaceGateResult =
  | { ready: true; checkedAgoMs: number }
  | { ready: false; reason: string };

export function resolvePlaceGate(input: PlaceGateInput): PlaceGateResult {
  const windowMs = input.windowMs ?? CHECK_TRUST_WINDOW_MS;

  if (!input.armed) {
    return { ready: false, reason: "Practice mode — placing is off." };
  }
  if (input.busy) {
    return { ready: false, reason: "A run is already in progress." };
  }
  if (!input.rulesValid) {
    return { ready: false, reason: "Fix the issues above first." };
  }
  if (!input.currentCartHash) {
    return { ready: false, reason: "Cart is empty." };
  }

  const check = input.lastGreenCheck;
  if (!check || !check.cartHash || typeof check.at !== "number") {
    return { ready: false, reason: "Check with MLCC first." };
  }
  if (check.cartHash !== input.currentCartHash) {
    return { ready: false, reason: "Cart changed — check with MLCC again." };
  }

  const ageMs = input.nowMs - check.at;
  // Assert the POSITIVE window condition and fail closed on anything else.
  // NaN (corrupted stored record) fails EVERY comparison — a naive
  // `ageMs < 0 || ageMs >= windowMs` reject-list would let NaN sail
  // through to "unlocked". Negative age = device clock anomaly (a check
  // from "the future") — locked too, honestly.
  if (!(Number.isFinite(ageMs) && ageMs >= 0 && ageMs < windowMs)) {
    return { ready: false, reason: "Check expired — check with MLCC again." };
  }

  return { ready: true, checkedAgoMs: ageMs };
}
