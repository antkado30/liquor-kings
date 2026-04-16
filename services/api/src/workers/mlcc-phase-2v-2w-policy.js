/**
 * Phase 2v / 2w — MILO-specific validate successor contracts.
 * 2v is bounded single-click validate when explicitly gated; 2w remains design/inert.
 */

export const PHASE_2V_MILO_VALIDATE_POLICY_VERSION = "lk-rpa-2v-1";
export const PHASE_2W_MILO_POST_VALIDATE_POLICY_VERSION = "lk-rpa-2w-1";

/**
 * Canonical checklist for MILO validate successor after hardened 2u -> 2o lane.
 */
export function buildPhase2vMiloValidateFutureGateManifest() {
  return {
    version: PHASE_2V_MILO_VALIDATE_POLICY_VERSION,
    phase_intent:
      "milo_validate_successor_contract_after_2u_and_2o_bounded_single_click_when_explicitly_env_gated",
    relationship_to_prior_phases: [
      "phase_2u_milo_bulk_click_repeatable_and_rubric_backed",
      "phase_2o_milo_post_2u_observation_repeatable_and_rubric_backed",
      "legacy_phase_2q_depends_on_phase_2n_not_milo_fit",
    ],
    required_preconditions: [
      "same_run_phase_2u_click_performed_true",
      "same_run_phase_2o_milo_post_2u_observation_performed_true",
      "tenant_validate_selector_list_documented_non_heuristic",
      "operator_acknowledges_validate_boundary_is_new_scope_not_implied_by_2u_or_2o",
    ],
    required_approvals_and_env_gates: [
      "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true",
      "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_APPROVED=true",
      "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_SELECTORS_json_non_empty",
      "MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true_and_approved",
      "MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U=true_and_phase_2o_approved",
    ],
    required_evidence_before_live_validate: [
      "candidate_evaluation_dump_for_validate_targets",
      "expected_click_count_exactly_one_for_future_runtime_phase",
      "layer_2_delta_zero_requirements_for_click_and_full_phase_windows",
      "explicit_downstream_forbidden_clear_status_checkout_submit_finalize",
      "mandatory_disclaimer_browser_dom_not_server_order_truth",
    ],
    forbidden_in_current_phase: [
      "second_validate_click",
      "checkout",
      "submit_or_finalize",
      "mixing_legacy_2q_or_2r_with_milo_2v_model",
    ],
    mandatory_disclaimers: [
      "phase_2v_allows_one_validate_click_only_when_explicitly_enabled_and_approved",
      "single_run_success_does_not_establish_general_tenant_validate_safety",
      "browser_observation_and_layer2_deltas_are_not_server_order_truth",
    ],
  };
}

/**
 * Canonical checklist for MILO post-validate observation successor after 2v.
 */
export function buildPhase2wMiloPostValidateFutureGateManifest() {
  return {
    version: PHASE_2W_MILO_POST_VALIDATE_POLICY_VERSION,
    phase_intent:
      "milo_post_validate_observation_successor_after_2v_design_only_zero_click_contract",
    relationship_to_prior_phases: [
      "phase_2v_milo_validate_successor_declares_validate_boundary",
      "legacy_phase_2r_depends_on_legacy_phase_2q_not_milo_fit",
    ],
    required_preconditions: [
      "same_run_phase_2v_validate_success_documented_for_future_runtime_phase",
      "post_validate_read_only_observation_scope_defined_no_clicks",
      "operator_acknowledges_inferred_checkout_like_controls_are_not_authorization",
    ],
    required_approvals_and_env_gates: [
      "MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE=true",
      "MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE_APPROVED=true",
      "MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true_and_approved",
    ],
    required_evidence_before_live_post_validate: [
      "pre_post_observation_payload_schema_defined_url_title_text_status",
      "layer_2_delta_zero_requirement_for_observation_window",
      "validate_selector_state_deltas_and_visible_samples",
      "explicit_downstream_forbidden_clear_status_checkout_submit_finalize",
    ],
    forbidden_in_current_phase: [
      "runtime_post_validate_observation_execution",
      "any_click_in_post_validate_observation_contract",
      "checkout",
      "submit_or_finalize",
      "mixing_legacy_2r_with_milo_2w_model",
    ],
    mandatory_disclaimers: [
      "design_only_contract_not_runtime_authorization",
      "post_validate_observation_signals_do_not_prove_backend_order_truth",
      "inferred_checkout_like_visibility_is_not_permission_to_proceed",
    ],
  };
}
