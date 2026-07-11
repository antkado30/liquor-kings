/**
 * Persistent RPA worker daemon — the production path for execution_runs.
 *
 * Runs as its own Fly process (see fly.toml [processes].worker). Reads runs
 * from the queue and processes them one at a time, forever.
 *
 *   while (running) {
 *     processOneRpaRun()       // claim → run all stages → finalize
 *     if (queue empty) sleep(IDLE_POLL_MS)
 *     loop immediately if work was found (more is probably waiting)
 *   }
 *
 * CONCURRENCY MODEL — one run at a time per worker process. To handle more
 * load, scale by running more worker machines: `fly scale count worker=N`.
 * claim-next is atomic (we verified this), and the orphan reaper in
 * execution-run.service.js cleans up any run whose worker crashed mid-flight
 * (status='running' with stale heartbeat → marked failed, never auto-retried).
 *
 * GRACEFUL SHUTDOWN — on SIGINT/SIGTERM (Fly sends SIGINT on deploy), we set
 * shuttingDown=true so we stop claiming NEW runs. The in-flight run finishes
 * naturally. fly.toml's kill_timeout is set generously (600s) so a real RPA
 * run has time to complete. If Fly force-kills past the deadline, the reaper
 * picks up the orphaned run within ~15 min and marks it failed.
 */

import process from "node:process";
import { initSentry } from "../lib/sentry.js";
import { processOneRpaRun } from "./execution-worker.js";
import { forceCloseAll as forceCloseRpaSessions } from "./rpa-session-manager.js";

// AUDIT #29 (P1, 2026-06-13): the API entrypoint (index.js) calls initSentry(),
// but this worker daemon is a SEPARATE process (Dockerfile.worker's CMD) and
// never did — so even with SENTRY_DSN set on liquor-kings-worker, every RPA
// crash (the surface that actually matters most, per the 2026-06-09 wedge
// incident) was invisible to Sentry. Safe no-op if SENTRY_DSN is unset.
initSentry();

// Polling cadence when the queue is empty — snappy enough for orders to feel
// instant, cheap enough that we're not hammering claim-next.
//
// 10s → 2.5s (2026-07-11, claim-latency dig): with a 10s idle poll, a check
// fired between polls sat QUEUED for ~5s on average before the worker even
// looked — the single biggest structural chunk left in the 20-23s check
// under the <60s / instant-feel mandate. An idle claim-next is two light
// PostgREST reads (throttled reap + empty-queue check, see the route), so
// 4x the polls is negligible DB load at this worker count. If we ever run
// MANY workers, the scale answer is a long-poll claim (server holds the
// request until work appears) or LISTEN/NOTIFY — deliberately deferred
// until the fleet grows (YAGNI, documented in the dig notes).
const IDLE_POLL_MS = 2_500;
// Back off briefly when processOneRpaRun throws unexpectedly, so an upstream
// outage doesn't turn into a tight error loop that floods logs.
const ERROR_BACKOFF_MS = 30_000;
// Back-off when the API replies with a transient 5xx — historically "the app
// machine waking from standby" (Fly proxy returns 502/503/504 while it
// boots). 2026-06-14: the API app has min_machines_running=1 and
// auto_stop_machines="off", so it should already be warm — a 502/503/504 here
// is now almost always a brief blip (e.g. mid-rolling-deploy), not a cold
// boot. The old 60s value meant a real order sitting at "still working" with
// ZERO visible progress for a full minute (or two, if it hit twice) before
// the worker even claimed the run — a P0 under the instant-feel mandate. 8s
// still avoids hammering claim-next but recovers fast.
const TRANSIENT_5XX_BACKOFF_MS = 8_000;

// claimNextRun (and friends) throw Error("HTTP <code>: ...") on non-2xx.
// 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout are the
// signatures Fly's proxy emits while waking a stopped/booting machine.
//
// 2026-06-14 P0: also treat raw network failures as transient. Node's
// fetch() throws TypeError("fetch failed") on a dead/refused connection, and
// execution-worker.js's new fetchWithTimeout() throws "Fetch timeout after
// 20s: ..." when a connection hangs instead of failing outright (this is
// what turned a bad worker->API connection into a 4.5-HOUR stall on
// 2026-06-14 — every fetch hung for minutes before throwing, and the old
// "fetch failed" message didn't match this regex, so it got the slow 30s
// ERROR_BACKOFF_MS too). Both now get the fast 8s retry — a flaky connection
// should self-heal in seconds, not minutes.
const TRANSIENT_HTTP_RE = /^HTTP (502|503|504)\b/;
const TRANSIENT_NETWORK_RE = /^(fetch failed|Fetch timeout)/;
function isTransientUpstreamError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_HTTP_RE.test(msg) || TRANSIENT_NETWORK_RE.test(msg);
}

const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:8080";
const workerId =
  process.env.WORKER_ID ??
  `rpa-worker-${process.env.FLY_MACHINE_ID ?? Math.random().toString(36).slice(2, 8)}`;

