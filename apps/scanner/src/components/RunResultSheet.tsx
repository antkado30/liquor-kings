/**
 * RunResultSheet — surfaces what MILO actually found after a non-blocking
 * "Check Order" / "Place Order" run (2026-06-26).
 *
 * The old ValidateResultPanel showed in-stock / out-of-stock / totals inside
 * the cart drawer; after the async pivot (P1b) the drawer closes immediately
 * and the OrderStatusPill only showed practice/placed/failed — dropping the
 * OOS items and totals. This sheet restores that detail, rendered purely
 * from the run's validate_result (already fetched by useActiveOrder's poll —
 * no extra request, no cart dependency).
 *
 * Self-contained: inline-styled bottom-sheet mirroring SubmitConfirmationModal,
 * inline-SVG icons only (no emoji). Everything is null-guarded — validateResult
 * may be null briefly or on runs that never produced one.
 */
import type { ActiveOrderResult } from "../hooks/useActiveOrder";
import type { RunMode } from "../api/execution";
import { useCartItemsOrEmpty } from "../hooks/useCart";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import { oosDisplayLabel } from "../lib/oos-display";
import { IconAlert, IconCheck, IconLoader, IconX } from "./Icons";

type Props = {
  /**
   * Terminal run result — or null while the run is still in flight (the
   * sheet then renders the LIVE view and fills in when the result lands,
   * because the pill re-renders it with fresh props; 2026-07-08 want).
   */
  result: ActiveOrderResult | null;
  /** Live copy while result is null: the pill's own headline + stage line. */
  live?: { title: string; sub: string | null } | null;
  /** True when the run finalized failed/canceled → honest failure view. */
  failed?: boolean;
  /**
   * True when the run finalized submitted_unconfirmed (2026-07-16 truth
   * rule): submit clicked, receipt missed. Renders the amber
   * "don't place again" view — NEVER the red failure view.
   */
  submittedUnconfirmed?: boolean;
  mode: RunMode;
  onClose: () => void;
};

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

/**
 * Wall-clock the check took, formatted for a subtle one-line readout.
 * <10s shows one decimal (e.g. 7.4s); 10–59s rounds; ≥60s is "Xm Ys".
 * Returns null for missing/invalid/non-positive values (rendered as nothing).
 */
function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) <= 0) return null;
  const s = Number(ms) / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

/**
 * MILO sometimes echoes bare numbers or single chars alongside real messages.
 * Skip pure-numeric and too-short strings so the messages list stays signal.
 * Mirrors the junk filter ValidateResultPanel uses.
 */
function isUsefulMessage(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length <= 3) return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return false;
  return true;
}

/**
 * MLCC's three Authorized Distribution Agents, keyed by MILO's distributor
 * referenceNumber. Stable state-level identities (they're baked into MLCC's
 * ordering rules), used only as display labels — unknown keys fall back
 * gracefully below.
 */
const ADA_NAMES: Record<string, string> = {
  "141": "Imperial Beverage",
  "221": "General Wine & Liquor",
  "321": "NWS Michigan",
};

/**
 * Normalize submit-result confirmation numbers into display rows.
 * Accepts the REAL worker shape (object keyed by ADA ref or "ada_N") and,
 * defensively, a plain array from any historic run evidence. Rows with no
 * number are dropped — a null never renders as a fake confirmation.
 */
function confirmationRows(
  confirmations: Record<string, string | null> | string[] | null | undefined,
): Array<{ label: string; number: string }> {
  if (!confirmations) return [];
  if (Array.isArray(confirmations)) {
    return confirmations
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      .map((n, i) => ({ label: `Order ${i + 1}`, number: n.trim() }));
  }
  const rows: Array<{ label: string; number: string }> = [];
  for (const [key, value] of Object.entries(confirmations)) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const adaMatch = /^(\d{3})$/.exec(key.trim());
    const fallbackMatch = /^ada_(\d+)$/i.exec(key.trim());
    const label = adaMatch
      ? ADA_NAMES[adaMatch[1]] ?? `ADA ${adaMatch[1]}`
      : fallbackMatch
        ? `Order ${fallbackMatch[1]}`
        : key;
    rows.push({ label, number: value.trim() });
  }
  return rows;
}

