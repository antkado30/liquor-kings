#!/usr/bin/env node
/**
 * doctor:lk:mlcc-backfill — SAFE diagnostic / optional apply for bottles.mlcc_item_id
 * backfill (exact code match). Uses sql/mlcc_backfill_preview_and_apply.sql via psql.
 *
 * DEFAULT: dry-run / preview summary only (no writes).
 * APPLY:   set APPLY_BACKFILL=1, confirm interactively, then runs APPLY SQL in a
 *          single psql transaction (-1). Never echoes secrets or hardcoded URLs.
 *
 * Connection: set DATABASE_URL or standard PG* variables (PGHOST, PGPORT, PGUSER,
 * PGDATABASE, PGPASSWORD, etc.) as you would for normal psql — not printed here.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as stdinStream, stdout as stdoutStream } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const SQL_REL = "sql/mlcc_backfill_preview_and_apply.sql";
const APPLY_CONFIRM_TOKEN = "MLCC_BACKFILL_STAGING";

/** @typedef {{ can_backfill: number, ambiguous: number, no_match: number }} BucketSummary */

/**
 * @param {string} fullText
 * @param {string} startMarker line including leading `-- `
 * @param {string} endMarker
 * @returns {string}
 */
export function extractBetweenMarkers(fullText, startMarker, endMarker) {
  const s = fullText.indexOf(startMarker);
  if (s === -1) {
    throw new Error(`Missing marker: ${startMarker}`);
  }
  const afterStart = fullText.indexOf("\n", s);
  const contentStart = afterStart === -1 ? s + startMarker.length : afterStart + 1;
  const e = fullText.indexOf(endMarker, contentStart);
  if (e === -1) {
    throw new Error(`Missing marker: ${endMarker}`);
  }
  return fullText.slice(contentStart, e).trim();
}

/**
 * First SELECT only (bucket summary); detail query is after OPTIONAL PREVIEW DETAIL.
 * @param {string} previewBlock
 * @returns {string}
 */
export function splitPreviewSummarySql(previewBlock) {
  const marker = "-- OPTIONAL PREVIEW DETAIL";
  const idx = previewBlock.indexOf(marker);
  if (idx === -1) {
    return previewBlock.trim();
  }
  return previewBlock.slice(0, idx).trim();
}

/**
 * Parse psql unaligned pipe output: one `bucket|count` per line (from -At -F'|').
 * @param {string} stdout
 * @returns {BucketSummary}
 */
export function parseBucketSummaryLines(stdout) {
  const out = { can_backfill: 0, ambiguous: 0, no_match: 0 };
  const allowed = new Set(Object.keys(out));
  for (const raw of String(stdout).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("(") || /^\d+\s+rows?\)?$/i.test(line)) {
      continue;
    }
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;
    const bucket = parts[0];
    const n = parseInt(parts[1], 10);
    if (!allowed.has(bucket) || !Number.isFinite(n)) continue;
    out[bucket] = n;
  }
  return out;
}

/**
 * @param {string} typed
 * @returns {boolean}
 */
export function isApplyConfirmationValid(typed) {
  return typed === APPLY_CONFIRM_TOKEN;
}

/**
 * @returns {string[]}
 */
function buildPsqlArgvPrefix() {
  if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) {
    return [String(process.env.DATABASE_URL).trim(), "-v", "ON_ERROR_STOP=1", "-X"];
  }
  return ["-v", "ON_ERROR_STOP=1", "-X"];
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertDbEnvConfigured(env = process.env) {
  if (env.DATABASE_URL && String(env.DATABASE_URL).trim()) {
    return;
  }
  if (env.PGHOST && String(env.PGHOST).trim()) {
    return;
  }
  throw new Error(
    "No database connection configured. Set DATABASE_URL or at least PGHOST (and PGUSER, PGDATABASE, etc.) the same way you run psql — secrets are never printed by this script.",
  );
}

/**
 * Run SQL via psql stdin. Does not log connection strings.
 * @param {string} sql
 * @param {{ singleTransaction?: boolean, tuplesPipe?: boolean }} opts
 * @returns {{ ok: boolean, status: number | null, stdout: string, stderr: string }}
 */
