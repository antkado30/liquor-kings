/**
 * LOOP WATCHDOG (2026-07-28 — the 12-hour silent wedge, found live two
 * days before the first engine order).
 *
 * The worker logged its last line at 06:19Z and then went completely
 * silent: no claims, no errors, while a real check sat unclaimed at
 * "Starting up" for minutes on Tony's phone — and `fly machine restart`
 * then 408'd because the graceful shutdown handler was politely waiting
 * for the hung run to finish (it never would). The Stage-1 dead-man
 * (2026-06-12) only catches runs that FAIL; a run — or any await in the
 * loop — that HANGS without returning freezes the daemon forever with
 * zero symptoms.
 *
 * Same lesson as the dead-man, generalized: a process can't always heal
 * itself, but it can refuse to keep lying. If the main loop hasn't
 * completed an iteration inside LOOP_WEDGE_LIMIT_MS, the process
 * declares itself wedged and exits non-zero; Fly restarts it from a
 * clean slate (fresh Chromium, fresh sockets, fresh memory).
 *
 * 20 minutes is deliberately far above any legitimate iteration: idle
 * polls complete in seconds, node-engine runs in well under a minute,
 * and even a browser-engine submit on a big cart finishes inside ~10.
 * Anything past 20 is not "slow" — it is stuck, and a restart is the
 * only honest move. (A run killed mid-hang is finalized by the API's
 * stale-run recovery sweep; validate runs are harmless to re-run and
 * submits are protected by the truth rule — never auto-retried.)
 *
 * Lives in its own module (not run-rpa-worker.js) because the worker
 * file self-executes main() on import — tests import THIS file only.
 */

export const LOOP_WEDGE_LIMIT_MS = 20 * 60_000;
export const WATCHDOG_CHECK_INTERVAL_MS = 30_000;

/** Pure verdict so the threshold behavior is unit-testable. */
export function loopWedgeVerdict(nowMs, lastTickMs, limitMs = LOOP_WEDGE_LIMIT_MS) {
  const stalledMs = Math.max(0, nowMs - lastTickMs);
  return { wedged: stalledMs > limitMs, stalledMs };
}

/**
 * Start the watchdog interval.
 * @param {object} opts
 * @param {() => number} opts.getLastTickMs - reads the loop's heartbeat.
 * @param {(msg: string) => void} [opts.onWedged] - defaults to console.error + process.exit(1).
 * @returns {ReturnType<typeof setInterval>} the (unref'd) timer.
 */
export function startLoopWatchdog({ getLastTickMs, onWedged }) {
  const handle =
    onWedged ??
    ((msg) => {
      console.error(msg);
      process.exit(1);
    });
  const timer = setInterval(() => {
    const { wedged, stalledMs } = loopWedgeVerdict(Date.now(), getLastTickMs());
    if (wedged) {
      handle(
        `[rpa-worker] WATCHDOG: main loop has not completed an iteration in ` +
          `${Math.round(stalledMs / 1000)}s (limit ${LOOP_WEDGE_LIMIT_MS / 1000}s) — ` +
          `the process is wedged (hung run or stuck await). Exiting 1 so Fly ` +
          `restarts us from a clean slate.`,
      );
    }
  }, WATCHDOG_CHECK_INTERVAL_MS);
  // Never keep the process alive just for the watchdog.
  timer.unref?.();
  return timer;
}
