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
  updateReorderSettings,
  type InventoryRow,
  type InventorySummary,
} from "../api/inventory";
import { getProductFamily } from "../api/catalog";
import { useCart } from "../hooks/useCart";
import {
  IconAlert,
  IconCart,
  IconChevronLeft,
  IconChevronRight,
  IconLoader,
  IconPackage,
} from "../components/Icons";
import { useCachedResource } from "../lib/swr";
import { getCurrentStoreId } from "../lib/currentStore";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";

type StockFilter = "all" | "low" | "reorder";

function isBelowLowThreshold(row: InventoryRow): boolean {
  const qty = Number(row.quantity ?? 0);
  const low = row.low_stock_threshold;
  return low != null && qty <= Number(low);
}

function isAtOrBelowReorderPoint(row: InventoryRow): boolean {
  const qty = Number(row.quantity ?? 0);
  const reorder = row.reorder_point;
  return reorder != null && qty <= Number(reorder);
}

function isLow(row: InventoryRow): boolean {
  return isBelowLowThreshold(row) || isAtOrBelowReorderPoint(row);
}

function rowAccentClass(row: InventoryRow): string {
  if (isAtOrBelowReorderPoint(row)) return "inventory-row--reorder";
  if (isBelowLowThreshold(row)) return "inventory-row--low";
  return "";
}

function rowStatusLabel(row: InventoryRow): string | null {
  if (isAtOrBelowReorderPoint(row)) return "Needs reorder";
  if (isBelowLowThreshold(row)) return "Low stock";
  return null;
}

