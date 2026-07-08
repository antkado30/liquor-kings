/**
 * OrderStatusPill — persistent, app-level status pill for the active order
 * (2026-06-26). Renders null when no order is tracked, so the app behaves
 * exactly as today until something calls useActiveOrder().trackOrder().
 *
 * Lives in the App shell OUTSIDE <Routes>, so it survives cart-drawer close
 * and page navigation. Pure presentation over useActiveOrder state — no run
 * triggering, no validate/submit logic.
 *
 * Styling is inline (no CSS file edits) so this stays a self-contained
 * addition. Icons reuse the existing inline-SVG set (no emoji).
 */
import { useEffect, useState } from "react";
import { useActiveOrder } from "../hooks/useActiveOrder";
import { IconAlert, IconCheck, IconLoader, IconX } from "./Icons";
import { RunResultSheet } from "./RunResultSheet";

const STAGE_LABELS: Record<string, string> = {
  rpa_login: "Signing in to MLCC",
  rpa_navigate: "Opening MLCC",
  rpa_add_items: "Adding your items",
  rpa_validate: "Confirming your cart",
  rpa_checkout: "Placing the order",
};

function formatElapsed(startedAtMs: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

/**
 * Re-render once per second, but ONLY while a run is in flight. Terminal
 * results are static and don't need a live clock. Returns nothing — its sole
 * job is to force a re-render so the elapsed mm:ss stays fresh.
 */
function useNowTicker(active: boolean) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => bump((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

export function OrderStatusPill() {
  const { activeOrder, dismiss } = useActiveOrder();
  const [showResult, setShowResult] = useState(false);

  const isRunning = activeOrder !== null && activeOrder.result === null;
  useNowTicker(isRunning);

  if (!activeOrder) return null;

  const terminal = activeOrder.result !== null;

  // Resolve copy + icon per state. EVERY state is tappable (2026-07-08 want:
  // "the pill doesn't let me click to see the progress" — now it does):
  // in-flight opens the LIVE sheet, succeeded opens the result, failed opens
  // the honest failure view. The sheet is rendered from this component's
  // state, so a run finishing while it's open fills the result in place.
  let icon: React.ReactNode;
  let title: string;
  let sub: string | null = null;
  let tone: "running" | "ok" | "warn" | "err" = "running";

  if (!terminal) {
    // In flight. Headline is mode-aware so we never lie: a validate_only run
    // is "checking", not "placing". The stage label gives the live detail.
    icon = <IconLoader size={14} strokeWidth={2.25} className="rpa-progress__spin" />;
    title = activeOrder.mode === "submit" ? "Placing your order" : "Checking your cart";
    const stageLabel = activeOrder.progressStage
      ? activeOrder.progressStage === "rpa_checkout" && activeOrder.mode !== "submit"
        ? "Finalizing the check"
        : (STAGE_LABELS[activeOrder.progressStage] ?? null)
      : null;
    sub = stageLabel ?? activeOrder.progressMessage ?? "Working…";
    sub = `${sub} · ${formatElapsed(activeOrder.startedAtMs)}`;
    tone = "running";
  } else if (activeOrder.status === "succeeded") {
    const submitted = activeOrder.result?.submitted === true;
    const vr = activeOrder.result?.validateResult ?? null;
    const oosCount = Array.isArray(vr?.out_of_stock_items) ? vr!.out_of_stock_items.length : 0;
    if (submitted) {
      icon = <IconCheck size={14} strokeWidth={2.25} />;
      title = "Order placed";
      tone = "ok";
    } else {
      // Succeeded but not submitted — dry-run / preview downgrade. Honest.
      icon = <IconCheck size={14} strokeWidth={2.25} />;
      title = "Cart checked — nothing ordered (practice run)";
      tone = "warn";
    }
    // Summarize what MILO found; tap opens the full detail sheet.
    if (oosCount > 0) {
      sub = `${oosCount} item${oosCount === 1 ? "" : "s"} out of stock — tap to review`;
    } else {
      const net = vr?.order_summary?.netTotal;
      const netStr = money(net);
      sub = netStr ? `Everything in stock · ${netStr}` : "Everything in stock";
    }
  } else {
    // failed / cancelled — tap opens the honest failure sheet (was: navigate
    // home, which explained nothing).
    icon = <IconAlert size={14} />;
    title = "Order didn't go through";
    const result = activeOrder.result;
    sub = result?.failureMessage || result?.failureType || "Please try again";
    tone = "err";
  }

  const handleBodyClick = () => setShowResult(true);

  return (
    <>
      <div
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          // Sit just above the bottom tab bar (tab bar ~56px + margin).
          bottom: 72,
          zIndex: 1200,
          pointerEvents: "auto",
          maxWidth: "calc(100vw - 24px)",
        }}
      >
        <div
          onClick={handleBodyClick}
          role="button"
          tabIndex={0}
          aria-label={terminal ? "Show run result" : "Show run progress"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 999,
            background: toneBackground(tone),
            color: "#ffffff",
            boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1.2,
            maxWidth: "calc(100vw - 24px)",
          }}
        >
        <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            fontWeight: 600,
          }}
        >
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </span>
          {sub ? (
            <span
              style={{
                fontWeight: 400,
                opacity: 0.85,
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {sub}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            border: "none",
            background: "transparent",
            color: "inherit",
            opacity: 0.7,
            padding: 2,
            cursor: "pointer",
            marginLeft: 2,
          }}
        >
          <IconX size={14} />
        </button>
        </div>
      </div>
      {showResult && activeOrder ? (
        <RunResultSheet
          result={activeOrder.result}
          live={!terminal ? { title, sub } : null}
          failed={terminal && activeOrder.status !== "succeeded"}
          mode={activeOrder.mode}
          onClose={() => setShowResult(false)}
        />
      ) : null}
    </>
  );
}

function toneBackground(tone: "running" | "ok" | "warn" | "err"): string {
  switch (tone) {
    case "ok":
      return "#0f7a4d";
    case "warn":
      return "#8a6d00";
    case "err":
      return "#b3261e";
    case "running":
    default:
      return "#1f2937";
  }
}
