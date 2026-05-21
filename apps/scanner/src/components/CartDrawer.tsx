import { useEffect, useMemo, useRef, useState } from "react";
import { validateCart, type CartValidationResult } from "../api/cart";
import { cartLineId, type CartContextValue } from "../hooks/useCart";
import { useSubmission } from "../hooks/useSubmission";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

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
  const { state, start, reset } = submission;
  const isBusy = state.kind === "syncing" || state.kind === "submitting" || state.kind === "polling";
  const [isCheckingValidation, setIsCheckingValidation] = useState(false);
  const [validationResult, setValidationResult] = useState<CartValidationResult | null>(null);
  const validationRequestRef = useRef(0);

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

  const hasDefinitiveValidationFailure =
    validationResult?.ok === true && validationResult.valid === false;
  const submitDisabled = isBusy || hasDefinitiveValidationFailure;

  // Cart-wide blockers shown above the submit button. Per-line split-case
  // errors are NOT listed here — they render inline on their cart line
  // (with tap-to-fix chips) below. ADA_-prefixed errors are skipped here
  // too; the adaBreakdown loop produces a cleaner message for those.
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

  /** Split-case / quantity error for a specific cart line, if any. */
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
    void start(items);
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

        {state.kind === "idle" ? (
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
                                      disabled={atMin}
                                      onClick={() => decrementQuantity(lineId)}
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
                                      onClick={() => incrementQuantity(lineId)}
                                    >
                                      +
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn text danger"
                                    onClick={() => removeItem(line.product.code)}
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
                                            onClick={() => updateQuantity(line.product.code, alt)}
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

            {items.length > 0 ? (
              <>
                {validationResult?.ok === false ? (
                  <p className="drawer-validation-notice muted">
                    Couldn&apos;t verify this cart right now ({validationResult.error}). You can still submit.
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
                <button type="button" className="btn secondary btn-block" onClick={() => clearCart()}>
                  Clear cart
                </button>
                <button
                  type="button"
                  className="btn primary btn-block"
                  disabled={submitDisabled}
                  onClick={() => {
                    void start(items);
                  }}
                >
                  {isCheckingValidation ? "Checking..." : "Validate & Submit"}
                </button>
              </>
            ) : null}
          </>
        ) : null}

        {state.kind === "syncing" ? (
          <div className="banner">
            Syncing item {state.itemsSynced} of {state.itemsTotal}...
          </div>
        ) : null}

        {state.kind === "submitting" ? (
          <div className="banner">Triggering MILO order pipeline...</div>
        ) : null}

        {state.kind === "polling" ? (
          <div className="banner">
            {state.progressStage || state.progressMessage ? (
              <>
                {state.progressStage ? <strong>{state.progressStage}</strong> : null}
                {state.progressMessage ? <div>{state.progressMessage}</div> : null}
              </>
            ) : (
              <>Working on your order... (status: {state.status})</>
            )}
          </div>
        ) : null}

        {state.kind === "done" && state.finalStatus === "succeeded" ? (
          <>
            <div className="banner banner-ok">
              Cart validated and ready in MILO. Order is in dry_run mode — no real order placed yet.
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

        {state.kind === "done" && state.finalStatus !== "succeeded" ? (
          <>
            <div className="banner banner-warn">
              Run finished as {state.finalStatus}.{" "}
              {state.progressMessage ??
                (state.failureType ? `Failure type: ${state.failureType}` : "No further details were provided.")}
            </div>
            <button type="button" className="btn secondary btn-block" onClick={handleRetry}>
              Try again
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
              Try again
            </button>
            <button type="button" className="btn btn-block" onClick={onClose}>
              Close
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
