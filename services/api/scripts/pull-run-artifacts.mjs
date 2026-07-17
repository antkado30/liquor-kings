#!/usr/bin/env node
/**
 * pull-run-artifacts — fetch a run's preserved evidence from Supabase
 * Storage (P0-2, Order Day 2026-07-16 postmortem F5).
 *
 * The worker uploads every run's rpa-output files to the private
 * `run-artifacts` bucket at teardown (see src/lib/run-artifacts-storage.js),
 * keyed <runId>/<relative-path>. This script pulls them back down — the
 * durable replacement for `pull-latest-har.mjs`, which can only see
 * whatever survived on the worker's ephemeral disk.
 *
 * Run it locally (sandbox has no egress to Supabase) — needs
 * LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or the
 * SUPABASE_* fallbacks) in services/api/.env.
 *
 * USAGE (services/api/):
 *   node scripts/pull-run-artifacts.mjs --run <run-id>            # network.har + actions.jsonl
 *   node scripts/pull-run-artifacts.mjs --run <run-id> --all      # everything (screenshots too)
 *   node scripts/pull-run-artifacts.mjs --run <run-id> --list     # list only, download nothing
 *   node scripts/pull-run-artifacts.mjs --list-runs               # newest run folders in the bucket
 *
 * Files land in <repo>/rpa-captures/<run-id>/<relative-path>.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "run-artifacts";

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("This points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}
// DB discipline: always print the target host before doing anything.
console.log(`Target: ${new URL(SUPABASE_URL).host} · bucket: ${BUCKET}`);

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const has = (name) => args.includes(`--${name}`);

const runId = flagValue("run");
const wantAll = has("all");
const listOnly = has("list");
const listRuns = has("list-runs");

if (!runId && !listRuns) {
  console.error("Usage: node scripts/pull-run-artifacts.mjs --run <run-id> [--all|--list] | --list-runs");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY);

/** Recursively list every file under a prefix. Folders come back with id=null. */
async function listRecursive(prefix) {
  const out = [];
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`list(${prefix || "/"}) failed: ${error.message}`);
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      out.push(...(await listRecursive(full)));
    } else {
      out.push({ key: full, size: entry.metadata?.size ?? null, updatedAt: entry.updated_at ?? null });
    }
  }
  return out;
}

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..", "..", "..");

if (listRuns) {
  const { data, error } = await supabase.storage.from(BUCKET).list("", {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) {
    console.error(`list-runs failed: ${error.message}`);
    process.exit(1);
  }
  const folders = (data ?? []).filter((e) => e.id === null);
  if (folders.length === 0) {
    console.log("No run folders in the bucket yet.");
  } else {
    for (const f of folders) console.log(f.name);
  }
  process.exit(0);
}

const files = await listRecursive(runId);
if (files.length === 0) {
  console.error(
    `No artifacts stored for run ${runId}. (Runs before the P0-2 deploy have nothing here; ` +
      "for those, only pull-latest-har.mjs against the live machine can help.)",
  );
  process.exit(1);
}

console.log(`Found ${files.length} file(s) for run ${runId}:`);
for (const f of files) {
  console.log(`  ${f.key}${f.size != null ? ` (${Math.round(f.size / 1024)} KB)` : ""}`);
}
if (listOnly) process.exit(0);

const isPriority = (key) => key.endsWith(".har") || key.endsWith(".jsonl");
const targets = wantAll ? files : files.filter((f) => isPriority(f.key));
if (targets.length === 0) {
  console.log("No .har/.jsonl files for this run — re-run with --all for screenshots etc.");
  process.exit(0);
}

let saved = 0;
for (const f of targets) {
  const { data, error } = await supabase.storage.from(BUCKET).download(f.key);
  if (error) {
    console.error(`  download failed: ${f.key} — ${error.message}`);
    continue;
  }
  const rel = f.key.startsWith(`${runId}/`) ? f.key.slice(runId.length + 1) : f.key;
  const dest = path.join(repoRoot, "rpa-captures", runId, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await data.arrayBuffer()));
  console.log(`  Saved: ${path.relative(repoRoot, dest)}`);
  saved += 1;
}
console.log(`Done — ${saved}/${targets.length} file(s) in rpa-captures/${runId}/`);