export function runPsqlStdin(sql, opts = {}) {
  assertDbEnvConfigured(process.env);
  const argv = [...buildPsqlArgvPrefix()];
  if (opts.singleTransaction) {
    argv.push("-1");
  }
  if (opts.tuplesPipe) {
    argv.push("-At", "-F", "|");
  }
  argv.push("-f", "-");
  const r = spawnSync("psql", argv, {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
    windowsHide: true,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function printBucketSummary(label, summary) {
  console.log("");
  console.log(`--- ${label} ---`);
  console.log(`  can_backfill : ${summary.can_backfill}`);
  console.log(`  ambiguous    : ${summary.ambiguous}`);
  console.log(`  no_match     : ${summary.no_match}`);
  const total =
    summary.can_backfill + summary.ambiguous + summary.no_match;
  console.log(`  (candidates) : ${total}`);
}

/**
 * @param {string} combinedOut
 * @returns {number | null}
 */
export function parseUpdateCount(combinedOut) {
  const m = String(combinedOut).match(/\bUPDATE\s+(\d+)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Executable APPLY DML only (markers already stripped by extractBetweenMarkers).
 * @param {string} applyBlock
 * @returns {string}
 */
export function normalizeApplySql(applyBlock) {
  return applyBlock
    .split("\n")
    .filter((ln) => !ln.trimStart().startsWith("-- APPLY_END"))
    .join("\n")
    .trim();
}

async function promptApplyConfirmation() {
  const rl = readline.createInterface({
    input: stdinStream,
    output: stdoutStream,
  });
  try {
    const line = await rl.question(
      `\nType exactly ${APPLY_CONFIRM_TOKEN} to run APPLY in a transaction: `,
    );
    return line;
  } finally {
    rl.close();
  }
}

/**
 * Core orchestration (CLI and tests). No real DB when `runPsql` is stubbed.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv;
 *   repoRoot?: string;
 *   existsSync?: (p: string) => boolean;
 *   readFileSync?: (p: string, enc?: BufferEncoding) => string | Buffer;
 *   runPsql?: typeof runPsqlStdin;
 *   promptApply?: () => Promise<string>;
 *   quiet?: boolean;
 *   onPsqlCall?: (sql: string, opts: { singleTransaction?: boolean; tuplesPipe?: boolean }) => void;
 * }} [deps]
 * @returns {Promise<{ exitCode: number; mode?: string; preview?: BucketSummary; postPreview?: BucketSummary; updatedRows?: number | null }>}
 */
export async function runDoctorMlccBackfill(deps = {}) {
  const env = deps.env ?? process.env;
  const applyMode = env.APPLY_BACKFILL === "1";
  const root = deps.repoRoot ?? repoRoot;
  const existsSync = deps.existsSync ?? fs.existsSync.bind(fs);
  const readFileSync = deps.readFileSync ?? fs.readFileSync.bind(fs);
  const baseRunPsql = deps.runPsql ?? runPsqlStdin;
  const runPsql = /** @type {typeof runPsqlStdin} */ (sql, opts) => {
    deps.onPsqlCall?.(sql, opts ?? {});
    return baseRunPsql(sql, opts ?? {});
  };
  const promptApply = deps.promptApply ?? promptApplyConfirmation;
  const quiet = deps.quiet ?? false;

  const sqlAbs = path.join(root, SQL_REL);
  if (!existsSync(sqlAbs)) {
    if (!quiet) {
      console.error(`[doctor:mlcc-backfill] Missing ${SQL_REL}`);
    }
    return { exitCode: 1 };
  }

  const full = String(readFileSync(sqlAbs, "utf8"));
  const previewBlock = extractBetweenMarkers(
    full,
    "-- PREVIEW_START",
    "-- PREVIEW_END",
  );
  const applyBlock = extractBetweenMarkers(
    full,
    "-- APPLY_START",
    "-- APPLY_END",
  );
  const previewSummarySql = splitPreviewSummarySql(previewBlock);
  const applySql = normalizeApplySql(applyBlock);

  if (!quiet) {
    console.log("[doctor:mlcc-backfill] MLCC bottles.mlcc_item_id backfill helper");
    console.log("");
    console.log("Safety:");
    console.log("  • Default is DRY-RUN / preview only (no writes).");
    console.log(
      "  • APPLY updates only unique exact code matches (see SQL file); never overwrites existing mlcc_item_id.",
    );
    console.log(
      `  • APPLY requires APPLY_BACKFILL=1 and interactive confirmation (${APPLY_CONFIRM_TOKEN}).`,
    );
    console.log("");
  }

  try {
    assertDbEnvConfigured(env);
  } catch (e) {
    if (!quiet) {
      console.error(
        "[doctor:mlcc-backfill]",
        e instanceof Error ? e.message : e,
      );
    }
    return { exitCode: 1 };
  }

  const runSummary = () => {
    const r = runPsql(previewSummarySql, { tuplesPipe: true });
    if (!r.ok) {
      if (!quiet) {
        console.error("[doctor:mlcc-backfill] PREVIEW psql failed.");
        console.error(r.stderr || r.stdout);
      }
      return { ok: false, status: r.status ?? 1, stderr: r.stderr || r.stdout };
    }
    return { ok: true, summary: parseBucketSummaryLines(r.stdout) };
  };

  const preResult = runSummary();
  if (!preResult.ok) {
    return { exitCode: preResult.status, preview: undefined };
  }
  const pre = preResult.summary;
  if (!quiet) {
    printBucketSummary("Preview (bucket counts)", pre);
  }

  if (!applyMode) {
    if (!quiet) {
      console.log("");
      console.log(
        "[doctor:mlcc-backfill] Dry-run complete. Set APPLY_BACKFILL=1 to enable apply path (still requires typing the confirmation token).",
      );
    }
    return { exitCode: 0, mode: "dry-run", preview: pre };
  }

  const typed = await promptApply();
  if (!isApplyConfirmationValid(typed)) {
    if (!quiet) {
      console.error(
        "[doctor:mlcc-backfill] Confirmation mismatch — aborting with no writes.",
      );
    }
    return { exitCode: 2, mode: "apply-aborted", preview: pre };
  }

  if (!quiet) {
    console.log("");
    console.log(
      "[doctor:mlcc-backfill] Running APPLY in a single transaction (-1)…",
    );
  }

  const applyResult = runPsql(applySql, { singleTransaction: true });
  const combined = `${applyResult.stdout}\n${applyResult.stderr}`;
  const updated = parseUpdateCount(combined);

  if (!applyResult.ok) {
    if (!quiet) {
      console.error(
        "[doctor:mlcc-backfill] APPLY failed — transaction rolled back by psql (-1).",
      );
      console.error(applyResult.stderr || applyResult.stdout);
    }
    return { exitCode: applyResult.status ?? 1, preview: pre };
  }

  if (!quiet) {
    console.log(
      updated != null
        ? `[doctor:mlcc-backfill] UPDATE row count (from psql): ${updated}`
        : "[doctor:mlcc-backfill] APPLY finished (parse UPDATE n from output if needed).",
    );
  }

  const postResult = runSummary();
  if (!postResult.ok) {
    if (!quiet) {
      console.error("[doctor:mlcc-backfill] PREVIEW psql failed.");
      console.error(postResult.stderr || "");
    }
    return { exitCode: postResult.status, preview: pre };
  }
  const post = postResult.summary;
  if (!quiet) {
    printBucketSummary("Post-apply preview (bucket counts)", post);
    console.log("");
    console.log("[doctor:mlcc-backfill] Done.");
  }
  return {
    exitCode: 0,
    mode: "apply-done",
    preview: pre,
    postPreview: post,
    updatedRows: updated,
  };
}

async function main() {
  const r = await runDoctorMlccBackfill({ quiet: false });
  process.exit(r.exitCode);
}

function isInvokedAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedAsCli()) {
  main().catch((e) => {
    console.error("[doctor:mlcc-backfill]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
