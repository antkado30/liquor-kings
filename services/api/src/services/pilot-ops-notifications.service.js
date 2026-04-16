const NOTIFICATIONS_TABLE = "pilot_ops_notifications";
const STATE_TABLE = "pilot_ops_notification_state";

const toBool = (value) => value === true;

export async function evaluateAndRecordPilotOpsNotifications(
  supabase,
  { storeId, healthStatus, attentionOverdue, alertReasons = [], workflowState = null, now },
) {
  const id = String(storeId ?? "").trim();
  if (!id) return { ok: false, error: "storeId is required" };
  const nowIso = now ?? new Date().toISOString();
  const isNeedsAttention = String(healthStatus ?? "") === "needs_attention";
  const isOverdue = toBool(attentionOverdue?.is_overdue);

  const { data: prev, error: prevError } = await supabase
    .from(STATE_TABLE)
    .select("last_health_status, last_attention_overdue")
    .eq("store_id", id)
    .maybeSingle();
  if (prevError) return { ok: false, error: prevError.message };

  const notifications = [];
  const prevHealth = String(prev?.last_health_status ?? "");
  const prevOverdue = toBool(prev?.last_attention_overdue);

  if (!isNeedsAttention && !isOverdue) {
    // no-op transition; still update baseline snapshot
  } else {
    if (isNeedsAttention && prevHealth !== "needs_attention") {
      notifications.push({
        store_id: id,
        notification_kind: "newly_needs_attention",
        reason_code: "newly_needs_attention",
        triggered_at: nowIso,
        payload: {
          health_status: healthStatus ?? null,
          alert_reasons: Array.isArray(alertReasons) ? alertReasons : [],
          workflow_state: workflowState ?? null,
        },
      });
    }
    if (isOverdue && prevOverdue !== true) {
      notifications.push({
        store_id: id,
        notification_kind: "newly_attention_overdue",
        reason_code: "newly_attention_overdue",
        triggered_at: nowIso,
        payload: {
          health_status: healthStatus ?? null,
          alert_reasons: Array.isArray(alertReasons) ? alertReasons : [],
          workflow_state: workflowState ?? null,
          attention_overdue: attentionOverdue ?? null,
        },
      });
    }
  }

  if (notifications.length > 0) {
    const { error: insertError } = await supabase.from(NOTIFICATIONS_TABLE).insert(notifications);
    if (insertError) return { ok: false, error: insertError.message };
  }

  const { error: stateError } = await supabase.from(STATE_TABLE).upsert(
    {
      store_id: id,
      last_health_status: healthStatus ?? null,
      last_attention_overdue: isOverdue,
      last_checked_at: nowIso,
    },
    { onConflict: "store_id" },
  );
  if (stateError) return { ok: false, error: stateError.message };

  return { ok: true, created_count: notifications.length };
}

export async function listPilotOpsNotifications(supabase, storeIds, opts = {}) {
  const ids = [...new Set((storeIds ?? []).filter((v) => typeof v === "string" && v.length > 0))];
  if (ids.length === 0) return { ok: true, data: [] };
  const rawLimit = Number.parseInt(String(opts.limit ?? "50"), 10);
  const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);
  const { data, error } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .select("id, store_id, notification_kind, reason_code, triggered_at, payload")
    .in("store_id", ids)
    .order("triggered_at", { ascending: false })
    .range(0, limit - 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

