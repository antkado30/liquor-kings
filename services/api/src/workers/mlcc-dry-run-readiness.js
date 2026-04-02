/**
 * Read-only repeatability / readiness analysis for MLCC browser dry-run phases (2a–2r).
 * Does not launch a browser, perform clicks, or weaken guards.
 */

import { buildMlccBrowserConfig } from "./mlcc-browser-worker.js";

/**
 * @param {{ payload: unknown, env?: import("node:process").Env }} args
 * @returns {{
 *   config_ready: boolean,
 *   errors: Array<{ type?: string, message: string }>,
 *   phases: Array<{
 *     id: string,
 *     label: string,
 *     status: "runnable" | "off",
 *     tenant_specific_keys: string[],
 *     generic_keys: string[],
 *     notes: string[],
 *   }>,
 *   safety_reminder: string,
 * }}
 */
export function buildMlccDryRunReadinessReport({ payload, env }) {
  const e = env ?? process.env;
  const cfg = buildMlccBrowserConfig({ payload, env: e });

  const safety_reminder =
    "This report is config-only. Runtime may still fail on UI drift. Checkout, submit, finalize, and real order placement remain forbidden in the worker.";

  if (!cfg.ready || !cfg.config) {
    return {
      config_ready: false,
      errors: cfg.errors ?? [],
      phases: [],
      safety_reminder,
    };
  }

  const c = cfg.config;

  const phases = [];

  phases.push({
    id: "2a_nav",
    label: "Login + post-login navigation (ordering entry / safe target)",
    status: "runnable",
    tenant_specific_keys: [
      "MLCC_LOGIN_URL (tenant portal)",
      "MLCC_SAFE_TARGET_URL",
      "MLCC_ORDERING_ENTRY_URL (optional)",
    ],
    generic_keys: ["MLCC_HEADLESS", "MLCC_STEP_SCREENSHOTS (optional)"],
    notes: [
      "Payload store.mlcc_username + MLCC_PASSWORD required.",
      "Evidence: early step snapshots and mlcc_ordering_ready_* checkpoints.",
    ],
  });

  phases.push({
    id: "2a_license",
    label: "Optional license / store automation (2a)",
    status: c.licenseStoreAutomation ? "runnable" : "off",
    tenant_specific_keys: [
      "MLCC_LICENSE_STORE_SELECT_SELECTOR",
      "MLCC_LICENSE_STORE_CONTINUE_SELECTOR",
      "MLCC_LICENSE_STORE_URL_PATTERN (optional)",
    ],
    generic_keys: ["MLCC_LICENSE_STORE_AUTOMATION", "MLCC_LICENSE_STORE_WAIT_MS"],
    notes: c.licenseStoreAutomation
      ? ["Navigation-only; not checkout."]
      : ["Set MLCC_LICENSE_STORE_AUTOMATION=true (+ selectors) to enable."],
  });

  phases.push({
    id: "2b",
    label: "Add-by-code probe (detection / bounded safe open)",
    status: c.addByCodeProbe ? "runnable" : "off",
    tenant_specific_keys: ["MLCC_ADD_BY_CODE_ENTRY_SELECTOR (optional)"],
    generic_keys: ["MLCC_ADD_BY_CODE_PROBE"],
    notes: c.addByCodeProbe
      ? ["Required gate for Phases 2c–2r."]
      : ["Enable MLCC_ADD_BY_CODE_PROBE=true for add-by-code path."],
  });

  const probeOn = c.addByCodeProbe;

  phases.push({
    id: "2c",
    label: "Field hardening (tenant code/qty selectors, read-only)",
    status: probeOn && c.addByCodePhase2c ? "runnable" : "off",
    tenant_specific_keys: [
      "MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR",
      "MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR",
    ],
    generic_keys: ["MLCC_ADD_BY_CODE_PHASE_2C", "MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR"],
    notes: [
      probeOn
        ? c.addByCodePhase2c
          ? ["No cart mutation; inspection / optional focus-blur only."]
          : ["Set MLCC_ADD_BY_CODE_PHASE_2C=true to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2d",
    label: "Mutation boundary map (full page, read-only)",
    status: probeOn && c.addByCodePhase2d ? "runnable" : "off",
    tenant_specific_keys: [],
    generic_keys: ["MLCC_ADD_BY_CODE_PHASE_2D"],
    notes: [
      probeOn
        ? c.addByCodePhase2d
          ? ["Mutually exclusive with 2E in config."]
          : ["Set MLCC_ADD_BY_CODE_PHASE_2D=true to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2e",
    label: "Mutation boundary map (scoped root, read-only)",
    status: probeOn && c.addByCodePhase2e ? "runnable" : "off",
    tenant_specific_keys: ["MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR (optional)"],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2E",
      "MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS (optional JSON)",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2e
          ? ["Mutually exclusive with 2D in config."]
          : ["Set MLCC_ADD_BY_CODE_PHASE_2E=true to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2f",
    label: "Safe open confirmation (at most one tenant-listed open click)",
    status: probeOn && c.addByCodePhase2f ? "runnable" : "off",
    tenant_specific_keys: [
      "MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS (JSON array, required when 2F on)",
      "MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS (optional JSON)",
    ],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2F",
      "MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV (optional)",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2f
          ? ["Layer 2/3 gated; not checkout/submit."]
          : ["Set MLCC_ADD_BY_CODE_PHASE_2F=true + candidate selectors to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2g",
    label: "Typing policy + optional rehearsal (sentinel / focus-blur)",
    status: probeOn && c.addByCodePhase2g ? "runnable" : "off",
    tenant_specific_keys: [],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2G",
      "MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL",
      "MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING",
      "MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2g
          ? ["Default read-only; real codes only in later phases."]
          : ["Set MLCC_ADD_BY_CODE_PHASE_2G=true to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2h",
    label: "Real code-field rehearsal (single field, fill+clear)",
    status: probeOn && c.addByCodePhase2h ? "runnable" : "off",
    tenant_specific_keys: ["MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR (required)"],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2H",
      "MLCC_ADD_BY_CODE_PHASE_2H_APPROVED",
      "MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2h
          ? ["Operator approval required; no checkout."]
          : ["Set 2H flags + approved + test code to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2j",
    label: "Quantity-field-only rehearsal",
    status: probeOn && c.addByCodePhase2j ? "runnable" : "off",
    tenant_specific_keys: ["MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR (required)"],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2J",
      "MLCC_ADD_BY_CODE_PHASE_2J_APPROVED",
      "MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY",
      "MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR (optional)",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2j
          ? ["No code field; no validate/checkout."]
          : ["Set 2J flags + approved + test quantity to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2l",
    label: "Combined code+quantity rehearsal",
    status: probeOn && c.addByCodePhase2l ? "runnable" : "off",
    tenant_specific_keys: [
      "MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR",
      "MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR",
      "MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER",
    ],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2L",
      "MLCC_ADD_BY_CODE_PHASE_2L_APPROVED",
      "MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE",
      "MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY",
      "MLCC_ADD_BY_CODE_PHASE_2L_ALLOW_BLUR (optional)",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2l
          ? ["Prerequisite for 2N."]
          : ["Set 2L flags + approved + field order + tests to run."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2n",
    label: "Single add/apply-line click",
    status: probeOn && c.addByCodePhase2n ? "runnable" : "off",
    tenant_specific_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS (JSON)",
      "MLCC_ADD_BY_CODE_PHASE_2N_TEXT_ALLOW_SUBSTRINGS (optional JSON)",
    ],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2N",
      "MLCC_ADD_BY_CODE_PHASE_2N_APPROVED",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2n
          ? ["Requires 2L enabled+approved in config; at most one click; no validate/checkout."]
          : ["Set 2N + approved + selectors; requires 2L chain."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2o",
    label: "Read-only post-add/apply observation",
    status: probeOn && c.addByCodePhase2o ? "runnable" : "off",
    tenant_specific_keys: [],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2O",
      "MLCC_ADD_BY_CODE_PHASE_2O_APPROVED",
      "MLCC_ADD_BY_CODE_PHASE_2O_SETTLE_MS (optional)",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2o
          ? ["Zero clicks; requires successful 2N at runtime (not checked here)."]
          : ["Set 2O + approved to run after 2N."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2q",
    label: "Single bounded validate click",
    status: probeOn && c.addByCodePhase2q ? "runnable" : "off",
    tenant_specific_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS (JSON)",
      "MLCC_ADD_BY_CODE_PHASE_2Q_TEXT_ALLOW_SUBSTRINGS (optional JSON)",
    ],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2Q",
      "MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED",
      "MLCC_ADD_BY_CODE_PHASE_2Q_POST_VALIDATE_OBSERVE_SETTLE_MS (optional)",
      "MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O (if 2O off)",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2q
          ? ["Not checkout; Layer 2 window enforced at runtime."]
          : ["Set 2Q + approved + validate selectors; requires 2N/2L chain."]
        : ["Blocked: probe off."],
    ],
  });

  phases.push({
    id: "2r",
    label: "Read-only post-validate observation",
    status: probeOn && c.addByCodePhase2r ? "runnable" : "off",
    tenant_specific_keys: [],
    generic_keys: [
      "MLCC_ADD_BY_CODE_PHASE_2R",
      "MLCC_ADD_BY_CODE_PHASE_2R_APPROVED",
      "MLCC_ADD_BY_CODE_PHASE_2R_SETTLE_MS (optional)",
    ],
    notes: [
      probeOn
        ? c.addByCodePhase2r
          ? [
              "Zero clicks; inferred checkout-like controls are not authorization.",
              "Requires successful 2Q at runtime (not checked here).",
            ]
          : ["Set 2R + approved to run after 2Q."]
        : ["Blocked: probe off."],
    ],
  });

  return {
    config_ready: true,
    errors: [],
    phases,
    safety_reminder,
  };
}

/**
 * @param {ReturnType<typeof buildMlccDryRunReadinessReport>} report
 * @returns {string}
 */
export function formatMlccDryRunReadinessText(report) {
  const lines = [];
  lines.push("=== MLCC dry-run readiness (config-only, 2a–2r) ===");
  lines.push("");

  if (!report.config_ready) {
    lines.push("CONFIG: NOT READY");
    lines.push("Fix the following before running worker:mlcc-browser-dry-run:");
    for (const err of report.errors) {
      lines.push(`  - ${err.message}`);
    }
    lines.push("");
    lines.push(report.safety_reminder);
    return lines.join("\n");
  }

  lines.push("CONFIG: READY (structural checks passed)");
  lines.push("");
  lines.push("Phase          Status     Notes");
  lines.push("-------------  ---------  --------------------------------------------");

  for (const p of report.phases) {
    const st = p.status === "runnable" ? "RUNNABLE" : "off";
    const note0 = p.notes[0] ?? "";
    lines.push(`${p.id.padEnd(13)}  ${st.padEnd(9)}  ${note0}`);
    for (let i = 1; i < p.notes.length; i++) {
      lines.push(`${"".padEnd(13)}  ${"".padEnd(9)}  ${p.notes[i]}`);
    }
  }

  lines.push("");
  lines.push("--- Tenant-specific env (per MLCC tenant / skin) ---");
  for (const p of report.phases) {
    if (p.tenant_specific_keys.length === 0) {
      continue;
    }
    lines.push(`${p.id}: ${p.tenant_specific_keys.join("; ")}`);
  }

  lines.push("");
  lines.push("--- Generic / operator flags (shared pattern) ---");
  for (const p of report.phases) {
    if (p.generic_keys.length === 0) {
      continue;
    }
    lines.push(`${p.id}: ${p.generic_keys.join("; ")}`);
  }

  lines.push("");
  lines.push(report.safety_reminder);
  lines.push("");
  lines.push(
    "Full checklist + evidence stages: docs/lk/architecture/mlcc-dry-run-repeatability.md",
  );

  return lines.join("\n");
}
