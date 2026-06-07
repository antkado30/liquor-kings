/**
 * Scheduled template banner (task #75, 2026-06-04 evening).
 *
 * Sits at the very top of the scanner home — above SmartCards — to
 * surface "your weekly order is ready to review" when an order
 * template's scheduler fired today and the user hasn't loaded it yet.
 *
 * Tap → loads the template into the cart → cart drawer opens so the
 * user can review/adjust/validate/submit through the existing flow.
 * The load endpoint marks the scheduled run consumed so the banner
 * auto-dismisses for the rest of the week.
 *
 * Empty state: no templates with needs_review = true → render nothing.
 * Multiple ready: show the most recently scheduled one. (Two templates
 * scheduled for the same day is a corner case we surface as "+ N more"
 * with a sub-link to the picker.)
 */
import { useEffect, useState } from "react";
import {
  listOrderTemplates,
  loadOrderTemplate,
  type OrderTemplate,
} from "../api/orderTemplates";
import type { CartContextValue } from "../hooks/useCart";

export function ScheduledTemplateBanner({
  cart,
  onLoaded,
}: {
  cart: CartContextValue;
  /** Called after a successful load so parent can open the cart drawer. */
  onLoaded?: (templateName: string) => void;
}) {
  const [ready, setReady] = useState<OrderTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch once on mount. We deliberately don't poll — the banner is a
  // "what's waiting for me today" view, not a real-time feed. A user
  // who triggers a refresh (pull-down) will pick up changes.
  useEffect(() => {
    let cancelled = false;
    void listOrderTemplates().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setReady(r.data.filter((t) => t.needs_review));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (ready.length === 0) return null;

  // Show the first (the API sorts by last_loaded_at + updated_at desc,
  // so the most-recently-touched scheduled template lands at the top).
  const head = ready[0];
  const extraCount = ready.length - 1;

  const handleLoad = async () => {
    setLoading(true);
    setError(null);
    const r = await loadOrderTemplate(head.id);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    for (const it of r.data.items) {
      cart.addItem(it.product, it.quantity);
    }
    // Drop from local ready list so the banner clears immediately,
    // even though the server already marked it consumed.
    setReady((cur) => cur.filter((t) => t.id !== head.id));
    if (onLoaded) onLoaded(r.data.template.name);
  };

  return (
    <div
      style={{
        margin: "12px 0",
        padding: "14px 16px",
        background:
          "linear-gradient(135deg, rgba(108,99,255,0.18), rgba(34,197,94,0.10))",
        border: "1px solid rgba(108,99,255,0.32)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22 }}>📋</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Your {head.name} is ready to review
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {head.items.length} item{head.items.length === 1 ? "" : "s"} —
            load into cart and adjust before validating
          </div>
        </div>
      </div>
      <button
        type="button"
        className="btn primary"
        onClick={() => void handleLoad()}
        disabled={loading}
        style={{ width: "100%" }}
      >
        {loading ? "Loading…" : `Load ${head.name} into cart`}
      </button>
      {extraCount > 0 ? (
        <div className="muted small" style={{ textAlign: "center" }}>
          + {extraCount} other template{extraCount === 1 ? "" : "s"} ready
          — open the cart drawer to pick.
        </div>
      ) : null}
      {error ? (
        <div
          className="muted small"
          style={{ textAlign: "center", color: "#fca5a5" }}
        >
          Couldn&apos;t load: {error}
        </div>
      ) : null}
    </div>
  );
}
