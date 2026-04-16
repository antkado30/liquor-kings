import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPilotOpsNotifications,
  getPilotOpsQualitySummary,
  getPilotOpsStoreOverview,
  getPilotOpsStores,
  patchPilotOpsStoreWorkflowState,
  parseJson,
} from "../api/operatorReview";
import { Msg } from "../operator-review/components/Msg";
import { buildQuery } from "../operator-review/utils";
import { useOperatorSession } from "../session/OperatorSessionContext";
import type { FlashKind } from "../operator-review/types";

type StorePilotRow = {
  store_id: string;
  store_name: string | null;
  health_status: "healthy" | "degraded" | "needs_attention";
  alert_reasons: string[];
  completion_rate_pct: number | null;
  total_recent_runs: number;
  pilot_complete_runs: number;
  runs_with_failed_checks: number;
  most_common_triage_bucket: { bucket: string | null; count: number };
  pilot_ops_status: "unreviewed" | "watching" | "escalated" | "resolved";
  last_reviewed_at: string | null;
  last_reviewed_by: string | null;
  operator_note: string | null;
  attention_overdue?: {
    requires_follow_up: boolean;
    is_overdue: boolean;
    reason_code: string;
    due_at: string | null;
    elapsed_hours: number;
    threshold_hours: number | null;
  };
};

type WorkflowHistoryRow = {
  id: string;
  changed_at: string;
  changed_by: string;
  previous_pilot_ops_status: string | null;
  new_pilot_ops_status: string;
  previous_operator_note: string | null;
  new_operator_note: string | null;
};

type PilotNotificationRow = {
  id: string;
  store_id: string;
  notification_kind: "newly_needs_attention" | "newly_attention_overdue";
  reason_code: string;
  triggered_at: string;
  payload?: Record<string, unknown>;
};

const formatTs = (value: string | null | undefined) => {
  if (!value) return "n/a";
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return String(value);
  return t.toLocaleString();
};

const trendGlyph = (code: string) => {
  if (code === "improving") return "↑";
  if (code === "worsening") return "↓";
  return "→";
};

const healthRank = (status: string) =>
  status === "needs_attention" ? 0 : status === "degraded" ? 1 : 2;

const statusColor = (kind: "health" | "workflow" | "overdue", value: string) => {
  if (kind === "health") {
    if (value === "needs_attention") return { bg: "#fee2e2", fg: "#991b1b" };
    if (value === "degraded") return { bg: "#fef3c7", fg: "#92400e" };
    return { bg: "#dcfce7", fg: "#166534" };
  }
  if (kind === "workflow") {
    if (value === "escalated") return { bg: "#fecaca", fg: "#7f1d1d" };
    if (value === "watching") return { bg: "#dbeafe", fg: "#1e3a8a" };
    if (value === "resolved") return { bg: "#dcfce7", fg: "#14532d" };
    return { bg: "#e5e7eb", fg: "#374151" };
  }
  if (value === "overdue") return { bg: "#fecaca", fg: "#7f1d1d" };
  if (value === "follow_up") return { bg: "#fde68a", fg: "#854d0e" };
  return { bg: "#e5e7eb", fg: "#374151" };
};

function Pill({ label, kind, value }: { label: string; kind: "health" | "workflow" | "overdue"; value: string }) {
  const c = statusColor(kind, value);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
      }}
    >
      {label}
    </span>
  );
}

