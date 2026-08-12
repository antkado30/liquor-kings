import { useCartOrNull } from "../hooks/useCart";

/**
 * The add-guard's confirm dialog (#29 UI wiring, 2026-08-10).
 *
 * Rendered ONCE at the app root, inside CartProvider. Shows whenever a
 * guarded add trips (duplicate line and/or big line — lib/add-guard
 * writes the plain-words question). Confirm performs the add exactly
 * as asked; Cancel drops it and the cart is untouched.
 *
 * Born from Tony's 8/4 ask ("i forgot i already added 3 fifths of
 * jack and press add 3 more — a little popup should say are you
 * sure") and the 150-unit / $3,349.50 party-bucket line that rode a
 * real order unnoticed on 8/5.
 */
export function AddGuardDialog() {
  const cart = useCartOrNull();
  const pending = cart?.pendingAdd ?? null;
  if (!cart || !pending) return null;

  const title =
    pending.verdict.kind === "big_line" ? "Big line — you sure?" : "Already in your cart";

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm cart add"
      onClick={cart.cancelPendingAdd}
    >
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-title">{title}</h2>
        <p className="confirm-body">{pending.verdict.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn secondary" onClick={cart.cancelPendingAdd}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={cart.confirmPendingAdd}
            autoFocus
          >
            Yes, add {pending.quantity}
          </button>
        </div>
      </div>
    </div>
  );
}
