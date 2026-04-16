import crypto from "crypto";
import express from "express";
import supabase from "../config/supabase.js";
import {
  applyExecutionRunOperatorAction,
  getExecutionRunOperatorReviewBundleById,
  getStorePilotOverview,
  listExecutionRunsForOperatorReview,
} from "../services/execution-run.service.js";
import { getOperatorDiagnosticsOverview } from "../services/operator-diagnostics.service.js";
import { logSystemDiagnostic, DIAGNOSTIC_KIND } from "../services/diagnostics.service.js";
import {
  getPilotOpsWorkflowState,
  listPilotOpsWorkflowStateHistory,
  listPilotOpsWorkflowStateHistoryForStores,
  updatePilotOpsWorkflowState,
} from "../services/pilot-ops-workflow-state.service.js";
import { evaluatePilotOpsAttentionOverdue } from "../services/pilot-ops-attention.service.js";
import {
  evaluateAndRecordPilotOpsNotifications,
  listPilotOpsNotifications,
} from "../services/pilot-ops-notifications.service.js";
import {
  buildPilotOpsQualitySummary,
  buildPilotOpsTimeComparison,
} from "../services/pilot-ops-quality-metrics.service.js";

const router = express.Router();
const SESSION_COOKIE = "lk_operator_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();

const parseCookies = (cookieHeader = "") => {
  const out = {};
  const parts = String(cookieHeader).split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
};

const cookieString = (name, value, maxAgeSec = null) => {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  if (maxAgeSec != null) attrs.push(`Max-Age=${maxAgeSec}`);
  return `${name}=${encodeURIComponent(value)}; ${attrs.join("; ")}`;
};

const now = () => Date.now();

const listUserStores = async (userId) => {
  const { data: memberships, error } = await supabase
    .from("store_users")
    .select("store_id")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) return { data: null, error };
  const storeIds = [...new Set((memberships ?? []).map((m) => m.store_id).filter(Boolean))];
  if (!storeIds.length) return { data: [], error: null };
  const { data: stores, error: storesError } = await supabase
    .from("stores")
    .select("id, name")
    .in("id", storeIds);
  if (storesError) return { data: null, error: storesError };
  const rows = stores ?? [];
  return {
    data: storeIds.map((id) => rows.find((s) => s.id === id) ?? { id, name: null }),
    error: null,
  };
};

const getSession = (req) => {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const record = sessions.get(sid);
  if (!record) return null;
  if (record.expiresAt < now()) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...record };
};

const logOperatorSessionEvent = async ({ event, userId = null, storeId = null, payload = {} }) => {
  await logSystemDiagnostic({
    kind: DIAGNOSTIC_KIND.OPERATOR_SESSION,
    userId,
    storeId,
    payload: { event, ...payload },
  });
};

const requireOperatorSession = async (req, res, next) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({
      error: "Operator session required or expired",
      code: "operator_session_required",
    });
  }
  const { data: stores, error } = await listUserStores(session.userId);
  if (error) return res.status(500).json({ error: error.message });
  const allowed = (stores ?? []).some((s) => s.id === session.storeId);
  if (!allowed) {
    sessions.delete(session.sid);
    res.setHeader("Set-Cookie", cookieString(SESSION_COOKIE, "", 0));
    await logOperatorSessionEvent({
      event: "session_invalidated",
      userId: session.userId,
      storeId: session.storeId,
      payload: { reason: "membership_revoked_or_store_removed" },
    });
    return res.status(403).json({
      error: "Store membership is no longer active",
      code: "operator_session_revoked",
    });
  }
  sessions.set(session.sid, {
    ...session,
    expiresAt: now() + SESSION_TTL_MS,
  });
  req.operatorSession = {
    sid: session.sid,
    userId: session.userId,
    email: session.email,
    storeId: session.storeId,
  };
  next();
};

