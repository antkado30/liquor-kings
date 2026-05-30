/**
 * CartDrawer — two-step Validate → Submit UX (Phase 1 Week 1 of V1 roadmap,
 * 2026-05-30).
 *
 * Mirrors MLCC's actual user flow:
 *   1. User reviews cart (with instant rule-engine feedback per line)
 *   2. Clicks "Validate against MLCC" → backend RPA runs Stages 1-4 → we
 *      surface MILO's live cart state (in-stock items, out-of-stock items,
 *      totals, ADA breakdown, validate messages)
 *   3. User can edit cart (any mutation invalidates the validate result
 *      and the Submit button locks again — they must re-validate)
 *   4. User clicks "Submit Order" → confirmation modal → RPA runs Stages
 *      1-5 → real checkout
 *
 * Two layers of validation, each serving a different purpose:
 *   - Instant rule-engine validation (validateCart from api/cart) — runs
 *     locally as the cart changes, surfaces split-case errors, 9L
 *     minimum-per-ADA, etc. WITHOUT hitting MILO. Catches obvious issues
 *     in 50ms. ALWAYS runs.
 *   - MLCC live validation (validate_only RPA run) — actually logs into
 *     MILO, adds items, runs MILO's real Validate. Sees real stock
 *     status, surfaces OOS items, MILO's own validation messages. Costs
 *     30-60s + a few pennies per run.
 *
 * Submit is GATED on (a) instant rule-engine clean AND (b) at least one
 * successful MLCC validate. This means a user can never accidentally
 * submit a cart that hasn't been confirmed against MLCC's live view.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { validateCart, type CartValidationResult } from "../api/cart";
import { cartLineId, type CartContextValue } from "../hooks/useCart";
import { useSubmission } from "../hooks/useSubmission";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/**
 * Stages the user sees during a validate_only RPA run. The `id` matches
 * the worker's `progress_stage` value reported via the heartbeat. The
 * `label` is user-facing copy (kept short and concrete — "Logging in"
 * not "Stage 1"). Order matters: the progress list checks indices left
 * to right.
 */
const RPA_STAGES_VALIDATE: ReadonlyArray<{ id: string; label: string }> = [
  { id: "rpa_login", label: "Logging into MLCC" },
  { id: "rpa_navigate", label: "Loading products page" },
  { id: "rpa_add_items", label: "Adding items to cart" },
  { id: "rpa_validate", label: "Validating cart" },
];

/**
 * Stages for a full submit run (Stages 1-5). Same shape as the validate
 * list with one extra step at the end.
 */
const RPA_STAGES_SUBMIT: ReadonlyArray<{ id: string; label: string }> = [
  { id: "rpa_login", label: "Logging into MLCC" },
  { id: "rpa_navigate", label: "Loading products page" },
  { id: "rpa_add_items", label: "Adding items to cart" },
  { id: "rpa_validate", label: "Validating cart" },
  { id: "rpa_checkout", label: "Submitting order" },
];

type CartDrawerProps = {
  cart: CartContextValue;
  onClose: () => void;
  onSubmit?: () => void;
};

