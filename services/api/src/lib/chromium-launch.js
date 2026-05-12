/**
 * Wrapper around `playwright.chromium.launch` that applies container-safe
 * args when running in a sandboxed environment (Docker on Fly, CI, etc.).
 *
 * On a developer Mac, Chromium runs with its full sandbox — no changes.
 * In a Linux container without setuid sandbox bits, Chromium needs:
 *   --no-sandbox
 *   --disable-setuid-sandbox
 *   --disable-dev-shm-usage  (avoids /dev/shm < 64MB OOM crashes)
 *
 * Triggered by env: LK_CHROMIUM_SANDBOX=off
 * Set this in fly.toml [env] only — never in dev .env files.
 */
import { chromium } from "playwright";

const CONTAINER_SAFE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

function isSandboxDisabled() {
  return String(process.env.LK_CHROMIUM_SANDBOX ?? "")
    .trim()
    .toLowerCase() === "off";
}

/**
 * Drop-in replacement for `chromium.launch(opts)`. Merges container-safe args
 * onto the caller's `args` array when `LK_CHROMIUM_SANDBOX=off`.
 *
 * @param {Parameters<typeof chromium.launch>[0]} [opts]
 */
export async function launchChromium(opts = {}) {
  if (!isSandboxDisabled()) {
    return chromium.launch(opts);
  }
  const callerArgs = Array.isArray(opts.args) ? opts.args : [];
  const mergedArgs = [...new Set([...CONTAINER_SAFE_ARGS, ...callerArgs])];
  return chromium.launch({ ...opts, args: mergedArgs });
}
