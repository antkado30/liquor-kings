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
  const { items, totalCost, clearCart, incrementQuantity, decrementQuantity, removeItem } = cart;
  const submission = useSubmission();
  const { state, start, reset } = submission;
  const isBusy = state.kind === "syncing" || state.kind === "submitting" || state.kind === "polling";

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
              <ul className="drawer-list">
                {items.map((line) => {
                  const unit = line.product.licensee_price ?? 0;
                  const lineTotal = unit * line.quantity;
                  const size = line.product.bottle_size_label ?? `${line.product.bottle_size_ml ?? ""} ML`;
                  const lineId = cartLineId(line.product);
                  const atMin = line.quantity <= 1;
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
                      </div>
                      <div className="drawer-line-total">{money(lineTotal)}</div>
                    </li>
                  );
                })}
              </ul>
            )}

            {items.length > 0 ? (
              <>
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
                  onClick={() => {
                    void start(items);
                  }}
                >
                  Validate & Submit
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
