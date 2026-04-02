#!/usr/bin/env node
/**
 * doctor:lk:mlcc-dry-run — config-only readiness for MLCC browser dry-run (Phases 2a–2r).
 * Does not launch Playwright, click checkout, or submit orders.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

loadDotenv({ path: path.join(repoRoot, "services/api/.env") });

const readinessUrl = pathToFileURL(
  path.join(repoRoot, "services/api/src/workers/mlcc-dry-run-readiness.js"),
).href;

const { buildMlccDryRunReadinessReport, formatMlccDryRunReadinessText } =
  await import(readinessUrl);

const usernameRaw =
  process.argv[2]?.trim() ||
  process.env.MLCC_DOCTOR_USERNAME?.trim() ||
  process.env.MLCC_DOCTOR_STORE_USER?.trim() ||
  "";

if (!usernameRaw) {
  console.error(
    "[mlcc-dry-run-doctor] Provide store MLCC username as first argument, or set MLCC_DOCTOR_USERNAME (or MLCC_DOCTOR_STORE_USER) in the environment.",
  );
  console.error(
    "Example: npm run doctor:lk:mlcc-dry-run -- mystoreuser",
  );
  process.exit(2);
}

const payload = {
  store: {
    mlcc_username: usernameRaw,
  },
};

const report = buildMlccDryRunReadinessReport({
  payload,
  env: process.env,
});

console.log(formatMlccDryRunReadinessText(report));
process.exit(report.config_ready ? 0 : 1);
