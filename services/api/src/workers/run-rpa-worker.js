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
import { processOneRpaRun } from "./execution-worker.js";

// Polling cadence when the queue is empty — snappy enough for orders to feel
// instant, cheap enough that we're not hammering claim-next.
const IDLE_POLL_MS = 10_000;
// Back off briefly when processOneRpaRun throws unexpectedly, so an upstream
// outage doesn't turn into a tight error loop that floods logs.
const ERROR_BACKOFF_MS = 30_000;

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

  while (!shuttingDown) {
    inFlight = true;
    let result;
    try {
      result = await processOneRpaRun({ apiBaseUrl, workerId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rpa-worker] processOneRpaRun threw: ${msg}`);
      inFlight = false;
      await interruptibleSleep(ERROR_BACKOFF_MS);
      continue;
    }
    inFlight = false;

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

  console.log(`[rpa-worker] shutdown complete (inFlight at exit: ${inFlight})`);
  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[rpa-worker] fatal: ${msg}`);
  process.exit(1);
});
