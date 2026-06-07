/**
 * BottomTabBar — Amazon-style 5-tab fixed bottom navigation (task #90,
 * 2026-06-07). Tony approved on the spot:
 *
 *   🏠 Scan · 📚 Catalog · 🛒 Cart · 📅 Templates · 👤 More
 *
 * Why this shape:
 *   - 5 is the proven sweet spot (Amazon, Instacart, every shopping app)
 *   - Cart in center, larger, with a count badge — primary action front
 *     and center
 *   - Templates gets its own tab because it's aspirational use (every
 *     week) not reference-only
 *   - "More" absorbs Orders / Dashboard / AI Chat / Settings so the bar
 *     stays clean
 *   - When Inventory ships (next major feature per TONY-WANTS), it
 *     promotes out of More into a tab. We'll either swap one of the 5
 *     into More, or go to 6 if the count badge needs the breathing room.
 *
 * Doctrine alignment: discipline #1 (predictable). Same tabs, same
 * order, same icons, every render. No A/B variations.
 */
import { useLocation, useNavigate } from "react-router-dom";
import { useCart } from "../hooks/useCart";

type Tab = {
  id: "scan" | "catalog" | "cart" | "templates" | "more";
  label: string;
  icon: string;
  path: string;
  /** Match function — true if the current pathname belongs to this tab. */
  matches: (pathname: string) => boolean;
};

const TABS: Tab[] = [
  {
    id: "scan",
    label: "Scan",
    icon: "🏠",
    path: "/",
    matches: (p) => p === "/" || p === "",
  },
  {
    id: "catalog",
    label: "Catalog",
    icon: "📚",
    path: "/browse",
    matches: (p) => p.startsWith("/browse"),
  },
  {
    id: "cart",
    label: "Cart",
    icon: "🛒",
    path: "/cart",
    matches: (p) => p.startsWith("/cart"),
  },
  {
    id: "templates",
    label: "Templates",
    icon: "📅",
    path: "/templates",
    matches: (p) => p.startsWith("/templates"),
  },
  {
    id: "more",
    label: "More",
    icon: "👤",
    path: "/more",
    /* `more` also matches the destinations the More menu links to,
     * so the active highlight stays on More when the user is deep in
     * Orders, Dashboard, Settings, etc. */
    matches: (p) =>
      p.startsWith("/more") ||
      p.startsWith("/orders") ||
      p.startsWith("/settings"),
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
                ...iconStyle,
                ...(isCart ? cartIconStyle : null),
                opacity: active ? 1 : 0.55,
                transform: active ? "translateY(-1px)" : "none",
              }}
            >
              {tab.icon}
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
  gap: 3,
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

const iconStyle: React.CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  position: "relative",
  display: "inline-block",
  transition: "opacity 120ms ease, transform 120ms ease",
};

const cartIconStyle: React.CSSProperties = {
  fontSize: 26,
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
