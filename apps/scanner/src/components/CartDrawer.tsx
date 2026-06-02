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
import {
  generateValidQuantities,
  getOrderingRuleDisplay,
} from "../lib/mlcc-ordering-rules";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/**
 * Compute "inferred OOS" — cart items the user added that did NOT show up
 * in MILO's ada_breakdown active items. Almost always means MILO demoted
 * them to its OOS section even though Stage 3 thought it added them.
 *
 * Used in two places:
 *   1. ValidateResultPanel — renders the list of likely-OOS items.
 *   2. CartDrawer parent — gates Submit on inferredOos.length === 0
 *      (otherwise we'd surface "MLCC says ready for checkout" + a list
 *      of OOS items in the same banner, which is incoherent).
 *
 * Until the real Stage 3/4 OOS detection ships (task #53), this is the
 * single source of truth for "are there OOS items?"
 */
function computeInferredOos(
  cartItems: CartContextValue["items"],
  result: import("../api/execution").ValidateResult | null,
): CartContextValue["items"] {
  if (!result) return [];
  const adaBreakdown = Array.isArray(result.ada_breakdown) ? result.ada_breakdown : [];
  const adaActiveCodes = new Set<string>();
  for (const ada of adaBreakdown) {
    const items = Array.isArray((ada as { items?: unknown[] }).items)
      ? ((ada as { items: unknown[] }).items as unknown[])
      : [];
    for (const it of items) {
      const code = (it as { code?: unknown })?.code;
      if (typeof code === "string" && code) adaActiveCodes.add(code);
    }
  }
  /*
    Exclude items already in items_rejected (2026-06-01 fix for #61).
    Tony's Tito's 750ml false-OOS flake: Stage 3 timed out waiting for
    MILO's quick-add list to render → reported the item in
    items_rejected ("did not appear in quick add list"). Without this
    filter, the item ALSO appeared in inferredOos with the misleading
    "out of stock" label. Real cause is a Stage 3 timeout, not stock.
    The rejected list now owns the user-facing message for those rows.
  */
  const rejectedCodes = new Set<string>();
  const rejectedList = Array.isArray(result.items_rejected)
    ? result.items_rejected
    : [];
  for (const it of rejectedList) {
    const code = (it as { code?: unknown })?.code;
    if (typeof code === "string" && code) rejectedCodes.add(code);
  }
  return cartItems.filter(
    (line) =>
      !adaActiveCodes.has(line.product.code) &&
      !rejectedCodes.has(line.product.code),
  );
}

/*
  Recognize Stage 3 timeout rejections so the UI shows a recoverable
  "try re-validate" message instead of the hard "MLCC rejected this"
  language we use for genuine rule violations. The reason string is
  produced by add-items-to-cart.js (services/api/src/rpa/stages/) and
  is stable enough to pattern-match.
*/
function isStage3TimeoutRejection(reason: unknown): boolean {
  if (typeof reason !== "string") return false;
  return /quick add list|did not appear/i.test(reason);
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
  /**
   * Optional callback fired when the user taps a cart line's product
   * name (task #51, 2026-05-30 — Amazon-style sibling browsing). The
   * scanner page handles opening the ProductCard for that bottle's
   * family so the user can swap sizes / see other SKUs in the same
   * brand without re-scanning. If omitted, the line title is not
   * tappable and the drawer behaves the same as before.
   */
  onLineProductClick?: (product: import("../types").MlccProduct) => void;
};

