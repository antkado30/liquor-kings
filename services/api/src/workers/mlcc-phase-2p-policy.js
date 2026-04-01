/**
 * Phase 2p — canonical repo truth for MLCC **validate** interaction approval and post-validate ladder.
 * Imported by `mlcc-browser-add-by-code-probe.js` only (Phase **2q** echoes manifest + ladder in evidence).
 * `mlcc-browser-worker.js` must not import this module (`verify:lk:rpa-safety`).
 * Specializes the `validate_order` step in `buildPhase2mPostAddApplyLadder()` in `mlcc-phase-2m-policy.js`.
 * Bump version when validate criteria or ladder semantics change.
 */

export const PHASE_2P_POLICY_VERSION = "lk-rpa-2p-2";

/**
 * Approval model for Phase **2q**: **at most one** bounded validate control interaction when env-gated.
 * Does **not** authorize checkout, submit, finalize, second validate, or backend order truth claims.
 */
export function buildPhase2pValidateFutureGateManifest() {
  return {
    version: PHASE_2P_POLICY_VERSION,
    phase_intent:
      "canonical_gate_manifest_for_validate_phase_2q_runtime_imports_probe_only_no_worker_import",
    relationship_to_prior_phases: [
      "phase_2m_post_add_apply_ladder_validate_order_step_gated_by_this_manifest_until_execution",
      "phase_2n_documents_single_add_apply_click_and_layer2_delta_expectations",
      "phase_2o_documents_read_only_post_add_apply_observation_with_strict_disclaimers",
      "mlcc_validate_safety_unknown_do_not_infer_from_visible_success_text_or_zero_abort_count_alone",
    ],
    evidence_prerequisites_before_validate_execution_considered: [
      "same_run_successful_phase_2n_with_add_apply_click_performed_true_and_no_new_layer2_aborts_in_2n_click_window",
      "same_run_successful_phase_2o_with_observation_performed_true_and_no_new_layer2_aborts_in_2o_observation_window_when_2o_enabled",
      "when_phase_2o_disabled_operator_documents_equivalent_read_only_evidence_or_explicit_tenant_risk_acceptance_process_via_env_flag",
      "tenant_mutation_boundary_evidence_phase_2d_or_2e_reviewed_for_validate_adjacent_controls_when_used",
      "operator_acknowledges_validate_may_mutate_server_order_state_even_if_client_abort_counter_stays_flat_for_configured_patterns",
    ],
    required_selectors_and_constraints: [
      "tenant_env_validate_control_selector_or_priority_candidate_json_array_required_no_heuristic_only_click_path",
      "dedicated_phase_2q_enable_flag_and_dedicated_operator_approval_flag_required",
      "at_most_one_bounded_validate_click_per_validate_phase_no_second_validate_without_new_phase",
      "validate_control_eligibility_must_use_layer3_and_mutation_boundary_family_analogous_to_phase_2n_not_raw_generic_probe_clicks",
    ],
    network_and_layer2_special_interpretation: [
      "execution_phase_2q_may_allow_real_validate_xhr_by_removing_validate_url_from_shouldBlockHttpRequest_with_doc_and_version_bump",
      "zero_layer2_abort_delta_claims_apply_only_to_configured_abort_patterns_not_proof_of_absence_of_server_mutation",
      "positive_abort_delta_during_declared_validate_phase_window_hard_fail_stop_capture_evidence",
    ],
    layer3_and_ui_expectations: [
      "isProbeUiTextUnsafe_remains_for_checkout_submit_cart_patterns_validate_labels_use_dedicated_phase_2q_eligibility",
      "same_phase_forbids_checkout_submit_final_confirmation_and_second_add_apply_line",
    ],
    hard_fail_stop_conditions: [
      "validate_control_not_visible_disabled_or_obscured_at_click_boundary",
      "more_than_one_validate_click_attempt_in_single_phase",
      "positive_network_guard_delta_when_policy_requires_zero_delta_for_declared_window",
      "unexpected_navigation_or_url_change_without_prior_approval",
      "any_code_path_that_would_reach_checkout_submit_or_finalize_order_in_same_phase",
    ],
    observable_bounded_validate_proof_criteria: [
      "evidence_includes_pre_and_post_click_read_only_snapshots_in_family_of_phase_2n_2o",
      "selector_used_and_visible_control_text_or_label_sample_recorded",
      "layer2_blockedrequestcount_delta_for_declared_window_stated_without_over_claiming",
      "disclaimer_required_success_or_error_message_visible_in_browser_does_not_prove_backend_order_ready_or_inventory",
      "no_claim_that_validate_is_generally_safe_after_single_tenant_run",
      "no_claim_of_readiness_for_checkout_or_submit_based_on_validate_rehearsal_only",
    ],
    mandatory_disclaimers: [
      "browser_and_client_abort_observation_do_not_prove_backend_order_or_cart_truth",
      "layer_2_blocking_is_heuristic_and_may_miss_equivalent_mutation_endpoints",
      "successful_validate_ui_signal_does_not_imply_safe_checkout_or_submit",
    ],
  };
}

/**
 * Ordered ladder after validate: each step stays out of scope until separately approved.
 */
export function buildPhase2pPostValidateLadder() {
  return {
    version: PHASE_2P_POLICY_VERSION,
    note: "each_step_requires_explicit_phase_doc_verify_policy_version_bump_and_operator_approval_when_implemented",
    relates_to_phase_2m_ladder_step: "validate_order",
    steps: [
      {
        id: "validate_order_bounded_interaction",
        label:
          "At most one bounded MLCC-style validate control interaction (single click or equivalent tenant-approved action)",
        status: "implemented_as_phase_2q_when_env_gated",
        implementation_note:
          "runtime_mlcc_browser_add_by_code_probe_runAddByCodePhase2qBoundedValidateSingleClick",
        forbids_until_approved: [
          "second_validate_click",
          "checkout",
          "submit",
          "finalize_order",
        ],
      },
      {
        id: "post_validate_observation",
        label:
          "Read-only observation after validate (DOM, status messages, Layer 2 tally; no checkout/submit)",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "checkout",
          "submit",
          "finalize_order",
          "second_validate",
        ],
      },
      {
        id: "checkout_flow",
        label: "Checkout or equivalent pre-submit cart flow",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "submit",
          "finalize_order",
          "real_order_submission_without_mlcc_submission_armed_and_later_phase",
        ],
      },
      {
        id: "submit_finalize_order",
        label: "Order submission / final confirmation",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "real_order_submission_without_mlcc_submission_armed_and_later_phase",
        ],
      },
    ],
  };
}