router.post("/session", async (req, res) => {
  const accessToken = String(req.body?.accessToken ?? "").trim();
  const requestedStoreId = String(req.body?.storeId ?? "").trim() || null;
  if (!accessToken) {
    return res.status(400).json({ error: "accessToken is required" });
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  const user = userData.user;
  const { data: stores, error } = await listUserStores(user.id);
  if (error) return res.status(500).json({ error: error.message });
  if (!stores?.length) {
    return res.status(403).json({ error: "No active store membership for operator" });
  }
  let selected = stores[0];
  if (requestedStoreId) {
    selected = stores.find((s) => s.id === requestedStoreId);
    if (!selected) {
      return res.status(403).json({ error: "Not a member of requested store" });
    }
  }
  const sid = crypto.randomUUID();
  sessions.set(sid, {
    accessToken,
    userId: user.id,
    email: user.email ?? null,
    storeId: selected.id,
    expiresAt: now() + SESSION_TTL_MS,
  });
  res.setHeader("Set-Cookie", cookieString(SESSION_COOKIE, sid, SESSION_TTL_MS / 1000));
  await logOperatorSessionEvent({
    event: "session_created",
    userId: user.id,
    storeId: selected.id,
    payload: { store_count: stores.length },
  });
  return res.status(200).json({
    success: true,
    operator: { id: user.id, email: user.email ?? null },
    stores,
    current_store_id: selected.id,
    current_store: { id: selected.id, name: selected.name ?? null },
  });
});

router.get("/session", async (req, res) => {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const cookieSid = cookies[SESSION_COOKIE];
  const session = getSession(req);
  if (!session) {
    if (cookieSid) {
      res.setHeader("Set-Cookie", cookieString(SESSION_COOKIE, "", 0));
      await logOperatorSessionEvent({
        event: "session_invalidated",
        payload: { reason: "invalid_or_expired_cookie", had_cookie: true },
      });
      return res.status(200).json({
        success: true,
        authenticated: false,
        reason: "invalid_or_expired",
        message: "Session expired, was cleared, or this server restarted. Sign in again.",
      });
    }
    return res.status(200).json({ success: true, authenticated: false });
  }
  const { data: stores, error } = await listUserStores(session.userId);
  if (error) return res.status(500).json({ error: error.message });
  const currentStore = (stores ?? []).find((s) => s.id === session.storeId);
  if (!currentStore) {
    sessions.delete(session.sid);
    res.setHeader("Set-Cookie", cookieString(SESSION_COOKIE, "", 0));
    await logOperatorSessionEvent({
      event: "session_invalidated",
      userId: session.userId,
      storeId: session.storeId,
      payload: { reason: "membership_revoked_or_store_removed" },
    });
    return res.status(200).json({
      success: true,
      authenticated: false,
      reason: "membership_revoked",
      message: "You no longer have access to the selected store. Sign in again.",
    });
  }
  return res.status(200).json({
    success: true,
    authenticated: true,
    operator: { id: session.userId, email: session.email ?? null },
    stores: stores ?? [],
    current_store_id: currentStore.id,
    current_store: { id: currentStore.id, name: currentStore.name ?? null },
  });
});

router.patch("/session/store", requireOperatorSession, async (req, res) => {
  const requestedStoreId = String(req.body?.storeId ?? "").trim();
  if (!requestedStoreId) {
    return res.status(400).json({ error: "storeId is required" });
  }
  const { data: stores, error } = await listUserStores(req.operatorSession.userId);
  if (error) return res.status(500).json({ error: error.message });
  const selected = (stores ?? []).find((s) => s.id === requestedStoreId);
  if (!selected) return res.status(403).json({ error: "Not a member of requested store" });
  const previousStoreId = req.operatorSession.storeId;
  sessions.set(req.operatorSession.sid, {
    ...(sessions.get(req.operatorSession.sid) ?? {}),
    storeId: selected.id,
    expiresAt: now() + SESSION_TTL_MS,
  });
  await logOperatorSessionEvent({
    event: "store_switched",
    userId: req.operatorSession.userId,
    storeId: selected.id,
    payload: { from_store_id: previousStoreId, to_store_id: selected.id },
  });
  return res.status(200).json({
    success: true,
    current_store_id: selected.id,
    current_store: { id: selected.id, name: selected.name ?? null },
  });
});

router.delete("/session", async (req, res) => {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const sid = cookies[SESSION_COOKIE];
  let userId = null;
  let storeId = null;
  if (sid) {
    const rec = sessions.get(sid);
    if (rec) {
      userId = rec.userId;
      storeId = rec.storeId;
    }
    sessions.delete(sid);
  }
  res.setHeader("Set-Cookie", cookieString(SESSION_COOKIE, "", 0));
  if (userId) {
    await logOperatorSessionEvent({
      event: "logout",
      userId,
      storeId,
      payload: {},
    });
  }
  return res.status(200).json({ success: true });
});

router.get("/api/runs", requireOperatorSession, async (req, res) => {
  const { status, failure_type: failureType, cart_id: cartId } = req.query;
  const pendingManualReviewRaw = req.query.pending_manual_review;
  const pendingManualReview =
    pendingManualReviewRaw === undefined
      ? undefined
      : String(pendingManualReviewRaw).toLowerCase() === "true";
  const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const offsetRaw = Number.parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(limitRaw, 1), 100);
  const offset = Number.isNaN(offsetRaw) ? 0 : Math.max(offsetRaw, 0);
  const { statusCode, body } = await listExecutionRunsForOperatorReview(
    supabase,
    req.operatorSession.storeId,
    {
      status: status ? String(status) : undefined,
      failureType: failureType ? String(failureType) : undefined,
      pendingManualReview,
      cartId: cartId ? String(cartId) : undefined,
      limit,
      offset,
    },
  );
  return res.status(statusCode).json(body);
});

