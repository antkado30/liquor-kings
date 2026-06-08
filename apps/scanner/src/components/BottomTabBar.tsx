/**
 * BottomTabBar — Amazon-style 5-tab fixed bottom navigation (task #90,
 * 2026-06-07). Premium SVG icon pass (#91, same day) replaced the
 * tacky emoji icons.
 *
 *   ⌂ Scan · ❐ Catalog · ⛁ Cart · ▦ Templates · ⌗ More
 *
 * Each tab gets a clean stroke SVG icon (see Icons.tsx). Active tab
 * highlighted with accent color + top indicator bar. Cart tab is
 * slightly wider and gets a count badge.
 */
import { useLocation, useNavigate } from "react-router-dom";
import { useCart } from "../hooks/useCart";
import {
  IconCart,
  IconCatalog,
  IconHome,
  IconMore,
  IconSparkles,
} from "./Icons";

type Tab = {
  id: "scan" | "catalog" | "cart" | "ai" | "more";
  label: string;
  Icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
  path: string;
  matches: (pathname: string) => boolean;
};

/*
 * Tab bar shape — Tony's 2026-06-07 redesign call: AI Assistant
 * replaces Templates as a top-level tab because AI is the MOAT and
 * shouldn't be buried. Templates moves into the More page (still
 * accessible, just not a tab).
 *
 * Tap AI tab → /assistant (full-screen chat page).
 */
const TABS: Tab[] = [
  {
    id: "scan",
    label: "Scan",
    Icon: IconHome,
    path: "/",
    matches: (p) => p === "/" || p === "",
  },
  {
    id: "catalog",
    label: "Catalog",
    Icon: IconCatalog,
    path: "/browse",
    matches: (p) => p.startsWith("/browse"),
  },
  {
    id: "cart",
    label: "Cart",
    Icon: IconCart,
    path: "/cart",
    matches: (p) => p.startsWith("/cart"),
  },
  {
    id: "ai",
    label: "AI",
    Icon: IconSparkles,
    path: "/assistant",
    matches: (p) => p.startsWith("/assistant"),
  },
  {
    id: "more",
    label: "More",
    Icon: IconMore,
    path: "/more",
    matches: (p) =>
      p.startsWith("/more") ||
      p.startsWith("/orders") ||
      p.startsWith("/settings") ||
      p.startsWith("/templates"),
  },
];

export function BottomTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const cart = useCart();

  return (
    <nav
      style={navStyle}
      role="navigation"
      aria-label="Primary navigation"
    >
      {TABS.map((tab) => {
        const active = tab.matches(location.pathname);
        const isCart = tab.id === "cart";
        const badge = isCart && cart.totalItems > 0 ? cart.totalItems : null;
        const Icon = tab.Icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => navigate(tab.path)}
            style={{
              ...tabBtnStyle,
              ...(isCart ? cartTabExtraStyle : null),
            }}
            aria-current={active ? "page" : undefined}
            aria-label={tab.label}
          >
            <span
              style={{
                ...iconWrapStyle,
                color: active ? "#fff" : "rgba(255,255,255,0.55)",
                transform: active ? "translateY(-1px)" : "none",
              }}
            >
              <Icon size={isCart ? 26 : 22} strokeWidth={active ? 2.1 : 1.75} />
              {badge != null ? (
                <span style={badgeStyle}>
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </span>
            <span
              style={{
                ...labelStyle,
                color: active ? "#fff" : "rgba(255,255,255,0.55)",
                fontWeight: active ? 700 : 500,
              }}
            >
              {tab.label}
            </span>
            {active ? <span style={activeIndicatorStyle} aria-hidden /> : null}
          </button>
        );
      })}
    </nav>
  );
}

const navStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 90,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "space-around",
  background: "rgba(11, 13, 18, 0.96)",
  backdropFilter: "saturate(140%) blur(12px)",
  WebkitBackdropFilter: "saturate(140%) blur(12px)",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  paddingTop: 8,
  paddingBottom: "max(8px, env(safe-area-inset-bottom))",
  paddingLeft: "max(0px, env(safe-area-inset-left))",
  paddingRight: "max(0px, env(safe-area-inset-right))",
};

const tabBtnStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  background: "transparent",
  border: "none",
  color: "#fff",
  padding: "4px 4px 2px",
  cursor: "pointer",
  position: "relative",
  minWidth: 0,
};

const cartTabExtraStyle: React.CSSProperties = {
  flex: 1.15,
};

const iconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  position: "relative",
  transition: "color 120ms ease, transform 120ms ease",
  height: 26,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.01em",
};

const badgeStyle: React.CSSProperties = {
  position: "absolute",
  top: -6,
  right: -10,
  background: "#3a82f7",
  color: "#fff",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 800,
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "2px solid rgba(11, 13, 18, 1)",
};

const activeIndicatorStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: "50%",
  transform: "translateX(-50%)",
  width: 26,
  height: 2,
  borderRadius: 2,
  background: "#3a82f7",
};