export function RunResultSheet({
  result,
  live = null,
  failed = false,
  submittedUnconfirmed = false,
  mode,
  onClose,
}: Props) {
  useLockBodyScroll();
  // Cart lines carry the real name/size for every OOS code MILO reports
  // bare (TONY-WANTS 7/16 #1). Graceful-empty variant: in the app this
  // always has the provider (OrderStatusPill sits inside CartProvider in
  // App.tsx); without one (component tests) it falls back to
  // productName/code rendering instead of throwing.
  const cartItems = useCartItemsOrEmpty();

  // ─── SUBMITTED-UNCONFIRMED view (2026-07-16 truth rule): the submit
  // click went to MILO and the receipt wasn't captured before the run
  // ended. The order very likely EXISTS — the first live one did, with
  // MLCC's email arriving while this sheet said "didn't go through."
  // Amber, not red. The one instruction that matters: don't place again.
  if (submittedUnconfirmed) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Order submitted, confirmation pending"
        style={backdropStyle}
        onClick={onClose}
      >
        <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
          <div style={headerStyle}>
            <div style={headerIconRowStyle}>
              <span style={{ display: "inline-flex", color: "#fbbf24" }}>
                <IconAlert size={18} />
              </span>
              <strong style={{ fontSize: 17 }}>Order submitted — confirming</strong>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} style={closeBtnStyle}>
              <IconX size={18} />
            </button>
          </div>
          <div style={bodyStyle}>
            <div style={practiceNoteStyle}>
              Your order went to MILO, but the confirmation didn&apos;t come back
              before the run ended. <strong>Do not place this order again.</strong>
            </div>
            <p style={mutedStyle}>
              Check your MLCC confirmation email or MILO&apos;s Orders page — the
              order is most likely there. Confirmations will appear in the
              Orders tab once verified. If MILO shows nothing after a few
              minutes, tell support before doing anything else.
            </p>
          </div>
          <div style={footerStyle}>
            <button type="button" style={primaryBtnStyle} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── LIVE view: the run is still in flight (2026-07-08 want — tap the pill
  // DURING the run). Same sheet shell; the result body replaces this in place
  // the moment the run lands, because the pill re-renders us with `result`.
  if (!result) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="MLCC run progress"
        style={backdropStyle}
        onClick={onClose}
      >
        <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
          <div style={headerStyle}>
            <div style={headerIconRowStyle}>
              <span style={{ display: "inline-flex", color: "#93c5fd" }}>
                <IconLoader size={18} strokeWidth={2.25} className="rpa-progress__spin" />
              </span>
              <strong style={{ fontSize: 17 }}>{live?.title ?? "Working on it"}</strong>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} style={closeBtnStyle}>
              <IconX size={18} />
            </button>
          </div>
          <div style={bodyStyle}>
            {live?.sub ? (
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginBottom: 14 }}>
                {live.sub}
              </div>
            ) : null}
            {mode === "validate_only" ? (
              <div style={practiceNoteStyle}>
                Practice check — nothing is being ordered.{" "}
                <span style={{ opacity: 0.7 }}>MILO is checking the cart and pricing only.</span>
              </div>
            ) : null}
            <p style={mutedStyle}>
              MILO is checking your cart against live stock and rules. You can
              close this — the pill keeps tracking, and the result lands here
              the moment it&apos;s done.
            </p>
          </div>
          <div style={footerStyle}>
            <button type="button" style={primaryBtnStyle} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── FAILED view: honest, names the reason, careful about retry advice.
  if (failed) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="MLCC run failed"
        style={backdropStyle}
        onClick={onClose}
      >
        <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
          <div style={headerStyle}>
            <div style={headerIconRowStyle}>
              <span style={{ display: "inline-flex", color: "#f87171" }}>
                <IconAlert size={18} />
              </span>
              <strong style={{ fontSize: 17 }}>
                {mode === "submit" ? "Order run couldn't finish" : "Check couldn't finish"}
              </strong>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} style={closeBtnStyle}>
              <IconX size={18} />
            </button>
          </div>
          <div style={bodyStyle}>
            <div style={practiceNoteStyle}>
              {result.failureMessage || result.failureType || "It hit a problem and stopped."}
            </div>
            <p style={mutedStyle}>
              {mode === "validate_only"
                ? "Nothing was ordered — this was a check. Fix what it names above, or just try again."
                : "Before retrying, open the Orders tab and make sure nothing went through — never double an order."}
            </p>
          </div>
          <div style={footerStyle}>
            <button type="button" style={primaryBtnStyle} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const vr = result.validateResult;
  const submitted = result.submitted === true;
  const oos = Array.isArray(vr?.out_of_stock_items) ? vr!.out_of_stock_items : [];
  const summary = vr?.order_summary ?? null;
  const checkedIn = formatDuration(result.durationMs);
  const confirmations = confirmationRows(result.confirmationNumbers);

  // Headline: placed > ready > review. Honest about a non-submission.
  let headline: string;
  let headlineIcon: React.ReactNode;
  if (submitted) {
    headline = "Order placed";
    headlineIcon = <IconCheck size={18} strokeWidth={2.25} />;
  } else if (vr?.can_checkout === true) {
    headline = "Cart is ready";
    headlineIcon = <IconCheck size={18} strokeWidth={2.25} />;
  } else {
    headline = "Review before ordering";
    headlineIcon = <IconAlert size={18} />;
  }

  // Dedupe + junk-filter MILO's messages and errors into one list.
  const messages: string[] = [];
  const seen = new Set<string>();
  const rawMessages = [
    ...(Array.isArray(vr?.validate_messages) ? vr!.validate_messages : []),
    ...(Array.isArray(vr?.validate_errors) ? vr!.validate_errors : []),
  ];
  for (const m of rawMessages) {
    if (typeof m !== "string") continue;
    if (!isUsefulMessage(m)) continue;
    const key = m.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push(m.trim());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="MLCC run result"
      style={backdropStyle}
      onClick={onClose}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        {/* ─── Header ─── */}
        <div style={headerStyle}>
          <div style={headerIconRowStyle}>
            <span style={{ display: "inline-flex", color: submitted || vr?.can_checkout === true ? "#34d399" : "#fbbf24" }}>
              {headlineIcon}
            </span>
            <strong style={{ fontSize: 17 }}>{headline}</strong>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={closeBtnStyle}
          >
            <IconX size={18} />
          </button>
        </div>

        <div style={bodyStyle}>
          {checkedIn ? (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
              Checked in {checkedIn}
            </div>
          ) : null}
          {/* ─── Practice-run honesty note ─── */}
          {!submitted ? (
            <div style={practiceNoteStyle}>
              {mode === "validate_only"
                ? "Practice check — nothing was ordered."
                : "Practice run — nothing was ordered."}{" "}
              <span style={{ opacity: 0.7 }}>
                Live ordering isn&apos;t switched on yet; MILO checked the cart
                and pricing only.
              </span>
            </div>
          ) : null}

          {/* ─── Confirmation numbers (real submitted orders only) ─── */}
          {submitted ? (
            confirmations.length > 0 ? (
              <section style={{ marginBottom: 16 }}>
                <div style={sectionLabelStyle}>Confirmation</div>
                <ul style={listStyle}>
                  {confirmations.map((c) => (
                    <li key={`${c.label}-${c.number}`} style={confirmationRowStyle}>
                      <span style={{ opacity: 0.85 }}>{c.label}</span>
                      <span style={confirmationNumberStyle}>#{c.number}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <div style={confirmationPendingStyle}>
                Your order went through, but the confirmation number
                didn&apos;t come back with this run — it&apos;s on the Orders
                tab, and on MILO under your order history.
              </div>
            )
          ) : null}

          {/* ─── Out of stock ─── */}
          <section style={{ marginBottom: 16 }}>
            <div style={sectionLabelStyle}>Out of stock at MLCC</div>
            {oos.length === 0 ? (
              <p style={mutedStyle}>Everything&apos;s in stock.</p>
            ) : (
              <ul style={listStyle}>
                {oos.map((item, i) => {
                  // TONY-WANTS 7/16 #1: never a naked code — join against the
                  // cart, which knows every OOS line's real name and size.
                  const name = oosDisplayLabel(item, cartItems);
                  return (
                    <li key={`${item.code ?? name}-${i}`} style={liStyle}>
                      <span>{name}</span>
                      {item.quantity ? <span style={qtyStyle}>× {item.quantity}</span> : null}
                      {item.reason ? (
                        <span style={reasonStyle}>
                          {item.reason === "oos_section"
                            ? "marked out-of-stock by MILO"
                            : item.reason === "validate_demoted"
                              ? "dropped during validate (likely out of stock)"
                              : item.reason}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ─── Totals ─── */}
          {summary ? (
            <section style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>MLCC totals</div>
              <div style={totalsStyle}>
                <TotalRow label="Subtotal" value={summary.grossTotal} />
                {summary.discount != null && Math.abs(Number(summary.discount)) > 0.005 ? (
                  <TotalRow label="Discount" value={summary.discount} />
                ) : null}
                <TotalRow label="Liquor tax" value={summary.liquorTax} />
                <TotalRow label="Net total" value={summary.netTotal} bold />
              </div>
            </section>
          ) : null}

          {/* ─── MILO messages ─── */}
          {messages.length > 0 ? (
            <section style={{ marginBottom: 4 }}>
              <div style={sectionLabelStyle}>MLCC messages</div>
              <ul style={listStyle}>
                {messages.map((m, i) => (
                  <li key={i} style={liStyle}>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ─── No detail fallback ─── */}
          {!vr ? (
            <p style={mutedStyle}>
              No detailed result was returned for this run. If something looks
              wrong, try again.
            </p>
          ) : null}
        </div>

        {/* ─── Footer ─── */}
        <div style={footerStyle}>
          <button type="button" style={primaryBtnStyle} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TotalRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: number | undefined;
  bold?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontWeight: bold ? 700 : 400,
      }}
    >
      <span style={{ opacity: bold ? 1 : 0.8 }}>{label}</span>
      <span>{money(value)}</span>
    </div>
  );
}

// ─── Styles (mirror SubmitConfirmationModal's dark bottom-sheet) ─────────────
const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(6, 8, 12, 0.85)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 2100,
  padding: 0,
};

const cardStyle: React.CSSProperties = {
  background: "#11141b",
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  width: "100%",
  maxWidth: 520,
  maxHeight: "92vh",
  display: "flex",
  flexDirection: "column",
  color: "#fff",
  boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 20px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const headerIconRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const closeBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: "rgba(255,255,255,0.7)",
  padding: 4,
  cursor: "pointer",
};

const bodyStyle: React.CSSProperties = {
  padding: "16px 20px",
  overflowY: "auto",
};

const practiceNoteStyle: React.CSSProperties = {
  background: "rgba(251,191,36,0.12)",
  border: "1px solid rgba(251,191,36,0.3)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  marginBottom: 16,
  color: "rgba(255,255,255,0.92)",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.5)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
  marginBottom: 8,
};

const mutedStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.6)",
  fontSize: 14,
  margin: 0,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const liStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "4px 8px",
  fontSize: 14,
  padding: "6px 10px",
  background: "rgba(255,255,255,0.04)",
  borderRadius: 8,
};

const qtyStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.7)",
  fontSize: 13,
};

const reasonStyle: React.CSSProperties = {
  width: "100%",
  color: "rgba(251,191,36,0.85)",
  fontSize: 12,
};

const totalsStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  borderRadius: 10,
  padding: "8px 12px",
};

const confirmationRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 14,
  padding: "8px 12px",
  background: "rgba(52,211,153,0.08)",
  border: "1px solid rgba(52,211,153,0.25)",
  borderRadius: 8,
};

const confirmationNumberStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: "0.02em",
  color: "#34d399",
};

const confirmationPendingStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  marginBottom: 16,
  color: "rgba(255,255,255,0.85)",
};

const footerStyle: React.CSSProperties = {
  padding: "12px 20px 18px",
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  background: "#ffffff",
  color: "#11141b",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};
