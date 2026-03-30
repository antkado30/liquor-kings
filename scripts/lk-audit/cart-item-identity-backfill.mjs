import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadApiEnv, requireEnv } from "./lib/load-env.mjs";

const SOURCE = "lk_cart_item_identity_backfill";

function parseArgs(argv) {
  const set = new Set(argv.slice(2));
  return {
    apply: set.has("--apply"),
    persistDiagnostics: !set.has("--no-diagnostics"),
  };
}

async function fetchNullIdentityRows(supabase) {
  const { data, error } = await supabase
    .from("cart_items")
    .select(
      `
      id,
      cart_id,
      bottle_id,
      created_at,
      bottles (
        id,
        mlcc_item_id,
        mlcc_code,
        name,
        size_ml
      )
    `,
    )
    .is("mlcc_item_id", null)
    .order("created_at", { ascending: true });

  if (error) {
    if (String(error.message ?? "").includes("mlcc_item_id")) {
      return { rows: null, missingIdentityColumn: true };
    }
    throw new Error(`Failed to load cart_items with null identity: ${error.message}`);
  }
  return { rows: data ?? [], missingIdentityColumn: false };
}

async function resolveByCode(supabase, mlccCode) {
  if (!mlccCode) return { candidates: [], detail: "missing_mlcc_code" };

  const trimmed = String(mlccCode).trim();
  if (!trimmed) return { candidates: [], detail: "blank_mlcc_code" };

  const candidateMap = new Map();

  const { data: directRows, error: e1 } = await supabase
    .from("mlcc_items")
    .select("id")
    .eq("code", trimmed);
  if (e1) {
    throw new Error(`mlcc_items lookup failed for code=${trimmed}: ${e1.message}`);
  }
  for (const row of directRows ?? []) {
    candidateMap.set(row.id, (candidateMap.get(row.id) ?? 0) + 1);
  }

  const { data: aliasRows, error: e2 } = await supabase
    .from("mlcc_item_codes")
    .select("mlcc_item_id, valid_to")
    .eq("mlcc_code", trimmed);
  if (e2) {
    throw new Error(`mlcc_item_codes lookup failed for code=${trimmed}: ${e2.message}`);
  }

  const now = Date.now();
  for (const row of aliasRows ?? []) {
    if (!row.mlcc_item_id) continue;
    if (row.valid_to && new Date(row.valid_to).getTime() <= now) continue;
    candidateMap.set(row.mlcc_item_id, (candidateMap.get(row.mlcc_item_id) ?? 0) + 1);
  }

  return { candidates: [...candidateMap.keys()], detail: null };
}

async function resolveIdentityForRow(supabase, row) {
  const bottle = row.bottles;
  if (!bottle) {
    return { status: "unresolved", reason: "missing_bottle_relation", mlccItemId: null };
  }

  if (bottle.mlcc_item_id) {
    return {
      status: "resolved",
      reason: "bottle_mlcc_item_id",
      mlccItemId: bottle.mlcc_item_id,
    };
  }

  const { candidates, detail } = await resolveByCode(supabase, bottle.mlcc_code);
  if (detail) {
    return { status: "unresolved", reason: detail, mlccItemId: null };
  }

  if (candidates.length === 1) {
    return {
      status: "resolved",
      reason: "single_candidate_from_mlcc_code",
      mlccItemId: candidates[0],
    };
  }

  if (candidates.length === 0) {
    return {
      status: "unresolved",
      reason: "no_mlcc_candidate",
      mlccItemId: null,
    };
  }

  return {
    status: "ambiguous",
    reason: "multiple_mlcc_candidates",
    mlccItemId: null,
    candidateCount: candidates.length,
    candidateIds: candidates,
  };
}

async function applyBackfillUpdates(supabase, updates) {
  let updated = 0;
  const failures = [];

  for (const u of updates) {
    const { error } = await supabase
      .from("cart_items")
      .update({ mlcc_item_id: u.mlccItemId })
      .eq("id", u.cartItemId)
      .is("mlcc_item_id", null);

    if (error) {
      failures.push({
        cart_item_id: u.cartItemId,
        mlcc_item_id: u.mlccItemId,
        message: error.message,
      });
      continue;
    }
    updated += 1;
  }

  return { updated, failures };
}

