/**
 * Read-only `proposed_fix` for MLCC blocking hints — derived only from hint row fields
 * (`hint_status`, `candidates`, `candidate_count`). No writes, no catalog re-fetch.
 *
 * Keep option lists aligned with hint builder cap (candidates are already truncated).
 */

const OPTIONS_MAX = 5;

/**
 * Compact operator-facing option (subset of full candidate; stable keys).
 *
 * @param {Record<string, unknown>} c
 */
export function toProposedFixCandidateOption(c) {
  return {
    mlcc_item_id: c.mlcc_item_id != null ? String(c.mlcc_item_id) : null,
    code: c.code != null ? String(c.code) : null,
    brand_name: c.brand_name != null ? String(c.brand_name) : null,
    size: c.size == null || c.size === "" ? null : String(c.size),
    proof: c.proof == null || c.proof === "" ? null : String(c.proof),
    pack: c.pack ?? null,
  };
}

/**
 * @param {{ hint_status?: string; candidate_count?: number; candidates?: unknown[] }} hint
 * @returns {Record<string, unknown>}
 */
export function deriveProposedFixFromBlockingHint(hint) {
  const status = typeof hint?.hint_status === "string" ? hint.hint_status : "";
  const candidates = Array.isArray(hint?.candidates) ? hint.candidates : [];
  const capped = candidates
    .filter((c) => c && typeof c === "object")
    .slice(0, OPTIONS_MAX)
    .map((c) => toProposedFixCandidateOption(/** @type {Record<string, unknown>} */ (c)));

  const manual = (reasonCode) => ({
    action: "manual_review_required",
    reason_code: reasonCode,
    suggested_mlcc_item_id: null,
    auto_selectable: false,
  });

  if (status === "blank_code") {
    return manual("blank_code");
  }
  if (status === "bad_code_format") {
    return manual("bad_code_format");
  }
  if (status === "no_catalog_match") {
    return manual("no_catalog_match");
  }

  if (status === "multiple_catalog_matches") {
    return {
      action: "operator_must_choose_candidate",
      reason_code: "multiple_catalog_matches",
      suggested_mlcc_item_id: null,
      candidate_options: capped,
      auto_selectable: false,
    };
  }

  if (status === "exact_catalog_match_found") {
    const only = candidates.length === 1 ? candidates[0] : null;
    const id =
      only && typeof only === "object" && only.mlcc_item_id != null
        ? String(only.mlcc_item_id)
        : null;
    if (id) {
      return {
        action: "confirm_single_candidate",
        reason_code: "exact_catalog_match_found",
        suggested_mlcc_item_id: id,
        candidate_options: [toProposedFixCandidateOption(/** @type {Record<string, unknown>} */ (only))],
        auto_selectable: true,
      };
    }
    return manual("exact_catalog_match_found");
  }

  return {
    action: "manual_review_required",
    reason_code: status || "unknown_hint_status",
    suggested_mlcc_item_id: null,
    auto_selectable: false,
  };
}