export function CartDrawer({ cart, onClose, onLineProductClick }: CartDrawerProps) {
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

  // Inferred OOS for the current validate result. Empty when not in
  // validateDone state, or when MILO showed all cart items as active.
  // Used to gate Submit so we never offer "submit a cart that has
  // likely-OOS items in it".
  const inferredOos =
    state.kind === "validateDone"
      ? computeInferredOos(items, state.validateResult)
      : [];

  // Has MLCC actually said this cart is OK? Only true when the last
  // validate ended succeeded AND MILO said canCheckout=true AND we
  // didn't infer any OOS items. The inferredOos gate prevents the
  // 2026-05-30 bug where MILO would return canCheckout=true for the
  // items it DID accept while silently dropping the OOS row — leaving
  // the user with a "ready for checkout" green banner that hid the
  // problem.
  const mlccValidatePassed =
    state.kind === "validateDone" &&
    state.finalStatus === "succeeded" &&
    state.validateResult?.can_checkout === true &&
    inferredOos.length === 0;

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
                          // Hoisted out of the qty-controls IIFE below so
                          // atMin can use it too. lineSmallestValid is what
                          // the `−` button bottoms out at (user must use
                          // trash icon to remove past that).
                          const lineRule = getOrderingRuleDisplay({
                            code: line.product.code,
                            bottle_size_ml: line.product.bottle_size_ml,
                            case_size: line.product.case_size,
                            ada_name: line.product.ada_name,
                          });
                          const lineValid = generateValidQuantities(lineRule);
                          const lineConstrained = lineValid.length > 0;
                          const lineSmallestValid = lineConstrained ? lineValid[0] : 1;
                          const atMin = line.quantity <= lineSmallestValid;
                          const lineError = lineErrorFor(line.product.code);
                          const suggestions = lineError?.suggestedAlternatives ?? [];
                          return (
                            <li key={lineId} className="drawer-line">
                              <div className="drawer-line-main">
                                {/*
                                  Title is tappable IF onLineProductClick is wired
                                  (task #51, 2026-05-30). Opens the ProductCard for
                                  this bottle's family — Amazon-style sibling
                                  browsing without re-scanning. Disabled during
                                  busy states so a tap mid-validate doesn't open
                                  a new modal layer over the progress UI.
                                */}
                                {onLineProductClick ? (
                                  <button
                                    type="button"
                                    className="drawer-line-title drawer-line-title--tappable"
                                    onClick={() => onLineProductClick(line.product)}
                                    disabled={isBusy}
                                  >
                                    {line.product.name}
                                  </button>
                                ) : (
                                  <div className="drawer-line-title">{line.product.name}</div>
                                )}
                                <div className="muted small">{size}</div>
                                <div className="drawer-line-controls">
                                  {/*
                                    Cart-line quantity controls (2026-05-31
                                    fix for #45). +/− snap to valid MLCC
                                    quantities via useCart's stepLineQuantity
                                    helper; tapping the qty number opens a
                                    native dropdown of all valid amounts so
                                    the user can jump to 240 without 20 taps.
                                  */}
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
                                    {lineConstrained ? (
                                      <div className="qty-picker-wrap qty-picker-wrap--cart" aria-live="polite">
                                        <span className="qty-picker-display">{line.quantity}</span>
                                        <select
                                          className="qty-picker-select"
                                          value={line.quantity}
                                          disabled={isBusy}
                                          onChange={(e) =>
                                            handleUpdateQuantity(
                                              line.product.code,
                                              Number(e.target.value),
                                            )
                                          }
                                          aria-label="Quantity (tap to choose from valid amounts)"
                                        >
                                          {/*
                                            Include the line's current qty as
                                            a "(not valid)" option if it's
                                            not in the valid list (e.g. a
                                            cart saved before this shipped).
                                            Lets the user see what they have
                                            without the select silently
                                            snapping to a different value.
                                          */}
                                          {!lineValid.includes(line.quantity) ? (
                                            <option value={line.quantity}>
                                              {line.quantity} (not valid)
                                            </option>
                                          ) : null}
                                          {lineValid.map((q) => (
                                            <option key={q} value={q}>
                                              {q} bottles
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : (
                                      <span className="qty-stepper__value" aria-live="polite">
                                        {line.quantity}
                                      </span>
                                    )}
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
                                  {/*
                                    Clean trash icon (task #52, 2026-05-30).
                                    Was: full-width red oval next to qty stepper that looked
                                    like an alarm button. Now: square icon button on the right
                                    edge with aria-label for screen readers + title tooltip.
                                  */}
                                  <button
                                    type="button"
                                    className="cart-line-remove-btn"
                                    disabled={isBusy}
                                    onClick={() => handleRemove(line.product.code)}
                                    aria-label={`Remove ${line.product.name} from cart`}
                                    title="Remove from cart"
                                  >
                                    <span aria-hidden>🗑️</span>
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
          <ValidateResultPanel
            result={state.validateResult}
            /*
              canCheckout for the BANNER is the AND of MILO's flag and
              our inferred-OOS check. When inferredOos is non-empty we
              want the warn-yellow banner + "review issues below"
              headline, not the green "ready for checkout" lie.
            */
            canCheckout={
              (state.validateResult?.can_checkout ?? null) === true &&
              inferredOos.length === 0
            }
            cartItems={items}
          />
        ) : null}

        {state.kind === "validateDone" && state.finalStatus !== "succeeded" ? (
          <div className="banner banner-warn">
            MLCC validate finished as <strong>{state.finalStatus}</strong>. Review the cart and try again.
          </div>
        ) : null}

        {/* ─── Action buttons (idle / validateDone) ───────────────────────── */}
        {(state.kind === "idle" || state.kind === "validateDone") && items.length > 0 ? (
          <>
            {/*
              "Clear scanner cart" — clears LOCAL + LK server cart only.
              MILO's actual cart state lives in their session and won't
              empty until the next validate/submit run (Stage 3's auto-
              clear-cart pre-flight, task #9). The caption below tells
              the user this honestly. Bug found 2026-05-30: Tony hit
              "Clear cart" and MLCC still showed Tito's + Ciroc on the
              website — because we'd only ever cleared the scanner side.
              True MILO clear is task #56 (deferred — it costs an RPA
              run and most users don't actually need it between orders).
            */}
            <button type="button" className="btn secondary btn-block" disabled={isBusy} onClick={handleClearCart}>
              Clear scanner cart
            </button>
            <p className="muted small" style={{ marginTop: 4, marginBottom: 8, textAlign: "center" }}>
              MLCC&apos;s cart resets automatically on your next validate.
            </p>
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
 *
 * Iteration 2 (2026-05-30): Tony found that MILO's actual OOS-section
 * items weren't being surfaced — Stage 3 incorrectly verifies them as
 * "added", Stage 4 doesn't populate out_of_stock_items, and the user
 * just saw a yellow banner with no explanation. Fix:
 *
 *   (a) Surface ada_breakdown.errors — MILO's actual error messages
 *       per ADA ("You must order at least nine liters from this
 *       distributor"). The most informative field we have.
 *   (b) Compute "inferred OOS" by diffing the user's local cart against
 *       ada_breakdown items. Anything the user added but MILO's active
 *       orders don't show is almost certainly in MILO's OOS section.
 *   (c) Show per-ADA progress against the 9L minimum so user can see
 *       which distributor is under.
 *
 * (b) is a stopgap until the proper Stage 3/4 OOS detection ships — but
 * it works with the data we already have.
 */
function ValidateResultPanel({
  result,
  canCheckout,
  cartItems,
}: {
  result: import("../api/execution").ValidateResult | null;
  canCheckout: boolean | null;
  cartItems: CartContextValue["items"];
}) {
  if (!result) {
    return (
      <div className="banner banner-warn">
        MLCC validate finished but no result data was returned. Re-validate to retry.
      </div>
    );
  }
  const oos = Array.isArray(result.out_of_stock_items) ? result.out_of_stock_items : [];
  const rejected = Array.isArray(result.items_rejected) ? result.items_rejected : [];
  const messages = Array.isArray(result.validate_messages) ? result.validate_messages : [];
  const errors = Array.isArray(result.validate_errors) ? result.validate_errors : [];
  const summary = result.order_summary ?? null;
  const adaBreakdown = Array.isArray(result.ada_breakdown) ? result.ada_breakdown : [];

  // Collect every error string MILO reported per ADA. These are the
  // human-readable messages MILO itself shows (e.g. "You must order at
  // least nine liters from this distributor"). De-duped.
  const milccErrors = new Set<string>();
  for (const ada of adaBreakdown) {
    const adaErrors = Array.isArray((ada as { errors?: unknown[] }).errors)
      ? ((ada as { errors: unknown[] }).errors as unknown[])
      : [];
    for (const e of adaErrors) {
      const s = typeof e === "string" ? e.trim() : "";
      // Filter junk: pure numbers, single chars (MILO sometimes echoes
      // the liter count alongside the message).
      if (s.length > 3 && !/^\d+(\.\d+)?$/.test(s)) milccErrors.add(s);
    }
  }
  const milccErrorList = [...milccErrors];

  // Inferred OOS — uses the shared helper so the panel and the parent
  // CartDrawer see the same list (parent uses it to gate Submit; we
  // use it here to render the "Likely out of stock" block).
  const inferredOos = computeInferredOos(cartItems, result);

  // Per-ADA liter progress (only shown when at least one ADA is under).
  const adaProgress = adaBreakdown
    .filter((ada) => (ada as { meetsMinimum?: boolean }).meetsMinimum === false)
    .map((ada) => {
      const a = ada as {
        adaName?: string;
        adaNumber?: string;
        subtotalLiters?: number;
        meetsMinimum?: boolean;
      };
      return {
        name: a.adaName ?? `ADA ${a.adaNumber ?? "?"}`,
        liters: typeof a.subtotalLiters === "number" ? a.subtotalLiters : 0,
        shortBy: Math.max(0, 9 - (typeof a.subtotalLiters === "number" ? a.subtotalLiters : 0)),
      };
    });

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
      {/*
        Items REJECTED by MLCC during Stage 3 add-to-cart. Different from
        OOS: MILO actively refused to add these (validation rule violation,
        unknown code, MILO-side error, etc.). Without this list the user
        sees a yellow 'review issues below' banner but no explanation of
        what's wrong. Added 2026-05-30 to close that UX gap.
      */}
      {rejected.length > 0 ? (
        <>
          {/*
            Split the rejected list into "timed out" vs "hard rejected"
            (2026-06-01 fix for #61). Tony's Tito's 750ml flake was
            ALWAYS a Stage 3 timeout — MILO was slow rendering the
            quick-add row, we gave up after 8s, the line ended up in
            items_rejected with a misleading "did not appear" reason.
            Treating that as a hard rejection scares the user; treating
            it as a transient flake lets them re-validate and move on.
            The 8s wait was bumped to 18s in the worker too — this UI
            split is the user-facing complement.
          */}
          {(() => {
            const rejectedTyped = rejected as Array<{
              code?: string;
              productName?: string;
              quantity?: number;
              reason?: string;
            }>;
            const timedOut = rejectedTyped.filter((r) =>
              isStage3TimeoutRejection(r.reason),
            );
            const hard = rejectedTyped.filter(
              (r) => !isStage3TimeoutRejection(r.reason),
            );
            return (
              <>
                {timedOut.length > 0 ? (
                  <>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>
                      MLCC didn&apos;t finish adding ({timedOut.length} item
                      {timedOut.length === 1 ? "" : "s"}):
                    </div>
                    <ul className="banner-content-list">
                      {timedOut.map((it, i) => (
                        <li key={`to-${i}`}>
                          {it.productName ?? it.code ?? "Unknown item"}
                          {it.quantity ? ` × ${it.quantity}` : ""}
                        </li>
                      ))}
                    </ul>
                    <p className="muted small" style={{ marginTop: 6 }}>
                      MLCC was slow responding for these. Tap{" "}
                      <strong>Re-validate against MLCC</strong> — it usually
                      goes through the second time.
                    </p>
                  </>
                ) : null}
                {hard.length > 0 ? (
                  <>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>
                      Rejected by MLCC ({hard.length} item
                      {hard.length === 1 ? "" : "s"}):
                    </div>
                    <ul className="drawer-validation-errors">
                      {hard.map((it, i) => (
                        <li key={`h-${i}`}>
                          {it.productName ?? it.code ?? "Unknown item"}
                          {it.quantity ? ` × ${it.quantity}` : ""}
                          {it.reason ? ` — ${it.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                    <p className="muted small" style={{ marginTop: 6 }}>
                      Remove these from your cart and re-validate to clear.
                    </p>
                  </>
                ) : null}
              </>
            );
          })()}
        </>
      ) : null}
      {/*
        Inferred OOS: items the user added that MILO's active orders don't
        show. Almost always means MILO put them in its own OOS section
        even though Stage 3 thought it added them. Stopgap until Stage
        3/4 OOS detection ships properly — but works with what we have.
      */}
      {inferredOos.length > 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            Likely out of stock at MLCC ({inferredOos.length} item{inferredOos.length === 1 ? "" : "s"}):
          </div>
          <ul className="drawer-validation-errors">
            {inferredOos.map((line) => (
              <li key={cartLineId(line.product)}>
                {line.product.name}
                {line.quantity ? ` × ${line.quantity}` : ""}
                {line.product.bottle_size_label
                  ? ` (${line.product.bottle_size_label})`
                  : ""}
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 6 }}>
            MLCC accepted the order but didn&apos;t show these on the cart —
            usually means they&apos;re in MLCC&apos;s out-of-stock section. Remove
            them and re-validate.
          </p>
        </>
      ) : null}
      {/*
        Per-ADA progress for under-minimum cases. Shows distributor by
        name, current liters, and how many more they need. This is what
        the user actually needs to act on — "NWS Michigan needs 6.00 L
        more" is concrete; "ADA breakdown is short" is not.
      */}
      {adaProgress.length > 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            Distributors below 9 L minimum:
          </div>
          <ul className="banner-content-list">
            {adaProgress.map((ada) => (
              <li key={ada.name}>
                <strong>{ada.name}</strong>: {ada.liters.toFixed(2)} L / 9.00 L
                {" — needs "}
                <strong>{ada.shortBy.toFixed(2)} L</strong> more
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {/*
        Generic MILO error strings from ada_breakdown.errors. Only render
        if we haven't already covered them with the more-structured blocks
        above. (The 9L minimum message is implicit in adaProgress, so we
        hide it when adaProgress is non-empty.)
      */}
      {milccErrorList.length > 0 && adaProgress.length === 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            MLCC reported:
          </div>
          <ul className="banner-content-list">
            {milccErrorList.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
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
