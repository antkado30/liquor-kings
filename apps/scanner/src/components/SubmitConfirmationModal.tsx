/**
 * SubmitConfirmationModal — pre-submit verification card (task #89, 2026-06-07).
 *
 * This is discipline #3 (pre-commit verification) of the LK Integrity
 * Doctrine in action. Tony set the rule on 2026-06-06: NO OPT-OUT,
 * EVER. Every user, every order, sees this card. Even at order #1,000.
 *
 * Why this isn't just an "are you sure?" yes/no:
 *
 * The yes/no popup adds a tap but doesn't catch integrity bugs — it
 * trusts that whatever the system thinks is in the cart actually IS
 * in the cart. The full line-by-line summary catches the bugs that
 * keep Tony up at night: wrong UPC mapping, phantom cart from a
 * background pre-validate, vision picker picking the wrong bottle,
 * stale template loading a discontinued code. If our display is
 * wrong, the user sees it in their own language and stops. If our
 * display is right, we have their explicit per-line confirmation.
 *
 * What it kills (integrity surfaces from the doctrine):
 *   #1 UPC mapping wrong   → user sees Tito's when they scanned Tito's,
 *                            catches it when name says Jack Daniels instead
 *   #4 phantom cart        → user sees the actual final cart, not their
 *                            mental model of an earlier cart state
 *   #5 vision wrong bottle → user sees what's about to ship, by name
 *
 * What it can't catch (and that's fine — other layers cover):
 *   #2 Stage 3 substitution at MILO    → covered by post-submit delta-check
 *   #6 catalog data wrong (data quality) → covered by data trust layer
 *   #8 MILO confirmation mismatch       → covered by post-submit delta-check
 */
import type { CartItem } from "../types";

type Props = {
  /** Cart lines the user is about to submit. */
  items: CartItem[];
  /** Subtotal (sum of licensee_price × quantity). */
  subtotal: number;
  /**
   * Live order summary from the most recent successful validate run.
   * When present, we show MLCC's real grossTotal / liquorTax / netTotal
   * — those are the numbers MILO will charge against. When null, we
   * fall back to our locally-computed subtotal only, with a small note
   * that tax is calculated by MILO at submit.
   */
  orderSummary: {
    grossTotal?: number;
    liquorTax?: number;
    discount?: number;
    netTotal?: number;
  } | null;
  /**
   * Store name to display at the top of the card. Helps catch "wrong
   * store" mistakes for users belonging to multiple stores (rare today,
   * common in V2). Pulled from /home/smart-cards store_meta.
   */
  storeName: string | null;
  /** Liquor license # — paired with store name. */
  storeLicense: string | null;
  /** User confirmed — fire the actual submit. */
  onConfirm: () => void;
  /** User backed out — keep the cart open for edits. */
  onCancel: () => void;
};

