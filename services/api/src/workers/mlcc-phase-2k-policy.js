/**
 * Phase 2k — repo truth for combined code+quantity interaction and later ladder.
 * Imported by mlcc-browser-add-by-code-probe for Phase 2l evidence echo only (not executed here).
 * mlcc-browser-worker does not import this module.
 * Bump version when combined-interaction criteria or ladder semantics change.
 *
 * Complements Phase 2i (quantity-only gates + broader ladder) and Phase 2j (runtime qty-only rehearsal).
 */

export const PHASE_2K_POLICY_VERSION = "lk-rpa-2k-2";

/**
 * Approval model for a future runtime phase that fills **both** code and quantity in one session.
 * Does **not** authorize add-to-cart, validate, checkout, submit, or any cart mutation.
 */
export function buildPhase2kCombinedInteractionFutureGateManifest() {
  return {
    version: PHASE_2K_POLICY_VERSION,
    phase_intent:
      "planning_repo_truth_phase_2l_combined_rehearsal_runtime_env_gated_in_probe_not_in_worker",
    relationship_to_prior_phases: [
      "phase_2h_established_tenant_code_field_only_rehearsal_evidence_patterns",
      "phase_2j_established_tenant_quantity_field_only_rehearsal_evidence_patterns",
      "combined_safety_is_unknown_do_not_infer_from_2h_plus_2j_separate_runs_alone",
    ],
    evidence_prerequisites_before_combined_rehearsal_considered: [
      "documented_successful_phase_2h_run_for_tenant_or_equivalent_evidence_code_field_only",
      "documented_successful_phase_2j_run_for_tenant_or_equivalent_evidence_quantity_field_only",
      "phase_2i_quantity_gate_manifest_reviewed_and_still_aligned_when_combined_phase_is_proposed",
      "mutation_boundary_evidence_phase_2d_or_2e_available_for_relevant_screens_when_used",
      "tenant_explicit_field_order_rule_documented_in_repo_for_combined_sequence_code_then_qty_or_qty_then_code_or_other",
    ],
    required_selectors_and_constraints: [
      "tenant_mlcc_add_by_code_code_field_selector_required_non_heuristic",
      "tenant_mlcc_add_by_code_qty_field_selector_required_non_heuristic",
      "both_locators_must_resolve_visible_intended_fields_before_any_future_combined_fill",
      "optional_mlcc_mutation_boundary_root_selector_alignment_when_scoped_ui_is_operator_standard",
    ],
    field_order_rules: [
      "tenant_must_publish_documented_order_code_first_then_quantity_or_quantity_first_then_code_or_single_atomic_control",
      "runtime_implementation_must_follow_documented_order_only_no_automatic_field_order_guessing",
      "enter_and_return_forbidden_on_either_field_during_combined_rehearsal_unless_future_phase_explicitly_documents_exception",
      "blur_policy_must_match_tenant_documentation_default_no_blur_until_separately_approved_per_field",
    ],
    mutation_risk_checks_must_pass: [
      "computePhase2gExtendedMutationRisk_or_successor_on_code_locator_before_any_combined_step",
      "computePhase2gExtendedMutationRisk_or_successor_on_quantity_locator_before_any_combined_step",
      "reject_if_either_field_rehearsal_blocked_per_extended_risk_block_reasons",
      "re_evaluate_or_track_risk_after_first_field_fill_before_second_field_if_dom_or_form_context_can_change",
    ],
    network_and_ui_guard_signals_required_zero_for_non_mutating_claim: [
      "layer_2_guardstats_blockedrequestcount_delta_zero_during_each_fill_step_and_any_documented_blur",
      "layer_2_delta_zero_during_clear_or_revert_steps_if_clear_allowed_same_family_as_2h_2j",
      "layer_3_no_clicks_on_add_line_apply_add_to_cart_validate_checkout_submit_or_final_confirmation_in_combined_rehearsal_phase",
    ],
    hard_fail_stop_conditions: [
      "any_positive_network_guard_delta_during_any_fill_immediate_stop_clear_policy_same_family_as_phase_2h_2j",
      "extended_mutation_risk_blocked_on_either_field",
      "either_field_not_visible_disabled_or_readonly_at_step_boundary",
      "unexpected_navigation_or_url_change_during_rehearsal_without_prior_approval",
      "attempt_to_skip_documented_field_order_or_touch_unrelated_controls",
      "any_add_line_apply_or_cart_mutation_control_click_in_phase_2l",
    ],
    observable_non_mutating_combined_proof_criteria: [
      "per_step_layer_2_abort_deltas_zero_on_that_run_only_for_declared_steps",
      "evidence_redacts_real_code_and_quantity_values_length_only_or_equivalent",
      "disclaimer_required_observable_browser_signals_do_not_prove_server_cart_state",
      "no_claim_that_combined_interaction_is_generally_safe_after_single_tenant_run",
      "explicit_statement_that_2h_and_2j_separate_success_does_not_imply_combined_safety",
    ],
  };
}

/**
 * Ordered ladder after combined code+quantity rehearsal is approved as its own phase; each step stays out of scope until repo + verify + operator approval.
 */
export function buildPhase2kPostCombinedInteractionLadder() {
  return {
    version: PHASE_2K_POLICY_VERSION,
    note: "each_step_requires_explicit_phase_doc_verify_and_policy_version_bump_when_implemented",
    steps: [
      {
        id: "combined_code_quantity_rehearsal",
        label:
          "Gated combined code+quantity field rehearsal (fill sequence per tenant order doc; no add/validate/checkout)",
        status: "out_of_scope_until_separate_approval",
        implementation_note:
          "bounded_subset_implemented_as_runAddByCodePhase2lCombinedCodeQuantityTypingRehearsal_when_MLCC_ADD_BY_CODE_PHASE_2L_and_2L_APPROVED",
        forbids_until_approved: [
          "add_line",
          "apply_line",
          "add_to_cart",
          "validate",
          "checkout",
          "submit",
          "real_order_submission",
        ],
      },
      {
        id: "combined_clear_revert",
        label:
          "Clear or revert both fields under same guard and risk rules as fills (order documented per tenant)",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "add_to_cart",
          "validate",
          "checkout",
          "submit",
        ],
      },
      {
        id: "add_or_apply_line",
        label: "Add line / apply / equivalent pre-cart commit control interaction",
        status: "out_of_scope_until_separate_approval",
        forbids_until_approved: [
          "validate",
          "checkout",
          "submit",
          "finalize_order",
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
