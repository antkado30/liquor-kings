#!/usr/bin/env node
/**
 * verify:lk:contracts — ensure documented implementation paths exist.
 * Exit 1 if any required file is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const requiredFiles = [
  "docs/lk/architecture/README.md",
  "docs/lk/architecture/strategic-architecture.md",
  "docs/lk/architecture/execution-state-machine.md",
  "docs/lk/architecture/rpa-rebuild-phases.md",
  "docs/lk/architecture/rpa-safety-rules.md",
  "docs/lk/architecture/auth-and-store-scoping-invariants.md",
  "docs/lk/architecture/api-contract-truth.md",
  "docs/lk/DEVELOPER_ANTI_DRIFT.md",
  "services/api/src/routes/execution-runs.routes.js",
  "services/api/src/routes/operator-review.routes.js",
  "services/api/src/services/execution-run.service.js",
  "services/api/src/services/operator-diagnostics.service.js",
  "services/api/src/services/mlcc-operator-context.service.js",
  "services/api/src/middleware/store-param.middleware.js",
  "services/api/src/middleware/require-service-role.middleware.js",
  "services/api/src/workers/mlcc-browser-worker.js",
  "services/api/src/workers/mlcc-browser-add-by-code-probe.js",
  "services/api/src/workers/mlcc-phase-2k-policy.js",
  "services/api/src/workers/mlcc-phase-2m-policy.js",
  "services/api/src/workers/execution-worker.js",
  "apps/admin/src/pages/DiagnosticsPage.tsx",
  "apps/admin/src/pages/OperatorOverviewPage.tsx",
];

let failed = false;

for (const rel of requiredFiles) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[verify:lk:contracts] MISSING: ${rel}`);
    failed = true;
  }
}

if (failed) {
  console.error("[verify:lk:contracts] FAILED");
  process.exit(1);
}

console.log(`[verify:lk:contracts] OK (${requiredFiles.length} paths)`);
process.exit(0);
