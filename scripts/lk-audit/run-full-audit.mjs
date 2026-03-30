import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runRepoAudit } from "./audit-repo.mjs";
import { runSupabaseAudit } from "./audit-supabase.mjs";
import { loadApiEnv, requireEnv } from "./lib/load-env.mjs";
import { pathFromRoot, REPO_ROOT } from "./lib/paths.mjs";
import { STATUS } from "./lib/status.mjs";

function readApiVersion() {
  try {
    const p = pathFromRoot("services", "api", "package.json");
    const j = JSON.parse(readFileSync(p, "utf8"));

    return j.version ?? null;
  } catch {
    return null;
  }
}

function buildRisks(repo, db) {
  const risks = [];

  if (repo.paths_missing?.length) {
    risks.push({
      level: "medium",
      detail:
        "Expected top-level paths are missing (monorepo may be intentionally thin).",
      items: repo.paths_missing.map((p) => p.expected),
    });
  }

  if (repo.app_js_structure_broken) {
    risks.push({
      level: "high",
      detail:
        "services/api/src/app.js appears to export default from inside a route handler (invalid ESM).",
    });
  }

  if (repo.import_issues?.length) {
    risks.push({
      level: "high",
      detail: "Broken relative imports detected under services/api/src.",
      count: repo.import_issues.length,
    });
  }

  const missingTables = db.tables?.filter((t) => t.status === STATUS.MISSING);

  if (missingTables?.length) {
    risks.push({
      level: "high",
      detail: "Tables expected by the audit list were not reachable via PostgREST.",
      tables: missingTables.map((t) => t.table),
    });
  }

  if (db.rls_and_policies?.status === STATUS.UNVERIFIED) {
    risks.push({
      level: "medium",
      detail:
        "RLS and policies were not verified against anon/authenticated roles in this run.",
    });
  }

  if (db.edge_functions?.status === STATUS.UNVERIFIED) {
    risks.push({
      level: "low",
      detail:
        "Deployed Edge Functions could not be listed via Supabase CLI (see edge_functions.raw).",
    });
  }

  return risks;
}

function buildBlockers(repo, db) {
  const blockers = [];

  if (repo.app_js_structure_broken) {
    blockers.push({
      detail:
        "Fix services/api/src/app.js so `export default app` is top-level; the API may not load.",
    });
  }

  const missingRpc = db.rpcs?.filter((r) => r.status === STATUS.MISSING);

  if (missingRpc?.length) {
    blockers.push({
      detail:
        "Grounding RPCs expected by the API/chat layer may be missing on the deployed database.",
      rpcs: missingRpc.map((r) => r.name),
    });
  }

  return blockers;
}

function recommendedNextStep(repo, db, risks, blockers) {
  if (repo.app_js_structure_broken) {
    return "Repair `services/api/src/app.js` module structure, then re-run `npm run audit:lk`.";
  }

  if (blockers.some((b) => b.rpcs?.length)) {
    return "Align Supabase migrations/RPCs with `supabase/schema.sql` expectations and verify with `audit:lk:supabase`.";
  }

  if (risks.some((r) => r.tables?.length)) {
    return "Apply pending migrations or fix PostgREST schema cache so required tables exist on the linked project.";
  }

  return "Stand up missing client apps (apps/web, apps/admin) or document intentional scope; add CI running `npm run audit:lk` on main.";
}

