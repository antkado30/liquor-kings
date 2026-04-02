/**
 * Read-only repeatability / readiness analysis for MLCC browser dry-run phases (2a–2r).
 * Does not launch a browser, perform clicks, or weaken guards.
 */

import { buildMlccBrowserConfig } from "./mlcc-browser-worker.js";

/**
 * @typedef {"runnable" | "off"} PhaseRunStatus
 * @typedef {null | "disabled_by_env" | "blocked_dependency"} PhaseOffKind
 */

/**
 * @param {object} row
 * @param {boolean} probeOn
 * @param {boolean} phaseFlag
 * @param {string[]} whenEnabledNotes
 * @param {string} enableHint
 * @returns {object}
 */
function phaseRowBase(row, probeOn, phaseFlag, whenEnabledNotes, enableHint) {
  const {
    id,
    label,
    tenant_specific_keys,
    generic_keys,
    notes_extra_when_blocked_probe = [],
  } = row;

  if (!probeOn) {
    return {
      id,
      label,
      status: /** @type {PhaseRunStatus} */ ("off"),
      off_kind: /** @type {PhaseOffKind} */ ("blocked_dependency"),
      off_reason: "MLCC_ADD_BY_CODE_PROBE is not true (Phase 2b gate)",
      next_actions: [
        "Set MLCC_ADD_BY_CODE_PROBE=true (and satisfy base URLs + credentials), then re-run doctor.",
      ],
      tenant_specific_keys,
      generic_keys,
      notes: [
        "Blocked: add-by-code probe off — Phases 2c–2r require 2b first.",
        ...notes_extra_when_blocked_probe,
      ],
    };
  }

  if (!phaseFlag) {
    return {
      id,
      label,
      status: "off",
      off_kind: "disabled_by_env",
      off_reason: "Phase env flag(s) not enabled or not approved in this config",
      next_actions: [enableHint],
      tenant_specific_keys,
      generic_keys,
      notes: [enableHint],
    };
  }

  return {
    id,
    label,
    status: "runnable",
    off_kind: null,
    off_reason: null,
    next_actions: [
      "Config allows this phase; run worker dry-run and confirm evidence stages for this id.",
    ],
    tenant_specific_keys,
    generic_keys,
    notes: whenEnabledNotes,
  };
}

