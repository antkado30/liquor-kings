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
import { PlaceholderBottle, tintForCategory } from "../components/BottleArt";
import { useCart } from "../hooks/useCart";
import { useCachedResource } from "../lib/swr";
import { getCurrentStoreId } from "../lib/currentStore";
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
  const storeId = getCurrentStoreId() ?? "none";
  const [toast, setToast] = useState<string | null>(null);
  const [filters, setFilters] = useState<BrowseFilters>({});
  const [sort, setSort] = useState<BrowseSort>("name");
  const [query, setQuery] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [openPicker, setOpenPicker] = useState<
    null | "category" | "ada" | "size" | "sort" | "price" | "proof"
  >(null);

  // Facets rarely change — cache them so reopening Browse is instant.
  const facetsRes = useCachedResource<BrowseFacets>(
    `browse:facets:${storeId}`,
    async () => {
      const r = await getBrowseFacets();
      if (!r.ok) throw new Error("facets_failed");
      return r.facets;
    },
    5 * 60_000, // facets are very stable; refresh at most every 5 min
  );
  const facets = facetsRes.data ?? null;

  // Product list — cached per (filters + sort + query) combo so flipping
  // filters back and forth, or returning to the Catalog tab, is instant.
  const listKey = `browse:list:${storeId}:${JSON.stringify({ filters, sort, query })}`;
  const listRes = useCachedResource<{ products: MlccProduct[]; cursor: string | null }>(
    listKey,
    async () => {
      const r = await browseProducts({
        filters: { ...filters, q: query || null },
        sort,
        limit: 30,
      });
      if (!r.ok) throw new Error(r.error);
      return { products: r.products, cursor: r.nextCursor };
    },
  );
  const products = listRes.data?.products ?? [];
  const cursor = listRes.data?.cursor ?? null;
  const loading = listRes.loading;
  const error = listRes.error
    ? listRes.error instanceof Error
      ? listRes.error.message
      : String(listRes.error)
    : null;

  // Local input buffers for the range pickers (task #73, 2026-06-04).
  // Held separately from `filters` so the user can type freely without
  // re-fetching mid-keystroke. Committed to filters on the Apply tap.
  const [priceMinInput, setPriceMinInput] = useState("");
  const [priceMaxInput, setPriceMaxInput] = useState("");
  const [proofMinInput, setProofMinInput] = useState("");
  const [proofMaxInput, setProofMaxInput] = useState("");

  // ProductCard modal state — same pattern as ScannerPage.
  const [showProductCard, setShowProductCard] = useState(false);
  const [currentFamily, setCurrentFamily] = useState<ProductFamily | null>(null);
  const [initialCode, setInitialCode] = useState<string | undefined>(undefined);

  const openProduct = useCallback(async (p: MlccProduct) => {
    // Never silently drop the tap if the family lookup fails — we already have
    // the full product, so fall back to a single-size family so the card opens.
    const fam: ProductFamily =
      (await getProductFamily(p.code)) ?? { baseName: p.name, sizes: [p] };
    setInitialCode(p.code);
    setCurrentFamily(fam);
    setShowProductCard(true);
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await browseProducts({
        filters: { ...filters, q: query || null },
        sort,
        limit: 30,
        cursor,
      });
      if (r.ok) {
        // Append into the cache so the longer list survives a tab switch.
        listRes.mutate({
          products: [...products, ...r.products],
          cursor: r.nextCursor,
        });
      } else {
        // Don't fail silently — the user tapped "Load more" and deserves
        // to know why nothing happened. (Stuck-spinner / silent-failure
        // sweep, 2026-06-09.)
        setToast(
          r.error === "session_expired"
            ? "Session expired — refresh to keep browsing."
            : "Couldn't load more bottles. Check your connection and try again.",
        );
      }
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, filters, sort, query, products, listRes]);

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

  // Range chip labels — show "Price" when unset, "$20-$50" etc. when bounded.
  const priceChipLabel =
    filters.min_price != null && filters.max_price != null
      ? `$${filters.min_price}-$${filters.max_price}`
      : filters.min_price != null
        ? `≥ $${filters.min_price}`
        : filters.max_price != null
          ? `≤ $${filters.max_price}`
          : "Price";

  const proofChipLabel =
    filters.min_proof != null && filters.max_proof != null
      ? `${filters.min_proof}-${filters.max_proof} proof`
      : filters.min_proof != null
        ? `≥ ${filters.min_proof} proof`
        : filters.max_proof != null
          ? `≤ ${filters.max_proof} proof`
          : "Proof";

  const hasAnyFilter =
    !!filters.category ||
    !!filters.ada_number ||
    filters.bottle_size_ml != null ||
    filters.min_price != null ||
    filters.max_price != null ||
    filters.min_proof != null ||
    filters.max_proof != null ||
    !!query.trim();

  const clearAll = () => {
    setFilters({});
    setQuery("");
    setPriceMinInput("");
    setPriceMaxInput("");
    setProofMinInput("");
    setProofMaxInput("");
  };

  // Apply handlers — parse inputs, push into filters, close picker.
  const applyPriceRange = () => {
    const min = priceMinInput.trim() === "" ? null : Number(priceMinInput);
    const max = priceMaxInput.trim() === "" ? null : Number(priceMaxInput);
    setFilters((f) => ({
      ...f,
      min_price: Number.isFinite(min) ? min : null,
      max_price: Number.isFinite(max) ? max : null,
    }));
    setOpenPicker(null);
  };
  const applyProofRange = () => {
    const min = proofMinInput.trim() === "" ? null : Number(proofMinInput);
    const max = proofMaxInput.trim() === "" ? null : Number(proofMaxInput);
    setFilters((f) => ({
      ...f,
      min_proof: Number.isFinite(min) ? min : null,
      max_proof: Number.isFinite(max) ? max : null,
    }));
    setOpenPicker(null);
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
          className={`browse-chip${filters.min_price != null || filters.max_price != null ? " browse-chip--active" : ""}`}
          onClick={() => {
            setPriceMinInput(filters.min_price?.toString() ?? "");
            setPriceMaxInput(filters.max_price?.toString() ?? "");
            setOpenPicker("price");
          }}
        >
          {priceChipLabel} ▾
        </button>
        <button
          type="button"
          className={`browse-chip${filters.min_proof != null || filters.max_proof != null ? " browse-chip--active" : ""}`}
          onClick={() => {
            setProofMinInput(filters.min_proof?.toString() ?? "");
            setProofMaxInput(filters.max_proof?.toString() ?? "");
            setOpenPicker("proof");
          }}
        >
          {proofChipLabel} ▾
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
            <BrowseCardImage product={p} />
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
                      : openPicker === "price"
                        ? "Price range"
                        : openPicker === "proof"
                          ? "Proof range"
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
              {openPicker === "price" ? (
                <li style={{ padding: 12 }}>
                  <p className="muted small" style={{ margin: "0 0 12px 0" }}>
                    Filter by licensee price. Leave a box empty to skip that bound.
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 14 }}>$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="min"
                      value={priceMinInput}
                      onChange={(e) => setPriceMinInput(e.target.value)}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "inherit" }}
                    />
                    <span>to</span>
                    <span style={{ fontSize: 14 }}>$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="max"
                      value={priceMaxInput}
                      onChange={(e) => setPriceMaxInput(e.target.value)}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "inherit" }}
                    />
                  </div>
                  {/* Quick-pick presets — common ranges for liquor pricing */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {[
                      { label: "Under $20", min: "", max: "20" },
                      { label: "$20–$50", min: "20", max: "50" },
                      { label: "$50–$100", min: "50", max: "100" },
                      { label: "$100+", min: "100", max: "" },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="browse-chip"
                        onClick={() => {
                          setPriceMinInput(preset.min);
                          setPriceMaxInput(preset.max);
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setPriceMinInput("");
                        setPriceMaxInput("");
                        setFilters((f) => ({ ...f, min_price: null, max_price: null }));
                        setOpenPicker(null);
                      }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      style={{ flex: 1 }}
                      onClick={applyPriceRange}
                    >
                      Apply
                    </button>
                  </div>
                </li>
              ) : null}
              {openPicker === "proof" ? (
                <li style={{ padding: 12 }}>
                  <p className="muted small" style={{ margin: "0 0 12px 0" }}>
                    Filter by alcohol proof. Beer is ~10, wine ~24, liquor 60-100+, overproof 100+.
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="min"
                      value={proofMinInput}
                      onChange={(e) => setProofMinInput(e.target.value)}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "inherit" }}
                    />
                    <span>to</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="max"
                      value={proofMaxInput}
                      onChange={(e) => setProofMaxInput(e.target.value)}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "inherit" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {[
                      { label: "Low (≤80)", min: "", max: "80" },
                      { label: "Standard (80–100)", min: "80", max: "100" },
                      { label: "High (100+)", min: "100", max: "" },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="browse-chip"
                        onClick={() => {
                          setProofMinInput(preset.min);
                          setProofMaxInput(preset.max);
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setProofMinInput("");
                        setProofMaxInput("");
                        setFilters((f) => ({ ...f, min_proof: null, max_proof: null }));
                        setOpenPicker(null);
                      }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      style={{ flex: 1 }}
                      onClick={applyProofRange}
                    >
                      Apply
                    </button>
                  </div>
                </li>
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

/**
 * Category placeholder colors. Tony's spec: every browse card must
 * show *something* visual, never a blank box. When image_url is NULL
 * (which is the vast majority of the ~13k SKUs until backfill runs),
 * we render a category-tinted bottle silhouette so the grid still
 * scans cleanly as a "wall of bottles."
 *
 * The pin-point-accuracy rule from Tony — "we cannot have random
 * pictures to random bottles like imagine putting a fifth of Tito's
 * picture on a pint of Hennessy code" — means we ONLY render the
 * real <img> when the row has a verified image_url set by the
 * backfill script. We never substitute "any image from this
 * category" as a stand-in for a specific SKU.
 */
/**
 * Browse card image slot. Renders the real product image if the
 * catalog row has image_url, otherwise a category-tinted bottle
 * silhouette. Sets `loading="lazy"` so Tony's iPhone doesn't try to
 * pull every image at once when the grid first paints.
 */
function BrowseCardImage({ product }: { product: MlccProduct }) {
  const [errored, setErrored] = useState(false);
  const url = product.imageUrl;
  const showImage = !!url && !errored;
  return (
    <div className="browse-card__img">
      {showImage ? (
        <img
          src={url ?? undefined}
          alt={product.name}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
        />
      ) : (
        <PlaceholderBottle
          tint={tintForCategory(product.category)}
          name={product.name}
          seed={product.id}
        />
      )}
    </div>
  );
}
