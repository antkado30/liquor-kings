#!/usr/bin/env node
/**
 * pull-latest-har.mjs — download the newest Playwright network.har from the
 * LK RPA worker to your Mac, for offline analysis of a real MLCC order run.
 *
 * WHEN TO RUN: AFTER a worker run completes (e.g. after tomorrow's real MLCC
 * order). The worker writes network.har to /app/services/api/rpa-output/
 * login-<timestamp>/network.har — but ONLY if the run's browsing context was
 * closed on teardown (the worker's finally now closes context before browser
 * so Playwright flushes recordHar). This script just fetches that file.
 *
 * READ-ONLY on the worker: the only remote commands issued are
 *   `ls` (to find the newest HAR) and `fly ssh sftp get` (to download it).
 * It NEVER deletes, restarts, deploys, sets a secret, or triggers a run.
 * It prints no secrets. No npm dependencies — shells out to the `fly` CLI
 * (Tony is already authenticated).
 *
 * Usage:
 *   node services/api/scripts/pull-latest-har.mjs [--app liquor-kings-worker]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// --app flag (default: the worker app).
const DEFAULT_APP = "liquor-kings-worker";
let app = DEFAULT_APP;
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--app" && i + 1 < process.argv.length) {
    app = process.argv[i + 1];
    i += 1;
  } else if (process.argv[i] === "--help" || process.argv[i] === "-h") {
    console.log("Usage: pull-latest-har.mjs [--app liquor-kings-worker]");
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${process.argv[i]}`);
    process.exit(2);
  }
}

const REMOTE_GLOB = "/app/services/api/rpa-output/login-*/network.har";

function runFly(args) {
  return execFileSync("fly", args, { encoding: "utf8" }).toString();
}

// Step 1 — find the newest HAR path on the worker (read-only `ls`).
let remotePath = "";
try {
  const out = runFly([
    "ssh",
    "console",
    "-a",
    app,
    "-C",
    `sh -lc 'ls -1t ${REMOTE_GLOB} 2>/dev/null | head -1'`,
  ]);
  remotePath = out.trim().split("\n")[0].trim();
} catch (e) {
  console.error(`Failed to list HARs on the worker via 'fly ssh console'.`);
  console.error(String(e?.stderr || e?.message || e).trim());
  process.exit(1);
}

if (!remotePath) {
  console.error(
    "No HAR found on the worker — was LK_RPA_PERSIST_SESSION=no and did a run complete?",
  );
  process.exit(1);
}
console.log(`Newest HAR on worker: ${remotePath}`);

// Step 2 — download to a local ./rpa-captures/ dir (read-only sftp get).
const localDir = path.resolve(process.cwd(), "rpa-captures");
mkdirSync(localDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const localPath = path.join(localDir, `network-${stamp}.har`);

try {
  runFly(["ssh", "sftp", "get", remotePath, localPath, "-a", app]);
} catch (e) {
  console.error(`Failed to download ${remotePath} via 'fly ssh sftp get'.`);
  console.error(String(e?.stderr || e?.message || e).trim());
  process.exit(1);
}

// Step 3 — report the local absolute path + size in KB.
const sizeKb = Math.round(statSync(localPath).size / 1024);
console.log(`Saved: ${localPath} (${sizeKb} KB)`);
