/**
 * RpaProgress — the ONE rich live-progress panel for MILO RPA runs
 * (extracted verbatim from CartDrawer 2026-07-27).
 *
 * Why extracted: Tony's 2026-07-05 want — "when i press check order the
 * little pill at the bottom doesnt let me click on it to see the
 * progress" — was half-served: the pill became tappable, but the live
 * sheet it opened showed one thin line while the cart drawer had the
 * full stage checklist + elapsed clock + honest slow-MILO copy. Real
 * checks run 30–90s; a thin line reads as frozen. Now the drawer AND
 * the pill's live sheet render THIS panel — one truth, identical
 * experience wherever the run is watched.
 *
 * Stage ids match the worker's `progress_stage` heartbeat values.
 * Order matters: the checklist checks indices left to right.
 */
import { useEffect, useState } from "react";
import { IconCheck, IconLoader } from "./Icons";

export type RpaStage = { id: string; label: string };

/** Stages the user sees during a validate_only RPA run. */
export const RPA_STAGES_VALIDATE: ReadonlyArray<RpaStage> = [
  { id: "rpa_login", label: "Logging into MLCC" },
  { id: "rpa_navigate", label: "Loading products page" },
  { id: "rpa_add_items", label: "Adding items to cart" },
  { id: "rpa_validate", label: "Validating cart" },
];

/** Stages for a full submit run (Stages 1-5) — one extra step at the end. */
export const RPA_STAGES_SUBMIT: ReadonlyArray<RpaStage> = [
  { id: "rpa_login", label: "Logging into MLCC" },
  { id: "rpa_navigate", label: "Loading products page" },
  { id: "rpa_add_items", label: "Adding items to cart" },
  { id: "rpa_validate", label: "Validating cart" },
  { id: "rpa_checkout", label: "Submitting order" },
];

/** Which checklist a run mode uses. Anything that is not an armed submit
    shows the validate ladder (a dry-run "submit" downgrade still walks
    the submit stages server-side, but the mode string decides here). */
export function stagesForMode(
  mode: string | null | undefined,
): ReadonlyArray<RpaStage> {
  return mode === "submit" ? RPA_STAGES_SUBMIT : RPA_STAGES_VALIDATE;
}

/** Index of the worker's current stage in a checklist; -1 = pre-stage
    (syncing / waiting for the worker to claim) or unknown stage id. */
export function stageIndexFor(
  stages: ReadonlyArray<RpaStage>,
  progressStage: string | null | undefined,
): number {
  if (!progressStage) return -1;
  return stages.findIndex((s) => s.id === progressStage);
}

export function formatElapsedMs(startedAtMs: number): string {
  const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * How long a validate poll may run with no result before we surface the
 * "Start over" escape hatch. Deliberately aligned with honestSlowMessage()'s
 * top tier so the escape button appears at exactly the moment the honest
 * slow-MILO copy turns to its most patient tone — not earlier (a normal
 * validate genuinely takes 60-90s; offering recovery sooner would invite
 * unnecessary store-recovery calls) and not later (past this, MILO is either
 * wedged or glacial, and the user should be able to free their store in one
 * tap rather than staring at a spinner).
 */
export const STUCK_RETRY_THRESHOLD_SEC = 75;

export function honestSlowMessage(elapsedSec: number): string | null {
  if (elapsedSec >= STUCK_RETRY_THRESHOLD_SEC) {
    return "MILO is slow today. We keep at it until it answers — you can keep scanning, this continues in the background.";
  }
  if (elapsedSec >= 30) {
    return "MILO is taking longer than usual — still working.";
  }
  return null;
}

/**
 * Live elapsed clock for RPA polling phases. Ticks every second from
 * startedAtMs; cleaned up on unmount.
 */
export function PollingElapsedStatus({ startedAtMs }: { startedAtMs: number }) {
  const [elapsedSec, setElapsedSec] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
  );

  useEffect(() => {
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  const slowNote = honestSlowMessage(elapsedSec);

  return (
    <div className="rpa-progress__elapsed-row">
      <span className="rpa-progress__elapsed" aria-label="Elapsed time">
        {formatElapsedMs(startedAtMs)}
      </span>
      {slowNote ? (
        <p className="rpa-progress__slow-note muted small">{slowNote}</p>
      ) : null}
    </div>
  );
}

/**
 * The staged progress checklist shown during an RPA run. Replaces a
 * boring static banner with a checkable stage list so the user can see
 * what's in flight, what's done, and what's coming.
 *
 * Each stage is one row with:
 *   - icon: SVG check (done) / SVG spinner (active, pulsing) / empty ring (pending)
 *   - label
 *
 * Headline at top shows the overall operation + the worker's latest
 * progress_message (if it added any color).
 *
 * Why this matters: when MLCC takes 60-90s to respond, an unchanging
 * banner feels frozen even when the system is working hard. Visible
 * progress = perceived speed. The actual time is unchanged.
 */
export function RpaProgressPanel({
  headline,
  stages,
  currentStageIndex,
  preStage,
  startedAtMs,
}: {
  headline: { title: string; sub?: string };
  stages: ReadonlyArray<RpaStage>;
  currentStageIndex: number;
  /**
   * True when the run hasn't reached any RPA stage yet (still syncing
   * the cart to the server or waiting for the worker to claim). All
   * stages render as pending.
   */
  preStage: boolean;
  /** When set, show live elapsed timer + honest slow-progress copy. */
  startedAtMs?: number;
}) {
  return (
    <div className="rpa-progress" role="status" aria-live="polite">
      <div className="rpa-progress__headline">
        <strong>{headline.title}</strong>
        {headline.sub ? (
          <div className="rpa-progress__sub muted small">{headline.sub}</div>
        ) : null}
        {startedAtMs != null ? <PollingElapsedStatus startedAtMs={startedAtMs} /> : null}
      </div>
      <ol className="rpa-progress__list">
        {stages.map((stage, idx) => {
          const status: "done" | "active" | "pending" = preStage
            ? "pending"
            : currentStageIndex < 0
              ? "pending"
              : idx < currentStageIndex
                ? "done"
                : idx === currentStageIndex
                  ? "active"
                  : "pending";
          return (
            <li
              key={stage.id}
              className={`rpa-progress__step rpa-progress__step--${status}`}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="rpa-progress__icon" aria-hidden>
                {status === "done" ? (
                  <IconCheck size={12} strokeWidth={2.75} />
                ) : status === "active" ? (
                  <IconLoader size={12} strokeWidth={2.75} className="rpa-progress__spin" />
                ) : null}
              </span>
              <span className="rpa-progress__label">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