let shuttingDown = false;
let inFlight = false;

function installShutdownHandlers() {
  const handler = (signal) => {
    if (shuttingDown) {
      // Second signal — operator wants us out now. Honor it.
      console.warn(`[rpa-worker] ${signal} received again — forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(
      `[rpa-worker] ${signal} received — will NOT claim new runs; ` +
        `letting in-flight run (if any) finish naturally before exit`,
    );
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}

async function interruptibleSleep(ms) {
  // Wake up early if shutdown is requested mid-sleep — otherwise SIGINT
  // during an empty-queue idle would wait the full IDLE_POLL_MS.
  const STEP = 250;
  let waited = 0;
  while (waited < ms && !shuttingDown) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(STEP, ms - waited)));
    waited += STEP;
  }
}

async function main() {
  installShutdownHandlers();
  console.log(
    `[rpa-worker] daemon starting — apiBaseUrl=${apiBaseUrl} ` +
      `workerId=${workerId} idlePollMs=${IDLE_POLL_MS}`,
  );

  /*
    DEAD-MAN SWITCH (2026-06-12, the worker-wedge incident). On 2026-06-09
    the machine got into a state where EVERY login attempt timed out
    (zombie Chromium accumulation starving the box) and it ground through
    29 consecutive identical failures over two days, burning ~2 minutes of
    queue time per doomed run while real orders piled up behind it. A
    process can't always heal itself — but it CAN refuse to keep lying.
    After N consecutive Stage-1 (login) failures, tear down everything and
    exit non-zero; Fly restarts the machine from a clean slate (fresh
    Chromium, fresh memory). One restart fixes what days of grinding
    didn't. Doctrine: loud failures only.
  */
  const STAGE1_DEADMAN_THRESHOLD = 3;
  let consecutiveStage1Failures = 0;

  while (!shuttingDown) {
    inFlight = true;
    let result;
    try {
      result = await processOneRpaRun({ apiBaseUrl, workerId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      inFlight = false;
      if (isTransientUpstreamError(err)) {
        // Almost always the API machine waking from standby. Quiet log,
        // longer back-off, don't treat it as a fatal failure.
        console.warn(
          `[rpa-worker] transient upstream (${msg}) — backing off ` +
            `${TRANSIENT_5XX_BACKOFF_MS / 1000}s for API to recover`,
        );
        await interruptibleSleep(TRANSIENT_5XX_BACKOFF_MS);
      } else {
        console.error(`[rpa-worker] processOneRpaRun threw: ${msg}`);
        await interruptibleSleep(ERROR_BACKOFF_MS);
      }
      continue;
    }
    inFlight = false;

    // Dead-man bookkeeping: only claimed runs move the counter. Stage-1
    // failures increment; any run that gets PAST Stage 1 (success OR a
    // later-stage failure) proves the browser/network path works and
    // resets it. Idle polls don't touch it.
    if (result?.claimed !== false) {
      if (result?.failed === true && result?.stage === "stage1_login") {
        consecutiveStage1Failures += 1;
        console.warn(
          `[rpa-worker] stage1 failure ${consecutiveStage1Failures}/${STAGE1_DEADMAN_THRESHOLD} ` +
            `(error=${result?.error ?? "unknown"})`,
        );
        if (consecutiveStage1Failures >= STAGE1_DEADMAN_THRESHOLD) {
          console.error(
            `[rpa-worker] DEAD-MAN: ${consecutiveStage1Failures} consecutive Stage-1 login ` +
              `failures — this machine is likely wedged (zombie browsers / starved memory). ` +
              `Tearing down and exiting 1 so Fly restarts us clean.`,
          );
          try {
            await forceCloseRpaSessions("stage1_deadman");
          } catch {
            /* exiting anyway */
          }
          process.exit(1);
        }
      } else {
        consecutiveStage1Failures = 0;
      }
    }

    if (result?.claimed === false) {
      // Queue was empty — quiet poll cadence.
      await interruptibleSleep(IDLE_POLL_MS);
    } else if (result?.success === false) {
      // A run was claimed and failed (finalized properly). Tiny breath before
      // claiming the next — keeps logs readable, no real cost.
      await interruptibleSleep(1_000);
    }
    // Otherwise: claimed + processed cleanly — loop immediately. There's
    // probably more work waiting.
  }

  // Tear down any held persistent MILO session (task #46 Phase A). Safe
  // no-op when persist is disabled or no session is currently held.
  // Done AFTER the in-flight check above so we never close a session
  // mid-use.
  try {
    await forceCloseRpaSessions("worker_shutdown");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rpa-worker] forceCloseRpaSessions raised on shutdown: ${msg}`);
  }

  console.log(`[rpa-worker] shutdown complete (inFlight at exit: ${inFlight})`);
  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[rpa-worker] fatal: ${msg}`);
  process.exit(1);
});
