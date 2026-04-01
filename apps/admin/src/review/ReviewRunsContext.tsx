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
import {
  formatBulkTriageResultMessage,
  groupSkippedCounts,
  partitionForBulkAcknowledge,
  partitionForBulkMarkManual,
} from "../operator-review/bulkTriageEligibility";
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
  bulkSelectedRunIds: string[];
  toggleBulkRunId: (runId: string) => void;
  clearBulkSelection: () => void;
  addToBulkSelection: (runIds: string[]) => void;
  submitBulkTriage: (action: "acknowledge" | "mark_for_manual_review") => Promise<void>;
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

  const [bulkSelectedRunIds, setBulkSelectedRunIds] = useState<string[]>([]);

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

  useEffect(() => {
    setBulkSelectedRunIds((prev) => prev.filter((id) => runs.some((r) => r.run_id === id)));
  }, [runs]);

  const toggleBulkRunId = useCallback((runId: string) => {
    setBulkSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((x) => x !== runId) : [...prev, runId],
    );
  }, []);

  const clearBulkSelection = useCallback(() => setBulkSelectedRunIds([]), []);

  const addToBulkSelection = useCallback((runIds: string[]) => {
    if (runIds.length === 0) return;
    setBulkSelectedRunIds((prev) => {
      const s = new Set(prev);
      for (const id of runIds) s.add(id);
      return [...s];
    });
  }, []);

  const submitBulkTriage = useCallback(
    async (action: "acknowledge" | "mark_for_manual_review") => {
      if (!authenticated || actionInFlight) return;
      const partition =
        action === "acknowledge"
          ? partitionForBulkAcknowledge(bulkSelectedRunIds, runs)
          : partitionForBulkMarkManual(bulkSelectedRunIds, runs);
      const { eligible, skipped } = partition;
      if (eligible.length === 0) {
        setListMsg({
          type: "warn",
          text:
            skipped.length === 0
              ? "No runs selected for bulk action."
              : `No eligible runs in current selection.\n${groupSkippedCounts(skipped)
                  .map((g) => `  • ${g.count}× ${g.label}`)
                  .join("\n")}`,
        });
        return;
      }
      const skipBreakdown =
        skipped.length > 0
          ? `\n\nWill skip ${skipped.length} ineligible (not sent):\n${groupSkippedCounts(skipped)
              .map((g) => `  • ${g.count}× ${g.label}`)
              .join("\n")}`
          : "";
      const sharedNote = note.trim() || null;
      const sharedReason = reason.trim() || null;
      const actionTitle = action.replace(/_/g, " ");
      if (
        !window.confirm(
          `Bulk ${actionTitle}: validate and audit each of ${eligible.length} run(s) on the server (one request per run). Optional reason/note from the detail panel apply to all.${skipBreakdown}\n\nProceed?`,
        )
      ) {
        return;
      }
      setActionInFlight(true);
      setListMsg({ type: "", text: "" });
      const successes: string[] = [];
      const failures: { id: string; err: string }[] = [];
      try {
        for (const id of eligible) {
          const res = await postRunAction(id, {
            action,
            reason: sharedReason,
            note: sharedNote,
          });
          const body = await parseJson(res);
          if (!res.ok) {
            if (await handleSessionFailure(res, body)) {
              return;
            }
            failures.push({
              id,
              err: String(body.error ?? `HTTP ${res.status}`),
            });
          } else {
            successes.push(id);
          }
        }
        const text = formatBulkTriageResultMessage(actionTitle, {
          succeeded: successes.length,
          skippedBefore: skipped,
          failures,
        });
        const msgType =
          failures.length > 0 && successes.length === 0
            ? "error"
            : failures.length > 0
              ? "warn"
              : "success";
        setListMsg({ type: msgType, text });
        setBulkSelectedRunIds((prev) => prev.filter((id) => !successes.includes(id)));
        await loadRuns({ silentSuccess: true });
        if (selectedRunId && successes.includes(selectedRunId)) {
          await loadRunDetail(selectedRunId, true);
        }
        if (failures.length === 0) {
          setReason("");
          setNote("");
        }
      } catch {
        setListMsg({ type: "error", text: "Network error during bulk action." });
      } finally {
        setActionInFlight(false);
      }
    },
    [
      authenticated,
      actionInFlight,
      bulkSelectedRunIds,
      runs,
      note,
      reason,
      handleSessionFailure,
      loadRuns,
      loadRunDetail,
      selectedRunId,
    ],
  );

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
    setBulkSelectedRunIds([]);
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
      bulkSelectedRunIds,
      toggleBulkRunId,
      clearBulkSelection,
      addToBulkSelection,
      submitBulkTriage,
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
      bulkSelectedRunIds,
      toggleBulkRunId,
      clearBulkSelection,
      addToBulkSelection,
      submitBulkTriage,
    ],
  );

  return <ReviewRunsContext.Provider value={value}>{children}</ReviewRunsContext.Provider>;
}
