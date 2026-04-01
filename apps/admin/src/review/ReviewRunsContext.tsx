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
import type { QueueSortMode } from "../operator-review/queuePrioritization";
import {
  isLikelyUuid,
  readReviewUiPersisted,
  writeReviewUiPersisted,
  type ReviewUiPersistedV1,
} from "../operator-review/reviewUiPersistence";
import { useOperatorSession } from "../session/OperatorSessionContext";
import type {
  ExecutionAttemptRow,
  FlashMsg,
  OpAction,
  RunSummaryRow,
  Summary,
} from "../operator-review/types";
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
  attemptHistoryItems: ExecutionAttemptRow[];
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
  queueSortMode: QueueSortMode;
  setQueueSortMode: (v: QueueSortMode) => void;
  /** Present in loaded batch — safe to link; from last successful detail open */
  resumeRunId: string | null;
  loadRunDetail: (runId: string, silent?: boolean) => Promise<void>;
  loadRuns: (options?: { silentSuccess?: boolean; resetPage?: boolean }) => Promise<void>;
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
  /** Server GET /api/runs page size (25/50/100) */
  queuePageLimit: number;
  setQueuePageLimit: (n: number) => void;
  /** Last fetched server page (newest-first from API) */
  listPageMeta: {
    limit: number;
    offset: number;
    rowCount: number;
    /** From API; null if missing (older server). Meaning depends on pending-manual filter — see UI copy. */
    totalCount: number | null;
  };
  loadNextPage: () => Promise<void>;
  loadPrevPage: () => Promise<void>;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

const ReviewRunsContext = createContext<ReviewRunsCtx | null>(null);

export function useReviewRuns(): ReviewRunsCtx {
  const v = useContext(ReviewRunsContext);
  if (!v) throw new Error("useReviewRuns must be used within ReviewRunsProvider");
  return v;
}

