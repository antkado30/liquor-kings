import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadApiEnv, requireEnv } from "./lib/load-env.mjs";
import { pathFromRoot, REPO_ROOT } from "./lib/paths.mjs";
import { STATUS } from "./lib/status.mjs";

const TABLES_LK = [
  "bottles",
  "carts",
  "cart_items",
  "stores",
  "inventory",
  "execution_runs",
  "mlcc_items",
  "mlcc_item_codes",
  "mlcc_price_snapshots",
  "mlcc_code_map",
  "mlcc_change_rows",
  "lk_system_diagnostics",
  "lk_chat_threads",
  "lk_chat_messages",
  "ai_chat_sessions",
  "ai_messages",
];

const RPC_CHECKS = [
  {
    name: "lk_resolve_bottle",
    args: {
      p_store_id: "00000000-0000-0000-0000-000000000001",
      p_query: "x",
      p_limit: 1,
    },
  },
  {
    name: "lk_get_bottle_context",
    args: {
      p_bottle_id: "00000000-0000-0000-0000-000000000001",
      p_store_id: null,
    },
  },
];

function extractIndexesFromMigrations() {
  const dir = pathFromRoot("supabase", "migrations");
  const indexes = [];

  if (!existsSync(dir)) {
    return indexes;
  }

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".sql")) {
      continue;
    }

    const full = join(dir, name);
    const sql = readFileSync(full, "utf8");
    const re = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi;
    let m;

    while ((m = re.exec(sql)) !== null) {
      indexes.push({ migration: name, name: m[1] });
    }
  }

  return indexes;
}

async function probeTable(supabase, table) {
  const { error } = await supabase.from(table).select("*").limit(1);

  if (error) {
    const msg = error.message ?? "";
    const code = error.code ?? "";

    if (
      msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      code === "PGRST116" ||
      code === "42P01"
    ) {
      return { table, status: STATUS.MISSING, detail: msg };
    }

    return { table, status: STATUS.PRESENT_UNVERIFIED, detail: msg };
  }

  return { table, status: STATUS.PRESENT_VERIFIED, detail: null };
}

async function probeRpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    const msg = error.message ?? "";

    if (msg.includes("function") && msg.includes("does not exist")) {
      return { name, status: STATUS.MISSING, detail: msg };
    }

    return {
      name,
      status: STATUS.PRESENT_VERIFIED,
      detail: msg,
      note: "RPC exists; returned error may be expected for dummy arguments",
    };
  }

  return { name, status: STATUS.PRESENT_VERIFIED, detail: null, sample: data };
}

function listEdgeFunctionsCli() {
  try {
    const out = execSync("npx supabase functions list --linked", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      status: STATUS.PRESENT_VERIFIED,
      raw: out,
      source: "supabase_cli",
    };
  } catch (e) {
    return {
      status: STATUS.UNVERIFIED,
      raw: String(e.stderr ?? e.stdout ?? e.message ?? e),
      source: "supabase_cli",
      note: "Could not list Edge Functions (CLI not linked, not installed, or no network)",
    };
  }
}

export async function runSupabaseAudit() {
  loadApiEnv();

  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tables = [];

  for (const t of TABLES_LK) {
    tables.push(await probeTable(supabase, t));
  }

  const rpcs = [];

  for (const r of RPC_CHECKS) {
    rpcs.push(await probeRpc(supabase, r.name, r.args));
  }

  const indexes_from_migrations = extractIndexesFromMigrations();

  const edge_functions = listEdgeFunctionsCli();

  return {
    generated_at: new Date().toISOString(),
    supabase_url_host: new URL(url).host,
    tables,
    rpcs,
    rls_and_policies: {
      status: STATUS.UNVERIFIED,
      note:
        "RLS and policy correctness cannot be asserted with the service role client alone (service role bypasses RLS). Verify in SQL or Supabase Dashboard with anon/authenticated roles.",
    },
    indexes: {
      from_migrations: indexes_from_migrations,
      live: {
        status: STATUS.UNVERIFIED,
        note:
          "Live index list requires direct database access (not implemented in this pass).",
      },
    },
    edge_functions,
    drift: {
      status: STATUS.PRESENT_UNVERIFIED,
      note:
        "Compare supabase/migrations and deployed migration history via `supabase migration list --linked` (not run automatically here).",
    },
  };
}

async function main() {
  const out = await runSupabaseAudit();

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

const __f = fileURLToPath(import.meta.url);
const __main = path.resolve(process.argv[1] ?? "") === path.resolve(__f);

if (__main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
