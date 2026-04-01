export function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status}</span>;
}

export function FailureBadge({ ft }: { ft: string | null | undefined }) {
  if (!ft) return <span className="muted">-</span>;
  return <span className="badge">{ft}</span>;
}
