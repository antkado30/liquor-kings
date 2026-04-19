import type { CartContextValue } from "../hooks/useCart";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type CartDrawerProps = {
  cart: CartContextValue;
  onClose: () => void;
  onSubmit: () => void;
};

export function CartDrawer({ cart, onClose, onSubmit }: CartDrawerProps) {
  const { items, totalCost, clearCart, updateQuantity, removeItem } = cart;

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
              return (
                <li key={line.product.id} className="drawer-line">
                  <div className="drawer-line-main">
                    <div className="drawer-line-title">{line.product.name}</div>
                    <div className="muted small">{size}</div>
                    <div className="drawer-line-controls">
                      <input
                        className="drawer-qty"
                        type="number"
                        min={1}
                        max={99}
                        value={line.quantity}
                        onChange={(e) => {
                          const v = Number.parseInt(e.target.value, 10);
                          if (Number.isFinite(v)) updateQuantity(line.product.code, Math.min(99, Math.max(1, v)));
                        }}
                      />
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
