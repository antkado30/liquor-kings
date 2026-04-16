#!/usr/bin/env node
/**
 * doctor:lk:mlcc-dry-run — read-only static prerequisites for SAFE MODE MLCC dry-run.
 * No worker import, no browser, no network, no database, no order submission.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

function mustExist(rel, label) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    return { ok: false, message: `${label}: missing file ${rel}` };
  }
  return { ok: true, abs };
}

function mustMatch(rel, label, pattern) {
  const exist = mustExist(rel, label);
  if (!exist.ok) return exist;
  const text = fs.readFileSync(exist.abs, "utf8");
  if (!pattern.test(text)) {
    return {
      ok: false,
      message: `${label}: ${rel} does not match expected pattern ${pattern}`,
    };
  }
  return { ok: true };
}

const checks = [
  () =>
    mustMatch(
      "services/api/src/workers/mlcc-browser-worker.js",
      "Dry-run SAFE MODE constant",
      /export\s+const\s+MLCC_BROWSER_DRY_RUN_SAFE_MODE\s*=\s*true\b/,
    ),
  () =>
    mustExist(
      "scripts/lk-verify/verify-rpa-safety.mjs",
      "RPA safety verify script",
    ),
  () =>
    mustExist(
      "tests/rpa/safe-mode-invariant.test.js",
      "SAFE MODE network invariant test",
    ),
  () =>
    mustExist(
      ".github/workflows/liquor-kings-ci.yml",
      "SAFE-MODE-only CI workflow",
    ),
  () => mustExist("docs/SAFETY_INVARIANTS.md", "Safety invariants doc"),
  () => mustExist("docs/RPA_SAFETY_CHECKLIST.md", "RPA safety checklist doc"),
];

const failures = [];
for (const run of checks) {
  const r = run();
  if (!r.ok) failures.push(r.message);
}

if (failures.length) {
  console.error("[doctor:lk:mlcc-dry-run] FAILED — prerequisite check(s):");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(
  "[doctor:lk:mlcc-dry-run] OK — static SAFE MODE dry-run prerequisites present (" +
    checks.length +
    " checks).",
);
process.exit(0);