function renderMarkdown({
  timestamp,
  repo,
  db,
  risks,
  blockers,
  recommended_next_step,
}) {
  const lines = [
    "# Liquor Kings — diagnostic audit snapshot",
    "",
    `_Generated: ${timestamp}_`,
    "",
    "## Summary",
    "",
    "| Area | Notes |",
    "|------|-------|",
    `| Repository | ${repo.paths_missing?.length ? "partial / thin" : "scanned"} |`,
    `| Supabase (data plane) | ${db.tables?.filter((t) => t.status === STATUS.MISSING).length ? "gaps detected" : "reachable"} |`,
    `| RLS / policies | ${db.rls_and_policies?.status ?? STATUS.UNVERIFIED} |`,
    `| Edge functions | ${db.edge_functions?.status ?? STATUS.UNVERIFIED} |`,
    "",
    "## What looks complete",
    "",
    "- Repo scan + `services/api` route wiring inventory (see `repo_summary.subsystems`).",
    "- Supabase table probes for the curated LK list (see `db_summary.tables`).",
    "",
    "## What is partially complete",
    "",
    "- Index parity (live vs migrations): **UNVERIFIED** without direct SQL.",
    "- Edge Function deployment list: **CLI-dependent** (see `db_summary.edge_functions`).",
    "",
    "## What is missing",
    "",
    "- `apps/web`, `apps/admin`, `packages/*` if not present (expected for a backend-only checkout).",
    "- Dedicated auth/membership API routes in `services/api` (not found in this repo snapshot).",
    "",
    "## What is broken / risky",
    "",
    repo.app_js_structure_broken
      ? "- **Broken:** `services/api/src/app.js` — `export default` must be top-level (invalid ESM as scanned)."
      : "- (No structural ESM breakage detected by this audit.)",
    "",
    risks.length
      ? risks.map((r) => `- **${r.level}:** ${r.detail}`).join("\n")
      : "- (No additional risk rows.)",
    "",
    "## Blockers",
    "",
    blockers.length
      ? blockers.map((b) => `- ${b.detail}`).join("\n")
      : "- (No hard blockers beyond environment/DB issues above.)",
    "",
    "## Recommended single next lane",
    "",
    recommended_next_step,
    "",
    "---",
    "",
    "_This file is overwritten on each `npm run audit:lk`. Persisted rows live in `public.lk_system_diagnostics` (payload JSON)._",
    "",
  ];

  return lines.join("\n");
}

async function persistPayload(supabase, row) {
  const { data, error } = await supabase
    .from("lk_system_diagnostics")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to persist lk_system_diagnostics: ${error.message}`);
  }

  return data?.id ?? null;
}

export async function runFullAudit() {
  loadApiEnv();

  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const repo = await runRepoAudit();
  const db = await runSupabaseAudit();

  const timestamp = new Date().toISOString();
  const risks = buildRisks(repo, db);
  const blockers = buildBlockers(repo, db);
  const recommended_next_step = recommendedNextStep(repo, db, risks, blockers);

  const environment_name =
    process.env.LK_ENV || process.env.NODE_ENV || "unknown";

  const appVersion = readApiVersion();

  const payload = {
    version: 1,
    kind: "lk_full_audit",
    timestamp,
    environment_name,
    git_commit: repo.git_commit,
    app_version: appVersion,
    repo_summary: repo,
    db_summary: db,
    edge_function_summary: db.edge_functions,
    risks,
    blockers,
    recommended_next_step,
    report_markdown_path: "docs/LK_AUDIT_REPORT.md",
    raw_json: {
      repo,
      db,
      risks,
      blockers,
    },
  };

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const markdown = renderMarkdown({
    timestamp,
    repo,
    db,
    risks,
    blockers,
    recommended_next_step,
  });

  const docsDir = pathFromRoot("docs");

  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  const reportPath = join(docsDir, "LK_AUDIT_REPORT.md");

  writeFileSync(reportPath, markdown, "utf8");

  const rowId = await persistPayload(supabase, {
    source: "lk_full_audit",
    git_commit: repo.git_commit,
    app_version: appVersion,
    payload,
  });

  return {
    success: true,
    persisted_row_id: rowId,
    report_path: path.relative(REPO_ROOT, reportPath),
    summary: payload,
  };
}

const __f = fileURLToPath(import.meta.url);
const __main = path.resolve(process.argv[1] ?? "") === path.resolve(__f);

if (__main) {
  runFullAudit()
    .then((out) => {
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
