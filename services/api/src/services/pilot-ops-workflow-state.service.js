const ALLOWED = new Set(["unreviewed", "watching", "escalated", "resolved"]);
const TABLE = "pilot_ops_workflow_states";
const HISTORY_TABLE = "pilot_ops_workflow_state_history";

const defaultState = () => ({
  pilot_ops_status: "unreviewed",
  last_reviewed_at: null,
  last_reviewed_by: null,
  operator_note: null,
});

const cleanNote = (value) => {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s.slice(0, 280) : null;
};

const toWorkflowState = (row) => {
  if (!row) return defaultState();
  return {
    pilot_ops_status: row.pilot_ops_status ?? "unreviewed",
    last_reviewed_at: row.last_reviewed_at ?? null,
    last_reviewed_by: row.last_reviewed_by ?? null,
    operator_note: row.operator_note ?? null,
  };
};

export async function getPilotOpsWorkflowState(supabase, storeId) {
  const id = String(storeId ?? "").trim();
  if (!id) {
    return { ok: false, error: "storeId is required" };
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select("pilot_ops_status, last_reviewed_at, last_reviewed_by, operator_note")
    .eq("store_id", id)
    .maybeSingle();
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: toWorkflowState(data) };
}

export async function listPilotOpsWorkflowStateHistory(supabase, storeId, opts = {}) {
  const id = String(storeId ?? "").trim();
  if (!id) {
    return { ok: false, error: "storeId is required" };
  }
  const nRaw = Number.parseInt(String(opts.limit ?? "20"), 10);
  const limit = Number.isNaN(nRaw) ? 20 : Math.min(Math.max(nRaw, 1), 100);
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select(
      "id, store_id, changed_at, changed_by, previous_pilot_ops_status, new_pilot_ops_status, previous_operator_note, new_operator_note",
    )
    .eq("store_id", id)
    .order("changed_at", { ascending: false })
    .range(0, limit - 1);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: data ?? [] };
}

export async function listPilotOpsWorkflowStateHistoryForStores(supabase, storeIds, opts = {}) {
  const ids = [...new Set((storeIds ?? []).filter((v) => typeof v === "string" && v.length > 0))];
  if (ids.length === 0) return { ok: true, data: [] };
  const nRaw = Number.parseInt(String(opts.limit ?? "500"), 10);
  const limit = Number.isNaN(nRaw) ? 500 : Math.min(Math.max(nRaw, 1), 2000);
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select(
      "id, store_id, changed_at, changed_by, previous_pilot_ops_status, new_pilot_ops_status, previous_operator_note, new_operator_note",
    )
    .in("store_id", ids)
    .order("changed_at", { ascending: false })
    .range(0, limit - 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export async function updatePilotOpsWorkflowState(
  supabase,
  storeId,
  { status, note, actorId, actorEmail },
) {
  const id = String(storeId ?? "").trim();
  const nextStatus = String(status ?? "").trim();
  if (!id) {
    return { ok: false, error: "storeId is required" };
  }
  if (!ALLOWED.has(nextStatus)) {
    return { ok: false, error: "pilot_ops_status must be unreviewed, watching, escalated, or resolved" };
  }
  const actor =
    String(actorEmail ?? "").trim() ||
    String(actorId ?? "").trim() ||
    "unknown_operator";
  const now = new Date().toISOString();
  const prevOut = await getPilotOpsWorkflowState(supabase, id);
  if (!prevOut.ok) {
    return prevOut;
  }
  const previous = prevOut.data;
  const next = {
    store_id: id,
    pilot_ops_status: nextStatus,
    last_reviewed_at: now,
    last_reviewed_by: actor,
    operator_note: cleanNote(note),
    updated_at: now,
  };
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(next, { onConflict: "store_id" })
    .select("pilot_ops_status, last_reviewed_at, last_reviewed_by, operator_note")
    .maybeSingle();
  if (error) {
    return { ok: false, error: error.message };
  }
  const historyPayload = {
    store_id: id,
    changed_at: now,
    changed_by: actor,
    previous_pilot_ops_status: previous.pilot_ops_status ?? "unreviewed",
    new_pilot_ops_status: data?.pilot_ops_status ?? nextStatus,
    previous_operator_note: previous.operator_note ?? null,
    new_operator_note: data?.operator_note ?? cleanNote(note),
  };
  const { error: historyError } = await supabase.from(HISTORY_TABLE).insert(historyPayload);
  if (historyError) {
    return { ok: false, error: historyError.message };
  }
  return { ok: true, data: toWorkflowState(data) };
}
