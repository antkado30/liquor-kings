/**
 * CartPage — Cart tab destination. Critical fix 2026-06-07.
 *
 * The old CartPage was a placeholder stub from way back ("Connect to
 * your store to submit orders") that never got finished — the real
 * cart UX lives in <CartDrawer> on the ScannerPage. Tony hit this
 * immediately when the bottom Cart tab routed to the stub instead of
 * the real cart.
 *
 * Fix: redirect to / with ?view=cart so the existing query-param
 * machinery in ScannerPage opens the cart drawer. Same pattern we
 * use for the Dashboard and AI Assistant overlays.
 *
 * Long-term, CartDrawer should probably be refactored into a real
 * page so the Cart tab is a destination not a redirect. Filing that
 * as a follow-up; for V1 the redirect is the pragmatic fix.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function CartPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/?view=cart", { replace: true });
  }, [navigate]);
  // Empty render while the redirect fires. User sees a flash of black
  // for a frame; not worth styling.
  return null;
}
