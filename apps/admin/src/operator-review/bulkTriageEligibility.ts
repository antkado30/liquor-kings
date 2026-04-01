import type { RunSummaryRow } from "./types";

export type BulkTriageSkip = { runId: string; label: string };

/** Acknowledge: triage signal for non-terminal work; skip terminal and unknown statuses. */
export function eligibleForBulkAcknowledge(row: RunSummaryRow): BulkTriageSkip | null {
  const s = row.status;
  if (s === "succeeded") {
    return { runId: row.run_id, label: "status succeeded (terminal)" };
  }
  if (s === "canceled") {
    return { runId: row.run_id, label: "status canceled (terminal)" };
  }
  if (s === "queued" || s === "running" || s === "failed") {
    return null;
  }
  return { runId: row.run_id, label: `status ${s} (not in queued/running/failed)` };
}

/**
 * Mark for manual review: skip if already flagged; skip terminal runs.
 * Server allows other statuses; we mirror conservative triage use.
 */
export function eligibleForBulkMarkManual(row: RunSummaryRow): BulkTriageSkip | null {
  if (row.pending_manual_review) {
    return { runId: row.run_id, label: "already pending manual review" };
  }
  const s = row.status;
  if (s === "succeeded") {
    return { runId: row.run_id, label: "status succeeded (terminal)" };
  }
  if (s === "canceled") {
    return { runId: row.run_id, label: "status canceled (terminal)" };
  }
  return null;
}

export function partitionForBulkAcknowledge(
  selectedIds: string[],
  runs: RunSummaryRow[],
): { eligible: string[]; skipped: BulkTriageSkip[] } {
  const byId = new Map(runs.map((r) => [r.run_id, r]));
  const eligible: string[] = [];
  const skipped: BulkTriageSkip[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (!row) {
      skipped.push({ runId: id, label: "not in loaded run list (reload or clear selection)" });
      continue;
    }
    const skip = eligibleForBulkAcknowledge(row);
    if (skip) skipped.push(skip);
    else eligible.push(id);
  }
  return { eligible, skipped };
}

export function partitionForBulkMarkManual(
  selectedIds: string[],
  runs: RunSummaryRow[],
): { eligible: string[]; skipped: BulkTriageSkip[] } {
  const byId = new Map(runs.map((r) => [r.run_id, r]));
  const eligible: string[] = [];
  const skipped: BulkTriageSkip[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (!row) {
      skipped.push({ runId: id, label: "not in loaded run list (reload or clear selection)" });
      continue;
    }
    const skip = eligibleForBulkMarkManual(row);
    if (skip) skipped.push(skip);
    else eligible.push(id);
  }
  return { eligible, skipped };
}

export function summarizeSkipped(skipped: BulkTriageSkip[], maxIds = 6): string {
  if (skipped.length === 0) return "";
  const byLabel = new Map<string, string[]>();
  for (const { runId, label } of skipped) {
    const list = byLabel.get(label) ?? [];
    list.push(runId);
    byLabel.set(label, list);
  }
  const parts: string[] = [];
  for (const [label, ids] of byLabel) {
    const show = ids.slice(0, maxIds).join(", ");
    const more = ids.length > maxIds ? ` (+${ids.length - maxIds} more)` : "";
    parts.push(`${label}: ${show}${more}`);
  }
  return parts.join(" · ");
}

/** Group ineligible rows by reason label (counts only; no run IDs). */
export function groupSkippedCounts(skipped: BulkTriageSkip[]): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const { label } of skipped) {
    m.set(label, (m.get(label) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type BulkFailure = { id: string; err: string };

export function groupFailuresByMessage(failures: BulkFailure[]): { message: string; count: number; ids: string[] }[] {
  const m = new Map<string, string[]>();
  for (const { id, err } of failures) {
    const key = err.trim() || "(empty error)";
    const list = m.get(key) ?? [];
    list.push(id);
    m.set(key, list);
  }
  return [...m.entries()]
    .map(([message, ids]) => ({ message, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}

const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 8)}…` : id);

/**
 * Multi-line operator feedback for bulk triage (partial success friendly).
 */
export function formatBulkTriageResultMessage(
  actionLabel: string,
  outcome: {
    succeeded: number;
    skippedBefore: BulkTriageSkip[];
    failures: BulkFailure[];
  },
): string {
  const { succeeded, skippedBefore, failures } = outcome;
  const lines: string[] = [];
  const submitted = succeeded + failures.length;
  const selectedTotal = submitted + skippedBefore.length;

  lines.push(`Bulk ${actionLabel} — finished.`);
  lines.push(
    `Summary: ${selectedTotal} selected → ${skippedBefore.length} ineligible before submit → ${submitted} sent to API → ${succeeded} accepted, ${failures.length} rejected.`,
  );

  lines.push(`• Succeeded (server accepted): ${succeeded}`);

  if (skippedBefore.length > 0) {
    lines.push(`• Skipped before submit (ineligible): ${skippedBefore.length}`);
    for (const { label, count } of groupSkippedCounts(skippedBefore)) {
      lines.push(`    ${count}× ${label}`);
    }
  }

  if (failures.length > 0) {
    lines.push(`• Rejected by server: ${failures.length}`);
    const groups = groupFailuresByMessage(failures);
    const maxGroups = 8;
    for (let i = 0; i < Math.min(maxGroups, groups.length); i++) {
      const g = groups[i];
      const idSample = g.ids.slice(0, 2).map(shortId).join(", ");
      lines.push(`    ${g.count}× ${g.message}${idSample ? ` (e.g. ${idSample})` : ""}`);
    }
    if (groups.length > maxGroups) {
      lines.push(`    … ${groups.length - maxGroups} more error group(s)`);
    }
  }

  if (succeeded > 0 && failures.length > 0) {
    lines.push(
      "Partial success: fix or retry rejected runs individually; successful runs are already updated.",
    );
  }

  return lines.join("\n");
}

/** Loaded batch: failed runs where automatic retry is still allowed. */
export function filterRunIdsFailedRetryable(rows: RunSummaryRow[]): string[] {
  return rows.filter((r) => r.status === "failed" && r.retry_allowed === true).map((r) => r.run_id);
}

/**
 * Runs flagged for manual attention: server recommendation and/or already in manual queue; non-terminal only.
 */
export function filterRunIdsManualReviewCandidates(rows: RunSummaryRow[]): string[] {
  return rows
    .filter(
      (r) =>
        r.status !== "succeeded" &&
        r.status !== "canceled" &&
        (r.manual_review_recommended === true || r.pending_manual_review === true),
    )
    .map((r) => r.run_id);
}