/**
 * @param {{ payload: unknown, env?: import("node:process").Env }} args
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
      summary: {
        runnable_count: 0,
        off_disabled_count: 0,
        off_blocked_probe_count: 0,
        recommended_next_step: null,
      },
      safety_reminder,
    };
  }

  const c = cfg.config;
  const probeOn = c.addByCodeProbe;
  const phases = [];

  phases.push({
    id: "2a_nav",
    label: "Login + post-login navigation (ordering entry / safe target)",
    status: "runnable",
    off_kind: null,
    off_reason: null,
    next_actions: [
      "Run worker; confirm login evidence and mlcc_ordering_ready_* before enabling deeper phases.",
    ],
    tenant_specific_keys: [
      "MLCC_LOGIN_URL (tenant portal)",
      "MLCC_SAFE_TARGET_URL",
      "MLCC_ORDERING_ENTRY_URL (optional)",
    ],
    generic_keys: [
      "MLCC_HEADLESS",
      "MLCC_STEP_SCREENSHOTS (optional)",
      "MLCC_STEP_SCREENSHOT_MAX_BYTES (optional)",
    ],
    notes: [
      "Payload store.mlcc_username + MLCC_PASSWORD required (validated).",
      "Evidence: early step snapshots and mlcc_ordering_ready_* checkpoints.",
    ],
  });

  phases.push({
    id: "2a_license",
    label: "Optional license / store automation (2a)",
    ...(c.licenseStoreAutomation
      ? {
          status: "runnable",
          off_kind: null,
          off_reason: null,
          next_actions: [
            "Run worker with license automation; evidence should show bounded license/store navigation only.",
          ],
          tenant_specific_keys: [
            "MLCC_LICENSE_STORE_SELECT_SELECTOR",
            "MLCC_LICENSE_STORE_CONTINUE_SELECTOR",
            "MLCC_LICENSE_STORE_URL_PATTERN (optional)",
          ],
          generic_keys: [
            "MLCC_LICENSE_STORE_AUTOMATION",
            "MLCC_LICENSE_STORE_WAIT_MS (optional)",
          ],
          notes: ["Navigation-only; not checkout."],
        }
      : {
          status: "off",
          off_kind: "disabled_by_env",
          off_reason: "MLCC_LICENSE_STORE_AUTOMATION is not true",
          next_actions: [
            "To enable: set MLCC_LICENSE_STORE_AUTOMATION=true plus MLCC_LICENSE_STORE_SELECT_SELECTOR and MLCC_LICENSE_STORE_CONTINUE_SELECTOR.",
          ],
          tenant_specific_keys: [
            "MLCC_LICENSE_STORE_SELECT_SELECTOR",
            "MLCC_LICENSE_STORE_CONTINUE_SELECTOR",
            "MLCC_LICENSE_STORE_URL_PATTERN (optional)",
          ],
          generic_keys: [
            "MLCC_LICENSE_STORE_AUTOMATION",
            "MLCC_LICENSE_STORE_WAIT_MS (optional)",
          ],
          notes: [
            "Optional phase: skip if tenant has no license/store gate; otherwise set automation + selectors.",
          ],
        }),
  });

  phases.push({
    id: "2b",
    label: "Add-by-code probe (detection / bounded safe open)",
    ...(c.addByCodeProbe
      ? {
          status: "runnable",
          off_kind: null,
          off_reason: null,
          next_actions: [
            "Enable desired Phase 2c–2r flags next; all depend on this probe staying true.",
          ],
          tenant_specific_keys: ["MLCC_ADD_BY_CODE_ENTRY_SELECTOR (optional)"],
          generic_keys: ["MLCC_ADD_BY_CODE_PROBE"],
          notes: [
            "Gate for Phases 2c–2r. Optional MLCC_ADD_BY_CODE_ENTRY_SELECTOR helps 2b entry heuristics.",
          ],
        }
      : {
          status: "off",
          off_kind: "disabled_by_env",
          off_reason: "MLCC_ADD_BY_CODE_PROBE is not true",
          next_actions: [
            "Set MLCC_ADD_BY_CODE_PROBE=true to unlock mapping phases 2c–2r (still no checkout/submit).",
          ],
          tenant_specific_keys: ["MLCC_ADD_BY_CODE_ENTRY_SELECTOR (optional)"],
          generic_keys: ["MLCC_ADD_BY_CODE_PROBE"],
          notes: [
            "Without 2b, deeper add-by-code phases cannot run — enable probe first.",
          ],
        }),
  });

  phases.push(
    phaseRowBase(
      {
        id: "2c",
        label: "Field hardening (tenant code/qty selectors, read-only)",
        tenant_specific_keys: [
          "MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR",
          "MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR",
        ],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2C",
          "MLCC_ADD_BY_CODE_SAFE_FOCUS_BLUR (optional)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2c,
      [
        "Read-only inspection / optional focus-blur; no cart mutation.",
        "Tenant should document code + qty CSS (required when 2C is on — already validated).",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2C=true and provide MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR + MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR.",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2d",
        label: "Mutation boundary map (full page, read-only)",
        tenant_specific_keys: [],
        generic_keys: ["MLCC_ADD_BY_CODE_PHASE_2D"],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2d,
      [
        "Read-only scan. Mutually exclusive with 2E — worker rejects both true.",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2D=true (and ensure MLCC_ADD_BY_CODE_PHASE_2E is not true).",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2e",
        label: "Mutation boundary map (scoped root, read-only)",
        tenant_specific_keys: ["MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR (optional)"],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2E",
          "MLCC_MUTATION_BOUNDARY_UNCERTAIN_HINTS (optional JSON)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2e,
      [
        "Read-only scan; optional scoped root + uncertain hints JSON.",
        "Mutually exclusive with 2D.",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2E=true (and ensure MLCC_ADD_BY_CODE_PHASE_2D is not true); add MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR if needed.",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2f",
        label: "Safe open confirmation (at most one tenant-listed open click)",
        tenant_specific_keys: [
          "MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS (JSON array, required when 2F on)",
          "MLCC_ADD_BY_CODE_SAFE_OPEN_TEXT_ALLOW_SUBSTRINGS (optional JSON)",
        ],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2F",
          "MLCC_ADD_BY_CODE_PROBE_SKIP_ENTRY_NAV (optional)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2f,
      [
        "Layer 2/3 gated single open click; not checkout/submit.",
        "Non-empty candidate selector JSON required when enabled (validated).",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2F=true + MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS (non-empty JSON array).",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2g",
        label: "Typing policy + optional rehearsal (sentinel / focus-blur)",
        tenant_specific_keys: [],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2G",
          "MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL (optional)",
          "MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING (optional)",
          "MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE (optional; pattern enforced)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2g,
      [
        "Default read-only policy readout; optional sentinel/focus-blur only when env-gated.",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2G=true; add sentinel env pair only if doing sentinel rehearsal.",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2h",
        label: "Real code-field rehearsal (single field, fill+clear)",
        tenant_specific_keys: ["MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR (required)"],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2H",
          "MLCC_ADD_BY_CODE_PHASE_2H_APPROVED",
          "MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2h,
      [
        "Operator approval required; no checkout.",
        "Tenant code selector + test code required when enabled (validated).",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2H=true, MLCC_ADD_BY_CODE_PHASE_2H_APPROVED=true, MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE, and tenant code field selector.",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2j",
        label: "Quantity-field-only rehearsal",
        tenant_specific_keys: ["MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR (required)"],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2J",
          "MLCC_ADD_BY_CODE_PHASE_2J_APPROVED",
          "MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY",
          "MLCC_ADD_BY_CODE_PHASE_2J_ALLOW_BLUR (optional)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2j,
      [
        "Quantity field only; no code field; no validate/checkout.",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2J=true, MLCC_ADD_BY_CODE_PHASE_2J_APPROVED=true, MLCC_ADD_BY_CODE_PHASE_2J_TEST_QUANTITY, and tenant qty selector.",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2l",
        label: "Combined code+quantity rehearsal",
        tenant_specific_keys: [
          "MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR",
          "MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR",
          "MLCC_ADD_BY_CODE_PHASE_2L_FIELD_ORDER (code_first | quantity_first)",
        ],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2L",
          "MLCC_ADD_BY_CODE_PHASE_2L_APPROVED",
          "MLCC_ADD_BY_CODE_PHASE_2L_TEST_CODE",
          "MLCC_ADD_BY_CODE_PHASE_2L_TEST_QUANTITY",
          "MLCC_ADD_BY_CODE_PHASE_2L_ALLOW_BLUR (optional)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2l,
      [
        "Prerequisite in config for Phase 2N.",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2L=true, MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true, field order, both test values, and both tenant field selectors.",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2n",
        label: "Single add/apply-line click",
        tenant_specific_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS (JSON)",
          "MLCC_ADD_BY_CODE_PHASE_2N_TEXT_ALLOW_SUBSTRINGS (optional JSON)",
        ],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2N",
          "MLCC_ADD_BY_CODE_PHASE_2N_APPROVED",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2n,
      [
        "At most one add/apply click; requires 2L enabled+approved in config (validated).",
        "No validate/checkout in this phase.",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2N=true, MLCC_ADD_BY_CODE_PHASE_2N_APPROVED=true, and non-empty MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS JSON; ensure 2L chain is enabled.",
    ),
  );

  phases.push(
    phaseRowBase(
      {
        id: "2o",
        label: "Read-only post-add/apply observation",
        tenant_specific_keys: [],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2O",
          "MLCC_ADD_BY_CODE_PHASE_2O_APPROVED",
          "MLCC_ADD_BY_CODE_PHASE_2O_SETTLE_MS (optional)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2o,
      [
        "Zero clicks; requires successful 2N click at runtime (doctor cannot verify UI).",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2O=true and MLCC_ADD_BY_CODE_PHASE_2O_APPROVED=true (after 2N is stable).",
    ),
  );

  const qNeeds2oWaiver =
    c.addByCodePhase2q &&
    !c.addByCodePhase2o &&
    !c.addByCodePhase2qOperatorAcceptsMissing2o;

  phases.push(
    phaseRowBase(
      {
        id: "2q",
        label: "Single bounded validate click",
        tenant_specific_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS (JSON)",
          "MLCC_ADD_BY_CODE_PHASE_2Q_TEXT_ALLOW_SUBSTRINGS (optional JSON)",
        ],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2Q",
          "MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED",
          "MLCC_ADD_BY_CODE_PHASE_2Q_POST_VALIDATE_OBSERVE_SETTLE_MS (optional)",
          "MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O (required when 2O off)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2q && !qNeeds2oWaiver,
      [
        "Not checkout; Layer 2 window enforced at runtime.",
        "If 2O is off, MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true is required (validated when 2Q on).",
      ],
      qNeeds2oWaiver
        ? "Either enable Phase 2O (with approval) or set MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true when 2Q is on without 2O."
        : "Set MLCC_ADD_BY_CODE_PHASE_2Q=true, MLCC_ADD_BY_CODE_PHASE_2Q_APPROVED=true, validate selectors JSON, and satisfy 2N/2L prerequisites.",
    ),
  );

  if (qNeeds2oWaiver && probeOn && c.addByCodePhase2q) {
    const p2q = phases[phases.length - 1];
    p2q.status = "off";
    p2q.off_kind = "disabled_by_env";
    p2q.off_reason =
      "2Q enabled without 2O but MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O is not true";
    p2q.next_actions = [
      "Enable MLCC_ADD_BY_CODE_PHASE_2O + approval, or set MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true (explicit operator waiver per Phase 2p).",
    ];
    p2q.notes = p2q.next_actions;
  }

  phases.push(
    phaseRowBase(
      {
        id: "2r",
        label: "Read-only post-validate observation",
        tenant_specific_keys: [],
        generic_keys: [
          "MLCC_ADD_BY_CODE_PHASE_2R",
          "MLCC_ADD_BY_CODE_PHASE_2R_APPROVED",
          "MLCC_ADD_BY_CODE_PHASE_2R_SETTLE_MS (optional)",
        ],
        notes_extra_when_blocked_probe: [],
      },
      probeOn,
      c.addByCodePhase2r,
      [
        "Zero clicks; inferred checkout-like controls are not authorization.",
        "Requires successful 2Q at runtime (doctor cannot verify UI).",
      ],
      "Set MLCC_ADD_BY_CODE_PHASE_2R=true and MLCC_ADD_BY_CODE_PHASE_2R_APPROVED=true after 2Q is stable.",
    ),
  );

  let runnable_count = 0;
  let off_disabled_count = 0;
  let off_blocked_probe_count = 0;

  for (const p of phases) {
    if (p.status === "runnable") {
      runnable_count++;
    } else if (p.off_kind === "blocked_dependency") {
      off_blocked_probe_count++;
    } else if (p.off_kind === "disabled_by_env") {
      off_disabled_count++;
    }
  }

  let recommended_next_step = null;

  if (!probeOn) {
    recommended_next_step =
      "Enable MLCC_ADD_BY_CODE_PROBE=true to unlock tenant mapping phases 2c–2r, or stop at base/2a if only login validation is needed.";
  } else if (!c.addByCodePhase2l && (c.addByCodePhase2n || c.addByCodePhase2q)) {
    recommended_next_step =
      "Phase 2N/2Q require 2L in config — enable MLCC_ADD_BY_CODE_PHASE_2L + approval + selectors/tests first.";
  } else if (qNeeds2oWaiver) {
    recommended_next_step =
      "Fix 2Q vs 2O: enable 2O+approval or set MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true.";
  } else if (!c.addByCodePhase2f && !c.addByCodePhase2c && !c.addByCodePhase2d && !c.addByCodePhase2e) {
    recommended_next_step =
      "Probe is on: add MLCC_ADD_BY_CODE_PHASE_2C and/or 2D|2E and/or 2F per tenant onboarding plan (see repeatability doc order).";
  } else {
    recommended_next_step =
      "Deepen phases in order (repeatability doc); re-run doctor after each env change.";
  }

  return {
    config_ready: true,
    errors: [],
    phases,
    summary: {
      runnable_count,
      off_disabled_count,
      off_blocked_probe_count,
      recommended_next_step,
    },
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

  const s = report.summary;

  lines.push("CONFIG: READY (structural checks passed)");
  lines.push("");
  lines.push("SUMMARY:");
  lines.push(`  Runnable phases: ${s.runnable_count}`);
  lines.push(`  Off (env disabled): ${s.off_disabled_count}`);
  lines.push(`  Off (blocked — probe off): ${s.off_blocked_probe_count}`);
  lines.push(`  Suggested next action: ${s.recommended_next_step}`);
  lines.push("");
  lines.push(
    "Phase   Status     Off-kind        Reason / first next step",
  );
  lines.push(
    "------  ---------  --------------  ------------------------------------------------",
  );

  for (const p of report.phases) {
    const st = p.status === "runnable" ? "RUNNABLE" : "off";
    const kind =
      p.off_kind === "blocked_dependency"
        ? "blocked(2b)"
        : p.off_kind === "disabled_by_env"
          ? "disabled"
          : p.status === "runnable"
            ? "—"
            : "?";
    const reason =
      p.status === "runnable"
        ? (p.next_actions[0] ?? "")
        : `${p.off_reason ?? ""} → ${p.next_actions[0] ?? ""}`;
    lines.push(
      `${p.id.padEnd(6)}  ${st.padEnd(9)}  ${kind.padEnd(14)}  ${reason.slice(0, 72)}`,
    );
    if (reason.length > 72) {
      lines.push(`${"".padEnd(6)}  ${"".padEnd(9)}  ${"".padEnd(14)}  ${reason.slice(72)}`);
    }
  }

  lines.push("");
  lines.push("--- Tenant-specific keys (document per MLCC skin) ---");
  for (const p of report.phases) {
    if (p.tenant_specific_keys.length === 0) {
      continue;
    }
    lines.push(`${p.id}: ${p.tenant_specific_keys.join("; ")}`);
  }

  lines.push("");
  lines.push("--- Generic / operator flags ---");
  for (const p of report.phases) {
    if (p.generic_keys.length === 0) {
      continue;
    }
    lines.push(`${p.id}: ${p.generic_keys.join("; ")}`);
  }

  lines.push("");
  lines.push("--- MLCC_SUBMISSION_ARMED (future submit guard; not used in happy path) ---");
  lines.push(
    "  Must stay false unless a future approved submit phase exists; doctor does not enable submission.",
  );

  lines.push("");
  lines.push(report.safety_reminder);
  lines.push("");
  lines.push(
    "Step-by-step: docs/lk/architecture/mlcc-dry-run-repeatability.md",
  );

  return lines.join("\n");
}