async function loadRolloutMetrics(supabase) {
  const { count: totalCount, error: eTotal } = await supabase
    .from("cart_items")
    .select("id", { count: "exact", head: true });
  if (eTotal) throw new Error(`Failed counting cart_items: ${eTotal.message}`);

  const { data: sample, error: eSample } = await supabase
    .from("cart_items")
    .select("id, mlcc_item_id")
    .limit(1);
  if (eSample && String(eSample.message ?? "").includes("mlcc_item_id")) {
    return {
      total_cart_items: totalCount ?? 0,
      with_mlcc_item_id: null,
      null_mlcc_item_id: null,
      identity_write_requirement_failures: null,
      note: "mlcc_item_id column missing in this environment; apply migrations first",
    };
  }
  if (eSample) {
    throw new Error(`Failed sampling cart_items identity columns: ${eSample.message}`);
  }
  void sample;

  const { count: populatedCount, error: ePop } = await supabase
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .not("mlcc_item_id", "is", null);
  if (ePop) throw new Error(`Failed counting populated identities: ${ePop.message}`);

  const { count: nullCount, error: eNull } = await supabase
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .is("mlcc_item_id", null);
  if (eNull) throw new Error(`Failed counting null identities: ${eNull.message}`);

  const { data: recentDiagRows, error: eDiag } = await supabase
    .from("lk_system_diagnostics")
    .select("id")
    .eq("source", "lk_api")
    .contains("payload", { kind: "identity_write_missing_mlcc_item_id" });
  if (eDiag) throw new Error(`Failed counting identity write diagnostics: ${eDiag.message}`);

  return {
    total_cart_items: totalCount ?? 0,
    with_mlcc_item_id: populatedCount ?? 0,
    null_mlcc_item_id: nullCount ?? 0,
    identity_write_requirement_failures: (recentDiagRows ?? []).length,
  };
}

async function persistBackfillDiagnostic(supabase, payload) {
  const { error } = await supabase.from("lk_system_diagnostics").insert({
    source: SOURCE,
    payload,
  });

  if (error) {
    throw new Error(`Failed to persist backfill diagnostics: ${error.message}`);
  }
}

export async function runCartItemIdentityBackfill({ apply, persistDiagnostics }) {
  loadApiEnv();
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { rows: nullRows, missingIdentityColumn } = await fetchNullIdentityRows(
    supabase,
  );

  if (missingIdentityColumn) {
    const payload = {
      kind: "identity_backfill_report",
      mode: apply ? "apply" : "dry_run",
      precondition_failed: true,
      reason: "cart_items.mlcc_item_id column is missing",
      next_step:
        "Apply migrations (including mlcc_item_id rollout) before running identity backfill.",
      generated_at: new Date().toISOString(),
    };
    if (persistDiagnostics) {
      await persistBackfillDiagnostic(supabase, payload);
    }
    return payload;
  }

  const resolved = [];
  const unresolved = [];
  const ambiguous = [];

  for (const row of nullRows) {
    const result = await resolveIdentityForRow(supabase, row);
    if (result.status === "resolved") {
      resolved.push({
        cartItemId: row.id,
        mlccItemId: result.mlccItemId,
        reason: result.reason,
      });
      continue;
    }
    if (result.status === "ambiguous") {
      ambiguous.push({
        cart_item_id: row.id,
        bottle_id: row.bottle_id,
        reason: result.reason,
        candidate_count: result.candidateCount ?? 0,
        candidate_ids: result.candidateIds ?? [],
      });
      continue;
    }
    unresolved.push({
      cart_item_id: row.id,
      bottle_id: row.bottle_id,
      reason: result.reason,
    });
  }

  let applied = { updated: 0, failures: [] };
  if (apply && resolved.length > 0) {
    applied = await applyBackfillUpdates(supabase, resolved);
  }

  const metrics = await loadRolloutMetrics(supabase);

  const payload = {
    kind: "identity_backfill_report",
    mode: apply ? "apply" : "dry_run",
    scanned_null_rows: nullRows.length,
    resolved_candidates: resolved.length,
    unresolved_count: unresolved.length,
    ambiguous_count: ambiguous.length,
    applied_updates: applied.updated,
    update_failures: applied.failures.length,
    metrics,
    unresolved_examples: unresolved.slice(0, 50),
    ambiguous_examples: ambiguous.slice(0, 50),
    update_failures_examples: applied.failures.slice(0, 20),
    generated_at: new Date().toISOString(),
  };

  if (persistDiagnostics) {
    await persistBackfillDiagnostic(supabase, payload);
  }

  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  const out = await runCartItemIdentityBackfill(args);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

const __filename = fileURLToPath(import.meta.url);
const isMain = path.resolve(process.argv[1] ?? "") === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