router.get("/api/runs/:runId/review-bundle", requireOperatorSession, async (req, res) => {
  const { statusCode, body } = await getExecutionRunOperatorReviewBundleById(
    supabase,
    req.params.runId,
    req.operatorSession.storeId,
  );
  return res.status(statusCode).json(body);
});

router.post("/api/runs/:runId/actions", requireOperatorSession, async (req, res) => {
  const { action, reason, note } = req.body ?? {};
  const { statusCode, body } = await applyExecutionRunOperatorAction(
    supabase,
    req.params.runId,
    req.operatorSession.storeId,
    action,
    {
      reason,
      note,
      actorId: req.operatorSession.userId,
    },
  );
  return res.status(statusCode).json(body);
});

router.get("/api/diagnostics/overview", requireOperatorSession, async (req, res) => {
  const daysRaw = Number.parseInt(String(req.query.days ?? "7"), 10);
  const days = Number.isNaN(daysRaw) ? 7 : Math.min(90, Math.max(1, daysRaw));
  const diagRaw = Number.parseInt(String(req.query.diag_limit ?? "120"), 10);
  const diagLimit = Number.isNaN(diagRaw) ? 120 : Math.min(500, Math.max(10, diagRaw));
  const runsCapRaw = Number.parseInt(String(req.query.run_limit ?? "5000"), 10);
  const maxRunRows = Number.isNaN(runsCapRaw) ? 5000 : Math.min(20000, Math.max(100, runsCapRaw));

  const { statusCode, body } = await getOperatorDiagnosticsOverview(
    supabase,
    req.operatorSession.storeId,
    {
      runWindowDays: days,
      diagLimit,
      maxRunRows,
    },
  );
  return res.status(statusCode).json(body);
});

const pilotHealthRank = (status) => {
  if (status === "needs_attention") return 0;
  if (status === "degraded") return 1;
  return 2;
};

const defaultWorkflowState = () => ({
  pilot_ops_status: "unreviewed",
  last_reviewed_at: null,
  last_reviewed_by: null,
  operator_note: null,
});

const defaultAttentionSignal = (reason = "pilot_overview_unavailable") => ({
  requires_follow_up: false,
  is_overdue: false,
  reason_code: reason,
  workflow_status: "unreviewed",
  reference_at: null,
  due_at: null,
  elapsed_hours: 0,
  threshold_hours: 24,
});

