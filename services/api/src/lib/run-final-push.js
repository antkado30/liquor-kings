/**
 * run-final-push — PURE builder for the "order needs you" push notification
 * (2026-07-05, census core-promise item #7 / ordering-plan task 3).
 *
 * Given a FINALIZED execution_runs row (status already terminal, evidence
 * already appended), decide whether the store owner should get a push, and
 * compose it. No network, no env, no imports — fully unit-testable.
 *
 * Returns null (no notification) or:
 *   { title, body, tag, url, data: { run_id, store_id, kind } }
 *
 * COPY RULES (premium + honest, per the doctrine):
 * - Short, human, no emoji, no jargon, no markdown.
 * - NEVER claim more than we know. A reaped run may or may not have reached
 *   MILO — say "review it", never "nothing was placed".
 * - One clear next action ("tap to…").
 *
 * WHEN WE NOTIFY:
 * - validate_only succeeded → always (that's the async promise: fire the
 *   check, walk away, get told when it needs you — OOS, clean, or odd).
 * - rpa_run (submit path) succeeded → always (order placed / practice run).
 * - failed TERMINALLY (not an auto-retry re-queue — callers guard that) for
 *   validate_only / rpa_run, and any REAPED run regardless of type.
 * - canceled → never (the user did it themselves, in the app).
 * - cart_reset_only / unknown run types → never (housekeeping).
 */

const NOTIFY_RUN_TYPES = new Set(["validate_only", "rpa_run"]);

/** Best-effort money string; null-safe. "$1,234.56" style, no cents games. */
function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** One trimmed human sentence out of a possibly long error message. */
function firstSentence(msg, max = 120) {
  const s = String(msg ?? "").trim();
  if (!s) return null;
  const cut = s.split(/(?<=[.!?])\s/)[0] ?? s;
  return cut.length > max ? `${cut.slice(0, max - 1).trimEnd()}…` : cut;
}

/** Walk evidence (newest last) for the validate summary attributes. */
function findValidateSummary(evidence) {
  if (!Array.isArray(evidence)) return null;
  for (let i = evidence.length - 1; i >= 0; i -= 1) {
    const e = evidence[i];
    if (!e || typeof e !== "object") continue;
    const isSummary =
      e.kind === "validate_only_summary" ||
      (e.kind === "rpa_step" && e.stage === "validate_only_complete");
    if (isSummary && e.attributes && typeof e.attributes === "object") {
      return e.attributes;
    }
  }
  return null;
}

/** Walk evidence for the rpa_run (submit-path) summary attributes. */
function findRpaRunSummary(evidence) {
  if (!Array.isArray(evidence)) return null;
  for (let i = evidence.length - 1; i >= 0; i -= 1) {
    const e = evidence[i];
    if (e && typeof e === "object" && e.kind === "rpa_run_summary" && e.attributes && typeof e.attributes === "object") {
      return e.attributes;
    }
  }
  return null;
}

/** confirmation_numbers arrives ADA-keyed object (or legacy array); count it. */
function countConfirmations(cn) {
  if (Array.isArray(cn)) return cn.filter(Boolean).length;
  if (cn && typeof cn === "object") return Object.values(cn).filter(Boolean).length;
  return 0;
}

/**
 * @param {object} run finalized execution_runs row: { id, store_id, status,
 *   run_type, failure_type, error_message, evidence }
 * @returns {null | { title: string, body: string, tag: string, url: string,
 *   data: { run_id, store_id, kind } }}
 */
export function buildRunFinalPush(run) {
  try {
    if (!run || typeof run !== "object" || !run.id) return null;
    const status = run.status;
    const runType = run.run_type;

    const base = (kind, title, body) => ({
      title,
      body,
      tag: `lk-run-${run.id}`,
      url: "/",
      data: { run_id: run.id, store_id: run.store_id ?? null, kind },
    });

    // Reaped runs notify regardless of type — a silent stall is the exact
    // failure mode this layer exists to kill. Honest copy: we do NOT know
    // how far it got, so we say review, not "nothing happened".
    if (status === "failed" && run.failure_type === "LK_RUN_REAPED") {
      return base(
        "run_stalled",
        "A run stalled and was stopped",
        "It lost contact mid-flight and was marked failed. Tap to review it before retrying.",
      );
    }

    if (!NOTIFY_RUN_TYPES.has(runType)) return null;

    if (status === "failed") {
      const reason = firstSentence(run.error_message) ?? "It hit a problem and stopped.";
      return base(
        "run_failed",
        runType === "rpa_run" ? "Order run couldn't finish" : "Check couldn't finish",
        `${reason} Tap to retry.`,
      );
    }

    if (status !== "succeeded") return null; // canceled / anything else: no push

    // Submit-path run (rpa_run): placed for real, or practice-downgraded.
    if (runType === "rpa_run") {
      const rpa = findRpaRunSummary(run.evidence);
      if (rpa?.submitted === true) {
        const n = countConfirmations(rpa.confirmation_numbers);
        return base(
          "order_placed",
          "Order placed",
          n > 0
            ? `MILO confirmed ${n} order${n === 1 ? "" : "s"}. Tap to see the confirmation number${n === 1 ? "" : "s"}.`
            : "Submitted to MILO. Tap to see the result.",
        );
      }
      return base(
        "practice_complete",
        "Practice run finished",
        "No real order was placed. Tap to see how it went.",
      );
    }

    // validate_only: the async check came back — clean, needs decisions, or odd.
    const v = findValidateSummary(run.evidence);
    if (!v) {
      return base("check_done", "Check finished", "Tap to see the result.");
    }

    const oosCount = Array.isArray(v.out_of_stock_items) ? v.out_of_stock_items.length : 0;
    if (oosCount > 0) {
      return base(
        "needs_decision",
        oosCount === 1 ? "1 bottle needs a decision" : `${oosCount} bottles need a decision`,
        "Your MLCC check finished. Review them and re-check before placing.",
      );
    }

    if (v.can_checkout === true) {
      const total = money(v.order_summary?.netTotal ?? v.order_summary?.net_total);
      return base(
        "check_clean",
        "Cart checks out clean",
        total ? `Validated at ${total} — ready to place.` : "Validated — ready to place.",
      );
    }

    // Succeeded run, no OOS, but not checkout-ready (below minimum, validation
    // message, etc.) — needs a look, and we don't guess why in one line.
    return base(
      "needs_review",
      "Check finished — needs a look",
      "The cart isn't ready to place yet. Tap to see why.",
    );
  } catch {
    // A push must never be able to break the finalize path — and a broken
    // builder must not push nonsense. Silence here is safe: the caller logs.
    return null;
  }
}
