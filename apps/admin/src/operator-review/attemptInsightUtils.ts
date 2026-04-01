import type { ExecutionAttemptRow } from "./types";

/** Two failed attempts share identical stored failure_type and failure_message (including both empty). */
export function hasRepeatedSameStoredFailure(
  failedAttempts: Array<{
    failure_type?: string | null;
    failure_message?: string | null;
  }>,
): boolean {
  const counts = new Map<string, number>();
  for (const a of failedAttempts) {
    const k = `${a.failure_type ?? ""}\u0000${a.failure_message ?? ""}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.values()].some((c) => c >= 2);
}

export function deriveRunAttemptInsight(attempts: ExecutionAttemptRow[], runStatus: string) {
  const failed = attempts.filter((a) => a.status === "failed");
  return {
    repeated_same_stored_failure: hasRepeatedSameStoredFailure(failed),
    recovered_after_failure: runStatus === "succeeded" && failed.length >= 1,
    first_attempt_only_success:
      attempts.length === 1 &&
      attempts[0]?.status === "succeeded" &&
      runStatus === "succeeded",
  };
}
