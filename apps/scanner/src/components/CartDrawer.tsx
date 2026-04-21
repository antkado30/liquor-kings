import { cartLineId, type CartContextValue } from "../hooks/useCart";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type CartDrawerProps = {
  cart: CartContextValue;
  onClose: () => void;
  onSubmit: () => void;
};

export function CartDrawer({ cart, onClose, onSubmit }: CartDrawerProps) {
  const { items, totalCost, clearCart, incrementQuantity, decrementQuantity, removeItem } = cart;

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Cart">
        <div className="drawer-header">
          <h2>Cart</h2>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close cart">
            ×
          </button>
        </div>

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
            <button type="button" className="btn primary btn-block" onClick={onSubmit}>
              Validate & Submit
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
