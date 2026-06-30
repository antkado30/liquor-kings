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
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import { IconAlert, IconCheck, IconX } from "./Icons";

type Props = {
  result: ActiveOrderResult;
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

export function RunResultSheet({ result, mode, onClose }: Props) {
  useLockBodyScroll();

  const vr = result.validateResult;
  const submitted = result.submitted === true;
  const oos = Array.isArray(vr?.out_of_stock_items) ? vr!.out_of_stock_items : [];
  const summary = vr?.order_summary ?? null;
  const checkedIn = formatDuration(result.durationMs);

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

          {/* ─── Out of stock ─── */}
          <section style={{ marginBottom: 16 }}>
            <div style={sectionLabelStyle}>Out of stock at MLCC</div>
            {oos.length === 0 ? (
              <p style={mutedStyle}>Everything&apos;s in stock.</p>
            ) : (
              <ul style={listStyle}>
                {oos.map((item, i) => {
                  const name = item.productName ?? item.code ?? "Unknown item";
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
