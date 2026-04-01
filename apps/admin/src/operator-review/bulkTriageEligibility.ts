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
