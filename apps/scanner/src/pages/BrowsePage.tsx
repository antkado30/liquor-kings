/**
 * BrowsePage — Amazon-style catalog browsing (task #64, 2026-06-03).
 * Tony's spec from earlier in the night:
 *   "main browsing page where you scroll through all the bottles ...
 *    sort by features ... filter by tequila, whiskey, by proof, by
 *    size ... use all of the information that we have all the data
 *    we have to the max."
 *
 * Layout:
 *   - Page header with back button to scanner home + search bar.
 *   - Sticky filter row: horizontal-scrolling chips for category,
 *     ADA, size, sort. Tap a chip → opens a picker drawer with the
 *     full list of values from /catalog/browse/facets.
 *   - Product grid below — name, size, price, ADA. Tap → ProductCard.
 *   - "Load more" button at the bottom paginates via cursor.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  browseProducts,
  getBrowseFacets,
  type BrowseFacets,
  type BrowseFilters,
  type BrowseSort,
} from "../api/browse";
import { getProductFamily } from "../api/catalog";
import { ProductCard } from "../components/ProductCard";
import { useCart } from "../hooks/useCart";
import type { MlccProduct, ProductFamily } from "../types";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(n));
}

const SORT_OPTIONS: Array<{ value: BrowseSort; label: string }> = [
  { value: "name", label: "Name A→Z" },
  { value: "price_asc", label: "Price low→high" },
  { value: "price_desc", label: "Price high→low" },
  { value: "newest", label: "Newest" },
  { value: "proof_asc", label: "Proof low→high" },
  { value: "proof_desc", label: "Proof high→low" },
];

export function BrowsePage() {
  const navigate = useNavigate();
  const cart = useCart();
  const [facets, setFacets] = useState<BrowseFacets | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [products, setProducts] = useState<MlccProduct[]>([]);
  const [filters, setFilters] = useState<BrowseFilters>({});
  const [sort, setSort] = useState<BrowseSort>("name");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<
    null | "category" | "ada" | "size" | "sort"
  >(null);

  // ProductCard modal state — same pattern as ScannerPage.
  const [showProductCard, setShowProductCard] = useState(false);
  const [currentFamily, setCurrentFamily] = useState<ProductFamily | null>(null);
  const [initialCode, setInitialCode] = useState<string | undefined>(undefined);

  const openProduct = useCallback(async (p: MlccProduct) => {
    const fam = await getProductFamily(p.code);
    if (fam) {
      setInitialCode(p.code);
      setCurrentFamily(fam);
      setShowProductCard(true);
    }
  }, []);

  // Load facets once.
  useEffect(() => {
    void getBrowseFacets().then((r) => {
      if (r.ok) setFacets(r.facets);
    });
  }, []);

  // Load initial / refresh on filter or sort change.
  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await browseProducts({
      filters: { ...filters, q: query || null },
      sort,
      limit: 30,
    });
    if (r.ok) {
      setProducts(r.products);
      setCursor(r.nextCursor);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }, [filters, sort, query]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const r = await browseProducts({
      filters: { ...filters, q: query || null },
      sort,
      limit: 30,
      cursor,
    });
    if (r.ok) {
      setProducts((prev) => [...prev, ...r.products]);
      setCursor(r.nextCursor);
    } else {
      setError(r.error);
    }
    setLoadingMore(false);
  }, [cursor, loadingMore, filters, sort, query]);

  /*
    Chip label helpers — show "Category" when no filter, "Vodka" when
    set. Same pattern for ADA and Size. Sort chip always shows the
    current sort label.
  */
  const categoryChipLabel = filters.category ?? "Category";
  const adaChipLabel =
    facets?.adas.find((a) => a.number === filters.ada_number)?.name ?? "Distributor";
  const sizeChipLabel =
    facets?.sizes.find((s) => s.ml === filters.bottle_size_ml)?.label ?? "Size";
  const sortChipLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Sort";

  const hasAnyFilter =
    !!filters.category ||
    !!filters.ada_number ||
    filters.bottle_size_ml != null ||
    !!query.trim();

  const clearAll = () => {
    setFilters({});
    setQuery("");
  };

  return (
    <div className="page-shell browse-shell">
      <header className="page-header">
        <Link to="/" className="page-header__back" aria-label="Back to scanner">
          ←
        </Link>
        <h1>Browse</h1>
      </header>

      <input
        type="search"
        className="search-bar-input browse-search"
        placeholder="Search bottles by name or MLCC code..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        enterKeyHint="search"
        autoComplete="off"
      />

      <div className="browse-chips" role="group" aria-label="Filters">
        <button
          type="button"
          className={`browse-chip${filters.category ? " browse-chip--active" : ""}`}
          onClick={() => setOpenPicker("category")}
        >
          {categoryChipLabel} ▾
        </button>
        <button
          type="button"
          className={`browse-chip${filters.ada_number ? " browse-chip--active" : ""}`}
          onClick={() => setOpenPicker("ada")}
        >
          {adaChipLabel} ▾
        </button>
        <button
          type="button"
          className={`browse-chip${filters.bottle_size_ml != null ? " browse-chip--active" : ""}`}
          onClick={() => setOpenPicker("size")}
        >
          {sizeChipLabel} ▾
        </button>
        <button
          type="button"
          className="browse-chip browse-chip--sort"
          onClick={() => setOpenPicker("sort")}
        >
          {sortChipLabel} ▾
        </button>
        {hasAnyFilter ? (
          <button
            type="button"
            className="browse-chip browse-chip--clear"
            onClick={clearAll}
          >
            Clear ×
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="banner banner-err">Couldn&apos;t load: {error}</div>
      ) : null}

      {loading && products.length === 0 ? (
        <p className="muted small" style={{ padding: 24, textAlign: "center" }}>
          Loading…
        </p>
      ) : null}

      {!loading && products.length === 0 && !error ? (
        <p className="muted small" style={{ padding: 24, textAlign: "center" }}>
          No bottles match these filters. Clear filters or try a different
          search.
        </p>
      ) : null}

      <div className="browse-grid">
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            className="browse-card"
            onClick={() => void openProduct(p)}
          >
            <div className="browse-card__name">{p.name}</div>
            <div className="browse-card__meta muted small">
              {p.bottle_size_label ?? `${p.bottle_size_ml ?? "?"} mL`}
              {p.ada_name ? ` · ${p.ada_name}` : ""}
            </div>
            <div className="browse-card__bottom">
              <span className="browse-card__price">
                {money(p.licensee_price)}
              </span>
              {p.is_new_item ? <span className="browse-card__new">NEW</span> : null}
            </div>
          </button>
        ))}
      </div>

      {cursor && !loading ? (
        <button
          type="button"
          className="btn secondary btn-block"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          style={{ marginTop: 12 }}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}

      {/* Picker drawer — bottom sheet style */}
      {openPicker ? (
        <div
          className="browse-picker-backdrop"
          onClick={() => setOpenPicker(null)}
          role="presentation"
        >
          <div
            className="browse-picker"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Pick ${openPicker}`}
          >
            <div className="browse-picker__header">
              <h2>
                {openPicker === "category"
                  ? "Category"
                  : openPicker === "ada"
                    ? "Distributor"
                    : openPicker === "size"
                      ? "Bottle size"
                      : "Sort"}
              </h2>
              <button
                type="button"
                className="product-card-close product-card-close--labeled"
                onClick={() => setOpenPicker(null)}
              >
                Done
              </button>
            </div>
            <ul className="browse-picker__list">
              {openPicker === "category" ? (
                <>
                  <li>
                    <button
                      type="button"
                      className={`browse-picker__row${!filters.category ? " browse-picker__row--active" : ""}`}
                      onClick={() => {
                        setFilters((f) => ({ ...f, category: null }));
                        setOpenPicker(null);
                      }}
                    >
                      All categories
                    </button>
                  </li>
                  {facets?.categories.map((c) => (
                    <li key={c.name}>
                      <button
                        type="button"
                        className={`browse-picker__row${filters.category === c.name ? " browse-picker__row--active" : ""}`}
                        onClick={() => {
                          setFilters((f) => ({ ...f, category: c.name }));
                          setOpenPicker(null);
                        }}
                      >
                        <span>{c.name}</span>
                        <span className="muted small">{c.count}</span>
                      </button>
                    </li>
                  ))}
                </>
              ) : null}
              {openPicker === "ada" ? (
                <>
                  <li>
                    <button
                      type="button"
                      className={`browse-picker__row${!filters.ada_number ? " browse-picker__row--active" : ""}`}
                      onClick={() => {
                        setFilters((f) => ({ ...f, ada_number: null }));
                        setOpenPicker(null);
                      }}
                    >
                      All distributors
                    </button>
                  </li>
                  {facets?.adas.map((a) => (
                    <li key={a.number}>
                      <button
                        type="button"
                        className={`browse-picker__row${filters.ada_number === a.number ? " browse-picker__row--active" : ""}`}
                        onClick={() => {
                          setFilters((f) => ({ ...f, ada_number: a.number }));
                          setOpenPicker(null);
                        }}
                      >
                        <span>{a.name}</span>
                        <span className="muted small">{a.count}</span>
                      </button>
                    </li>
                  ))}
                </>
              ) : null}
              {openPicker === "size" ? (
                <>
                  <li>
                    <button
                      type="button"
                      className={`browse-picker__row${filters.bottle_size_ml == null ? " browse-picker__row--active" : ""}`}
                      onClick={() => {
                        setFilters((f) => ({ ...f, bottle_size_ml: null }));
                        setOpenPicker(null);
                      }}
                    >
                      All sizes
                    </button>
                  </li>
                  {facets?.sizes.map((s) => (
                    <li key={s.ml}>
                      <button
                        type="button"
                        className={`browse-picker__row${filters.bottle_size_ml === s.ml ? " browse-picker__row--active" : ""}`}
                        onClick={() => {
                          setFilters((f) => ({ ...f, bottle_size_ml: s.ml }));
                          setOpenPicker(null);
                        }}
                      >
                        <span>{s.label}</span>
                        <span className="muted small">{s.count}</span>
                      </button>
                    </li>
                  ))}
                </>
              ) : null}
              {openPicker === "sort" ? (
                <>
                  {SORT_OPTIONS.map((o) => (
                    <li key={o.value}>
                      <button
                        type="button"
                        className={`browse-picker__row${sort === o.value ? " browse-picker__row--active" : ""}`}
                        onClick={() => {
                          setSort(o.value);
                          setOpenPicker(null);
                        }}
                      >
                        {o.label}
                      </button>
                    </li>
                  ))}
                </>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {showProductCard && currentFamily ? (
        <ProductCard
          family={currentFamily}
          initialSelectedCode={initialCode}
          onDismiss={() => {
            setShowProductCard(false);
            setCurrentFamily(null);
            setInitialCode(undefined);
          }}
          onAddToCart={(product, quantity) => {
            cart.addItem(product, quantity);
            const sizeLabel =
              product.bottle_size_label ?? `${product.bottle_size_ml ?? ""} mL`;
            setToast(`Added ${quantity} × ${sizeLabel}`);
          }}
          onToast={(msg) => setToast(msg)}
        />
      ) : null}

      {/* Toast for add-to-cart confirmation + a quick "View cart" tap. */}
      {toast ? (
        <button
          type="button"
          className="browse-toast"
          onClick={() => navigate("/cart")}
        >
          {toast} · <strong>View cart ({cart.totalItems})</strong>
        </button>
      ) : null}

      {/* Auto-clear toast after 2.5s via inline effect. */}
      {toast ? <ToastClearer toast={toast} onClear={() => setToast(null)} /> : null}
    </div>
  );
}

/**
 * Tiny invisible component that clears a toast string after a delay.
 * Encapsulates the timer so the parent doesn't need to manage refs.
 */
function ToastClearer({
  toast,
  onClear,
}: {
  toast: string;
  onClear: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClear, 2500);
    return () => clearTimeout(t);
  }, [toast, onClear]);
  return null;
}