export function ReviewRunsProvider({ children }: { children: ReactNode }) {
  const { authenticated, handleSessionFailure, currentStore } = useOperatorSession();
  const navigate = useNavigate();
  const location = useLocation();

  const storeId = useMemo(() => {
    const id = currentStore?.id?.trim() ?? "";
    return id && isLikelyUuid(id) ? id : "";
  }, [currentStore?.id]);

  const persisted = useMemo(() => readReviewUiPersisted(storeId || null), [storeId]);

  const [statusFilter, setStatusFilter] = useState(persisted.statusFilter);
  const [failureTypeFilter, setFailureTypeFilter] = useState(persisted.failureTypeFilter);
  const [pendingManualFilter, setPendingManualFilter] = useState(persisted.pendingManualFilter);
  const [cartIdFilter, setCartIdFilter] = useState(persisted.cartIdFilter);
  const [queueSearch, setQueueSearch] = useState(persisted.queueSearch);
  const [queuePageLimit, setQueuePageLimitState] = useState(persisted.queuePageLimit);
  const [pageOffset, setPageOffset] = useState(0);
  const [listPageMeta, setListPageMeta] = useState({
    limit: persisted.queuePageLimit,
    offset: 0,
    rowCount: 0,
    totalCount: null as number | null,
  });

  const [runs, setRuns] = useState<RunSummaryRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detailSummary, setDetailSummary] = useState<Summary | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<unknown[]>([]);
  const [attemptHistoryItems, setAttemptHistoryItems] = useState<ExecutionAttemptRow[]>([]);
  const [opActions, setOpActions] = useState<OpAction[]>([]);

  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);

  const [listMsg, setListMsg] = useState<FlashMsg>({ type: "", text: "" });
  const [detailMsg, setDetailMsg] = useState<FlashMsg>({ type: "", text: "" });

  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(persisted.autoRefreshEnabled);
  const [autoRefreshSec, setAutoRefreshSec] = useState(persisted.autoRefreshSec);
  const [queueSortMode, setQueueSortMode] = useState<QueueSortMode>(persisted.queueSortMode);
  const [lastOpenedRunId, setLastOpenedRunId] = useState<string | null>(persisted.lastOpenedRunId);

  const [bulkSelectedRunIds, setBulkSelectedRunIds] = useState<string[]>([]);

  const persistSnapshot = useCallback((): ReviewUiPersistedV1 => {
    return {
      v: 1,
      queueSortMode,
      autoRefreshEnabled,
      autoRefreshSec,
      statusFilter,
      failureTypeFilter,
      pendingManualFilter,
      cartIdFilter,
      queueSearch,
      queuePageLimit,
      lastOpenedRunId,
    };
  }, [
    queueSortMode,
    autoRefreshEnabled,
    autoRefreshSec,
    statusFilter,
    failureTypeFilter,
    pendingManualFilter,
    cartIdFilter,
    queueSearch,
    queuePageLimit,
    lastOpenedRunId,
  ]);

  /** Debounced: avoids a localStorage write on every queue-search keystroke. */
  useEffect(() => {
    if (!storeId) return;
    const t = window.setTimeout(() => {
      writeReviewUiPersisted(storeId, persistSnapshot());
    }, 400);
    return () => clearTimeout(t);
  }, [storeId, persistSnapshot]);

  const resetDetail = useCallback(() => {
    setSelectedRunId(null);
    setDetailSummary(null);
    setEvidenceItems([]);
    setAttemptHistoryItems([]);
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
        const ah = data?.attempt_history as { items?: ExecutionAttemptRow[] } | undefined;
        const oa = data?.operator_actions as { items?: OpAction[] } | undefined;
        setDetailSummary(summary ?? null);
        setEvidenceItems(evidence?.items ?? []);
        setAttemptHistoryItems(ah?.items ?? []);
        setOpActions(oa?.items ?? []);
        setLastOpenedRunId(runId);
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
    async (
      filters: ServerFilters,
      options?: { silentSuccess?: boolean; offset?: number; limit?: number },
    ) => {
      if (!authenticated) return;
      const lim = options?.limit ?? queuePageLimit;
      const off = options?.offset !== undefined ? options.offset : pageOffset;
      setListMsg({ type: "", text: "" });
      setLoadingRuns(true);
      const query = buildQuery({
        status: filters.status || undefined,
        failure_type: filters.failureType || undefined,
        pending_manual_review: filters.pendingManual || undefined,
        cart_id: filters.cartId.trim() || undefined,
        limit: String(lim),
        offset: String(off),
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
        const page = body.page as { limit?: number; offset?: number; total_count?: number } | undefined;
        const resolvedLimit = Number(page?.limit ?? lim);
        const resolvedOffset = Number(page?.offset ?? off);
        const rawTotal = (body as { total_count?: unknown }).total_count ?? page?.total_count;
        const totalCount =
          typeof rawTotal === "number" && Number.isFinite(rawTotal) ? rawTotal : null;
        setRuns(list);
        setPageOffset(resolvedOffset);
        setListPageMeta({
          limit: resolvedLimit,
          offset: resolvedOffset,
          rowCount: list.length,
          totalCount,
        });

        const sid = selectedRunId;
        const urlRun = runIdFromReviewDetailPath(location.pathname);
        const still = sid ? list.some((r) => r.run_id === sid) : false;
        if (sid && !still) {
          resetDetail();
          if (urlRun === sid) navigate("/review", { replace: true });
        } else if (sid && still && !options?.silentSuccess) {
          await loadRunDetail(sid, true);
        }

        if (list.length === 0) {
          if (!options?.silentSuccess) {
            setListMsg({
              type: "warn",
              text: `No runs on this server page (offset ${resolvedOffset}, limit ${resolvedLimit}). Try Previous page or broaden server filters.`,
            });
          } else {
            setListMsg({ type: "", text: "" });
          }
        } else if (!options?.silentSuccess) {
          const rowStart = resolvedOffset + 1;
          const rowEnd = resolvedOffset + list.length;
          const totalPart =
            totalCount != null
              ? ` ${totalCount} total matching server filters.`
              : "";
          setListMsg({
            type: "success",
            text: `This page: SQL rows ${rowStart}–${rowEnd} (offset ${resolvedOffset}, limit ${resolvedLimit}; newest first).${totalPart} Queue search/sort apply only to the ${list.length} row(s) on this page.`,
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
      pageOffset,
      queuePageLimit,
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
    async (options?: { silentSuccess?: boolean; resetPage?: boolean }) => {
      const lim = queuePageLimit;
      const off = options?.resetPage ? 0 : pageOffset;
      await loadRunsWithFilters(currentServerFilters(), {
        silentSuccess: options?.silentSuccess,
        offset: off,
        limit: lim,
      });
    },
    [loadRunsWithFilters, currentServerFilters, pageOffset, queuePageLimit],
  );

  const setQueuePageLimit = useCallback(
    (n: number) => {
      const lim = n === 25 || n === 50 || n === 100 ? n : 50;
      setQueuePageLimitState(lim);
      void loadRunsWithFilters(currentServerFilters(), {
        offset: 0,
        limit: lim,
        silentSuccess: true,
      });
    },
    [loadRunsWithFilters, currentServerFilters],
  );

  const loadNextPage = useCallback(async () => {
    const next = pageOffset + queuePageLimit;
    await loadRunsWithFilters(currentServerFilters(), {
      silentSuccess: true,
      offset: next,
      limit: queuePageLimit,
    });
  }, [pageOffset, queuePageLimit, loadRunsWithFilters, currentServerFilters]);

  const loadPrevPage = useCallback(async () => {
    const prev = Math.max(0, pageOffset - queuePageLimit);
    await loadRunsWithFilters(currentServerFilters(), {
      silentSuccess: true,
      offset: prev,
      limit: queuePageLimit,
    });
  }, [pageOffset, queuePageLimit, loadRunsWithFilters, currentServerFilters]);

  const hasNextPage = useMemo(() => {
    const tc = listPageMeta.totalCount;
    const lim = listPageMeta.limit;
    const off = listPageMeta.offset;
    if (tc != null && pendingManualFilter === "") {
      return off + lim < tc;
    }
    return listPageMeta.rowCount === lim && lim > 0;
  }, [
    listPageMeta.totalCount,
    listPageMeta.limit,
    listPageMeta.offset,
    listPageMeta.rowCount,
    pendingManualFilter,
  ]);

  const hasPrevPage = useMemo(() => listPageMeta.offset > 0, [listPageMeta.offset]);

  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;
  const loadingRunsRef = useRef(false);
  const actionInFlightRef = useRef(false);
  loadingRunsRef.current = loadingRuns;
  actionInFlightRef.current = actionInFlight;

  useEffect(() => {
    if (!authenticated) return;
    void loadRunsRef.current({ silentSuccess: true });
  }, [authenticated]);

  useEffect(() => {
    if (!autoRefreshEnabled || !authenticated) return;
    const sec = Number(autoRefreshSec);
    if (!Number.isFinite(sec) || sec < 5) return;
    const id = window.setInterval(() => {
      if (!loadingRunsRef.current && !actionInFlightRef.current) {
        void loadRunsRef.current?.({ silentSuccess: true });
      }
    }, sec * 1000);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, autoRefreshSec, authenticated]);

  const filteredRuns = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter(
      (r) =>
        (r.run_id && r.run_id.toLowerCase().includes(q)) ||
        (r.cart_id && String(r.cart_id).toLowerCase().includes(q)),
    );
  }, [runs, queueSearch]);

  const resumeRunId = useMemo(() => {
    if (!lastOpenedRunId) return null;
    return runs.some((r) => r.run_id === lastOpenedRunId) ? lastOpenedRunId : null;
  }, [runs, lastOpenedRunId]);

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
    setLastOpenedRunId(null);
    setBulkSelectedRunIds([]);
    setPageOffset(0);
    void loadRunsWithFilters(
      { status: "", failureType: "", pendingManual: "", cartId: "" },
      { offset: 0, limit: queuePageLimit },
    );
  }, [loadRunsWithFilters, queuePageLimit]);

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
      attemptHistoryItems,
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
      queueSortMode,
      setQueueSortMode,
      resumeRunId,
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
      queuePageLimit,
      setQueuePageLimit,
      listPageMeta,
      loadNextPage,
      loadPrevPage,
      hasNextPage,
      hasPrevPage,
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
      attemptHistoryItems,
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
      queueSortMode,
      resumeRunId,
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
      queuePageLimit,
      setQueuePageLimit,
      listPageMeta,
      loadNextPage,
      loadPrevPage,
      hasNextPage,
      hasPrevPage,
    ],
  );

  return <ReviewRunsContext.Provider value={value}>{children}</ReviewRunsContext.Provider>;
}
