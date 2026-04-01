/**
 * Shared helpers for execution_run_attempts aggregates (diagnostics + operator list).
 * All "insight" labels are derived only from stored attempt rows + execution_runs fields.
 */

export const ATTEMPT_IN_BATCH = 120;

/** Two failed attempts share the same stored failure_type and failure_message (including both null). */
export const hasRepeatedSameStoredFailure = (failedAttempts) => {
  const counts = new Map();
  for (const a of failedAttempts) {
    const k = `${a.failure_type ?? ""}\u0000${a.failure_message ?? ""}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.values()].some((c) => c >= 2);
};

export const listItemAttemptFields = (attempts) => {
  if (!attempts?.length) {
    return {
      stored_attempt_count: 0,
      has_multiple_stored_attempts: false,
      repeated_same_stored_failure: false,
    };
  }
  const failed = attempts.filter((a) => a.status === "failed");
  return {
    stored_attempt_count: attempts.length,
    has_multiple_stored_attempts: attempts.length > 1,
    repeated_same_stored_failure: hasRepeatedSameStoredFailure(failed),
  };
};

/** Loads grouped attempt rows for many runs (batched IN queries). */
export const fetchAttemptsByRunIdsGrouped = async (supabase, storeId, runIds) => {
  if (!runIds.length) return { byRunId: new Map(), error: null };
  const all = [];
  for (let i = 0; i < runIds.length; i += ATTEMPT_IN_BATCH) {
    const slice = runIds.slice(i, i + ATTEMPT_IN_BATCH);
    const { data, error } = await supabase
      .from("execution_run_attempts")
      .select("run_id, attempt_number, status, failure_type, failure_message")
      .eq("store_id", storeId)
      .in("run_id", slice);
    if (error) return { byRunId: null, error: error.message };
    all.push(...(data ?? []));
  }
  const byRunId = new Map();
  for (const row of all) {
    const rid = row.run_id;
    if (!byRunId.has(rid)) byRunId.set(rid, []);
    byRunId.get(rid).push(row);
  }
  for (const arr of byRunId.values()) {
    arr.sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number));
  }
  return { byRunId, error: null };
};

/**
 * Diagnostics window metrics over execution_runs rows + grouped attempts.
 * @param {Array<Record<string, unknown>>} runs - must include `id`, `status`
 * @param {Map<string, Array<Record<string, unknown>>>} byRunId
 */
export const computeAttemptHistoryWindowInsights = (runs, byRunId) => {
  let runsWithAttemptRows = 0;
  let totalAttemptRows = 0;
  let runsWithMoreThanOneAttempt = 0;
  let runsWithTwoOrMoreFailedAttempts = 0;
  let runsWithRepeatedSameStoredFailure = 0;
  let multiAttemptTerminalSucceeded = 0;
  let multiAttemptTerminalFailed = 0;
  let multiAttemptNonTerminal = 0;
  let firstAttemptOnlySuccessRuns = 0;
  let eventualSuccessAfterFailedAttemptRuns = 0;

  for (const run of runs) {
    const id = run.id;
    const attempts = byRunId.get(id) ?? [];
    const n = attempts.length;
    if (n > 0) {
      runsWithAttemptRows += 1;
      totalAttemptRows += n;
    }

    if (n > 1) {
      runsWithMoreThanOneAttempt += 1;
      const st = run.status;
      if (st === "succeeded") multiAttemptTerminalSucceeded += 1;
      else if (st === "failed") multiAttemptTerminalFailed += 1;
      else multiAttemptNonTerminal += 1;
    }

    const failedAttempts = attempts.filter((a) => a.status === "failed");
    if (failedAttempts.length >= 2) {
      runsWithTwoOrMoreFailedAttempts += 1;
    }
    if (hasRepeatedSameStoredFailure(failedAttempts)) {
      runsWithRepeatedSameStoredFailure += 1;
    }

    if (
      n === 1 &&
      attempts[0]?.status === "succeeded" &&
      run.status === "succeeded"
    ) {
      firstAttemptOnlySuccessRuns += 1;
    }
    if (run.status === "succeeded" && failedAttempts.length >= 1) {
      eventualSuccessAfterFailedAttemptRuns += 1;
    }
  }

  const denomRetryRate = multiAttemptTerminalSucceeded + multiAttemptTerminalFailed;
  const multi_attempt_success_rate =
    denomRetryRate > 0 ? multiAttemptTerminalSucceeded / denomRetryRate : null;

  const avg_attempts_per_run_with_history =
    runsWithAttemptRows > 0 ? totalAttemptRows / runsWithAttemptRows : null;

  return {
    interpretation_notes: [
      "All counts use execution_run_attempts rows for runs in the same execution_runs sample (time window + row cap). Runs with no attempt rows (legacy / pre-migration) contribute only where a numerator uses total runs.",
      "avg_attempts_per_run_with_history divides total stored attempt rows by runs that have at least one attempt row.",
      "multi_attempt_success_rate is multi-attempt runs that ended succeeded divided by multi-attempt runs that ended succeeded or failed (queued/running/canceled excluded).",
      "repeated_same_stored_failure counts runs where at least two failed attempts share identical stored failure_type and failure_message.",
      "eventual_success_after_failed_attempt_runs counts succeeded runs with at least one stored failed attempt (proves recovery from a failed attempt, when attempt history exists).",
      "first_attempt_only_success_runs counts succeeded runs with exactly one stored attempt that is succeeded (proves single-attempt success when recorded).",
    ],
    runs_in_window: runs.length,
    runs_with_attempt_rows: runsWithAttemptRows,
    total_stored_attempt_rows: totalAttemptRows,
    avg_attempts_per_run_with_history,
    runs_with_more_than_one_attempt: runsWithMoreThanOneAttempt,
    runs_with_two_or_more_failed_attempts: runsWithTwoOrMoreFailedAttempts,
    runs_with_repeated_same_stored_failure: runsWithRepeatedSameStoredFailure,
    multi_attempt_runs_terminal_succeeded: multiAttemptTerminalSucceeded,
    multi_attempt_runs_terminal_failed: multiAttemptTerminalFailed,
    multi_attempt_runs_non_terminal: multiAttemptNonTerminal,
    multi_attempt_success_rate: multi_attempt_success_rate,
    first_attempt_only_success_runs: firstAttemptOnlySuccessRuns,
    eventual_success_after_failed_attempt_runs: eventualSuccessAfterFailedAttemptRuns,
  };
};
