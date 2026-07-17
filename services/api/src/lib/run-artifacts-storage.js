/**
 * run-artifacts-storage — durable off-machine run evidence (P0-2, Order Day
 * 2026-07-16 postmortem F5).
 *
 * WHY: rpa-output/ lives on the worker's EPHEMERAL container filesystem
 * (fly.worker.toml mounts no volume). On 7/16 the disarm restart wiped the
 * live submit run's network.har — the recording that held MILO's submit
 * endpoint (goal #2 of the whole order day). "Keep track of everything"
 * must include binary artifacts, not just DB rows. This module uploads a
 * run's entire output directory to Supabase Storage at the flush moment
 * (context teardown), so no restart can ever eat evidence again.
 *
 * Contract:
 *   - NEVER throws. A failed upload is a counted, logged fact — it must
 *     not be able to fail a run or block the worker loop (same doctrine
 *     as push-notify).
 *   - Bounded: total time budget + per-file size cap. If the budget dies
 *     mid-walk, the files most worth keeping went FIRST (see ordering).
 *   - Layout: <bucket>/<runId>/<path relative to the run's outputDir>,
 *     upsert:true so a retried upload of the same run is idempotent.
 *
 * Priority ordering (budget may expire before the list ends):
 *   1. network.har            — the endpoint evidence (why P0-2 exists)
 *   2. *.jsonl (actions log)  — the step-by-step forensic trail
 *   3. everything else        — screenshots etc., name-ascending
 *
 * Retrieval: services/api/scripts/pull-run-artifacts.mjs --run <id>.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const RUN_ARTIFACTS_BUCKET = "run-artifacts";

const DEFAULT_BUDGET_MS = 90_000;
// HARs on capture days run single-digit MB today; 100MB is a hang-stop
// against something pathological (a runaway trace), not a pace-setter.
const DEFAULT_PER_FILE_MAX_BYTES = 100 * 1024 * 1024;

/** Module-level memo: ensure the bucket once per worker process, not per run. */
let bucketEnsured = false;

function contentTypeFor(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  switch (ext) {
    case ".har":
    case ".json":
      return "application/json";
    case ".jsonl":
      return "application/x-ndjson";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".html":
      return "text/html";
    default:
      return "application/octet-stream";
  }
}

/** Upload priority: smaller number uploads first. */
function priorityFor(relPath) {
  const base = path.basename(relPath).toLowerCase();
  if (base === "network.har" || base.endsWith(".har")) return 0;
  if (base.endsWith(".jsonl")) return 1;
  return 2;
}

async function collectFilesRecursive(rootDir) {
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subdir — skip, never throw
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = (await stat(abs)).size;
        } catch {
          continue;
        }
        out.push({ abs, rel: path.relative(rootDir, abs), size });
      }
    }
  };
  await walk(rootDir);
  out.sort((a, b) => {
    const pa = priorityFor(a.rel);
    const pb = priorityFor(b.rel);
    if (pa !== pb) return pa - pb;
    return a.rel.localeCompare(b.rel);
  });
  return out;
}

/**
 * Create the private bucket if it doesn't exist. Safe to call every run —
 * memoized per process, and "already exists" is success, not an error.
 */
export async function ensureRunArtifactsBucket(supabase) {
  if (bucketEnsured) return true;
  try {
    const { error } = await supabase.storage.createBucket(RUN_ARTIFACTS_BUCKET, {
      public: false,
    });
    if (!error || /already exists/i.test(String(error.message ?? error))) {
      bucketEnsured = true;
      return true;
    }
    console.warn(`[artifacts] createBucket failed (continuing): ${error.message ?? error}`);
    return false;
  } catch (e) {
    console.warn(
      `[artifacts] createBucket threw (continuing): ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/** Exported for tests — reset the per-process bucket memo. */
export function __resetBucketMemoForTests() {
  bucketEnsured = false;
}

/**
 * Upload every file under outputDir to <bucket>/<runId>/<relative-path>.
 * Never throws. Returns a summary the caller can log verbatim.
 *
 * @returns {Promise<{
 *   attempted: number, uploaded: number, failed: number,
 *   skippedTooLarge: number, bytesUploaded: number,
 *   budgetExhausted: boolean, skipped: string | null, firstError: string | null,
 * }>}
 */
export async function uploadRunArtifacts({
  supabase,
  runId,
  outputDir,
  budgetMs = DEFAULT_BUDGET_MS,
  perFileMaxBytes = DEFAULT_PER_FILE_MAX_BYTES,
} = {}) {
  const summary = {
    attempted: 0,
    uploaded: 0,
    failed: 0,
    skippedTooLarge: 0,
    bytesUploaded: 0,
    budgetExhausted: false,
    skipped: null,
    firstError: null,
  };

  try {
    if (!supabase) {
      summary.skipped = "no_supabase_client";
      return summary;
    }
    if (typeof runId !== "string" || runId.trim() === "") {
      summary.skipped = "no_run_id";
      return summary;
    }
    if (typeof outputDir !== "string" || outputDir.trim() === "") {
      summary.skipped = "no_output_dir";
      return summary;
    }

    let rootStat;
    try {
      rootStat = await stat(outputDir);
    } catch {
      summary.skipped = "output_dir_missing";
      return summary;
    }
    if (!rootStat.isDirectory()) {
      summary.skipped = "output_dir_not_directory";
      return summary;
    }

    await ensureRunArtifactsBucket(supabase);

    const files = await collectFilesRecursive(outputDir);
    if (files.length === 0) {
      summary.skipped = "no_files";
      return summary;
    }

    const startedAt = Date.now();
    for (const file of files) {
      if (Date.now() - startedAt > budgetMs) {
        summary.budgetExhausted = true;
        break;
      }
      if (file.size > perFileMaxBytes) {
        summary.skippedTooLarge += 1;
        continue;
      }
      summary.attempted += 1;
      try {
        const body = await readFile(file.abs);
        // Storage keys use forward slashes regardless of host OS.
        const key = `${runId.trim()}/${file.rel.split(path.sep).join("/")}`;
        const { error } = await supabase.storage
          .from(RUN_ARTIFACTS_BUCKET)
          .upload(key, body, {
            contentType: contentTypeFor(file.rel),
            upsert: true,
          });
        if (error) {
          summary.failed += 1;
          if (!summary.firstError) summary.firstError = String(error.message ?? error);
        } else {
          summary.uploaded += 1;
          summary.bytesUploaded += file.size;
        }
      } catch (e) {
        summary.failed += 1;
        if (!summary.firstError) {
          summary.firstError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    return summary;
  } catch (e) {
    // Belt-and-suspenders: the contract is NEVER throw.
    summary.failed += 1;
    if (!summary.firstError) {
      summary.firstError = e instanceof Error ? e.message : String(e);
    }
    return summary;
  }
}

/** One log line, stable shape — grep target: "[artifacts]". */
export function formatUploadSummary(runId, summary) {
  const parts = [
    `[artifacts] run ${runId}: uploaded ${summary.uploaded}/${summary.attempted} file(s)`,
    `${summary.bytesUploaded} bytes`,
  ];
  if (summary.failed > 0) parts.push(`failed ${summary.failed} (${summary.firstError ?? "?"})`);
  if (summary.skippedTooLarge > 0) parts.push(`too-large ${summary.skippedTooLarge}`);
  if (summary.budgetExhausted) parts.push("budget exhausted");
  if (summary.skipped) parts.push(`skipped: ${summary.skipped}`);
  return parts.join(" · ");
}
