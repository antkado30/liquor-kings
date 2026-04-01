import type { RunSummaryRow } from "./types";

export type QueueSortMode = "priority" | "newest" | "failed_only";

/** Queued runs older than this (minutes) get a higher priority tier. */
export const QUEUED_OLD_MINUTES_WARN = 30;
export const QUEUED_AGED_MINUTES = 10;

function tsMs(iso: string | undefined | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function queuedAgeMinutes(row: RunSummaryRow): number | null {
  if (row.status !== "queued") return null;
  const ts = row.timestamps?.queued_at ?? row.timestamps?.created_at;
  if (!ts) return null;
  const ms = tsMs(ts);
  if (!ms) return null;
  return Math.max(0, (Date.now() - ms) / 60000);
}

/**
 * Higher = show first in Priority mode. Tiers are explicit and easy to retune.
 */
export function priorityRank(row: RunSummaryRow): number {
  if (row.pending_manual_review) return 100;

  if (row.status === "failed") {
    if (row.retry_allowed) return 92;
    return 88;
  }

  if (row.manual_review_recommended && row.status !== "succeeded" && row.status !== "canceled") {
    return 84;
  }

  if (row.status === "running") {
    if (row.actionable_next_step === "retry_now_allowed") return 80;
    if (row.has_evidence) return 76;
    return 72;
  }

  if (row.status === "queued") {
    const age = queuedAgeMinutes(row);
    if (age != null && age >= QUEUED_OLD_MINUTES_WARN) return 68;
    if (age != null && age >= QUEUED_AGED_MINUTES) return 62;
    return 58;
  }

  if (row.status === "succeeded") return 20;
  if (row.status === "canceled") return 15;
  return 40;
}

/** Short operator-facing reason for priority position (may combine multiple signals). */
export function priorityReason(row: RunSummaryRow): string {
  if (row.pending_manual_review) return "Manual review queue";

  if (row.status === "failed") {
    if (row.retry_allowed) return "Failed · retry allowed";
    return "Failed · no auto-retry";
  }

  if (row.manual_review_recommended && row.status !== "succeeded" && row.status !== "canceled") {
    return "Manual review recommended";
  }

  if (row.status === "running") {
    if (row.actionable_next_step === "retry_now_allowed") return "Running · retry path open";
    if (row.has_evidence) return "Running · has evidence";
    return "Running · monitor";
  }

  if (row.status === "queued") {
    const age = queuedAgeMinutes(row);
    if (age != null && age >= QUEUED_OLD_MINUTES_WARN) {
      return `Queued · ~${Math.floor(age)}m old`;
    }
    if (age != null && age >= QUEUED_AGED_MINUTES) {
      return `Queued · ~${Math.floor(age)}m`;
    }
    return "Queued";
  }

  if (row.status === "succeeded") return "Succeeded";
  if (row.status === "canceled") return "Canceled";
  return row.status ?? "Run";
}

function newestKey(row: RunSummaryRow): number {
  const t =
    row.timestamps?.created_at ??
    row.timestamps?.queued_at ??
    row.timestamps?.updated_at ??
    null;
  return tsMs(t);
}

export function sortRunsForQueue(rows: RunSummaryRow[], mode: QueueSortMode): RunSummaryRow[] {
  const copy = [...rows];

  if (mode === "failed_only") {
    const failed = copy.filter((r) => r.status === "failed");
    failed.sort((a, b) => {
      const ra = priorityRank(a);
      const rb = priorityRank(b);
      if (rb !== ra) return rb - ra;
      return newestKey(b) - newestKey(a);
    });
    return failed;
  }

  if (mode === "newest") {
    copy.sort((a, b) => newestKey(b) - newestKey(a));
    return copy;
  }

  copy.sort((a, b) => {
    const ra = priorityRank(a);
    const rb = priorityRank(b);
    if (rb !== ra) return rb - ra;
    return newestKey(b) - newestKey(a);
  });
  return copy;
}
