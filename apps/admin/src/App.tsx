import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteSession,
  getReviewBundle,
  getRuns,
  getSession,
  parseJson,
  patchSessionStore,
  postRunAction,
  postSession,
} from "./api/operatorReview";
import { failureGuidanceText } from "./lib/failureGuidance";

type StoreRow = { id: string; name: string | null };
type Operator = { id: string; email: string | null };

type RunSummaryRow = {
  run_id: string;
  cart_id?: string | null;
  status: string;
  failure_type?: string | null;
  retry_allowed?: boolean;
  operator_status?: string;
  actionable_next_step?: string;
  pending_manual_review?: boolean;
};

type Summary = Record<string, unknown>;
type OpAction = {
  action: string;
  created_at?: string;
  actor_id?: string | null;
  reason?: string | null;
  note?: string | null;
};

const CONFIRM_ACTIONS = new Set(["retry_now", "cancel", "resolve_without_retry"]);

function buildQuery(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length > 0) p.set(k, v);
  }
  return p.toString();
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function FailureBadge({ ft }: { ft: string | null | undefined }) {
  if (!ft) return <span className="muted">-</span>;
  return <span className="badge">{ft}</span>;
}

function pickEvidenceKind(item: Record<string, unknown>): string {
  return String(item.kind ?? item.type ?? item.source ?? "other");
}

function pickEvidenceStage(item: Record<string, unknown>): string {
  return String(item.stage ?? item.progress_stage ?? item.phase ?? "general");
}

function EvidenceBlock({ items }: { items: unknown[] }) {
  if (!items.length) {
    return (
      <div className="empty-state">
        <strong>No evidence on this run</strong>
        Nothing was attached for this execution. Check worker configuration or earlier pipeline stages
        if you expected artifacts.
      </div>
    );
  }
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const title = `${pickEvidenceKind(item)} — ${pickEvidenceStage(item)}`;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(item);
  }
  const nodes: ReactNode[] = [];
  for (const [title, groupItems] of groups) {
    nodes.push(
      <div key={title} className="evidence-group-title">
        {title}
      </div>,
    );
    for (let i = 0; i < groupItems.length; i++) {
      const item = groupItems[i];
      const path =
        item.ref ??
        item.path ??
        item.file ??
        item.artifact_ref ??
        item.file_path ??
        item.url ??
        null;
      const summaryLine =
        item.message ?? item.title ?? item.summary ?? item.description ?? null;
      const stage = pickEvidenceStage(item);
      nodes.push(
        <div key={`${title}-${i}`} className="evidence-item">
          <div className="meta-line">
            <strong>Kind</strong> {pickEvidenceKind(item)}
          </div>
          {stage !== "general" ? (
            <div className="meta-line">
              <strong>Stage</strong> {stage}
            </div>
          ) : null}
          {path != null ? (
            <div className="meta-line">
              <strong>Artifact / ref</strong>{" "}
              <span className="mono">{String(path)}</span>
            </div>
          ) : null}
          {summaryLine != null ? (
            <div className="meta-line">
              <strong>Summary</strong> {String(summaryLine)}
            </div>
          ) : null}
          <details>
            <summary className="muted" style={{ cursor: "pointer", marginTop: 6 }}>
              Raw JSON
            </summary>
            <pre className="raw mono">{JSON.stringify(item, null, 2)}</pre>
          </details>
        </div>,
      );
    }
  }
  return <>{nodes}</>;
}

