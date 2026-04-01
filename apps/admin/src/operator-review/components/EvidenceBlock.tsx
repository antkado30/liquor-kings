import type { ReactNode } from "react";

function pickEvidenceKind(item: Record<string, unknown>): string {
  return String(item.kind ?? item.type ?? item.source ?? "other");
}

function pickEvidenceStage(item: Record<string, unknown>): string {
  return String(item.stage ?? item.progress_stage ?? item.phase ?? "general");
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
