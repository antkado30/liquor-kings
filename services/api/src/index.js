import "dotenv/config";
import { initSentry } from "./lib/sentry.js";

initSentry();

const { default: app } = await import("./app.js");

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

/*
  GRACEFUL SHUTDOWN — root cause of the 2026-07-02 white-screen (postmortem in
  docs/lk/STATE-OF-LIQUOR-KINGS.md §0). Fly restarts the machine (every deploy
  AND every `fly secrets set`) by sending SIGINT. With no handler here — and
  with the start command being `npm start`, which does NOT forward signals to
  the node child — the process never exited on SIGINT. Fly then waited the full
  kill_timeout (was 5m) before force-killing with SIGTERM. So EVERY restart took
  ~5 minutes, and with only one API machine the site was blank the whole time.
  Thursday's arming ran several secrets changes back-to-back; Tony hit the site
  mid-restart → white screen.

  Fix: close the HTTP server on SIGINT/SIGTERM and exit immediately, so a
  restart takes ~seconds. Paired with (a) the start command changed to exec
  node directly (fly.toml) so signals actually reach this process, (b) a shorter
  kill_timeout, and (c) running 2 API machines so restarts are always rolling
  (one serves while the other cycles = zero downtime).
*/
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing HTTP server`);
  server.close(() => {
    console.log("[shutdown] server closed cleanly, exiting");
    process.exit(0);
  });
  // Safety net: if a connection hangs, force-exit well under Fly's kill_timeout
  // so a restart can never stall the machine again.
  setTimeout(() => {
    console.log("[shutdown] force-exit after 10s");
    process.exit(0);
  }, 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
