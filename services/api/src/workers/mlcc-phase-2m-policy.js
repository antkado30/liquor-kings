/**
 * Phase 2m — planning-only repo truth for future add-line / apply-line (pre-cart commit) interaction.
 * Not imported by mlcc-browser-worker or mlcc-browser-add-by-code-probe until a separately approved execution phase.
 * Aligns with Phase 2k ladder step `add_or_apply_line`; this file specializes approval criteria for that step.
 * Bump version when add/apply-line criteria or ladder semantics change.
 */

export const PHASE_2M_POLICY_VERSION = "lk-rpa-2m-1";

/**
 * Approval model for a future runtime phase that performs **one** bounded add-line / apply / equivalent control click.
 * Does **not** authorize validate, checkout, submit, second apply clicks, or cart mutation beyond what that control implies.
 */
export function buildPhase2mAddApplyLineFutureGateManifest() {
  return {
    version: PHASE_2M_POLICY_VERSION,
    phase_intent:
      "planning_only_no_add_apply_line_runtime_in_worker_or_probe_until_separate_execution_phase",
    relationship_to_prior_phases: [
      "phase_2l_established_combined_code_quantity_fill_clear_rehearsal_evidence_patterns",
      "phase_2k_post_combined_ladder_lists_add_or_apply_line_as_next_logical_step_still_out_of_scope",
      "add_apply_safety_is_unknown_do_not_infer_from_field_only_rehearsals_or_single_tenant_dom",
    ],
    evidence_prerequisites_before_add_apply_considered: [
      "documented_successful_phase_2l_run_for_tenant_or_equivalent_evidence_combined_fill_clear_non_mutating_per_layer2_on_that_run",
      "tenant_mutation_boundary_evidence_phase_2d_or_2e_reviewed_for_apply_add_controls_when_used",
      "tenant_lists_explicit_css_or_role_target_for_the_single_add_apply_control_non_heuristic_guesswork_disallowed",
      "operator_acknowledges_that_one_dom_click_may_still_mutate_server_cart_despite_layer2_zero_delta_on_client_abort_counter",
    ],
    required_selectors_and_constraints: [
      "tenant_env_add_apply_control_selector_or_priority_candidate_list_required_documented_in_repo",
      "control_must_pass_layer3_isProbeUiTextUnsafe_and_mutation_boundary_eligibility_same_family_as_phase_2f",
      "at_most_one_click_in_add_apply_phase_no_second_apply_or_add_line_without_new_phase",
      "optional_mlcc_mutation_boundary_root_selector_scope_when_operator_standard_for_control_visibility",
    ],
    network_and_ui_guard_expectations_for_non_mutating_claim: [
      "layer_2_guardstats_blockedrequestcount_delta_zero_during_click_step_if_claiming_no_new_mutation_pattern_triggers",
      "layer_2_patterns_in_shouldBlockHttpRequest_remain_active_no_relaxation_without_doc_and_version_bump",
      "layer_3_no_clicks_on_validate_checkout_submit_final_confirmation_in_same_phase_as_add_apply_rehearsal",
      "layer_3_add_apply_control_must_not_match_broader_unsafe_patterns_than_documented_tenant_label_set",
    ],
    hard_fail_stop_conditions: [
      "positive_network_guard_delta_during_or_immediately_after_apply_click_stop_capture_evidence",
      "control_not_visible_disabled_or_obscured_at_click_boundary",
      "mutation_boundary_classification_unsafe_mutation_likely_or_uncertain_without_tenant_advisory_resolution",
      "unexpected_navigation_or_url_change_without_prior_approval",
      "more_than_one_add_apply_click_attempt_in_single_phase",
    ],
    observable_non_mutating_add_apply_proof_criteria: [
      "if_non_mutating_claim_made_layer_2_abort_deltas_zero_on_that_run_for_declared_click_window_only",
      "evidence_captures_control_label_text_sample_href_or_selector_used_redacted_values_if_any",
      "disclaimer_required_dom_and_client_abort_observation_do_not_prove_server_cart_line_count_or_inventory",
      "disclaimer_required_zero_abort_count_does_not_prove_no_server_side_state_change_if_request_shape_escapes_guard",
      "no_claim_that_add_apply_is_generally_safe_after_single_tenant_run",
      "no_claim_of_readiness_for_validate_checkout_or_submit_after_add_apply_rehearsal_only",
    ],
    mandatory_disclaimers: [
      "browser_evidence_is_not_server_cart_truth",
      "layer_2_blocking_is_heuristic_and_may_miss_equivalent_mutation_endpoints",
      "successful_phase_2l_does_not_imply_safe_add_apply",
    ],
  };
}

/**
 * Ordered ladder from add/apply-line onward; each step stays out of scope until repo + verify + operator approval.
 */
export function buildPhase2mPostAddApplyLadder() {
  return {
    version: PHASE_2M_POLICY_VERSION,
    note: "each_step_requires_explicit_phase_doc_verify_and_policy_version_bump_when_implemented",
    relates_to_phase_2k_ladder_step: "add_or_apply_line",
    steps: [
      {
        id: "add_apply_line_rehearsal",
        label:
          "Gated single add-line / apply / equivalent pre-cart commit control click (no validate/checkout/submit)",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "second_add_or_apply_click",
          "validate",
          "checkout",
          "submit",
          "finalize_order",
        ],
      },
      {
        id: "post_add_apply_observation",
        label:
          "Read-only observation after add/apply (DOM signals, optional network guard tally, no further mutation clicks)",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "validate",
          "checkout",
          "submit",
          "second_add_apply",
        ],
      },
      {
        id: "validate_order",
        label: "Cart or order validate (MLCC-style)",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "checkout",
          "submit",
          "finalize_order",
        ],
      },
      {
        id: "checkout_submit",
        label: "Checkout or order submission",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "real_order_submission_without_mlcc_submission_armed_and_later_phase",
        ],
      },
    ],
  };
}
