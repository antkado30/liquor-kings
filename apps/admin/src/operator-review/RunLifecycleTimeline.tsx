import type { Summary } from "./types";

type Step = {
  key: string;
  label: string;
  detail: string;
  at: string | null;
  state: "done" | "current" | "upcoming";
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return iso;
  }
}

export function RunLifecycleTimeline({ summary }: { summary: Summary }) {
  const status = String(summary.status ?? "").toLowerCase();
  const ts = (summary.timestamps as Record<string, unknown> | undefined) ?? {};

  const queuedAt = (ts.queued_at as string) ?? (ts.created_at as string) ?? null;
  const createdAt = (ts.created_at as string) ?? null;
  const startedAt = (ts.started_at as string) ?? null;
  const heartbeatAt = (ts.heartbeat_at as string) ?? null;
  const finishedAt = (ts.finished_at as string) ?? null;

  const terminal = status === "succeeded" || status === "failed" || status === "canceled";
  const queueTs = queuedAt ?? createdAt;

  const baseSteps: Omit<Step, "state">[] = [
    {
      key: "queue",
      label: "Queued",
      detail: "Execution entered the queue",
      at: queueTs,
    },
    {
      key: "start",
      label: "Started",
      detail: startedAt ? "Worker began processing" : "started_at (may be missing while status=running)",
      at: startedAt,
    },
    {
      key: "hb",
      label: "Last heartbeat",
      detail: "Most recent worker heartbeat",
      at: heartbeatAt,
    },
    {
      key: "done",
      label: terminal ? `Terminal (${status})` : "Terminal",
      detail: terminal ? "Final status recorded" : "Awaiting completion",
      at: finishedAt,
    },
  ];

  let currentIndex = -1;
  if (terminal) {
    currentIndex = -1;
  } else if (status === "queued") {
    currentIndex = 0;
  } else if (status === "running") {
    currentIndex = startedAt ? 2 : 1;
  } else {
    currentIndex = 0;
  }

  const steps: Step[] = baseSteps.map((s, i) => {
    let state: Step["state"];
    if (terminal) {
      state = "done";
    } else if (currentIndex < 0) {
      state = "upcoming";
    } else if (i < currentIndex) {
      state = "done";
    } else if (i === currentIndex) {
      state = "current";
    } else {
      state = "upcoming";
    }
    return { ...s, state };
  });

  const stage = summary.progress_stage != null ? String(summary.progress_stage) : null;
  const progMsg = summary.progress_message != null ? String(summary.progress_message) : null;

  return (
    <div className="lifecycle-block">
      <div className="lifecycle-steps">
        {steps.map((s, i) => (
          <div key={s.key} className={`lifecycle-step lifecycle-${s.state}`}>
            <div className="lifecycle-dot-wrap">
              <span className="lifecycle-dot" aria-hidden />
              {i < steps.length - 1 ? <span className="lifecycle-line" aria-hidden /> : null}
            </div>
            <div className="lifecycle-body">
              <div className="lifecycle-label">{s.label}</div>
              <div className="lifecycle-time mono">{fmt(s.at)}</div>
              <div className="lifecycle-detail muted">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {(stage || progMsg) && (
        <div className="lifecycle-stage-box">
          <strong>Stage progression</strong>
          {stage ? (
            <div className="mono" style={{ marginTop: 4 }}>
              {stage}
            </div>
          ) : null}
          {progMsg ? <div style={{ marginTop: 4, fontSize: 13 }}>{progMsg}</div> : null}
        </div>
      )}
    </div>
  );
}
