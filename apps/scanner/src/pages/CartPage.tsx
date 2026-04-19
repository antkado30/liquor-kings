import { useNavigate } from "react-router-dom";
import { useCart } from "../hooks/useCart";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function CartPage() {
  const cart = useCart();
  const navigate = useNavigate();

  return (
    <div className="page cart-page">
      <header className="top-bar">
        <button type="button" className="btn text back-link" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h1 className="top-bar-title">Cart</h1>
      </header>

      {cart.items.length === 0 ? (
        <p className="muted center">Your cart is empty.</p>
      ) : (
        <ul className="cart-review-list">
          {cart.items.map((line) => {
            const unit = line.product.licensee_price ?? 0;
            const lineTotal = unit * line.quantity;
            const size = line.product.bottle_size_label ?? `${line.product.bottle_size_ml ?? ""} ML`;
            return (
              <li key={line.product.id} className="cart-review-line">
                <div>
                  <div className="cart-review-name">{line.product.name}</div>
                  <div className="muted small">
                    {size} · Qty {line.quantity}
                  </div>
                </div>
                <div className="cart-review-price">{money(lineTotal)}</div>
              </li>
            );
          })}
        </ul>
      )}

      {cart.items.length > 0 ? (
        <div className="cart-review-total">
          <span>Total</span>
          <strong>{money(cart.totalCost)}</strong>
        </div>
      ) : null}

      <button type="button" className="btn primary btn-block" disabled={cart.items.length === 0}>
        Connect to your store to submit orders
      </button>
      <p className="muted small center" style={{ marginTop: 12 }}>
        Full submit flow is coming in a later release.
      </p>
    </div>
  );
}
