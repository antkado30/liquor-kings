import { failureGuidanceText } from "../lib/failureGuidance";

/** Mirrors API `mlcc_operator_context` on run summary / list rows. */
export type MlccOperatorContext = {
  mlcc_signal: string;
  label: string;
  guidance: string;
  evidence_kinds?: string[];
};

export function formatMlccContextLine(ctx: MlccOperatorContext | null | undefined): string {
  if (!ctx?.label) return "";
  const ev =
    ctx.evidence_kinds && ctx.evidence_kinds.length > 0
      ? ` Evidence kinds: ${ctx.evidence_kinds.join(", ")}.`
      : "";
  return `${ctx.label}.${ev}`;
}

/**
 * Full operator text: coarse failure_type hint + MLCC-specific context when present.
 */
export function combinedFailureGuidance(
  failureType: string | null | undefined,
  mlcc: MlccOperatorContext | null | undefined,
): { primary: string; mlcc?: string } {
  const primary = failureGuidanceText(failureType ?? null);
  if (!mlcc?.guidance) {
    return { primary };
  }
  return {
    primary,
    mlcc: mlcc.guidance,
  };
}