router.get("/api/pilot-ops/stores", requireOperatorSession, async (req, res) => {
  const limitRaw = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const failedRaw = Number.parseInt(String(req.query.failed_limit ?? "5"), 10);
  const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);
  const failedLimit = Number.isNaN(failedRaw)
    ? 5
    : Math.min(Math.max(failedRaw, 1), 20);

  const { data: stores, error } = await listUserStores(req.operatorSession.userId);
  if (error) return res.status(500).json({ error: error.message });

  const rows = [];
  const nowIso = new Date().toISOString();
  for (const s of stores ?? []) {
    const ov = await getStorePilotOverview(supabase, s.id, { limit, failedLimit });
    if (ov.statusCode !== 200) {
      rows.push({
        store_id: s.id,
        store_name: s.name ?? null,
        health_status: "needs_attention",
        alert_reasons: ["pilot_overview_unavailable"],
        completion_rate_pct: null,
        total_recent_runs: 0,
        pilot_complete_runs: 0,
        runs_with_failed_checks: 0,
        most_common_triage_bucket: { bucket: null, count: 0 },
        attention_overdue: defaultAttentionSignal(),
        ...defaultWorkflowState(),
      });
      continue;
    }
    const summary = ov.body?.summary ?? {};
    const health = ov.body?.health ?? {};
    const wfOut = await getPilotOpsWorkflowState(supabase, s.id);
    if (!wfOut.ok) {
      return res.status(500).json({ error: wfOut.error });
    }
    const wf = wfOut.data;
    const attention_overdue = evaluatePilotOpsAttentionOverdue({
      healthStatus: health.health_status ?? "healthy",
      workflowState: wf,
      needsAttentionSince: health.needs_attention_since ?? null,
      minimumDataWindowMet: health.minimum_data_window_met !== false,
      now: nowIso,
    });
    const notifyOut = await evaluateAndRecordPilotOpsNotifications(supabase, {
      storeId: s.id,
      healthStatus: health.health_status ?? "healthy",
      attentionOverdue: attention_overdue,
      alertReasons: Array.isArray(health.alert_reasons) ? health.alert_reasons : [],
      workflowState: wf,
      now: nowIso,
    });
    if (!notifyOut.ok) return res.status(500).json({ error: notifyOut.error });
    rows.push({
      store_id: s.id,
      store_name: s.name ?? null,
      health_status: health.health_status ?? "healthy",
      alert_reasons: Array.isArray(health.alert_reasons) ? health.alert_reasons : [],
      completion_rate_pct: summary.completion_rate_pct ?? null,
      total_recent_runs: summary.total_recent_runs ?? 0,
      pilot_complete_runs: summary.pilot_complete_runs ?? 0,
      runs_with_failed_checks: summary.runs_with_failed_checks ?? 0,
      most_common_triage_bucket: summary.most_common_triage_bucket ?? {
        bucket: null,
        count: 0,
      },
      attention_overdue,
      ...wf,
    });
  }

  rows.sort((a, b) => {
    const ra = pilotHealthRank(a.health_status);
    const rb = pilotHealthRank(b.health_status);
    if (ra !== rb) return ra - rb;
    const ao = a.attention_overdue?.is_overdue === true ? 1 : 0;
    const bo = b.attention_overdue?.is_overdue === true ? 1 : 0;
    if (bo !== ao) return bo - ao;
    const ca = Number(a.completion_rate_pct ?? 0);
    const cb = Number(b.completion_rate_pct ?? 0);
    if (cb !== ca) return ca - cb;
    return String(a.store_name ?? a.store_id).localeCompare(
      String(b.store_name ?? b.store_id),
    );
  });

  return res.status(200).json({
    success: true,
    current_store_id: req.operatorSession.storeId,
    window: { run_limit: limit, failed_runs_limit: failedLimit },
    stores: rows,
  });
});

router.get("/api/pilot-ops/notifications", requireOperatorSession, async (req, res) => {
  const { data: stores, error } = await listUserStores(req.operatorSession.userId);
  if (error) return res.status(500).json({ error: error.message });
  const storeIds = (stores ?? []).map((s) => s.id).filter(Boolean);
  const rawLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);
  const out = await listPilotOpsNotifications(supabase, storeIds, { limit });
  if (!out.ok) return res.status(500).json({ error: out.error });
  return res.status(200).json({
    success: true,
    count: out.data.length,
    notifications: out.data,
  });
});