export function PilotOpsPage() {
  const { currentStore, handleSessionFailure } = useOperatorSession();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: FlashKind; text: string }>({
    type: "",
    text: "",
  });
  const [stores, setStores] = useState<StorePilotRow[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [wfStatus, setWfStatus] = useState<
    "unreviewed" | "watching" | "escalated" | "resolved"
  >("unreviewed");
  const [wfNote, setWfNote] = useState("");
  const [savingWf, setSavingWf] = useState(false);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowHistoryRow[]>([]);
  const [notifications, setNotifications] = useState<PilotNotificationRow[]>([]);
  const [attentionOverdue, setAttentionOverdue] = useState<Record<string, unknown> | null>(null);
  const [showFollowUpOnly, setShowFollowUpOnly] = useState(false);
  const [qualitySummary, setQualitySummary] = useState<Record<string, unknown> | null>(null);
  const [timeComparison, setTimeComparison] = useState<Record<string, unknown> | null>(null);

  const query = useMemo(
    () =>
      buildQuery({
        limit: "20",
        failed_limit: "5",
      }),
    [],
  );

  const loadStores = useCallback(async () => {
    setLoading(true);
    setMsg({ type: "", text: "" });
    try {
      const res = await getPilotOpsStores(query);
      const body = await parseJson(res);
      if (!res.ok) {
        if (await handleSessionFailure(res, body)) return;
        setMsg({
          type: "error",
          text: String(body.error ?? "Failed to load pilot stores."),
        });
        setStores([]);
        return;
      }
      const rows = Array.isArray(body.stores) ? (body.stores as StorePilotRow[]) : [];
      const sorted = [...rows].sort((a, b) => {
        const h = healthRank(a.health_status) - healthRank(b.health_status);
        if (h !== 0) return h;
        const ao = a.attention_overdue?.is_overdue === true ? 1 : 0;
        const bo = b.attention_overdue?.is_overdue === true ? 1 : 0;
        if (bo !== ao) return bo - ao;
        return String(a.store_name ?? a.store_id).localeCompare(String(b.store_name ?? b.store_id));
      });
      setStores(sorted);
      const qRes = await getPilotOpsQualitySummary(
        buildQuery({
          limit: "20",
          failed_limit: "5",
          metrics_limit: "3000",
          window_days: "7",
        }),
      );
      const qBody = await parseJson(qRes);
      if (qRes.ok) {
        setQualitySummary(
          (qBody.quality_summary as Record<string, unknown> | undefined) ?? null,
        );
        setTimeComparison(
          (qBody.time_comparison as Record<string, unknown> | undefined) ?? null,
        );
      } else {
        setTimeComparison(null);
      }
      const firstId = rows[0]?.store_id ?? currentStore?.id ?? "";
      setSelectedStoreId((prev) => prev || firstId);
    } catch {
      setMsg({ type: "error", text: "Network error loading pilot stores." });
      setStores([]);
    } finally {
      setLoading(false);
    }
  }, [query, handleSessionFailure, currentStore?.id]);

  const loadDetail = useCallback(
    async (storeId: string) => {
      if (!storeId) return;
      const res = await getPilotOpsStoreOverview(storeId, query);
      const body = await parseJson(res);
      if (!res.ok) {
        if (await handleSessionFailure(res, body)) return;
        setMsg({
          type: "error",
          text: String(body.error ?? "Failed to load selected store pilot detail."),
        });
        setDetail(null);
        return;
      }
      setDetail((body.data as Record<string, unknown>) ?? null);
      setAttentionOverdue((body.attention_overdue as Record<string, unknown> | undefined) ?? null);
      setWorkflowHistory(
        Array.isArray(body.workflow_history) ? (body.workflow_history as WorkflowHistoryRow[]) : [],
      );
      const wf = (body.workflow_state as Record<string, unknown> | undefined) ?? {};
      const st = String(wf.pilot_ops_status ?? "unreviewed") as
        | "unreviewed"
        | "watching"
        | "escalated"
        | "resolved";
      setWfStatus(st);
      setWfNote(String(wf.operator_note ?? ""));
      const notifRes = await getPilotOpsNotifications(buildQuery({ limit: "50" }));
      const notifBody = await parseJson(notifRes);
      if (notifRes.ok) {
        const rows = Array.isArray(notifBody.notifications)
          ? (notifBody.notifications as PilotNotificationRow[])
          : [];
        setNotifications(rows.filter((n) => n.store_id === storeId).slice(0, 12));
      }
    },
    [query, handleSessionFailure],
  );

  const saveWorkflowState = useCallback(async () => {
    if (!selectedStoreId) return;
    setSavingWf(true);
    try {
      const res = await patchPilotOpsStoreWorkflowState(selectedStoreId, {
        pilot_ops_status: wfStatus,
        operator_note: wfNote,
      });
      const body = await parseJson(res);
      if (!res.ok) {
        if (await handleSessionFailure(res, body)) return;
        setMsg({
          type: "error",
          text: String(body.error ?? "Failed to update workflow state."),
        });
        return;
      }
      setMsg({ type: "success", text: "Pilot workflow state updated." });
      await loadStores();
      await loadDetail(selectedStoreId);
    } finally {
      setSavingWf(false);
    }
  }, [selectedStoreId, wfStatus, wfNote, handleSessionFailure, loadStores, loadDetail]);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  useEffect(() => {
    if (selectedStoreId) {
      void loadDetail(selectedStoreId);
    }
  }, [selectedStoreId, loadDetail]);

  const visibleStores = useMemo(
    () =>
      showFollowUpOnly
        ? stores.filter(
            (s) => s.health_status === "needs_attention" || s.attention_overdue?.is_overdue === true,
          )
        : stores,
    [stores, showFollowUpOnly],
  );

  const selectedStoreRow = useMemo(
    () => stores.find((s) => s.store_id === selectedStoreId) ?? null,
    [stores, selectedStoreId],
  );

  return (
    <div className="review-view">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Pilot Ops
        </h2>
        <button type="button" className="secondary" onClick={() => void loadStores()} disabled={loading}>
          Refresh
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Internal pilot operations triage. List is prioritized by <code>needs_attention</code>, then{" "}
        <code>degraded</code>, with overdue follow-up surfaced first.
      </p>

      <Msg type={msg.type} text={msg.text} />

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 className="section-title">Pilot Ops quality snapshot</h3>
        {!qualitySummary ? (
          <p className="muted">Quality summary unavailable.</p>
        ) : (
          <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
            <div>
              notifications:{" "}
              <strong>{String((qualitySummary.notifications as Record<string, unknown>)?.total ?? 0)}</strong>
              {" · "}newly_needs_attention:{" "}
              <strong>
                {String(
                  (
                    (qualitySummary.notifications as Record<string, unknown>)?.by_kind as
                      | Record<string, unknown>
                      | undefined
                  )?.newly_needs_attention ?? 0,
                )}
              </strong>
              {" · "}newly_attention_overdue:{" "}
              <strong>
                {String(
                  (
                    (qualitySummary.notifications as Record<string, unknown>)?.by_kind as
                      | Record<string, unknown>
                      | undefined
                  )?.newly_attention_overdue ?? 0,
                )}
              </strong>
            </div>
            <div>
              transitions:{" "}
              <strong>{String((qualitySummary.workflow_transitions as Record<string, unknown>)?.total ?? 0)}</strong>
              {" · "}watching:{" "}
              <strong>
                {String(
                  (
                    (qualitySummary.workflow_transitions as Record<string, unknown>)?.by_new_status as
                      | Record<string, unknown>
                      | undefined
                  )?.watching ?? 0,
                )}
              </strong>
              {" · "}escalated:{" "}
              <strong>
                {String(
                  (
                    (qualitySummary.workflow_transitions as Record<string, unknown>)?.by_new_status as
                      | Record<string, unknown>
                      | undefined
                  )?.escalated ?? 0,
                )}
              </strong>
              {" · "}resolved:{" "}
              <strong>
                {String(
                  (
                    (qualitySummary.workflow_transitions as Record<string, unknown>)?.by_new_status as
                      | Record<string, unknown>
                      | undefined
                  )?.resolved ?? 0,
                )}
              </strong>
            </div>
            <div>
              follow-up: overdue unreviewed{" "}
              <strong>
                {String(
                  (
                    qualitySummary.follow_up_quality as
                      | Record<string, unknown>
                      | undefined
                  )?.overdue_unreviewed ?? 0,
                )}
              </strong>
              {" · "}reviewed within SLA{" "}
              <strong>
                {String(
                  (
                    qualitySummary.follow_up_quality as
                      | Record<string, unknown>
                      | undefined
                  )?.overdue_reviewed_within_sla ?? 0,
                )}
              </strong>
              {" · "}suppressed (insufficient data){" "}
              <strong>
                {String(
                  (
                    qualitySummary.follow_up_quality as
                      | Record<string, unknown>
                      | undefined
                  )?.signal_suppressed_insufficient_window ?? 0,
                )}
              </strong>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Point-in-time row uses live store health + workflow. Trend block below compares the last{" "}
              {String((timeComparison as Record<string, unknown> | null)?.window_days ?? 7)} days to the prior
              same-length window (notifications + workflow history timestamps).
            </p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 className="section-title">Quality trend (recent vs previous window)</h3>
        {!timeComparison ? (
          <p className="muted">Trend data unavailable.</p>
        ) : (
          <div style={{ fontSize: 12 }}>
            <div className="muted" style={{ marginBottom: 8 }}>
              recent: {String((timeComparison.recent as Record<string, unknown> | undefined)?.start ?? "")} —{" "}
              {String((timeComparison.recent as Record<string, unknown> | undefined)?.end ?? "")}
              {" · "}previous:{" "}
              {String((timeComparison.previous as Record<string, unknown> | undefined)?.start ?? "")} —{" "}
              {String((timeComparison.previous as Record<string, unknown> | undefined)?.end ?? "")}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "4px 8px 4px 0" }}>Metric</th>
                  <th style={{ padding: 4 }}>Recent</th>
                  <th style={{ padding: 4 }}>Previous</th>
                  <th style={{ padding: 4 }}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["newly_needs_attention", "notifications.by_kind.newly_needs_attention", "newly_needs_attention"],
                    [
                      "newly_overdue_notif",
                      "notifications.by_kind.newly_attention_overdue",
                      "newly_attention_overdue",
                    ],
                    ["workflow → resolved", "workflow_transitions.by_new_status.resolved", "workflow_resolved"],
                    [
                      "SLA: resolved after overdue",
                      "follow_up_quality.overdue_reviewed_within_sla",
                      "overdue_reviewed_within_sla",
                    ],
                    [
                      "after SLA (pair)",
                      "follow_up_quality.overdue_reviewed_after_sla",
                      "overdue_reviewed_after_sla",
                    ],
                    ["overdue & unreviewed", "follow_up_quality.overdue_unreviewed", "overdue_unreviewed"],
                  ] as const
                ).map(([label, path, trendKey]) => {
                  const recentSum = timeComparison.recent as Record<string, unknown> | undefined;
                  const prevSum = timeComparison.previous as Record<string, unknown> | undefined;
                  const getNum = (root: Record<string, unknown> | undefined, p: string) => {
                    const parts = p.split(".");
                    let cur: unknown = root;
                    for (const part of parts) {
                      cur =
                        cur && typeof cur === "object"
                          ? (cur as Record<string, unknown>)[part]
                          : undefined;
                    }
                    return Number(cur ?? 0);
                  };
                  const r = getNum(recentSum?.summary as Record<string, unknown>, path);
                  const p = getNum(prevSum?.summary as Record<string, unknown>, path);
                  const trend = (timeComparison.trend as Record<string, unknown> | undefined) ?? {};
                  const code = String(trend[trendKey] ?? "flat");
                  return (
                    <tr key={label} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "6px 8px 6px 0" }}>{label}</td>
                      <td style={{ padding: 6 }}>{r}</td>
                      <td style={{ padding: 6 }}>{p}</td>
                      <td style={{ padding: 6 }}>
                        {trendGlyph(code)} {code}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="section-title">Stores</h3>
          <label className="muted" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={showFollowUpOnly}
              onChange={(e) => setShowFollowUpOnly(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            show only needs attention / overdue
          </label>
        </div>
        {loading && stores.length === 0 ? <p className="muted">Loading…</p> : null}
        {!loading && visibleStores.length === 0 ? <p className="muted">No stores match the current view.</p> : null}
        {visibleStores.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {visibleStores.map((s) => (
              <button
                key={s.store_id}
                type="button"
                className="secondary"
                onClick={() => setSelectedStoreId(s.store_id)}
                style={{
                  textAlign: "left",
                  border:
                    selectedStoreId === s.store_id
                      ? "2px solid #4f46e5"
                      : undefined,
                }}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{s.store_name ?? s.store_id}</strong>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Pill label={s.health_status} kind="health" value={s.health_status} />
                    <Pill
                      label={s.pilot_ops_status}
                      kind="workflow"
                      value={s.pilot_ops_status}
                    />
                    <Pill
                      label={
                        s.attention_overdue?.is_overdue
                          ? "overdue"
                          : s.attention_overdue?.requires_follow_up
                            ? "follow-up pending"
                            : "no follow-up"
                      }
                      kind="overdue"
                      value={
                        s.attention_overdue?.is_overdue
                          ? "overdue"
                          : s.attention_overdue?.requires_follow_up
                            ? "follow_up"
                            : "none"
                      }
                    />
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  completion {s.completion_rate_pct ?? 0}% · runs {s.total_recent_runs} · failed checks{" "}
                  {s.runs_with_failed_checks}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  follow-up reason:{" "}
                  <strong>{String(s.attention_overdue?.reason_code ?? "none")}</strong>
                  {s.attention_overdue?.due_at ? ` · due ${formatTs(s.attention_overdue.due_at)}` : ""}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {s.last_reviewed_by ? ` · by ${s.last_reviewed_by}` : ""}
                  {s.last_reviewed_at ? ` · ${s.last_reviewed_at}` : ""}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3 className="section-title">Selected store pilot detail</h3>
        {!detail ? <p className="muted">Select a store to load pilot overview.</p> : null}
        {detail ? (
          <>
            <div className="card" style={{ marginBottom: 12 }}>
              <h4 style={{ marginTop: 0, marginBottom: 8 }}>
                Health and follow-up
              </h4>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <Pill
                  label={String(selectedStoreRow?.health_status ?? "unknown")}
                  kind="health"
                  value={String(selectedStoreRow?.health_status ?? "healthy")}
                />
                <Pill
                  label={String(selectedStoreRow?.pilot_ops_status ?? "unreviewed")}
                  kind="workflow"
                  value={String(selectedStoreRow?.pilot_ops_status ?? "unreviewed")}
                />
                <Pill
                  label={
                    attentionOverdue?.is_overdue
                      ? "overdue"
                      : attentionOverdue?.requires_follow_up
                        ? "follow-up pending"
                        : "no follow-up"
                  }
                  kind="overdue"
                  value={
                    attentionOverdue?.is_overdue
                      ? "overdue"
                      : attentionOverdue?.requires_follow_up
                        ? "follow_up"
                        : "none"
                  }
                />
              </div>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Overdue means this store is still <code>needs_attention</code> beyond the workflow-status SLA
                window (unreviewed 24h, watching 12h, escalated 6h).
              </p>
              <div className="muted" style={{ fontSize: 12 }}>
                reason: <strong>{String(attentionOverdue?.reason_code ?? "none")}</strong>
                {attentionOverdue?.due_at ? ` · due ${formatTs(String(attentionOverdue.due_at))}` : ""}
                {typeof attentionOverdue?.elapsed_hours === "number"
                  ? ` · elapsed ${attentionOverdue.elapsed_hours}h`
                  : ""}
              </div>
            </div>
            <div className="card" style={{ marginBottom: 12 }}>
              <h4 style={{ marginTop: 0 }}>Workflow state</h4>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Use <code>watching</code> for active monitoring, <code>escalated</code> when broader support is
                needed, and <code>resolved</code> once recent pilot risk is handled.
              </p>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <label style={{ minWidth: 100 }}>Status</label>
                <select
                  value={wfStatus}
                  onChange={(e) => setWfStatus(e.target.value as typeof wfStatus)}
                >
                  <option value="unreviewed">unreviewed</option>
                  <option value="watching">watching</option>
                  <option value="escalated">escalated</option>
                  <option value="resolved">resolved</option>
                </select>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={{ display: "block", marginBottom: 4 }}>Operator note</label>
                <textarea
                  value={wfNote}
                  onChange={(e) => setWfNote(e.target.value)}
                  rows={3}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void saveWorkflowState()}
                  disabled={savingWf}
                >
                  {savingWf ? "Saving…" : "Save workflow state"}
                </button>
              </div>
            </div>
            <div className="card" style={{ marginBottom: 12 }}>
              <h4 style={{ marginTop: 0, marginBottom: 8 }}>Recent workflow changes</h4>
              {workflowHistory.length === 0 ? (
                <p className="muted">No workflow history yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {workflowHistory.slice(0, 8).map((h) => (
                    <div key={h.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 12 }}>
                        <strong>{h.changed_by || "unknown_operator"}</strong> · {formatTs(h.changed_at)}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        status: {h.previous_pilot_ops_status ?? "none"} -&gt; {h.new_pilot_ops_status}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        note: {h.previous_operator_note ?? "(empty)"} -&gt; {h.new_operator_note ?? "(empty)"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card" style={{ marginBottom: 12 }}>
              <h4 style={{ marginTop: 0, marginBottom: 8 }}>Recent notifications</h4>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Notification entries emit only on transitions (newly needs_attention / newly overdue).
              </p>
              {notifications.length === 0 ? (
                <p className="muted">No notifications yet for this store.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {notifications.map((n) => (
                    <div key={n.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 12 }}>
                        <strong>{n.notification_kind}</strong> · {formatTs(n.triggered_at)}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        reason: {n.reason_code}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <pre className="diag-pre">
              {JSON.stringify((detail as { health?: unknown }).health ?? {}, null, 2)}
            </pre>
            <h4 style={{ marginTop: 12, marginBottom: 8 }}>Recent failed runs</h4>
            <pre className="diag-pre">
              {JSON.stringify(
                (detail as { recent_failed_runs?: unknown[] }).recent_failed_runs ?? [],
                null,
                2,
              )}
            </pre>
          </>
        ) : null}
      </div>
    </div>
  );
}

