/**
 * Phase 2i — planning repo truth for quantity gates and post-quantity ladder.
 * Imported by mlcc-browser-add-by-code-probe for Phase 2j evidence echo only (not executed here).
 * Combined code+quantity planning lives in mlcc-phase-2k-policy.js (Phase 2k; imported by probe for Phase 2l echo only).
 * Bump version when criteria or ladder semantics change.
 */

export const PHASE_2I_POLICY_VERSION = "lk-rpa-2i-2";

/**
 * Future quantity-phase approval model (machine-readable). Phase 2j implements a bounded,
 * env-gated subset at runtime (quantity field fill/clear only); this manifest remains the checklist.
 */
export function buildPhase2iQuantityFutureGateManifest() {
  return {
    version: PHASE_2I_POLICY_VERSION,
    phase_intent:
      "planning_only_gates_phase_2j_runtime_quantity_rehearsal_is_separately_env_gated",
    evidence_prerequisites_before_quantity_considered: [
      "operator_has_documented_successful_phase_2h_style_code_rehearsal_or_equivalent_tenant_evidence_where_applicable",
      "tenant_mlcc_add_by_code_code_field_selector_behavior_understood_not_heuristic_only_for_production_paths",
      "mutation_boundary_evidence_phase_2d_or_2e_available_for_relevant_screens_when_used",
      "safe_open_confirmation_phase_2f_or_equivalent_documented_when_entry_path_is_non_obvious",
      "extended_mutation_risk_model_phase_2g_manifest_reviewed_for_field_and_form_heuristics",
    ],
    required_selectors_and_constraints: [
      "tenant_env_mlcc_add_by_code_qty_field_selector_required_non_heuristic_fallback_disallowed_for_qty_rehearsal",
      "optional_mlcc_mutation_boundary_root_selector_alignment_when_scoped_ui_is_operator_standard",
      "quantity_locator_must_resolve_visible_single_intended_field_before_any_future_phase_2j_fill",
    ],
    mutation_risk_checks_must_pass: [
      "reuse_computePhase2gExtendedMutationRisk_or_successor_on_quantity_locator_before_fill",
      "reject_if_rehearsal_blocked_per_extended_risk_block_reasons",
      "explicit_policy_for_input_type_number_vs_non_numeric_quantity_surfaces_documented_per_tenant",
      "form_action_and_field_identifier_heuristics_same_family_as_phase_2g",
    ],
    network_and_ui_guard_signals_required_zero_for_non_mutating_claim: [
      "layer_2_guardstats_blockedrequestcount_delta_zero_during_quantity_type_step",
      "layer_2_guardstats_blockedrequestcount_delta_zero_during_quantity_clear_step_if_clear_allowed",
      "layer_3_no_clicks_on_add_to_cart_validate_checkout_submit_or_final_confirmation_in_same_phase",
    ],
    hard_fail_stop_conditions: [
      "any_positive_network_guard_delta_during_type_immediate_stop_no_clear_policy_same_as_phase_2h",
      "extended_mutation_risk_blocked",
      "field_not_visible_disabled_or_readonly",
      "enter_or_return_pressed_on_quantity_field",
      "unexpected_navigation_or_url_change_during_rehearsal_without_prior_approval",
      "any_attempt_to_touch_code_field_within_quantity_only_phase_without_separate_approval",
    ],
    observable_non_mutating_quantity_proof_criteria: [
      "no_new_layer_2_aborts_during_type_and_clear_on_that_run_only",
      "evidence_must_redact_quantity_value_use_length_only_or_equivalent",
      "disclaimer_required_observable_browser_signals_do_not_prove_server_cart_state",
      "no_claim_that_quantity_is_generally_safe_after_single_tenant_run",
    ],
  };
}

/**
 * Ordered ladder after quantity; each step stays out of scope until separately approved in repo.
 */
export function buildPhase2iBroaderInteractionLadder() {
  return {
    version: PHASE_2I_POLICY_VERSION,
    note: "each_step_requires_explicit_phase_doc_verify_and_policy_version_bump_when_implemented",
    steps: [
      {
        id: "quantity_rehearsal",
        label: "Gated quantity field rehearsal (fill/clear pattern analogous to 2h)",
        status: "out_of_scope_until_separate_approval",
        implementation_note:
          "bounded_subset_implemented_as_runAddByCodePhase2jQuantityTypingRehearsal_when_MLCC_ADD_BY_CODE_PHASE_2J_and_2J_APPROVED",
        forbids_until_approved: [
          "add_to_cart",
          "validate",
          "checkout",
          "submit",
          "real_order_submission",
        ],
      },
      {
        id: "quantity_clear_revert",
        label: "Quantity clear or revert under same guard and risk rules as type",
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
        forbids_until_approved: ["real_order_submission_without_mlcc_submission_armed_and_later_phase"],
      },
    ],
  };
}
