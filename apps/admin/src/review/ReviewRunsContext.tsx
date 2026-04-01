import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getReviewBundle,
  getRuns,
  parseJson,
  postRunAction,
} from "../api/operatorReview";
import { useOperatorSession } from "../session/OperatorSessionContext";
import type { FlashMsg, OpAction, RunSummaryRow, Summary } from "../operator-review/types";
import { buildQuery, CONFIRM_ACTIONS } from "../operator-review/utils";
import { runIdFromReviewDetailPath } from "./pathUtils";

type ServerFilters = {
  status: string;
  failureType: string;
  pendingManual: string;
  cartId: string;
};

type ReviewRunsCtx = {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  failureTypeFilter: string;
  setFailureTypeFilter: (v: string) => void;
  pendingManualFilter: string;
  setPendingManualFilter: (v: string) => void;
  cartIdFilter: string;
  setCartIdFilter: (v: string) => void;
  queueSearch: string;
  setQueueSearch: (v: string) => void;
  runs: RunSummaryRow[];
  filteredRuns: RunSummaryRow[];
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
  detailSummary: Summary | null;
  evidenceItems: unknown[];
  opActions: OpAction[];
  loadingRuns: boolean;
  loadingDetail: boolean;
  actionInFlight: boolean;
  listMsg: FlashMsg;
  detailMsg: FlashMsg;
  reason: string;
  note: string;
  setReason: (v: string) => void;
  setNote: (v: string) => void;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (v: boolean) => void;
  autoRefreshSec: number;
  setAutoRefreshSec: (v: number) => void;
  loadRunDetail: (runId: string, silent?: boolean) => Promise<void>;
  loadRuns: (options?: { silentSuccess?: boolean }) => Promise<void>;
  resetFilters: () => void;
  submitAction: (action: string) => Promise<void>;
  actionDisabled: boolean;
  canRetry: boolean;
  canResolve: boolean;
  canCancel: boolean;
};

const ReviewRunsContext = createContext<ReviewRunsCtx | null>(null);

export function useReviewRuns(): ReviewRunsCtx {
  const v = useContext(ReviewRunsContext);
  if (!v) throw new Error("useReviewRuns must be used within ReviewRunsProvider");
  return v;
}

export function ReviewRunsProvider({ children }: { children: ReactNode }) {
  const { authenticated, handleSessionFailure } = useOperatorSession();
  const navigate = useNavigate();
  const location = useLocation();

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

  const [listMsg, setListMsg] = useState<FlashMsg>({ type: "", text: "" });
  const [detailMsg, setDetailMsg] = useState<FlashMsg>({ type: "", text: "" });

  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

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
              body.error ?? "Failed to load this run (not found, wrong store, or server error).",
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

  const loadRunsWithFilters = useCallback(
    async (filters: ServerFilters, options?: { silentSuccess?: boolean }) => {
      if (!authenticated) return;
      setListMsg({ type: "", text: "" });
      setLoadingRuns(true);
      const query = buildQuery({
        status: filters.status || undefined,
        failure_type: filters.failureType || undefined,
        pending_manual_review: filters.pendingManual || undefined,
        cart_id: filters.cartId.trim() || undefined,
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

        const sid = selectedRunId;
        const urlRun = runIdFromReviewDetailPath(location.pathname);
        const still = sid ? list.some((r) => r.run_id === sid) : false;
        if (sid && !still) {
          resetDetail();
          if (urlRun === sid) navigate("/review", { replace: true });
        } else if (sid && still) {
          await loadRunDetail(sid, true);
        }

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
      selectedRunId,
      handleSessionFailure,
      loadRunDetail,
      resetDetail,
      location.pathname,
      navigate,
    ],
  );

  const currentServerFilters = useCallback(
    (): ServerFilters => ({
      status: statusFilter,
      failureType: failureTypeFilter,
      pendingManual: pendingManualFilter,
      cartId: cartIdFilter,
    }),
    [statusFilter, failureTypeFilter, pendingManualFilter, cartIdFilter],
  );

  const loadRuns = useCallback(
    async (options?: { silentSuccess?: boolean }) => {
      await loadRunsWithFilters(currentServerFilters(), options);
    },
    [loadRunsWithFilters, currentServerFilters],
  );

  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;

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

  const submitAction = useCallback(
    async (action: string) => {
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
    },
    [
      selectedRunId,
      actionInFlight,
      reason,
      note,
      handleSessionFailure,
      loadRuns,
      loadRunDetail,
    ],
  );

  const summary = detailSummary;
  const retryAllowed = Boolean(summary?.retry_allowed);
  const runStatus = String(summary?.status ?? "");
  const canRetry = retryAllowed;
  const canResolve = runStatus === "failed";
  const canCancel = runStatus !== "succeeded";

  const actionDisabled =
    !authenticated || !selectedRunId || !summary || actionInFlight || loadingDetail;

  const resetFilters = useCallback(() => {
    setStatusFilter("");
    setFailureTypeFilter("");
    setPendingManualFilter("");
    setCartIdFilter("");
    setQueueSearch("");
    void loadRunsWithFilters(
      { status: "", failureType: "", pendingManual: "", cartId: "" },
      undefined,
    );
  }, [loadRunsWithFilters]);

  const value = useMemo(
    () => ({
      statusFilter,
      setStatusFilter,
      failureTypeFilter,
      setFailureTypeFilter,
      pendingManualFilter,
      setPendingManualFilter,
      cartIdFilter,
      setCartIdFilter,
      queueSearch,
      setQueueSearch,
      runs,
      filteredRuns,
      selectedRunId,
      setSelectedRunId,
      detailSummary,
      evidenceItems,
      opActions,
      loadingRuns,
      loadingDetail,
      actionInFlight,
      listMsg,
      detailMsg,
      reason,
      note,
      setReason,
      setNote,
      autoRefreshEnabled,
      setAutoRefreshEnabled,
      autoRefreshSec,
      setAutoRefreshSec,
      loadRunDetail,
      loadRuns,
      resetFilters,
      submitAction,
      actionDisabled,
      canRetry,
      canResolve,
      canCancel,
    }),
    [
      statusFilter,
      failureTypeFilter,
      pendingManualFilter,
      cartIdFilter,
      queueSearch,
      runs,
      filteredRuns,
      selectedRunId,
      detailSummary,
      evidenceItems,
      opActions,
      loadingRuns,
      loadingDetail,
      actionInFlight,
      listMsg,
      detailMsg,
      reason,
      note,
      autoRefreshEnabled,
      autoRefreshSec,
      loadRunDetail,
      loadRuns,
      resetFilters,
      submitAction,
      actionDisabled,
      canRetry,
      canResolve,
      canCancel,
    ],
  );

  return <ReviewRunsContext.Provider value={value}>{children}</ReviewRunsContext.Provider>;
}
