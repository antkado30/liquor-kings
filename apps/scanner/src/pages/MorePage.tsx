/**
 * MorePage — the menu accessed from the 5th bottom tab (task #90,
 * 2026-06-07). Holds destinations that don't merit a dedicated tab
 * for V1:
 *
 *   - Orders (history)
 *   - Dashboard (analytics)
 *   - AI Assistant (chat)
 *   - Settings
 *   - Sign out
 *
 * "Coming soon" entries seed the user's mental model of what's next:
 *   - Inventory tracking (per TONY-WANTS — next major build)
 *
 * Doctrine alignment: discipline #1 (predictable) — same order, same
 * destinations; discipline #5 (loud failures) — Sign out shows a
 * confirm step so a misfire doesn't end your session.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "../lib/supabase";
import { clearCurrentStoreId } from "../lib/currentStore";

type MenuItem = {
  icon: string;
  label: string;
  blurb: string;
  onTap: () => void;
  comingSoon?: boolean;
};

export function MorePage() {
  const navigate = useNavigate();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const items: MenuItem[] = [
    {
      icon: "📋",
      label: "Orders",
      blurb: "MILO confirmation history",
      onTap: () => navigate("/orders"),
    },
    {
      icon: "📊",
      label: "Dashboard",
      blurb: "Weekly spend, top SKUs, biggest movers",
      /*
       * Dashboard and AI Assistant are modal overlays on the
       * ScannerPage today, not standalone routes. Rather than
       * refactor them tonight, navigate home with a query param the
       * scanner reads on mount to auto-open the right overlay.
       * Promotes to a real page in a follow-up.
       */
      onTap: () => navigate("/?view=dashboard"),
    },
    {
      icon: "💬",
      label: "AI Assistant",
      blurb: "Ask anything about your inventory or orders",
      onTap: () => navigate("/?view=assistant"),
    },
    {
      icon: "📦",
      label: "Inventory",
      blurb: "Par levels, on-hand, reorder alerts",
      comingSoon: true,
      onTap: () => {
        /* coming soon — no-op tap */
      },
    },
    {
      icon: "⚙️",
      label: "Settings",
      blurb: "MLCC credentials, store profile",
      onTap: () => navigate("/settings"),
    },
  ];

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>More</h1>
        <p style={subtitleStyle}>
          Everything else — history, analytics, AI, settings.
        </p>
      </header>

      <ul style={listStyle}>
        {items.map((item) => (
          <li
            key={item.label}
            style={{
              ...rowStyle,
              opacity: item.comingSoon ? 0.55 : 1,
              cursor: item.comingSoon ? "default" : "pointer",
            }}
            onClick={() => !item.comingSoon && item.onTap()}
          >
            <span style={iconStyle}>{item.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={rowTitleStyle}>
                {item.label}
                {item.comingSoon ? (
                  <span style={comingSoonBadgeStyle}>Coming soon</span>
                ) : null}
              </div>
              <div style={rowBlurbStyle}>{item.blurb}</div>
            </div>
            {!item.comingSoon ? <span style={chevronStyle}>›</span> : null}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setConfirmSignOut(true)}
        style={signOutBtnStyle}
      >
        🚪 Sign out
      </button>

      {confirmSignOut ? (
        <div
          role="dialog"
          aria-modal="true"
          style={backdropStyle}
          onClick={() => setConfirmSignOut(false)}
        >
          <div style={confirmCardStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={confirmTitleStyle}>Sign out?</h2>
            <p style={confirmBodyStyle}>
              You&apos;ll need your Liquor Kings email and password to sign
              back in. Your cart stays saved locally.
            </p>
            <div style={confirmActionsStyle}>
              <button
                type="button"
                onClick={() => setConfirmSignOut(false)}
                style={secondaryBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  clearCurrentStoreId();
                  void signOut();
                }}
                style={signOutConfirmStyle}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ─── routes for menu items that don't have explicit pages yet ──────── */
/* (We'll wire /dashboard and /assistant once their components are
 * moved out of the ScannerPage overlay model. For now those buttons
 * navigate to placeholder routes that fall back to home via the
 * catch-all <Route path="*"> in App.tsx. Tracked in TONY-WANTS as
 * future iteration. */

const pageStyle: React.CSSProperties = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "18px 16px 110px",
  color: "#fff",
};

const headerStyle: React.CSSProperties = {
  marginBottom: 18,
};

const titleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  margin: "0 0 4px",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.6)",
  margin: 0,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0 0 22px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const rowStyle: React.CSSProperties = {
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: "14px 14px",
  display: "flex",
  alignItems: "center",
  gap: 14,
};

const iconStyle: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1,
  width: 36,
  textAlign: "center",
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const rowBlurbStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.55)",
  marginTop: 2,
};

const chevronStyle: React.CSSProperties = {
  fontSize: 22,
  color: "rgba(255,255,255,0.3)",
  fontWeight: 300,
};

const comingSoonBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  background: "rgba(245, 158, 11, 0.18)",
  color: "#fde6b3",
  border: "1px solid rgba(245, 158, 11, 0.4)",
  borderRadius: 999,
  padding: "2px 8px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const signOutBtnStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(244, 63, 94, 0.08)",
  border: "1px solid rgba(244, 63, 94, 0.3)",
  color: "#fda4af",
  borderRadius: 12,
  padding: "14px 18px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(6, 8, 12, 0.85)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 200,
  padding: 20,
};

const confirmCardStyle: React.CSSProperties = {
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 22,
  maxWidth: 440,
  width: "100%",
  color: "#fff",
};

const confirmTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  margin: "0 0 8px",
};

const confirmBodyStyle: React.CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.7)",
  lineHeight: 1.5,
  margin: "0 0 18px",
};

const confirmActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};

const secondaryBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const signOutConfirmStyle: React.CSSProperties = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
