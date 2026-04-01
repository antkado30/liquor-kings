/**
 * Phase 2p — planning-only repo truth for future MLCC **validate** interaction approval and post-validate ladder.
 * **Not imported** by `mlcc-browser-worker.js` or `mlcc-browser-add-by-code-probe.js` until a separately approved
 * **execution** phase (e.g. 2q) is documented and `verify:lk:rpa-safety` is updated.
 * Specializes the `validate_order` step in `buildPhase2mPostAddApplyLadder()` in `mlcc-phase-2m-policy.js`.
 * Bump version when validate criteria or ladder semantics change.
 */

export const PHASE_2P_POLICY_VERSION = "lk-rpa-2p-1";

/**
 * Approval model for a **future** runtime phase that may perform **at most one** bounded validate control
 * interaction. **Does not** authorize checkout, submit, finalize, second validate, or any claim of backend order truth.
 */
export function buildPhase2pValidateFutureGateManifest() {
  return {
    version: PHASE_2P_POLICY_VERSION,
    phase_intent:
      "planning_only_no_runtime_validate_until_separate_execution_phase_worker_probe_must_not_import_this_module",
    relationship_to_prior_phases: [
      "phase_2m_post_add_apply_ladder_validate_order_step_remains_out_of_scope_until_execution_phase",
      "phase_2n_documents_single_add_apply_click_and_layer2_delta_expectations",
      "phase_2o_documents_read_only_post_add_apply_observation_with_strict_disclaimers",
      "mlcc_validate_safety_unknown_do_not_infer_from_visible_success_text_or_zero_abort_count_alone",
    ],
    evidence_prerequisites_before_validate_execution_considered: [
      "same_run_successful_phase_2n_with_add_apply_click_performed_true_and_no_new_layer2_aborts_in_2n_click_window",
      "same_run_successful_phase_2o_with_observation_performed_true_and_no_new_layer2_aborts_in_2o_observation_window_when_2o_enabled",
      "when_phase_2o_disabled_operator_documents_equivalent_read_only_evidence_or_explicit_tenant_risk_acceptance_process",
      "tenant_mutation_boundary_evidence_phase_2d_or_2e_reviewed_for_validate_adjacent_controls_when_used",
      "operator_acknowledges_validate_may_mutate_server_order_state_even_if_client_abort_counter_stays_flat_for_configured_patterns",
    ],
    required_selectors_and_constraints: [
      "tenant_env_validate_control_selector_or_priority_candidate_json_array_required_no_heuristic_only_click_path",
      "dedicated_future_execution_phase_enable_flag_and_dedicated_operator_approval_flag_required",
      "at_most_one_bounded_validate_click_per_validate_phase_no_second_validate_without_new_phase",
      "validate_control_eligibility_must_use_layer3_and_mutation_boundary_family_analogous_to_phase_2n_not_raw_generic_probe_clicks",
    ],
    network_and_layer2_special_interpretation: [
      "current_shouldBlockHttpRequest_may_abort_POST_urls_matching_validate_patterns_execution_phase_requires_explicit_doc_version_bump_if_allowing_real_validate_xhr",
      "zero_layer2_abort_delta_claims_apply_only_to_configured_abort_patterns_not_proof_of_absence_of_server_mutation",
      "positive_abort_delta_during_declared_validate_window_hard_fail_stop_capture_evidence",
    ],
    layer3_and_ui_expectations: [
      "isProbeUiTextUnsafe_and_global_lists_block_validate_labels_for_unscoped_clicks_future_phase_needs_targeted_eligibility",
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
        status: "out_of_scope_until_separate_approval",
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