router.get("/api/pilot-ops/quality-summary", requireOperatorSession, async (req, res) => {
  const limitRaw = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const failedRaw = Number.parseInt(String(req.query.failed_limit ?? "5"), 10);
  const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);
  const failedLimit = Number.isNaN(failedRaw)
    ? 5
    : Math.min(Math.max(failedRaw, 1), 20);
  const metricsLimitRaw = Number.parseInt(String(req.query.metrics_limit ?? "3000"), 10);
  const metricsLimit = Number.isNaN(metricsLimitRaw)
    ? 3000
    : Math.min(Math.max(metricsLimitRaw, 50), 5000);
  const windowDaysRaw = Number.parseInt(String(req.query.window_days ?? "7"), 10);
  const windowDays = Number.isNaN(windowDaysRaw) ? 7 : Math.min(Math.max(windowDaysRaw, 1), 90);

  const { data: stores, error } = await listUserStores(req.operatorSession.userId);
  if (error) return res.status(500).json({ error: error.message });
  const nowIso = new Date().toISOString();

  /** @type {Array<Record<string, any>>} */
  const storeSnapshots = [];
  for (const s of stores ?? []) {
    const ov = await getStorePilotOverview(supabase, s.id, { limit, failedLimit });
    if (ov.statusCode !== 200) continue;
    const health = ov.body?.health ?? {};
    const wfOut = await getPilotOpsWorkflowState(supabase, s.id);
    if (!wfOut.ok) return res.status(500).json({ error: wfOut.error });
    const attention_overdue = evaluatePilotOpsAttentionOverdue({
      healthStatus: health.health_status ?? "healthy",
      workflowState: wfOut.data,
      needsAttentionSince: health.needs_attention_since ?? null,
      minimumDataWindowMet: health.minimum_data_window_met !== false,
      now: nowIso,
    });
    storeSnapshots.push({
      store_id: s.id,
      health_status: health.health_status ?? "healthy",
      pilot_ops_status: wfOut.data.pilot_ops_status,
      attention_overdue,
    });
  }

  const storeIds = storeSnapshots.map((s) => s.store_id);
  const notifOut = await listPilotOpsNotifications(supabase, storeIds, { limit: metricsLimit });
  if (!notifOut.ok) return res.status(500).json({ error: notifOut.error });
  const wfHistoryOut = await listPilotOpsWorkflowStateHistoryForStores(supabase, storeIds, {
    limit: metricsLimit,
  });
  if (!wfHistoryOut.ok) return res.status(500).json({ error: wfHistoryOut.error });

  const summary = buildPilotOpsQualitySummary({
    stores: storeSnapshots,
    notifications: notifOut.data,
    workflowHistory: wfHistoryOut.data,
  });

  const timeComparison = buildPilotOpsTimeComparison({
    nowMs: Date.now(),
    windowDays,
    notifications: notifOut.data ?? [],
    workflowHistory: wfHistoryOut.data ?? [],
  });

  return res.status(200).json({
    success: true,
    generated_at: nowIso,
    scope: {
      stores: storeSnapshots.length,
      run_limit: limit,
      failed_runs_limit: failedLimit,
      metrics_limit: metricsLimit,
      window_days: windowDays,
    },
    quality_summary: summary,
    time_comparison: timeComparison,
  });
});

router.get("/api/pilot-ops/stores-needing-follow-up", requireOperatorSession, async (req, res) => {
  const limitRaw = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const failedRaw = Number.parseInt(String(req.query.failed_limit ?? "5"), 10);
  const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);
  const failedLimit = Number.isNaN(failedRaw)
    ? 5
    : Math.min(Math.max(failedRaw, 1), 20);

  const { data: stores, error } = await listUserStores(req.operatorSession.userId);
  if (error) return res.status(500).json({ error: error.message });

  const rows = [];
  const nowIso = new Date().toISOString();
  for (const s of stores ?? []) {
    const ov = await getStorePilotOverview(supabase, s.id, { limit, failedLimit });
    if (ov.statusCode !== 200) continue;
    const summary = ov.body?.summary ?? {};
    const health = ov.body?.health ?? {};
    const wfOut = await getPilotOpsWorkflowState(supabase, s.id);
    if (!wfOut.ok) return res.status(500).json({ error: wfOut.error });
    const attention_overdue = evaluatePilotOpsAttentionOverdue({
      healthStatus: health.health_status ?? "healthy",
      workflowState: wfOut.data,
      needsAttentionSince: health.needs_attention_since ?? null,
      minimumDataWindowMet: health.minimum_data_window_met !== false,
      now: nowIso,
    });
    if (!attention_overdue.requires_follow_up) continue;
    if (!attention_overdue.is_overdue) continue;
    rows.push({
      store_id: s.id,
      store_name: s.name ?? null,
      health_status: health.health_status ?? "healthy",
      alert_reasons: Array.isArray(health.alert_reasons) ? health.alert_reasons : [],
      completion_rate_pct: summary.completion_rate_pct ?? null,
      total_recent_runs: summary.total_recent_runs ?? 0,
      pilot_complete_runs: summary.pilot_complete_runs ?? 0,
      runs_with_failed_checks: summary.runs_with_failed_checks ?? 0,
      most_common_triage_bucket: summary.most_common_triage_bucket ?? {
        bucket: null,
        count: 0,
      },
      ...wfOut.data,
      attention_overdue,
    });
  }

  rows.sort((a, b) => {
    const ad = new Date(a.attention_overdue?.due_at ?? 0).getTime();
    const bd = new Date(b.attention_overdue?.due_at ?? 0).getTime();
    if (ad !== bd) return ad - bd;
    return String(a.store_name ?? a.store_id).localeCompare(String(b.store_name ?? b.store_id));
  });

  return res.status(200).json({
    success: true,
    current_store_id: req.operatorSession.storeId,
    window: { run_limit: limit, failed_runs_limit: failedLimit },
    stores: rows,
  });
});