export function SubmitConfirmationModal({
  items,
  subtotal,
  orderSummary,
  storeName,
  storeLicense,
  onConfirm,
  onCancel,
}: Props) {
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  // Prefer MLCC's authoritative totals when we have them — those are
  // what MILO will charge. Fall back to our local subtotal only.
  const displayTotal =
    orderSummary?.netTotal ??
    orderSummary?.grossTotal ??
    subtotal;
  const milccTax = orderSummary?.liquorTax ?? null;
  const milccGross = orderSummary?.grossTotal ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm order before sending to MILO"
      style={backdropStyle}
      onClick={onCancel}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        {/* ─── Store header — catches "wrong store" mistakes ─── */}
        <div style={storeHeaderStyle}>
          <div style={storeLabelStyle}>Sending to MILO for</div>
          <div style={storeNameStyle}>
            {storeName ?? "Your store"}
          </div>
          {storeLicense ? (
            <div style={storeLicenseStyle}>License #{storeLicense}</div>
          ) : null}
        </div>

        {/* ─── Line items — the actual integrity check ─── */}
        <div style={linesScrollStyle}>
          {items.length === 0 ? (
            <div style={emptyStyle}>Your cart is empty.</div>
          ) : (
            items.map((line) => {
              const lineTotal =
                (line.product.licensee_price ?? 0) * line.quantity;
              return (
                <div key={line.product.code} style={lineRowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={lineNameStyle}>{line.product.name}</div>
                    <div style={lineMetaStyle}>
                      {line.product.bottle_size_label ?? "—"} · Code{" "}
                      {line.product.code} · ADA {line.product.ada_number}
                    </div>
                  </div>
                  <div style={lineQtyStyle}>
                    <div style={lineQtyNumStyle}>
                      {line.quantity}
                      <span style={lineQtyXStyle}> ×</span>
                    </div>
                    <div style={lineUnitPriceStyle}>
                      {money(line.product.licensee_price)} ea
                    </div>
                    <div style={lineTotalStyle}>{money(lineTotal)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ─── Totals ─── */}
        <div style={totalsStyle}>
          <div style={totalRowStyle}>
            <span style={totalLabelStyle}>
              {totalQty} bottle{totalQty === 1 ? "" : "s"} ·{" "}
              {items.length} line{items.length === 1 ? "" : "s"}
            </span>
          </div>
          {milccGross != null ? (
            <div style={totalRowStyle}>
              <span style={totalLabelStyle}>Subtotal</span>
              <span style={totalValueStyle}>{money(milccGross)}</span>
            </div>
          ) : (
            <div style={totalRowStyle}>
              <span style={totalLabelStyle}>Subtotal (estimated)</span>
              <span style={totalValueStyle}>{money(subtotal)}</span>
            </div>
          )}
          {milccTax != null ? (
            <div style={totalRowStyle}>
              <span style={totalLabelStyle}>MLCC liquor tax</span>
              <span style={totalValueStyle}>{money(milccTax)}</span>
            </div>
          ) : null}
          <div style={totalRowFinalStyle}>
            <span style={totalLabelFinalStyle}>Total</span>
            <span style={totalValueFinalStyle}>{money(displayTotal)}</span>
          </div>
        </div>

        {/* ─── Final warning — this is a destructive action ─── */}
        <div style={warningStyle}>
          This goes to MILO immediately and can&apos;t be unsent.
        </div>

        {/* ─── Actions ─── */}
        <div style={actionsStyle}>
          <button
            type="button"
            onClick={onCancel}
            style={cancelBtnStyle}
            autoFocus
          >
            Cancel, keep editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={confirmBtnStyle}
          >
            Confirm &amp; send to MILO
          </button>
        </div>
      </div>
    </div>
  );
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/* ─── Styles ──────────────────────────────────────────────────────────── */

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(6, 8, 12, 0.85)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 200,
  padding: 0,
};

const cardStyle: React.CSSProperties = {
  background: "#11141b",
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  borderBottom: "none",
  border: "1px solid rgba(255,255,255,0.08)",
  width: "100%",
  maxWidth: 520,
  maxHeight: "92vh",
  display: "flex",
  flexDirection: "column",
  color: "#fff",
  boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
};

const storeHeaderStyle: React.CSSProperties = {
  padding: "22px 22px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const storeLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.5)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
  fontWeight: 600,
};

const storeNameStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1.2,
};

const storeLicenseStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.55)",
  marginTop: 2,
  fontVariantNumeric: "tabular-nums",
};

const linesScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 22px",
};

const emptyStyle: React.CSSProperties = {
  padding: "20px 0",
  textAlign: "center",
  color: "rgba(255,255,255,0.55)",
};

const lineRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  padding: "12px 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const lineNameStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1.3,
};

const lineMetaStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.5)",
  marginTop: 2,
  fontVariantNumeric: "tabular-nums",
};

const lineQtyStyle: React.CSSProperties = {
  textAlign: "right",
  minWidth: 92,
};

const lineQtyNumStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  fontVariantNumeric: "tabular-nums",
};

const lineQtyXStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  opacity: 0.6,
};

const lineUnitPriceStyle: React.CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.5)",
  marginTop: 2,
  fontVariantNumeric: "tabular-nums",
};

const lineTotalStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  marginTop: 4,
  fontVariantNumeric: "tabular-nums",
};

const totalsStyle: React.CSSProperties = {
  padding: "16px 22px",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
};

const totalRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "3px 0",
  fontSize: 14,
};

const totalLabelStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.65)",
};

const totalValueStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.85)",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

const totalRowFinalStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  paddingTop: 10,
  marginTop: 6,
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

const totalLabelFinalStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
};

const totalValueFinalStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  fontVariantNumeric: "tabular-nums",
};

const warningStyle: React.CSSProperties = {
  padding: "10px 22px",
  fontSize: 12,
  color: "#fda4af",
  background: "rgba(244, 63, 94, 0.06)",
  borderTop: "1px solid rgba(244, 63, 94, 0.15)",
  borderBottom: "1px solid rgba(244, 63, 94, 0.15)",
  textAlign: "center",
  fontWeight: 600,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  padding: "16px 22px 22px",
  paddingBottom: "max(22px, env(safe-area-inset-bottom))",
};

const cancelBtnStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 12,
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  padding: "14px 12px",
  cursor: "pointer",
};

const confirmBtnStyle: React.CSSProperties = {
  flex: 1.4,
  background: "#3a82f7",
  border: "none",
  borderRadius: 12,
  color: "#fff",
  fontSize: 15,
  fontWeight: 800,
  padding: "14px 12px",
  cursor: "pointer",
};
