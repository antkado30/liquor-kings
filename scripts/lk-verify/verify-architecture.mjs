#!/usr/bin/env node
/**
 * verify:lk:architecture — run contract + RPA safety verification.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

function run(nodeScript) {
  const r = spawnSync(process.execPath, [nodeScript], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

const code = run(path.join(__dirname, "verify-contracts.mjs"));
if (code !== 0) process.exit(code);

// verify-rpa-safety.mjs was retired 2026-07-18 with the legacy RPA
// browser-automation subsystem it policed (strangler-fig final cut). The live
// money-path safety it used to assert now lives in the unit suite: the submit
// triple-gate (engine-submit.unit.test.js) and the submitted_unconfirmed
// never-auto-retry rule (execution-run-recovery / execution-failure tests).
console.log("[verify:lk:architecture] OK (contracts)");
process.exit(0);
