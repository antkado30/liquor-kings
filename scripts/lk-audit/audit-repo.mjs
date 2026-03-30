import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path, { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { pathFromRoot, REPO_ROOT } from "./lib/paths.mjs";
import { STATUS } from "./lib/status.mjs";

const EXPECTED_TOP_LEVEL = [
  "services/api",
  "supabase/migrations",
  "apps/web",
  "apps/admin",
  "packages",
  "scripts",
  "supabase/functions",
];

const SUBSYSTEM_MARKERS = [
  {
    id: "bottle_search_grounding",
    patterns: [
      { path: "services/api/src/routes/bottles.routes.js", type: "file" },
    ],
  },
  {
    id: "cart",
    patterns: [
      { path: "services/api/src/routes/cart.routes.js", type: "file" },
    ],
  },
  {
    id: "order_execution",
    patterns: [
      { path: "services/api/src/routes/execution-runs.routes.js", type: "file" },
    ],
  },
  {
    id: "mlcc_worker",
    patterns: [
      { path: "services/api/src/workers", type: "dir" },
    ],
    fileGlobs: ["mlcc-", "execution-worker"],
  },
  {
    id: "diagnostics",
    patterns: [
      { path: "scripts/lk-audit", type: "dir" },
    ],
  },
  {
    id: "auth_store_membership_gating",
    patterns: [],
    note:
      "No dedicated auth/membership routes detected under services/api/src/routes in this snapshot",
  },
  {
    id: "audit_event_logging",
    patterns: [
      { path: "supabase/schema.sql", type: "file" },
    ],
    keyword: "lk_system_diagnostics",
  },
];

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function walkJsFiles(dir, out = []) {
  if (!existsSync(dir)) {
    return out;
  }

  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) {
      continue;
    }

    const full = join(dir, name);
    const st = statSync(full);

    if (st.isDirectory()) {
      walkJsFiles(full, out);
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }

  return out;
}

function checkRelativeImports(fromFile, content) {
  const issues = [];
  const dir = join(fromFile, "..");
  const importRe =
    /(?:from\s+|import\s*\()\s*["'](\.[^"']+)["']/g;
  let m;

  while ((m = importRe.exec(content)) !== null) {
    const spec = m[1];

    if (!spec.startsWith(".")) {
      continue;
    }

    const resolved = join(dir, spec);

    const candidates = [
      resolved,
      `${resolved}.js`,
      join(resolved, "index.js"),
    ];

    const ok = candidates.some((p) => existsSync(p));

    if (!ok) {
      issues.push({
        file: relative(REPO_ROOT, fromFile),
        import: spec,
        status: STATUS.BROKEN,
      });
    }
  }

  return issues;
}

function countTodoInPath(rootDir) {
  if (!existsSync(rootDir)) {
    return 0;
  }

  let n = 0;
  const files = walkJsFiles(rootDir);

  for (const f of files) {
    const t = safeRead(f);

    if (!t) {
      continue;
    }

    if (/\bTODO\b|\bFIXME\b|\bXXX\b/.test(t)) {
      n += 1;
    }
  }

  return n;
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

export async function runRepoAudit() {
  const pathsMissing = [];
  const pathsPresent = [];

  for (const rel of EXPECTED_TOP_LEVEL) {
    const full = pathFromRoot(...rel.split("/"));

    if (existsSync(full)) {
      pathsPresent.push(rel);
    } else {
      pathsMissing.push({ expected: rel, status: STATUS.MISSING });
    }
  }

  const subsystems = {};

  for (const sub of SUBSYSTEM_MARKERS) {
    let evidence = [];
    let state = STATUS.PRESENT_UNVERIFIED;

    if (sub.patterns.length === 0) {
      subsystems[sub.id] = {
        status: STATUS.PRESENT_UNVERIFIED,
        evidence: [],
        note: sub.note ?? null,
      };
      continue;
    }

    for (const p of sub.patterns) {
      const full = pathFromRoot(...p.path.split("/"));

      if (p.type === "file" && existsSync(full)) {
        evidence.push(p.path);
      } else if (p.type === "dir" && existsSync(full)) {
        evidence.push(p.path);

        if (sub.fileGlobs) {
          const names = readdirSync(full);

          for (const g of sub.fileGlobs) {
            if (names.some((n) => n.includes(g))) {
              evidence.push(`${p.path}/${names.find((n) => n.includes(g))}`);
            }
          }
        }
      }
    }

    if (sub.keyword) {
      const schemaPath = pathFromRoot("supabase", "schema.sql");
      const s = safeRead(schemaPath);

      if (s && s.includes(sub.keyword)) {
        evidence.push(`supabase/schema.sql mentions ${sub.keyword}`);
        state = STATUS.PRESENT_VERIFIED;
      }
    } else if (evidence.length > 0) {
      state = STATUS.PRESENT_VERIFIED;
    } else {
      state = STATUS.MISSING;
    }

    subsystems[sub.id] = {
      status: state,
      evidence,
      note: sub.note ?? null,
    };
  }

  const apiSrc = pathFromRoot("services", "api", "src");
  const importIssues = [];

  if (existsSync(apiSrc)) {
    for (const f of walkJsFiles(apiSrc)) {
      const content = safeRead(f);

      if (!content) {
        continue;
      }

      importIssues.push(...checkRelativeImports(f, content));
    }
  }

  const appJs = pathFromRoot("services", "api", "src", "app.js");
  let appJsBroken = false;

  if (existsSync(appJs)) {
    const src = safeRead(appJs);

    if (src && /^[ \t]+export\s+default/m.test(src)) {
      appJsBroken = true;
      importIssues.push({
        file: "services/api/src/app.js",
        import: "(module structure)",
        status: STATUS.BROKEN,
        detail: "export default is not at top level (likely invalid ESM)",
      });
    }
  }

  const envRefs = {
    SUPABASE_URL: ["services/api/src/config/supabase.js"],
    SUPABASE_SERVICE_ROLE_KEY: ["services/api/src/config/supabase.js"],
  };

  const todoTally = {
    services_api: countTodoInPath(apiSrc),
  };

  const functionsDir = pathFromRoot("supabase", "functions");

  return {
    generated_at: new Date().toISOString(),
    git_commit: gitCommit(),
    paths_expected: EXPECTED_TOP_LEVEL,
    paths_present: pathsPresent,
    paths_missing: pathsMissing,
    supabase_functions_dir: existsSync(functionsDir)
      ? STATUS.PRESENT_VERIFIED
      : STATUS.MISSING,
    subsystems,
    import_issues: importIssues,
    app_js_structure_broken: appJsBroken,
    env_vars_documented_in_audit: envRefs,
    todo_file_hits: todoTally,
    notes: [
      "Static import resolution only checks relative .js paths from services/api/src.",
      "apps/web, apps/admin, packages are optional monorepo slots; MISSING is expected for a thin repo.",
    ],
  };
}

export async function main() {
  const out = await runRepoAudit();

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

const __auditRepoFile = fileURLToPath(import.meta.url);
const __isMain =
  path.resolve(process.argv[1] ?? "") === path.resolve(__auditRepoFile);

if (__isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