router.get("/api/pilot-ops/stores/:storeId", requireOperatorSession, async (req, res) => {
  const requestedStoreId = String(req.params.storeId ?? "").trim();
  const { data: stores, error } = await listUserStores(req.operatorSession.userId);
  if (error) return res.status(500).json({ error: error.message });
  const selected = (stores ?? []).find((s) => s.id === requestedStoreId);
  if (!selected) return res.status(403).json({ error: "Not a member of requested store" });

  const limitRaw = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const failedRaw = Number.parseInt(String(req.query.failed_limit ?? "5"), 10);
  const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);
  const failedLimit = Number.isNaN(failedRaw)
    ? 5
    : Math.min(Math.max(failedRaw, 1), 20);
  const historyLimitRaw = Number.parseInt(String(req.query.workflow_history_limit ?? "20"), 10);
  const workflowHistoryLimit = Number.isNaN(historyLimitRaw)
    ? 20
    : Math.min(Math.max(historyLimitRaw, 1), 100);
  const notifLimitRaw = Number.parseInt(String(req.query.notification_limit ?? "20"), 10);
  const notificationLimit = Number.isNaN(notifLimitRaw)
    ? 20
    : Math.min(Math.max(notifLimitRaw, 1), 100);

  const result = await getStorePilotOverview(supabase, requestedStoreId, {
    limit,
    failedLimit,
  });
  if (result.statusCode !== 200) {
    return res.status(result.statusCode).json(result.body);
  }

  const wfOut = await getPilotOpsWorkflowState(supabase, selected.id);
  if (!wfOut.ok) {
    return res.status(500).json({ error: wfOut.error });
  }
  const wfHistoryOut = await listPilotOpsWorkflowStateHistory(supabase, selected.id, {
    limit: workflowHistoryLimit,
  });
  if (!wfHistoryOut.ok) {
    return res.status(500).json({ error: wfHistoryOut.error });
  }

  const notifOut = await listPilotOpsNotifications(supabase, [selected.id], {
    limit: notificationLimit,
  });
  if (!notifOut.ok) {
    return res.status(500).json({ error: notifOut.error });
  }

  const attention_overdue = evaluatePilotOpsAttentionOverdue({
    healthStatus: result.body?.health?.health_status ?? "healthy",
    workflowState: wfOut.data,
    needsAttentionSince: result.body?.health?.needs_attention_since ?? null,
    minimumDataWindowMet: result.body?.health?.minimum_data_window_met !== false,
    now: new Date().toISOString(),
  });
  const notifyOut = await evaluateAndRecordPilotOpsNotifications(supabase, {
    storeId: selected.id,
    healthStatus: result.body?.health?.health_status ?? "healthy",
    attentionOverdue: attention_overdue,
    alertReasons: Array.isArray(result.body?.health?.alert_reasons)
      ? result.body.health.alert_reasons
      : [],
    workflowState: wfOut.data,
    now: new Date().toISOString(),
  });
  if (!notifyOut.ok) {
    return res.status(500).json({ error: notifyOut.error });
  }

  return res.status(200).json({
    success: true,
    store: { id: selected.id, name: selected.name ?? null },
    workflow_state: wfOut.data,
    attention_overdue,
    workflow_history: wfHistoryOut.data,
    notifications: notifOut.data,
    data: result.body,
  });
});

router.patch("/api/pilot-ops/stores/:storeId/workflow-state", requireOperatorSession, async (req, res) => {
  const requestedStoreId = String(req.params.storeId ?? "").trim();
  const { data: stores, error } = await listUserStores(req.operatorSession.userId);
  if (error) return res.status(500).json({ error: error.message });
  const selected = (stores ?? []).find((s) => s.id === requestedStoreId);
  if (!selected) return res.status(403).json({ error: "Not a member of requested store" });

  const status = req.body?.pilot_ops_status;
  const note = req.body?.operator_note;
  const out = await updatePilotOpsWorkflowState(supabase, selected.id, {
    status,
    note,
    actorId: req.operatorSession.userId,
    actorEmail: req.operatorSession.email ?? null,
  });
  if (!out.ok) {
    return res.status(400).json({ error: out.error });
  }
  return res.status(200).json({
    success: true,
    store: { id: selected.id, name: selected.name ?? null },
    workflow_state: out.data,
  });
});

export default router;
