/**
 * MorePage — task #90 + #91 + #92 (2026-06-07).
 *
 * Premium SVG icons replace emojis (#91). AI Assistant promoted to
 * top of list with hero-card styling (#92) — Tony's correct call:
 * "the AI assistant is our MOAT, why is it hidden in More."
 *
 * Layout:
 *   - Top: BIG AI Assistant card (purple gradient, sparkles icon,
 *     "Ask anything about your store" tagline). This is the moat,
 *     make it impossible to miss.
 *   - Then the rest as standard rows: Templates, Orders, Analytics,
 *     Inventory, Settings — all live.
 *   - Sign-out at the bottom.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "../lib/supabase";
import { clearCurrentStoreId } from "../lib/currentStore";
import {
  IconBarChart,
  IconCalendar,
  IconChevronRight,
  IconClipboardList,
  IconLogOut,
  IconPackage,
  IconSettings,
  IconSparkles,
} from "../components/Icons";

type MenuItem = {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  blurb: string;
  onTap: () => void;
};

export function MorePage() {
  const navigate = useNavigate();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const items: MenuItem[] = [
    {
      Icon: IconCalendar,
      label: "Templates",
      blurb: "Saved carts + weekly auto-prepare",
      onTap: () => navigate("/templates"),
    },
    {
      Icon: IconClipboardList,
      label: "Orders",
      blurb: "MILO confirmation history",
      onTap: () => navigate("/orders"),
    },
    {
      Icon: IconBarChart,
      label: "Analytics",
      blurb: "Spend, top sellers, distributors, biggest movers",
      onTap: () => navigate("/?view=dashboard"),
    },
    {
      Icon: IconPackage,
      label: "Inventory",
      blurb: "Par levels, on-hand, reorder alerts",
      onTap: () => navigate("/inventory"),
    },
    {
      Icon: IconSettings,
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
          AI assistant, history, analytics, settings.
        </p>
      </header>

      {/* ─── Hero AI Assistant card — the moat lives here (#92) ─── */}
      <button
        type="button"
        onClick={() => navigate("/assistant")}
        style={aiHeroStyle}
      >
        <div style={aiHeroIconWrapStyle}>
          <IconSparkles size={28} strokeWidth={1.9} />
        </div>
        <div style={aiHeroContentStyle}>
          <div style={aiHeroEyebrowStyle}>YOUR AI ASSISTANT</div>
          <div style={aiHeroTitleStyle}>
            Ask anything — your store or liquor in general
          </div>
          <div style={aiHeroSubtitleStyle}>
            Your orders, your inventory, MLCC rules, pricing, what
            pairs with what — grounded in real data.
          </div>
        </div>
        <span style={aiHeroChevronStyle}>
          <IconChevronRight size={22} />
        </span>
      </button>

      {/* ─── Standard rows ─── */}
      <ul style={listStyle}>
        {items.map((item) => {
          const Icon = item.Icon;
          return (
            <li
              key={item.label}
              style={{ ...rowStyle, cursor: "pointer" }}
              onClick={() => item.onTap()}
            >
              <span style={iconWrapStyle}>
                <Icon size={22} strokeWidth={1.75} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowTitleStyle}>{item.label}</div>
                <div style={rowBlurbStyle}>{item.blurb}</div>
              </div>
              <span style={chevronStyle}>
                <IconChevronRight size={20} />
              </span>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setConfirmSignOut(true)}
        style={signOutBtnStyle}
      >
        <IconLogOut size={18} strokeWidth={1.9} />
        <span>Sign out</span>
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
  fontSize: 30,
  fontWeight: 800,
  letterSpacing: "-0.01em",
  margin: "0 0 4px",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.55)",
  margin: 0,
};

/* ─── AI hero card ────────────────────────────────────────────────── */

const aiHeroStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  width: "100%",
  textAlign: "left",
  background:
    "linear-gradient(135deg, rgba(124, 92, 255, 0.22), rgba(58, 130, 247, 0.12))",
  border: "1px solid rgba(140, 110, 255, 0.35)",
  borderRadius: 16,
  padding: "16px 14px",
  marginBottom: 18,
  color: "#fff",
  cursor: "pointer",
  position: "relative",
  overflow: "hidden",
};

const aiHeroIconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 48,
  height: 48,
  borderRadius: 14,
  background: "rgba(140, 110, 255, 0.22)",
  color: "#cbb8ff",
  flexShrink: 0,
};

const aiHeroContentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const aiHeroEyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.1em",
  color: "rgba(203, 184, 255, 0.85)",
  marginBottom: 4,
};

const aiHeroTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  lineHeight: 1.25,
  marginBottom: 4,
};

const aiHeroSubtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.65)",
  lineHeight: 1.45,
};

const aiHeroChevronStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.5)",
  display: "inline-flex",
  alignSelf: "center",
};

/* ─── Standard rows ───────────────────────────────────────────────── */

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
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 14,
  padding: "14px 14px",
  display: "flex",
  alignItems: "center",
  gap: 14,
};

const iconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  color: "rgba(255,255,255,0.85)",
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
  color: "rgba(255,255,255,0.5)",
  marginTop: 2,
};

const chevronStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.3)",
  display: "inline-flex",
};

/* ─── Sign out ────────────────────────────────────────────────────── */

const signOutBtnStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(244, 63, 94, 0.06)",
  border: "1px solid rgba(244, 63, 94, 0.24)",
  color: "#fda4af",
  borderRadius: 14,
  padding: "14px 18px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
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