function StatusDot({ tone }: { tone: "ok" | "low" | "reorder" }) {
  return (
    <svg
      className={`inventory-status-dot inventory-status-dot--${tone}`}
      width={8}
      height={8}
      viewBox="0 0 8 8"
      aria-hidden
    >
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

export function InventoryPage() {
  const storeId = getCurrentStoreId() ?? "none";
  const cart = useCart();
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [toast, setToast] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [editingLevels, setEditingLevels] = useState<InventoryRow | null>(null);

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

  const lowCount = useMemo(
    () => rows.filter(isBelowLowThreshold).length,
    [rows],
  );
  const reorderCount = useMemo(
    () => rows.filter(isAtOrBelowReorderPoint).length,
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stockFilter === "low" && !isBelowLowThreshold(r)) return false;
      if (stockFilter === "reorder" && !isAtOrBelowReorderPoint(r)) return false;
      if (!q) return true;
      const name = r.bottles?.name?.toLowerCase() ?? "";
      const code = r.bottles?.mlcc_code?.toLowerCase() ?? "";
      return name.includes(q) || code.includes(q);
    });
  }, [rows, query, stockFilter]);

  const hasActiveFilters =
    stockFilter !== "all" || query.trim().length > 0;

  async function adjust(row: InventoryRow, delta: number) {
    const next = Math.max(0, Number(row.quantity ?? 0) + delta);
    setSavingId(row.id);
    listRes.mutate(
      rows.map((r) => (r.id === row.id ? { ...r, quantity: next } : r)),
    );
    const res = await updateInventoryQuantity(row.id, next);
    setSavingId(null);
    if (!res.ok) {
      setToast(`Couldn't update — ${res.error}`);
      setTimeout(() => setToast(null), 3000);
      void listRes.refresh();
    }
  }

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
    <div className="page-shell inventory-page">
      <header className="page-header">
        <Link to="/more" className="page-header__back" aria-label="Back">
          <IconChevronLeft size={20} strokeWidth={2} />
        </Link>
        <h1>Inventory</h1>
      </header>

      {!listRes.loading || listRes.data ? (
        <section className="orders-stats inventory-stats" aria-label="Inventory summary">
          <div className="orders-stat orders-stat--highlight">
            <div className="orders-stat__head">
              <IconPackage size={14} strokeWidth={2} aria-hidden />
              SKUs tracked
            </div>
            <div className="orders-stat__value">
              {summaryRes.data?.totalRows ?? rows.length}
            </div>
            <div className="orders-stat__meta">
              {summaryRes.data?.totalQuantity != null
                ? `${summaryRes.data.totalQuantity} bottles on hand`
                : "Active inventory rows"}
            </div>
          </div>
          <div className="orders-stat">
            <div className="orders-stat__head">
              <IconAlert size={14} strokeWidth={2} aria-hidden />
              Low stock
            </div>
            <div className="orders-stat__value">{lowCount}</div>
            <div className="orders-stat__meta">At/below threshold</div>
          </div>
          <div className="orders-stat">
            <div className="orders-stat__head">Reorder</div>
            <div className="orders-stat__value">{reorderCount}</div>
            <div className="orders-stat__meta">At/below reorder point</div>
          </div>
        </section>
      ) : null}

      {!listRes.loading && rows.length > 0 ? (
        <div className="inventory-toolbar">
          <label className="inventory-search">
            <span className="visually-hidden">Search inventory</span>
            <input
              type="search"
              className="orders-search__input"
              placeholder="Search by bottle name or MLCC code…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="orders-chips" role="group" aria-label="Stock filter">
            {(
              [
                ["all", "All"],
                ["low", "Low stock"],
                ["reorder", "Needs reorder"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`orders-chip${stockFilter === value ? " orders-chip--active" : ""}`}
                onClick={() => setStockFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {listRes.loading && !listRes.data ? (
        <div className="inventory-loading">
          <span className="settings-spinner" aria-hidden>
            <IconLoader size={28} strokeWidth={2} />
          </span>
          <p className="muted">Loading inventory…</p>
        </div>
      ) : null}

      {error ? (
        <div className="inventory-error">
          <div className="banner banner-err">
            Couldn&apos;t load inventory: {error}
          </div>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              void listRes.refresh();
              void summaryRes.refresh();
            }}
            disabled={listRes.isValidating}
          >
            {listRes.isValidating ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}

      {!listRes.loading && rows.length === 0 && !error ? (
        <div className="inventory-empty">
          <span className="inventory-empty__icon" aria-hidden>
            <IconPackage size={26} strokeWidth={1.9} />
          </span>
          <h2 className="inventory-empty__title">No inventory tracked yet</h2>
          <p className="inventory-empty__copy">
            Counts appear here as you track stock — set levels and reorder with
            one tap.
          </p>
        </div>
      ) : null}

      {!listRes.loading && rows.length > 0 && filtered.length === 0 ? (
        <div className="inventory-empty inventory-empty--compact">
          <p className="inventory-empty__copy">
            {hasActiveFilters
              ? "No bottles match your search or filters."
              : "Nothing to show."}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setQuery("");
                setStockFilter("all");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="inventory-list">
        {filtered.map((row) => {
          const qty = Number(row.quantity ?? 0);
          const low = isLow(row);
          const statusLabel = rowStatusLabel(row);
          const statusTone = isAtOrBelowReorderPoint(row)
            ? "reorder"
            : isBelowLowThreshold(row)
              ? "low"
              : "ok";

          return (
            <li
              key={row.id}
              className={`inventory-row ${rowAccentClass(row)}`.trim()}
            >
              <button
                type="button"
                className="inventory-row__main"
                onClick={() => setEditingLevels(row)}
                title="Set reorder levels"
              >
                <div className="inventory-row__top">
                  <div className="inventory-row__name">
                    {row.bottles?.name ??
                      row.bottles?.mlcc_code ??
                      "Unknown bottle"}
                  </div>
                  {statusLabel ? (
                    <span className={`inventory-row__pill inventory-row__pill--${statusTone}`}>
                      <StatusDot tone={statusTone} />
                      {statusLabel}
                    </span>
                  ) : null}
                </div>
                <div className="inventory-row__meta muted small">
                  {row.bottles?.mlcc_code ? (
                    <span className="mono">#{row.bottles.mlcc_code}</span>
                  ) : null}
                  {row.bottles?.size ||
                  row.bottles?.size_ml ? (
                    <>
                      {row.bottles?.mlcc_code ? (
                        <span className="inventory-row__dot" aria-hidden>
                          ·
                        </span>
                      ) : null}
                      <span>
                        {row.bottles?.size ??
                          (row.bottles?.size_ml
                            ? `${row.bottles.size_ml} mL`
                            : "")}
                      </span>
                    </>
                  ) : null}
                  {row.location ? (
                    <>
                      <span className="inventory-row__dot" aria-hidden>
                        ·
                      </span>
                      <span>{row.location}</span>
                    </>
                  ) : null}
                </div>
                <span className="inventory-row__levels-hint muted small">
                  Tap to set reorder levels
                </span>
                <IconChevronRight
                  size={18}
                  strokeWidth={2}
                  className="inventory-row__chevron"
                  aria-hidden
                />
              </button>

              <div className="inventory-row__controls">
                <div className="qty-stepper inventory-row__stepper">
                  <button
                    type="button"
                    className="qty-stepper__btn"
                    aria-label="Decrease quantity"
                    disabled={savingId === row.id || qty <= 0}
                    onClick={() => void adjust(row, -1)}
                  >
                    −
                  </button>
                  <span className="qty-stepper__value">{qty}</span>
                  <button
                    type="button"
                    className="qty-stepper__btn"
                    aria-label="Increase quantity"
                    disabled={savingId === row.id}
                    onClick={() => void adjust(row, +1)}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className={`inventory-row__cart${low ? " inventory-row__cart--urgent" : ""}`}
                  aria-label={`Add ${row.bottles?.name ?? "bottle"} to order`}
                  title="Add to order"
                  disabled={reorderingId === row.id || !row.bottles?.mlcc_code}
                  onClick={() => void reorder(row)}
                >
                  <IconCart size={18} strokeWidth={1.85} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {editingLevels ? (
        <LevelsModal
          row={editingLevels}
          onClose={() => setEditingLevels(null)}
          onSaved={() => {
            setEditingLevels(null);
            void listRes.refresh();
            setToast("Reorder levels saved");
            setTimeout(() => setToast(null), 2500);
          }}
        />
      ) : null}

      {toast ? (
        <div className="inventory-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function LevelsModal({
  row,
  onClose,
  onSaved,
}: {
  row: InventoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLockBodyScroll();
  const [lowStock, setLowStock] = useState(
    row.low_stock_threshold != null ? String(row.low_stock_threshold) : "",
  );
  const [reorderPoint, setReorderPoint] = useState(
    row.reorder_point != null ? String(row.reorder_point) : "",
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const parse = (s: string): number | null => {
      const t = s.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : NaN;
    };
    const low = parse(lowStock);
    const reorder = parse(reorderPoint);
    if (Number.isNaN(low) || Number.isNaN(reorder)) {
      setErr("Levels must be whole numbers (or left blank).");
      return;
    }
    setSaving(true);
    try {
      const res = await updateReorderSettings(row.id, {
        lowStockThreshold: low,
        reorderPoint: reorder,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inventory-levels-title"
      className="inventory-levels-backdrop"
      onClick={onClose}
    >
      <div
        className="inventory-levels-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="inventory-levels-title" className="inventory-levels-card__title">
          Reorder levels
        </h2>
        <p className="inventory-levels-card__subtitle">
          {row.bottles?.name ?? row.bottles?.mlcc_code ?? "Bottle"}
          {row.bottles?.mlcc_code ? (
            <span className="mono"> · #{row.bottles.mlcc_code}</span>
          ) : null}
        </p>

        <label className="inventory-levels-field">
          <span className="inventory-levels-field__label">Low-stock threshold</span>
          <input
            type="number"
            inputMode="numeric"
            className="orders-search__input"
            value={lowStock}
            onChange={(e) => setLowStock(e.target.value)}
            placeholder="e.g. 6"
            disabled={saving}
          />
          <span className="inventory-levels-field__hint">
            Flags the bottle as low when on-hand drops to this or below.
          </span>
        </label>

        <label className="inventory-levels-field">
          <span className="inventory-levels-field__label">Reorder point</span>
          <input
            type="number"
            inputMode="numeric"
            className="orders-search__input"
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
            placeholder="e.g. 3"
            disabled={saving}
          />
          <span className="inventory-levels-field__hint">
            The level at which it should be reordered. Leave blank to ignore.
          </span>
        </label>

        {err ? (
          <p className="banner banner-err inventory-levels-field__error" role="alert">
            {err}
          </p>
        ) : null}

        <div className="inventory-levels-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
