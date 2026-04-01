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

let code = run(path.join(__dirname, "verify-contracts.mjs"));
if (code !== 0) process.exit(code);

code = run(path.join(__dirname, "verify-rpa-safety.mjs"));
if (code !== 0) process.exit(code);

console.log("[verify:lk:architecture] OK (contracts + rpa-safety)");
process.exit(0);