function Msg({ type, text }: { type: "error" | "success" | "warn" | ""; text: string }) {
  if (!text) return null;
  return <div className={`msg ${type}`}>{text}</div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [currentStore, setCurrentStore] = useState<StoreRow | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [preferredStoreId, setPreferredStoreId] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [failureTypeFilter, setFailureTypeFilter] = useState("");
  const [pendingManualFilter, setPendingManualFilter] = useState("");
  const [cartIdFilter, setCartIdFilter] = useState("");
  const [queueSearch, setQueueSearch] = useState("");

  const [runs, setRuns] = useState<RunSummaryRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detailSummary, setDetailSummary] = useState<Summary | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<unknown[]>([]);
  const [opActions, setOpActions] = useState<OpAction[]>([]);

  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);

  const [gateMsg, setGateMsg] = useState<{ type: "error" | "success" | "warn" | ""; text: string }>(
    { type: "", text: "" },
  );
  const [listMsg, setListMsg] = useState<{ type: "error" | "success" | "warn" | ""; text: string }>(
    { type: "", text: "" },
  );
  const [detailMsg, setDetailMsg] = useState<{
    type: "error" | "success" | "warn" | "";
    text: string;
  }>({ type: "", text: "" });

  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [storeSelect, setStoreSelect] = useState("");

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshSec, setAutoRefreshSec] = useState(30);

  const resetDetail = useCallback(() => {
    setSelectedRunId(null);
    setDetailSummary(null);
    setEvidenceItems([]);
    setOpActions([]);
    setReason("");
    setNote("");
    setDetailMsg({ type: "", text: "" });
  }, []);

  const fullReset = useCallback(() => {
    setAuthenticated(false);
    setOperator(null);
    setStores([]);
    setCurrentStore(null);
    setRuns([]);
    setQueueSearch("");
    setAutoRefreshEnabled(false);
    setListMsg({ type: "", text: "" });
    resetDetail();
    setStoreSelect("");
  }, [resetDetail]);

  const handleSessionFailure = useCallback(
    async (res: Response, body: Record<string, unknown>): Promise<boolean> => {
      const code = body.code as string | undefined;
      if (
        res.status === 401 &&
        (code === "operator_session_required" || /session/i.test(String(body.error ?? "")))
      ) {
        await deleteSession();
        fullReset();
        setGateMsg({
          type: "warn",
          text: String(body.error ?? "Your session expired. Sign in again."),
        });
        return true;
      }
      if (res.status === 403 && code === "operator_session_revoked") {
        await deleteSession();
        fullReset();
        setGateMsg({
          type: "warn",
          text: String(
            body.error ??
              "Store access was revoked. Sign in again if you still have membership.",
          ),
        });
        return true;
      }
      return false;
    },
    [fullReset],
  );

  const loadSession = useCallback(async () => {
    try {
      const res = await getSession();
      const body = await parseJson(res);
      if (!res.ok) {
        fullReset();
        setGateMsg({ type: "error", text: String(body.error ?? "Could not read session.") });
        return;
      }
      if (!body.authenticated) {
        setAuthenticated(false);
        setOperator(null);
        setStores([]);
        setCurrentStore(null);
        if (body.reason === "invalid_or_expired" || body.reason === "membership_revoked") {
          setGateMsg({
            type: "warn",
            text: String(body.message ?? "Session is no longer valid."),
          });
        } else {
          setGateMsg({ type: "", text: "" });
        }
        return;
      }
      setAuthenticated(true);
      setOperator((body.operator as Operator) ?? null);
      setStores((body.stores as StoreRow[]) ?? []);
      const cs = body.current_store as StoreRow | undefined;
      const cid = body.current_store_id as string | undefined;
      setCurrentStore(cs ?? (cid ? { id: cid, name: null } : null));
      setStoreSelect(String(body.current_store_id ?? ""));
      setGateMsg({ type: "", text: "" });
    } catch {
      fullReset();
      setGateMsg({ type: "error", text: "Network error while checking session." });
    }
  }, [fullReset]);

  const loadRunDetail = useCallback(
    async (runId: string, silent?: boolean) => {
      if (!authenticated) return;
      setSelectedRunId(runId);
      setLoadingDetail(true);
      setDetailMsg({ type: "", text: "" });
      try {
        const res = await getReviewBundle(runId);
        const body = await parseJson(res);
        if (!res.ok) {
          if (await handleSessionFailure(res, body)) return;
          setDetailMsg({
            type: "error",
            text: String(
              body.error ??
                "Failed to load this run (not found, wrong store, or server error).",
            ),
          });
          return;
        }
        const data = body.data as Record<string, unknown> | undefined;
        const summary = data?.summary as Summary | undefined;
        const evidence = data?.evidence as { items?: unknown[] } | undefined;
        const oa = data?.operator_actions as { items?: OpAction[] } | undefined;
        setDetailSummary(summary ?? null);
        setEvidenceItems(evidence?.items ?? []);
        setOpActions(oa?.items ?? []);
        if (!silent) setDetailMsg({ type: "success", text: "Run detail loaded." });
      } catch {
        setDetailMsg({
          type: "error",
          text: "Network error while loading run detail. Check connection and try again.",
        });
      } finally {
        setLoadingDetail(false);
      }
    },
    [authenticated, handleSessionFailure],
  );

  const loadRuns = useCallback(
    async (options?: { silentSuccess?: boolean }) => {
      if (!authenticated) return;
      setListMsg({ type: "", text: "" });
      setLoadingRuns(true);
      const query = buildQuery({
        status: statusFilter || undefined,
        failure_type: failureTypeFilter || undefined,
        pending_manual_review: pendingManualFilter || undefined,
        cart_id: cartIdFilter.trim() || undefined,
      });
      try {
        const res = await getRuns(query);
        const body = await parseJson(res);
        if (!res.ok) {
          if (await handleSessionFailure(res, body)) return;
          setListMsg({
            type: "error",
            text: String(body.error ?? "Failed to load runs (server rejected the request)."),
          });
          return;
        }
        const list = (body.data as RunSummaryRow[]) ?? [];
        setRuns(list);
        if (list.length === 0) {
          if (!options?.silentSuccess) {
            setListMsg({
              type: "warn",
              text: "No runs returned for these filters. Broaden filters or use Refresh to check again.",
            });
          } else {
            setListMsg({ type: "", text: "" });
          }
        } else if (!options?.silentSuccess) {
          setListMsg({
            type: "success",
            text: `Showing ${list.length} run(s) (newest first).`,
          });
        }
        if (selectedRunId) {
          const still = list.some((r) => r.run_id === selectedRunId);
          if (still) await loadRunDetail(selectedRunId, true);
          else resetDetail();
        }
      } catch {
        setListMsg({
          type: "error",
          text: "Network error — could not reach the API. Ensure the API is running and Vite proxy target is correct.",
        });
      } finally {
        setLoadingRuns(false);
      }
    },
    [
      authenticated,
      statusFilter,
      failureTypeFilter,
      pendingManualFilter,
      cartIdFilter,
      selectedRunId,
      handleSessionFailure,
      loadRunDetail,
      resetDetail,
    ],
  );

  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!authenticated) return;
    void loadRunsRef.current({ silentSuccess: true });
  }, [authenticated]);

  useEffect(() => {
    if (!autoRefreshEnabled || !authenticated) return;
    const sec = Number(autoRefreshSec);
    if (!Number.isFinite(sec) || sec < 5) return;
    const id = window.setInterval(() => {
      if (!loadingRuns && !actionInFlight) {
        void loadRunsRef.current?.({ silentSuccess: true });
      }
    }, sec * 1000);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, autoRefreshSec, authenticated, loadingRuns, actionInFlight]);

  const filteredRuns = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter(
      (r) =>
        (r.run_id && r.run_id.toLowerCase().includes(q)) ||
        (r.cart_id && String(r.cart_id).toLowerCase().includes(q)),
    );
  }, [runs, queueSearch]);

  const connect = async () => {
    setGateMsg({ type: "", text: "" });
    if (!accessToken.trim()) {
      setGateMsg({ type: "error", text: "Access token is required." });
      return;
    }
    const res = await postSession({
      accessToken: accessToken.trim(),
      storeId: preferredStoreId.trim() || null,
    });
    const body = await parseJson(res);
    if (!res.ok) {
      setGateMsg({ type: "error", text: String(body.error ?? "Failed to create session.") });
      return;
    }
    setAccessToken("");
    setPreferredStoreId("");
    await loadSession();
    setListMsg({ type: "success", text: "Operator session connected." });
  };

  const logout = async () => {
    await deleteSession();
    fullReset();
    setGateMsg({ type: "success", text: "Signed out. Session cookie cleared." });
    await loadSession();
  };

  const switchStore = async () => {
    if (!storeSelect) return;
    const res = await patchSessionStore(storeSelect);
    const body = await parseJson(res);
    if (!res.ok) {
      if (await handleSessionFailure(res, body)) return;
      setListMsg({ type: "error", text: String(body.error ?? "Failed to switch store.") });
      return;
    }
    const cs = body.current_store as StoreRow | undefined;
    if (cs) setCurrentStore(cs);
    resetDetail();
    setListMsg({ type: "success", text: "Store switched." });
    await loadSession();
    await loadRuns({ silentSuccess: true });
  };

  const submitAction = async (action: string) => {
    if (!selectedRunId) {
      setDetailMsg({ type: "error", text: "Select a run first." });
      return;
    }
    if (actionInFlight) return;
    if (CONFIRM_ACTIONS.has(action)) {
      if (!window.confirm(`Confirm action "${action}" for run ${selectedRunId}?`)) return;
    }
    setActionInFlight(true);
    setDetailMsg({ type: "", text: "" });
    try {
      const res = await postRunAction(selectedRunId, {
        action,
        reason: reason.trim() || null,
        note: note.trim() || null,
      });
      const body = await parseJson(res);
      if (!res.ok) {
        if (await handleSessionFailure(res, body)) return;
        setDetailMsg({ type: "error", text: String(body.error ?? "Action rejected") });
        return;
      }
      setReason("");
      setNote("");
      setDetailMsg({ type: "success", text: `Action "${action}" submitted.` });
      await loadRuns({ silentSuccess: true });
      if (selectedRunId) await loadRunDetail(selectedRunId, true);
      setListMsg({ type: "success", text: "Run queue refreshed." });
    } catch {
      setDetailMsg({ type: "error", text: "Network error while submitting action." });
    } finally {
      setActionInFlight(false);
    }
  };

  const summary = detailSummary;
  const retryAllowed = Boolean(summary?.retry_allowed);
  const runStatus = String(summary?.status ?? "");
  const canRetry = retryAllowed;
  const canResolve = runStatus === "failed";
  const canCancel = runStatus !== "succeeded";

  const actionDisabled =
    !authenticated || !selectedRunId || !summary || actionInFlight || loadingDetail;

  return (
    <>
      <header>
        <strong>Liquor Kings — Operator Review (app)</strong>
        <div className="sub">
          Dev: run API on :4000 and <code>npm run dev</code> here; requests proxy to /operator-review.
          Legacy static console: <code>/operator-review</code> on the API.
        </div>
      </header>

      <div className={`session-banner ${authenticated ? "" : "signed-out"}`}>
        {authenticated ? (
          <>
            Signed in as <strong>{operator?.email ?? operator?.id ?? "operator"}</strong>
            {" · "}
            Active store:{" "}
            <span className="mono">
              {currentStore
                ? `${currentStore.name ?? "(unnamed)"} · ${currentStore.id}`
                : "—"}
            </span>
          </>
        ) : (
          "Signed out — connect a session to triage runs."
        )}
      </div>

      {!authenticated ? (
        <div className="card gate">
          <h2>Sign in</h2>
          <p className="muted">
            Paste your Supabase access token once. The API sets an HttpOnly session cookie (proxied
            through this dev server).
          </p>
          <div className="row">
            <label>Access token</label>
            <input
              style={{ flex: 1, minWidth: 280 }}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Paste once"
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label>Optional store UUID</label>
            <input
              style={{ flex: 1, minWidth: 280 }}
              value={preferredStoreId}
              onChange={(e) => setPreferredStoreId(e.target.value)}
              placeholder="If multiple stores, set initial store"
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={() => void connect()} disabled={loadingRuns}>
              Connect session
            </button>
          </div>
          <Msg type={gateMsg.type} text={gateMsg.text} />
        </div>
      ) : null}

      <div className={`workspace ${authenticated ? "visible" : ""}`}>
        <div className="layout">
          <section className="card">
            <h3 className="section-title">Run queue</h3>
            <div className="row">
              <label>Switch store</label>
              <select
                value={storeSelect}
                onChange={(e) => setStoreSelect(e.target.value)}
                disabled={loadingRuns || actionInFlight}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.id}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary" onClick={() => void switchStore()}>
                Apply store
              </button>
              <button type="button" className="secondary" onClick={() => void logout()}>
                Logout
              </button>
            </div>
            {stores.length > 1 ? (
              <p className="muted">Multiple stores: pick one and Apply store.</p>
            ) : null}

            <div className="row" style={{ marginTop: 8 }}>
              <label>Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">(all)</option>
                <option>queued</option>
                <option>running</option>
                <option>failed</option>
                <option>succeeded</option>
                <option>canceled</option>
              </select>
              <label>Failure type</label>
              <select
                value={failureTypeFilter}
                onChange={(e) => setFailureTypeFilter(e.target.value)}
              >
                <option value="">(all)</option>
                <option>CODE_MISMATCH</option>
                <option>OUT_OF_STOCK</option>
                <option>QUANTITY_RULE_VIOLATION</option>
                <option>MLCC_UI_CHANGE</option>
                <option>NETWORK_ERROR</option>
                <option>UNKNOWN</option>
              </select>
              <label>Pending manual</label>
              <select
                value={pendingManualFilter}
                onChange={(e) => setPendingManualFilter(e.target.value)}
              >
                <option value="">(all)</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label>Cart ID</label>
              <input
                value={cartIdFilter}
                onChange={(e) => setCartIdFilter(e.target.value)}
                placeholder="Server filter (optional)"
              />
              <button
                type="button"
                onClick={() => void loadRuns()}
                disabled={loadingRuns || actionInFlight}
              >
                Load runs
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void loadRuns({ silentSuccess: true })}
                disabled={loadingRuns || actionInFlight}
              >
                Refresh
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setStatusFilter("");
                  setFailureTypeFilter("");
                  setPendingManualFilter("");
                  setCartIdFilter("");
                  setQueueSearch("");
                  void loadRuns();
                }}
                disabled={loadingRuns || actionInFlight}
              >
                Reset filters
              </button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label>Search queue</label>
              <input
                style={{ flex: 1, minWidth: 200 }}
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Filter loaded list by run / cart ID"
              />
            </div>
            <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
              <label className="row" style={{ gap: 4, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={autoRefreshEnabled}
                  onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
                />
                Auto-refresh
              </label>
              <select
                value={autoRefreshSec}
                onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
              >
                <option value={15}>every 15s</option>
                <option value={30}>every 30s</option>
                <option value={60}>every 60s</option>
              </select>
            </div>
            <Msg type={listMsg.type} text={listMsg.text} />
            <div className={`runs-list ${loadingRuns ? "loading" : ""}`}>
              {runs.length === 0 ? (
                <div className="empty-state">
                  <strong>No runs loaded</strong>
                  Set filters and Load runs, or Refresh.
                </div>
              ) : filteredRuns.length === 0 ? (
                <div className="empty-state">
                  <strong>No queue matches</strong>
                  Clear search or load a broader set.
                </div>
              ) : (
                filteredRuns.map((row) => {
                  const hint = failureGuidanceText(row.failure_type);
                  return (
                    <div
                      key={row.run_id}
                      role="button"
                      tabIndex={0}
                      className={`run-card${row.pending_manual_review ? " pending-review" : ""}${selectedRunId === row.run_id ? " selected" : ""}`}
                      onClick={() => void loadRunDetail(row.run_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          void loadRunDetail(row.run_id);
                      }}
                    >
                      <div>
                        <div className="primary-line">
                          <StatusBadge status={row.status} />
                          <FailureBadge ft={row.failure_type} />
                          <span className={row.retry_allowed ? "retry-yes" : "retry-no"}>
                            Retry: {row.retry_allowed ? "allowed" : "blocked"}
                          </span>
                        </div>
                        <div className="triage-row">
                          <strong>Next:</strong> {row.actionable_next_step ?? "—"} ·{" "}
                          <strong>Operator:</strong> {row.operator_status ?? "—"}
                        </div>
                        <div className="ids mono">Run {row.run_id}</div>
                        <div className="ids mono">Cart {row.cart_id ?? "—"}</div>
                        {hint ? <div className="hint">{hint}</div> : null}
                      </div>
                      <div style={{ textAlign: "right", fontSize: 11, color: "#6b7280" }}>
                        {row.pending_manual_review ? (
                          <>
                            <strong>MANUAL REVIEW</strong>
                            <br />
                          </>
                        ) : null}
                        Open →
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="card">
            <h3 className="section-title">Run detail</h3>
            <p>
              <strong>Run ID:</strong>{" "}
              <span className="mono">{selectedRunId ?? "—"}</span>
            </p>

            <h4>Summary</h4>
            <div className={`box ${loadingDetail ? "loading" : ""}`}>
              {!summary ? (
                <div className="empty-state">
                  <strong>No run selected</strong>
                  Choose a card from the queue.
                </div>
              ) : (
                <div className="detail-grid">
                  <div className="kv">
                    <strong>Status:</strong> <StatusBadge status={String(summary.status)} />
                  </div>
                  <div className="kv">
                    <strong>Failure:</strong>{" "}
                    <FailureBadge ft={summary.failure_type as string | null} />
                  </div>
                  <div className="kv">
                    <strong>Retry count:</strong> {String(summary.retry_count)} /{" "}
                    {String(summary.max_retries)}
                  </div>
                  <div className="kv">
                    <strong>Retry allowed:</strong>{" "}
                    <span className={retryAllowed ? "retry-yes" : "retry-no"}>
                      {retryAllowed ? "yes" : "no"}
                    </span>
                  </div>
                  <div className="kv">
                    <strong>Operator status:</strong> {String(summary.operator_status ?? "—")}
                  </div>
                  <div className="kv">
                    <strong>Pending manual:</strong>{" "}
                    {summary.pending_manual_review ? "yes" : "no"}
                  </div>
                  <div className="kv">
                    <strong>Next step:</strong> {String(summary.actionable_next_step ?? "—")}
                  </div>
                  <div className="kv">
                    <strong>Progress stage:</strong> {String(summary.progress_stage ?? "—")}
                  </div>
                  <div className="kv">
                    <strong>Progress message:</strong> {String(summary.progress_message ?? "—")}
                  </div>
                  <div className="kv">
                    <strong>Failure message:</strong> {String(summary.failure_message ?? "—")}
                  </div>
                </div>
              )}
            </div>
            {summary?.failure_type ? (
              <div className="failure-guidance">
                <strong>Suggested triage ({String(summary.failure_type)})</strong>{" "}
                {failureGuidanceText(String(summary.failure_type))}
              </div>
            ) : null}

            <h4>Timestamps</h4>
            <div className={`box ${loadingDetail ? "loading" : ""}`}>
              {!summary?.timestamps ? (
                <div className="empty-state" style={{ padding: 12 }}>
                  <strong>No run selected</strong>
                </div>
              ) : (
                <div className="detail-grid">
                  {Object.entries(summary.timestamps as Record<string, unknown>).map(
                    ([k, v]) => (
                      <div key={k} className="kv">
                        <strong>{k}:</strong> {v == null ? "—" : String(v)}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>

            <h4>Evidence</h4>
            <div className={`box ${loadingDetail ? "loading" : ""}`}>
              {!selectedRunId ? (
                <div className="empty-state">
                  <strong>No run selected</strong>
                </div>
              ) : (
                <EvidenceBlock items={evidenceItems} />
              )}
            </div>

            <h4>Operator actions</h4>
            <div className={`box ${loadingDetail ? "loading" : ""}`}>
              {!opActions.length ? (
                <div className="empty-state">
                  <strong>No operator actions yet</strong>
                </div>
              ) : (
                <ul className="timeline">
                  {opActions.map((item, i) => (
                    <li key={i}>
                      <div>
                        <strong>{item.action}</strong>{" "}
                        <span className="muted">{item.created_at ?? "—"}</span>
                      </div>
                      <div className="muted">actor: {item.actor_id ?? "unknown"}</div>
                      <div className="muted">reason: {item.reason ?? "—"}</div>
                      <div className="muted">note: {item.note ?? "—"}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <h4>Action panel</h4>
            <div className="actions">
              {(
                [
                  "acknowledge",
                  "mark_for_manual_review",
                  "retry_now",
                  "cancel",
                  "resolve_without_retry",
                ] as const
              ).map((a) => {
                let dis = actionDisabled;
                if (summary) {
                  if (a === "retry_now" && !canRetry) dis = true;
                  if (a === "resolve_without_retry" && !canResolve) dis = true;
                  if (a === "cancel" && !canCancel) dis = true;
                }
                return (
                  <button
                    key={a}
                    type="button"
                    className={a === "cancel" ? "danger" : undefined}
                    disabled={dis}
                    onClick={() => void submitAction(a)}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="reason (optional)"
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="note (optional)"
              />
            </div>
            <Msg type={detailMsg.type} text={detailMsg.text} />
            <p className="muted">Actions follow server guardrails.</p>
          </section>
        </div>
      </div>
    </>
  );
}