export function CartDrawer({ cart, onClose }: CartDrawerProps) {
  const {
    items,
    groupedByAda,
    totalCost,
    clearCart,
    incrementQuantity,
    decrementQuantity,
    removeItem,
    updateQuantity,
  } = cart;
  const submission = useSubmission();
  const { state, startValidate, startSubmit, invalidateValidation, reset } = submission;

  // Compound "is the flow doing something async right now" flag. Used to
  // disable UI controls during sync / poll. Covers both validate and
  // submit phases.
  const isBusy =
    state.kind === "validateSyncing" ||
    state.kind === "validateStarting" ||
    state.kind === "validatePolling" ||
    state.kind === "submitStarting" ||
    state.kind === "submitPolling";

  // Has MLCC actually said this cart is OK? Only true when the last
  // validate ended succeeded AND MILO said canCheckout=true.
  const mlccValidatePassed =
    state.kind === "validateDone" &&
    state.finalStatus === "succeeded" &&
    state.validateResult?.can_checkout === true;

  const [isCheckingValidation, setIsCheckingValidation] = useState(false);
  const [validationResult, setValidationResult] = useState<CartValidationResult | null>(null);
  const validationRequestRef = useRef(0);

  /**
   * Confirmation gate before triggering the real RPA submit. Stage 5 is
   * triple-gated server-side, this is the UX-level "are you sure?"
   */
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  // ─── Instant rule-engine validation (unchanged from prior CartDrawer) ──
  //
  // Debounced 400ms after the cart changes. Surfaces split-case / quantity
  // errors per line and ADA 9L violations. Does NOT hit MILO.
  useEffect(() => {
    if (items.length === 0) {
      setIsCheckingValidation(false);
      setValidationResult(null);
      return;
    }
    const requestId = validationRequestRef.current + 1;
    validationRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      setIsCheckingValidation(true);
      void validateCart(items.map((line) => ({ code: line.product.code, quantity: line.quantity })))
        .then((result) => {
          if (validationRequestRef.current !== requestId) return;
          setValidationResult(result);
          setIsCheckingValidation(false);
        })
        .catch((error: unknown) => {
          if (validationRequestRef.current !== requestId) return;
          setValidationResult({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
          setIsCheckingValidation(false);
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [items]);

  // ─── Cart-mutation handlers that ALSO invalidate validate state ───────
  //
  // Whenever the user touches the cart, our validateDone state becomes
  // stale — the next submit MUST re-validate. invalidateValidation()
  // resets the submission state to idle so the Submit button locks again.
  const handleIncrement = (lineId: string) => {
    if (state.kind === "validateDone") invalidateValidation();
    incrementQuantity(lineId);
  };
  const handleDecrement = (lineId: string) => {
    if (state.kind === "validateDone") invalidateValidation();
    decrementQuantity(lineId);
  };
  const handleRemove = (code: string) => {
    if (state.kind === "validateDone") invalidateValidation();
    removeItem(code);
  };
  const handleUpdateQuantity = (code: string, qty: number) => {
    if (state.kind === "validateDone") invalidateValidation();
    updateQuantity(code, qty);
  };
  const handleClearCart = () => {
    if (state.kind !== "idle") reset();
    clearCart();
  };

  const hasDefinitiveValidationFailure =
    validationResult?.ok === true && validationResult.valid === false;
  // Validate is allowed only when rule-engine validation has cleared. We
  // don't want to waste an RPA run on a cart that obviously won't pass.
  const validateDisabled =
    isBusy || items.length === 0 || hasDefinitiveValidationFailure;
  // Submit is allowed only AFTER a successful MLCC validate, AND the
  // rule-engine is still clean (user hasn't edited the cart since).
  const submitDisabled = isBusy || !mlccValidatePassed || hasDefinitiveValidationFailure;

  // Cart-wide blockers shown above the validate button. Per-line errors
  // render inline on their cart line below.
  const validationBlockers = useMemo(() => {
    if (validationResult?.ok !== true || validationResult.valid !== false) return [];
    const cartCodes = new Set(items.map((line) => line.product.code));
    const blockers: string[] = validationResult.errors
      .filter((err) => {
        const codeStr = String(err.code);
        if (cartCodes.has(codeStr)) return false; // shown inline on the line
        if (codeStr.startsWith("ADA_")) return false; // adaBreakdown loop covers it
        return true;
      })
      .map((err) => err.reason)
      .filter((reason) => reason.trim().length > 0);
    for (const [adaNumber, info] of Object.entries(validationResult.adaBreakdown)) {
      if (info.meetsMinimum) continue;
      const matchedGroup = groupedByAda.find((group) => group.adaNumber === adaNumber);
      const adaName = matchedGroup?.adaName || `ADA ${adaNumber}`;
      const litersShort = Math.max(0, 9 - info.liters);
      blockers.push(`${adaName} is ${litersShort.toFixed(2)} L under the 9 L minimum.`);
    }
    return [...new Set(blockers)];
  }, [groupedByAda, validationResult, items]);

  const lineErrorFor = (code: string) =>
    validationResult?.ok === true
      ? validationResult.errors.find((err) => String(err.code) === code)
      : undefined;

  const handleClose = () => {
    if (isBusy) return;
    onClose();
  };

  const handleRetry = () => {
    reset();
  };

  // Map the worker's progress_stage value to the current "active" stage
  // index in our user-facing stage list. Returns -1 if the run hasn't
  // claimed/started yet (still in sync phase).
  const currentStageIndex = (s: typeof state): number => {
    let progressStage: string | null = null;
    if (s.kind === "validatePolling" || s.kind === "submitPolling") {
      progressStage = s.progressStage;
    }
    if (!progressStage) {
      // Pre-stage states map to "before stage 1" (no checkmarks yet).
      // Returning -1 means "the work hasn't reached any RPA stage".
      return -1;
    }
    const stages = s.kind === "submitPolling" ? RPA_STAGES_SUBMIT : RPA_STAGES_VALIDATE;
    const idx = stages.findIndex((st) => st.id === progressStage);
    return idx;
  };

  // Headline label for the progress panel.
  const progressHeadline = (s: typeof state): { title: string; sub?: string } => {
    if (s.kind === "validateSyncing")
      return { title: "Syncing cart to server", sub: `${s.itemsSynced} / ${s.itemsTotal} items` };
    if (s.kind === "validateStarting")
      return { title: "Validating against MLCC", sub: "Starting the RPA pipeline…" };
    if (s.kind === "validatePolling")
      return {
        title: "Validating against MLCC",
        sub: s.progressMessage ?? undefined,
      };
    if (s.kind === "submitStarting")
      return { title: "Submitting order to MLCC", sub: "Starting the RPA pipeline…" };
    if (s.kind === "submitPolling")
      return {
        title: "Submitting order to MLCC",
        sub: s.progressMessage ?? undefined,
      };
    return { title: "Working…" };
  };

  return (
    <div className="drawer-backdrop" onClick={handleClose} role="presentation">
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Cart">
        <div className="drawer-header">
          <h2>Cart</h2>
          <button type="button" className="drawer-close" onClick={handleClose} aria-label="Close cart" disabled={isBusy}>
            ×
          </button>
        </div>

        {/* ─── Cart contents (always visible unless in submit-done state) ─── */}
        {state.kind !== "submitDone" ? (
          <>
            {items.length === 0 ? (
              <p className="drawer-empty muted">Your cart is empty — scan items to add them</p>
            ) : (
              <div className="drawer-ada-groups">
                {groupedByAda.map((group) => {
                  const progressRatio = Math.min(group.liters / 9, 1);
                  const litersShort = Math.max(0, 9 - group.liters);
                  return (
                    <section key={group.adaNumber} className="drawer-ada-section">
                      <div className="drawer-ada-header">
                        <div className="drawer-ada-title">{group.adaName}</div>
                        <div className="drawer-ada-progress-text">
                          {group.liters.toFixed(2)} L / 9.00 L
                        </div>
                      </div>
                      <div className="drawer-ada-progress-track" aria-hidden="true">
                        <div
                          className={`drawer-ada-progress-fill ${group.meetsMinimum ? "is-met" : "is-short"}`}
                          style={{ width: `${progressRatio * 100}%` }}
                        />
                      </div>
                      {!group.meetsMinimum ? (
                        <p className="drawer-ada-needed">Need {litersShort.toFixed(2)} L more from this distributor</p>
                      ) : null}
                      <ul className="drawer-list">
                        {group.lines.map((line) => {
                          const unit = line.product.licensee_price ?? 0;
                          const lineTotal = unit * line.quantity;
                          const size =
                            line.product.bottle_size_label ?? `${line.product.bottle_size_ml ?? ""} ML`;
                          const lineId = cartLineId(line.product);
                          const atMin = line.quantity <= 1;
                          const lineError = lineErrorFor(line.product.code);
                          const suggestions = lineError?.suggestedAlternatives ?? [];
                          return (
                            <li key={lineId} className="drawer-line">
                              <div className="drawer-line-main">
                                <div className="drawer-line-title">{line.product.name}</div>
                                <div className="muted small">{size}</div>
                                <div className="drawer-line-controls">
                                  <div className="qty-stepper" role="group" aria-label="Quantity">
                                    <button
                                      type="button"
                                      className="qty-stepper__btn"
                                      aria-label="Decrease quantity"
                                      disabled={atMin || isBusy}
                                      onClick={() => handleDecrement(lineId)}
                                    >
                                      −
                                    </button>
                                    <span className="qty-stepper__value" aria-live="polite">
                                      {line.quantity}
                                    </span>
                                    <button
                                      type="button"
                                      className="qty-stepper__btn"
                                      aria-label="Increase quantity"
                                      disabled={isBusy}
                                      onClick={() => handleIncrement(lineId)}
                                    >
                                      +
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn text danger"
                                    disabled={isBusy}
                                    onClick={() => handleRemove(line.product.code)}
                                  >
                                    Remove
                                  </button>
                                </div>
                                {lineError ? (
                                  <div className="drawer-line-error" role="alert">
                                    <span className="drawer-line-error-text">{lineError.reason}</span>
                                    {suggestions.length > 0 ? (
                                      <div className="drawer-line-suggestions">
                                        <span className="muted small">Fix:</span>
                                        {suggestions.map((alt) => (
                                          <button
                                            key={alt}
                                            type="button"
                                            className="drawer-line-suggestion"
                                            disabled={isBusy}
                                            onClick={() => handleUpdateQuantity(line.product.code, alt)}
                                          >
                                            Set to {alt}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              <div className="drawer-line-total">{money(lineTotal)}</div>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="drawer-ada-subtotal">
                        <span>ADA subtotal</span>
                        <strong>{money(group.subtotalCost)}</strong>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        ) : null}

        {/* ─── Rule-engine validation messages ────────────────────────────── */}
        {items.length > 0 && state.kind !== "submitDone" ? (
          <>
            {validationResult?.ok === false ? (
              <p className="drawer-validation-notice muted">
                Couldn&apos;t verify this cart right now ({validationResult.error}). You can still validate against MLCC.
              </p>
            ) : null}
            {hasDefinitiveValidationFailure ? (
              <ul className="drawer-validation-errors">
                {validationBlockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            <div className="drawer-total">
              <span>Total</span>
              <strong>{money(totalCost)}</strong>
            </div>
          </>
        ) : null}

        {/* ─── Async progress (validate OR submit) ───────────────────────── */}
        {isBusy ? (
          <RpaProgressPanel
            headline={progressHeadline(state)}
            stages={
              state.kind === "submitStarting" || state.kind === "submitPolling"
                ? RPA_STAGES_SUBMIT
                : RPA_STAGES_VALIDATE
            }
            currentStageIndex={currentStageIndex(state)}
            preStage={
              state.kind === "validateSyncing" ||
              state.kind === "validateStarting" ||
              state.kind === "submitStarting"
            }
          />
        ) : null}

        {/* ─── Validate result panel (after successful MLCC validate) ────── */}
        {state.kind === "validateDone" && state.finalStatus === "succeeded" ? (
          <ValidateResultPanel result={state.validateResult} canCheckout={state.validateResult?.can_checkout ?? null} />
        ) : null}

        {state.kind === "validateDone" && state.finalStatus !== "succeeded" ? (
          <div className="banner banner-warn">
            MLCC validate finished as <strong>{state.finalStatus}</strong>. Review the cart and try again.
          </div>
        ) : null}

        {/* ─── Action buttons (idle / validateDone) ───────────────────────── */}
        {(state.kind === "idle" || state.kind === "validateDone") && items.length > 0 ? (
          <>
            <button type="button" className="btn secondary btn-block" disabled={isBusy} onClick={handleClearCart}>
              Clear cart
            </button>
            <button
              type="button"
              className="btn secondary btn-block"
              disabled={validateDisabled}
              onClick={() => void startValidate(items)}
            >
              {isCheckingValidation
                ? "Checking…"
                : state.kind === "validateDone"
                ? "Re-validate against MLCC"
                : "Validate against MLCC"}
            </button>
            <button
              type="button"
              className="btn primary btn-block"
              disabled={submitDisabled}
              onClick={() => setConfirmSubmit(true)}
              title={
                !mlccValidatePassed
                  ? "Validate against MLCC first"
                  : undefined
              }
            >
              {mlccValidatePassed ? "Submit Order" : "Submit Order (validate first)"}
            </button>
          </>
        ) : null}

        {/* ─── Submit terminal states ─────────────────────────────────────── */}
        {state.kind === "submitDone" && state.finalStatus === "succeeded" ? (
          <>
            <div className="banner banner-ok">
              Order submitted to MILO. Check the Orders page for confirmation numbers.
            </div>
            <button
              type="button"
              className="btn primary btn-block"
              onClick={() => {
                reset();
                clearCart();
                onClose();
              }}
            >
              Done
            </button>
          </>
        ) : null}

        {state.kind === "submitDone" && state.finalStatus !== "succeeded" ? (
          <>
            <div className="banner banner-warn">
              Submit finished as {state.finalStatus}.{" "}
              {state.progressMessage ??
                (state.failureType ? `Failure type: ${state.failureType}` : "No further details were provided.")}
            </div>
            <button type="button" className="btn secondary btn-block" onClick={handleRetry}>
              Back to cart
            </button>
            <button type="button" className="btn btn-block" onClick={onClose}>
              Close
            </button>
          </>
        ) : null}

        {state.kind === "error" ? (
          <>
            <div className="banner banner-err">{state.message}</div>
            <button type="button" className="btn secondary btn-block" onClick={handleRetry}>
              Back to cart
            </button>
            <button type="button" className="btn btn-block" onClick={onClose}>
              Close
            </button>
          </>
        ) : null}
      </div>

      {/* ─── Submit-confirm modal (server-side gates still apply) ─────────── */}
      {confirmSubmit ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm submit order"
          onClick={() => setConfirmSubmit(false)}
        >
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="confirm-title">Submit this order to MILO?</h2>
            <p className="confirm-body">
              {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
              {money(totalCost)}. MLCC already confirmed the cart is ready —
              this submits the order to MILO for real. Final review:
              this is your last chance to cancel.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setConfirmSubmit(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setConfirmSubmit(false);
                  void startSubmit();
                }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders the live MILO cart state after a successful validate_only run.
 * Shows: in-stock count, out-of-stock items (full list), totals, validate
 * messages from MILO. This is the user's "here's what MILO sees" view
 * before they commit to submitting.
 */
function ValidateResultPanel({
  result,
  canCheckout,
}: {
  result: import("../api/execution").ValidateResult | null;
  canCheckout: boolean | null;
}) {
  if (!result) {
    return (
      <div className="banner banner-warn">
        MLCC validate finished but no result data was returned. Re-validate to retry.
      </div>
    );
  }
  const oos = Array.isArray(result.out_of_stock_items) ? result.out_of_stock_items : [];
  const messages = Array.isArray(result.validate_messages) ? result.validate_messages : [];
  const errors = Array.isArray(result.validate_errors) ? result.validate_errors : [];
  const summary = result.order_summary ?? null;

  return (
    <div className={`banner ${canCheckout ? "banner-ok" : "banner-warn"}`}>
      <strong>
        {canCheckout
          ? "MLCC says: cart is ready for checkout."
          : "MLCC validate completed — review issues below before submitting."}
      </strong>
      {/*
        Note: do NOT use .drawer-validation-errors here. That class is
        hard-styled with color: #fecaca (light red) because it was built
        for the cart's rule-engine error list. On the green success
        banner, red bullets look broken. We use the
        .banner-content-list class (defined in index.css alongside this
        component) which inherits the banner's text color so success
        messages render in the right tone.
      */}
      {messages.length > 0 ? (
        <ul className="banner-content-list" style={{ marginTop: 8 }}>
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      {errors.length > 0 ? (
        <ul className="banner-content-list" style={{ marginTop: 8 }}>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {oos.length > 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            Out of stock at MLCC ({oos.length} item{oos.length === 1 ? "" : "s"}):
          </div>
          {/* OOS items DO use the red error class — they're real problems */}
          <ul className="drawer-validation-errors">
            {oos.map((item, i) => (
              <li key={i}>
                {item.productName ?? item.code ?? "Unknown item"}
                {item.quantity ? ` × ${item.quantity}` : ""}
                {item.reason ? ` — ${item.reason}` : ""}
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 6 }}>
            Remove these from your cart and re-validate to clear.
          </p>
        </>
      ) : null}
      {summary ? (
        <div style={{ marginTop: 12 }}>
          <div>
            <span className="muted">MLCC subtotal: </span>
            <strong>{money(Number(summary.grossTotal ?? 0))}</strong>
          </div>
          <div>
            <span className="muted">Net total: </span>
            <strong>{money(Number(summary.netTotal ?? 0))}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stage-by-stage progress panel rendered during a Validate or Submit RPA
 * run. Replaces the boring "Validating against MLCC…" banner with a
 * checkable stage list so the user can see what's in flight, what's
 * done, and what's coming.
 *
 * Each stage is one row with:
 *   - icon: ✓ (done) / ⏳ (active, pulsing) / ○ (pending)
 *   - label
 *
 * Headline at top of the panel shows the overall operation + the worker's
 * latest progress_message (if it added any color).
 *
 * Why this matters: when MLCC takes 60-90s to respond, an unchanging
 * banner feels frozen even when the system is working hard. Visible
 * progress = perceived speed. The actual time is unchanged.
 */
function RpaProgressPanel({
  headline,
  stages,
  currentStageIndex,
  preStage,
}: {
  headline: { title: string; sub?: string };
  stages: ReadonlyArray<{ id: string; label: string }>;
  currentStageIndex: number;
  /**
   * True when the run hasn't reached any RPA stage yet (we're still
   * syncing the cart to the server or waiting for the worker to claim).
   * In this state all stages render as pending and we show a sub-line
   * explaining the wait.
   */
  preStage: boolean;
}) {
  return (
    <div className="rpa-progress" role="status" aria-live="polite">
      <div className="rpa-progress__headline">
        <strong>{headline.title}</strong>
        {headline.sub ? (
          <div className="rpa-progress__sub muted small">{headline.sub}</div>
        ) : null}
      </div>
      <ol className="rpa-progress__list">
        {stages.map((stage, idx) => {
          const status: "done" | "active" | "pending" = preStage
            ? "pending"
            : currentStageIndex < 0
              ? "pending"
              : idx < currentStageIndex
                ? "done"
                : idx === currentStageIndex
                  ? "active"
                  : "pending";
          return (
            <li
              key={stage.id}
              className={`rpa-progress__step rpa-progress__step--${status}`}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="rpa-progress__icon" aria-hidden>
                {status === "done" ? "✓" : status === "active" ? "●" : "○"}
              </span>
              <span className="rpa-progress__label">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
