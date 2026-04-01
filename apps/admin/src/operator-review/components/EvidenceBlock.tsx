import type { ReactNode } from "react";

function pickEvidenceKind(item: Record<string, unknown>): string {
  return String(item.kind ?? item.type ?? item.source ?? "other");
}

function pickEvidenceStage(item: Record<string, unknown>): string {
  return String(item.stage ?? item.progress_stage ?? item.phase ?? "general");
}

function pickRef(item: Record<string, unknown>): string | null {
  const path =
    item.ref ??
    item.path ??
    item.file ??
    item.artifact_ref ??
    item.file_path ??
    item.url ??
    null;
  return path != null ? String(path) : null;
}

function pickSummaryLine(item: Record<string, unknown>): string | null {
  const summaryLine =
    item.message ?? item.title ?? item.summary ?? item.description ?? null;
  return summaryLine != null ? String(summaryLine) : null;
}

/** Higher = show first (failure-ish, has ref, non-generic stage). */
function evidencePriority(item: Record<string, unknown>): number {
  const stage = pickEvidenceStage(item).toLowerCase();
  const kind = pickEvidenceKind(item).toLowerCase();
  const ref = pickRef(item);
  let score = 0;
  if (
    stage.includes("fail") ||
    stage.includes("error") ||
    kind.includes("fail") ||
    kind.includes("error")
  ) {
    score += 100;
  }
  if (ref) score += 50;
  if (stage !== "general" && stage.length > 0) score += 20;
  if (pickSummaryLine(item)) score += 10;
  return score;
}

function sortEvidenceItems(items: unknown[]): Record<string, unknown>[] {
  const rows = items.map((raw) => raw as Record<string, unknown>);
  return [...rows].sort((a, b) => evidencePriority(b) - evidencePriority(a));
}

export function EvidenceBlock({ items }: { items: unknown[] }) {
  if (!items.length) {
    return (
      <div className="empty-state">
        <strong>No evidence on this run</strong>
        Nothing was attached for this execution. Check worker configuration or earlier pipeline stages
        if you expected artifacts.
      </div>
    );
  }

  const sorted = sortEvidenceItems(items);

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const item of sorted) {
    const title = `${pickEvidenceKind(item)} — ${pickEvidenceStage(item)}`;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(item);
  }

  const orderedTitles = [...groups.keys()];

  const nodes: ReactNode[] = [];
  for (const title of orderedTitles) {
    const groupItems = groups.get(title)!;
    nodes.push(
      <div key={title} className="evidence-group-title">
        {title}
      </div>,
    );
    for (let i = 0; i < groupItems.length; i++) {
      const item = groupItems[i];
      const path = pickRef(item);
      const summaryLine = pickSummaryLine(item);
      const stage = pickEvidenceStage(item);
      nodes.push(
        <div key={`${title}-${i}`} className="evidence-item">
          {path ? (
            <div className="evidence-ref-line mono" title={path}>
              <strong>Ref</strong> {path}
            </div>
          ) : (
            <div className="muted evidence-ref-missing">No ref / path / URL on this item</div>
          )}
          <div className="meta-line">
            <strong>Kind</strong> {pickEvidenceKind(item)}
          </div>
          {stage !== "general" ? (
            <div className="meta-line">
              <strong>Stage</strong> {stage}
            </div>
          ) : null}
          {summaryLine != null ? (
            <div className="meta-line evidence-summary-line">
              <strong>Summary</strong> {summaryLine}
            </div>
          ) : null}
          <details className="evidence-raw-details">
            <summary className="muted">Raw JSON (secondary)</summary>
            <pre className="raw mono">{JSON.stringify(item, null, 2)}</pre>
          </details>
        </div>,
      );
    }
  }
  return (
    <>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Ordered with failure-like and ref-bearing items first (client-side heuristic). Open raw JSON
        only when you need full structure.
      </p>
      {nodes}
    </>
  );
}
