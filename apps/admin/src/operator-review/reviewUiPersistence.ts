/**
 * Operator review UI — browser-local preferences (per store).
 *
 * Storage: localStorage, key `lk-admin-review-ui:v1:<storeId>` where `storeId` is the
 * authenticated operator session’s current store UUID. Not used when no store is selected
 * (avoids collisions and fighting session).
 *
 * Persisted fields:
 * - queueSortMode, autoRefreshEnabled, autoRefreshSec
 * - status / failure / pending manual / cart server filters (strings as in the UI)
 * - queueSearch (client-side filter on the loaded batch)
 * - lastOpenedRunId — last run successfully opened in detail; used only for an optional
 *   “Continue last opened run” link when that id still appears in the loaded list
 *
 * Not persisted: bulk selection, reason/note, flash messages, diagnostics page.
 *
 * Reset filters (queue UI): clears filters, queue search, and last-opened pointer for that
 * store; does not clear sort mode or auto-refresh prefs.
 *
 * Store switching: Review remounts per store; each store has its own key. Session/store
 * authority stays on the server — we do not persist store choice for auth.
 */

import type { QueueSortMode } from "./queuePrioritization";

export const REVIEW_UI_STORAGE_PREFIX = "lk-admin-review-ui:v1:";

const SORT_MODES = new Set<QueueSortMode>(["priority", "newest", "failed_only"]);
const REFRESH_SECS = new Set([15, 30, 60]);

const MAX_FIELD_LEN = 240;

function clip(s: string): string {
  if (s.length <= MAX_FIELD_LEN) return s;
  return s.slice(0, MAX_FIELD_LEN);
}

/** Loose UUID check — run ids from API are UUIDs */
export function isLikelyUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id.trim(),
  );
}

export type ReviewUiPersistedV1 = {
  v: 1;
  queueSortMode: QueueSortMode;
  autoRefreshEnabled: boolean;
  autoRefreshSec: number;
  statusFilter: string;
  failureTypeFilter: string;
  pendingManualFilter: string;
  cartIdFilter: string;
  queueSearch: string;
  lastOpenedRunId: string | null;
};

export const DEFAULT_REVIEW_UI: ReviewUiPersistedV1 = {
  v: 1,
  queueSortMode: "priority",
  autoRefreshEnabled: false,
  autoRefreshSec: 30,
  statusFilter: "",
  failureTypeFilter: "",
  pendingManualFilter: "",
  cartIdFilter: "",
  queueSearch: "",
  lastOpenedRunId: null,
};

function storageKey(storeId: string): string {
  return `${REVIEW_UI_STORAGE_PREFIX}${storeId}`;
}

function sanitizeMode(m: unknown): QueueSortMode {
  return typeof m === "string" && SORT_MODES.has(m as QueueSortMode)
    ? (m as QueueSortMode)
    : "priority";
}

function sanitizeSec(n: unknown): number {
  const x = Number(n);
  return REFRESH_SECS.has(x) ? x : 30;
}

function sanitizeBool(b: unknown, fallback: boolean): boolean {
  return typeof b === "boolean" ? b : fallback;
}

function sanitizeStr(s: unknown): string {
  if (typeof s !== "string") return "";
  return clip(s);
}

function sanitizeRunId(s: unknown): string | null {
  if (s === null || s === undefined || s === "") return null;
  if (typeof s !== "string") return null;
  const t = s.trim();
  return isLikelyUuid(t) ? t : null;
}

export function parseReviewUiPersisted(raw: unknown): ReviewUiPersistedV1 {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_REVIEW_UI };
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return { ...DEFAULT_REVIEW_UI };
  return {
    v: 1,
    queueSortMode: sanitizeMode(o.queueSortMode),
    autoRefreshEnabled: sanitizeBool(o.autoRefreshEnabled, DEFAULT_REVIEW_UI.autoRefreshEnabled),
    autoRefreshSec: sanitizeSec(o.autoRefreshSec),
    statusFilter: sanitizeStr(o.statusFilter),
    failureTypeFilter: sanitizeStr(o.failureTypeFilter),
    pendingManualFilter: sanitizeStr(o.pendingManualFilter),
    cartIdFilter: sanitizeStr(o.cartIdFilter),
    queueSearch: sanitizeStr(o.queueSearch),
    lastOpenedRunId: sanitizeRunId(o.lastOpenedRunId),
  };
}

export function readReviewUiPersisted(storeId: string | null | undefined): ReviewUiPersistedV1 {
  if (!storeId || !isLikelyUuid(storeId)) return { ...DEFAULT_REVIEW_UI };
  try {
    const raw = localStorage.getItem(storageKey(storeId));
    if (!raw) return { ...DEFAULT_REVIEW_UI };
    return parseReviewUiPersisted(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_REVIEW_UI };
  }
}

export function writeReviewUiPersisted(
  storeId: string | null | undefined,
  data: ReviewUiPersistedV1,
): void {
  if (!storeId || !isLikelyUuid(storeId)) return;
  try {
    localStorage.setItem(storageKey(storeId), JSON.stringify(data));
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Removes persisted prefs for one store (e.g. operator clears browser data manually — optional helper). */
export function clearReviewUiPersisted(storeId: string | null | undefined): void {
  if (!storeId || !isLikelyUuid(storeId)) return;
  try {
    localStorage.removeItem(storageKey(storeId));
  } catch {
    /* ignore */
  }
}
