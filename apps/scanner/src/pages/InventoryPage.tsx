/**
 * InventoryPage (2026-06-07) — promotes Inventory from the "Coming Soon"
 * tile in More to a real page. The backend (/inventory routes + services)
 * already existed; this is the front end.
 *
 * Cached via useCachedResource so reopening is instant (Tony's instant-feel
 * standard). On-hand counts edit inline with an optimistic update — the
 * number changes immediately, the PATCH fires underneath, and we revert +
 * toast only if the server rejects it.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getInventorySummary,
  listInventory,
  updateInventoryQuantity,
  type InventoryRow,
  type InventorySummary,
} from "../api/inventory";
import { getProductFamily } from "../api/catalog";
import { useCart } from "../hooks/useCart";
import { IconCart } from "../components/Icons";
import { useCachedResource } from "../lib/swr";
import { getCurrentStoreId } from "../lib/currentStore";

function isLow(row: InventoryRow): boolean {
  const qty = Number(row.quantity ?? 0);
  const low = row.low_stock_threshold;
  const reorder = row.reorder_point;
  return (
    (low != null && qty <= Number(low)) ||
    (reorder != null && qty <= Number(reorder))
  );
}

export function InventoryPage() {
  const storeId = getCurrentStoreId() ?? "none";
  const cart = useCart();
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  const listRes = useCachedResource<InventoryRow[]>(
    `inventory:list:${storeId}`,
    async () => {
      const r = await listInventory();
      if (!r.ok) throw new Error(r.error);
      return r.rows;
    },
  );
  const summaryRes = useCachedResource<InventorySummary>(
    `inventory:summary:${storeId}`,
    async () => {
      const r = await getInventorySummary();
      if (!r.ok) throw new Error(r.error);
      return r.summary;
    },
  );

  const rows = listRes.data ?? [];
  const error = listRes.error
    ? listRes.error instanceof Error
      ? listRes.error.message
      : String(listRes.error)
    : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (lowOnly && !isLow(r)) return false;
      if (!q) return true;
      const name = r.bottles?.name?.toLowerCase() ?? "";
      const code = r.bottles?.mlcc_code?.toLowerCase() ?? "";
      const loc = r.location?.toLowerCase() ?? "";
      return name.includes(q) || code.includes(q) || loc.includes(q);
    });
  }, [rows, query, lowOnly]);

  const lowCount = useMemo(() => rows.filter(isLow).length, [rows]);

  async function adjust(row: InventoryRow, delta: number) {
    const next = Math.max(0, Number(row.quantity ?? 0) + delta);
    setSavingId(row.id);
    // Optimistic: update the cached list immediately.
    listRes.mutate(
      rows.map((r) => (r.id === row.id ? { ...r, quantity: next } : r)),
    );
    const res = await updateInventoryQuantity(row.id, next);
    setSavingId(null);
    if (!res.ok) {
      setToast(`Couldn't update — ${res.error}`);
      setTimeout(() => setToast(null), 3000);
      void listRes.refresh(); // pull true server state back
    }
  }

  // One-tap reorder: resolve the bottle in the catalog (for ADA + price) and
  // drop it into the cart at the configured reorder quantity (default 1).
  async function reorder(row: InventoryRow) {
    const code = row.bottles?.mlcc_code;
    if (!code) return;
    setReorderingId(row.id);
    try {
      const fam = await getProductFamily(code);
      const product =
        fam?.sizes.find((s) => s.code === code) ?? fam?.sizes[0] ?? null;
      if (!product) {
        setToast("That bottle isn't in the orderable catalog right now.");
        setTimeout(() => setToast(null), 3000);
        return;
      }
      const qty =
        row.reorder_quantity && row.reorder_quantity > 0
          ? row.reorder_quantity
          : 1;
      cart.addItem(product, qty);
      setToast(`Added ${product.name} ×${qty} to your order`);
      setTimeout(() => setToast(null), 2800);
    } finally {
      setReorderingId(null);
    }
  }

  return (
    <div className="page-shell" style={{ color: "#fff" }}>
      <header className="page-header">
        <Link to="/more" className="page-header__back" aria-label="Back">
          ←
        </Link>
        <h1>Inventory</h1>
      </header>

      <section style={summaryRowStyle}>
        <div style={metricStyle}>
          <span style={metricLabelStyle}>SKUs tracked</span>
          <strong>{summaryRes.data?.totalRows ?? rows.length}</strong>
        </div>
        <div style={metricStyle}>
          <span style={metricLabelStyle}>Bottles on hand</span>
          <strong>{summaryRes.data?.totalQuantity ?? "—"}</strong>
        </div>
        <button
          type="button"
          onClick={() => setLowOnly((v) => !v)}
          style={{
            ...metricStyle,
            ...lowChipStyle,
            ...(lowOnly ? lowChipActiveStyle : {}),
          }}
        >
          <span style={metricLabelStyle}>Low stock</span>
          <strong style={{ color: lowCount > 0 ? "#fcaf6b" : "#fff" }}>
            {lowCount}
          </strong>
        </button>
      </section>

      <input
        type="search"
        className="search-bar-input"
        placeholder="Search inventory by name, code, or location…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        style={{ marginBottom: 12 }}
      />

      {error ? (
        <div className="banner banner-err">Couldn&apos;t load inventory: {error}</div>
      ) : null}

      {listRes.loading ? (
        <p className="muted small" style={{ padding: 24, textAlign: "center" }}>
          Loading inventory…
        </p>
      ) : null}

      {!listRes.loading && rows.length === 0 && !error ? (
        <div className="banner banner-warn" style={{ marginTop: 12 }}>
          No inventory yet. Counts will appear here as you track stock.
        </div>
      ) : null}

      {!listRes.loading && rows.length > 0 && filtered.length === 0 ? (
        <p className="muted small" style={{ padding: 24, textAlign: "center" }}>
          {lowOnly ? "Nothing low on stock right now." : "No matches."}
        </p>
      ) : null}

      <ul style={listStyle}>
        {filtered.map((row) => {
          const qty = Number(row.quantity ?? 0);
          const low = isLow(row);
          return (
            <li key={row.id} style={cardStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={nameStyle}>
                  {row.bottles?.name ?? row.bottles?.mlcc_code ?? "Unknown bottle"}
                </div>
                <div style={metaStyle}>
                  {row.bottles?.size ??
                    (row.bottles?.size_ml ? `${row.bottles.size_ml} mL` : "")}
                  {row.location ? ` · ${row.location}` : ""}
                  {low ? <span style={lowBadgeStyle}>LOW</span> : null}
                </div>
              </div>
              <div style={stepperStyle}>
                <button
                  type="button"
                  aria-label="Decrease"
                  style={stepBtnStyle}
                  disabled={savingId === row.id || qty <= 0}
                  onClick={() => void adjust(row, -1)}
                >
                  −
                </button>
                <span style={qtyStyle}>{qty}</span>
                <button
                  type="button"
                  aria-label="Increase"
                  style={stepBtnStyle}
                  disabled={savingId === row.id}
                  onClick={() => void adjust(row, +1)}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                aria-label={`Add ${row.bottles?.name ?? "bottle"} to order`}
                title="Add to order"
                style={{
                  ...reorderBtnStyle,
                  ...(low ? reorderBtnLowStyle : {}),
                }}
                disabled={reorderingId === row.id || !row.bottles?.mlcc_code}
                onClick={() => void reorder(row)}
              >
                <IconCart size={18} strokeWidth={1.85} />
              </button>
            </li>
          );
        })}
      </ul>

      {toast ? <div style={toastStyle}>{toast}</div> : null}
    </div>
  );
}

const summaryRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  marginBottom: 14,
};
const metricStyle: React.CSSProperties = {
  flex: 1,
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const metricLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.55)",
};
const lowChipStyle: React.CSSProperties = {
  cursor: "pointer",
  textAlign: "left",
};
const lowChipActiveStyle: React.CSSProperties = {
  borderColor: "rgba(245, 158, 11, 0.5)",
  background: "rgba(245, 158, 11, 0.12)",
};
const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: "12px 14px",
};
const nameStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1.25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const metaStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "rgba(255,255,255,0.6)",
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const lowBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "#fde6b3",
  background: "rgba(245, 158, 11, 0.18)",
  border: "1px solid rgba(245, 158, 11, 0.4)",
  borderRadius: 999,
  padding: "1px 7px",
};
const stepperStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};
const stepBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "transparent",
  color: "#fff",
  fontSize: 20,
  fontWeight: 700,
  lineHeight: 1,
  cursor: "pointer",
};
const reorderBtnStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  border: "1px solid rgba(58,130,247,0.35)",
  background: "rgba(58,130,247,0.12)",
  color: "#b9d1ff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};
const reorderBtnLowStyle: React.CSSProperties = {
  border: "1px solid rgba(245,158,11,0.45)",
  background: "rgba(245,158,11,0.14)",
  color: "#fde6b3",
};
const qtyStyle: React.CSSProperties = {
  minWidth: 28,
  textAlign: "center",
  fontSize: 16,
  fontWeight: 800,
};
const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 100,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(11, 13, 18, 0.96)",
  color: "#fff",
  padding: "12px 18px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.12)",
  zIndex: 95,
  maxWidth: "90%",
  textAlign: "center",
};
