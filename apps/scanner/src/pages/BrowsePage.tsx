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
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  browseFamilies,
  browseProducts,
  getBrowseFacets,
  type BrowseFacets,
  type BrowseFilters,
  type BrowseSort,
} from "../api/browse";
import { getProductFamily, searchProductsGrouped } from "../api/catalog";
import { ProductCard } from "../components/ProductCard";
import { PlaceholderBottle, tintForCategory } from "../components/BottleArt";
import { IconCheck, IconChevronRight } from "../components/Icons";
import { useCart } from "../hooks/useCart";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import { useCachedResource } from "../lib/swr";
import { getCurrentStoreId } from "../lib/currentStore";
import type { FamilyGroup, MlccProduct, ProductFamily } from "../types";
import { nonGlassContainerSuffix, packCountSuffix } from "../lib/container-label";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(n));
}

/*
  Family-first scrolling kill switch (2026-07-12, plan §safety). ON: the
  Catalog tab with no search and no size filter browses the whole catalog
  as one card per product line (browse_families RPC). Flip to false to
  restore flat scrolling everywhere with zero other changes — the flat
  grid also takes over automatically if the RPC/migration is missing.
*/
const FAMILY_BROWSE_ENABLED = true;

const SORT_OPTIONS: Array<{ value: BrowseSort; sheet: string; chip: string }> = [
  { value: "name", sheet: "Featured", chip: "Sort" },
  { value: "price_asc", sheet: "Price: Low to High", chip: "Price ↑" },
  { value: "price_desc", sheet: "Price: High to Low", chip: "Price ↓" },
  { value: "proof_desc", sheet: "Proof: High to Low", chip: "Proof ↓" },
  { value: "proof_asc", sheet: "Proof: Low to High", chip: "Proof ↑" },
  { value: "newest", sheet: "Newest", chip: "Newest" },
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
  const listEndRef = useRef<HTMLDivElement>(null);
  const [scrollFab, setScrollFab] = useState<"up" | "down" | null>(null);

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

  /*
    Grouped search in Browse (2026-07-11 pt.2 — Tony: family cards
    "should be everywhere", after finding the flat grid here on his first
    live look). When a SEARCH TERM is typed (and no size filter — asking
    for one size means asking for specific bottles), results collapse to
    one family card per product line, same truth as the scan-page search.
    Pure scrolling and filtered browsing keep the flat grid + cursor
    pagination. Zero groups (typo → fuzzy-only match) re-enables the flat
    list below, which owns the fuzzy fallback — so misspellings behave
    exactly as before. useCachedResource treats a null key as disabled.
  */
  const groupedMode = query.trim().length >= 2 && filters.bottle_size_ml == null;
  const groupsKey = groupedMode
    ? `browse:groups:${storeId}:${JSON.stringify({ filters, query: query.trim() })}`
    : null;
  const groupsRes = useCachedResource<{ groups: FamilyGroup[] }>(
    groupsKey,
    async () => {
      const groups = await searchProductsGrouped(query.trim(), {
        limit: 30,
        adaNumber: filters.ada_number ?? undefined,
        category: filters.category ?? undefined,
        minPrice: filters.min_price ?? undefined,
        maxPrice: filters.max_price ?? undefined,
        minProof: filters.min_proof ?? undefined,
        maxProof: filters.max_proof ?? undefined,
      });
      return { groups };
    },
  );
  const groups = groupedMode ? (groupsRes.data?.groups ?? []) : [];
  const showGroups = groupedMode && groups.length > 0;

  /*
    Family-first SCROLLING (2026-07-12 — Tony: family cards "should be
    everywhere"). With NO search typed and NO size filter, the Catalog
    tab now browses the whole catalog as one card per product line,
    served by the browse_families RPC with the active filters + sort
    mapped to family-level aggregates, offset-paginated.

    Fallbacks, all silent: RPC missing (migration not applied — valid
    deploy order), fetch error, or zero results → the flat grid takes
    over. Never a dead tab. Flip FAMILY_BROWSE_ENABLED to false to
    restore flat scrolling everywhere with zero other changes.
  */
  const familyScrollMode =
    FAMILY_BROWSE_ENABLED && !groupedMode && filters.bottle_size_ml == null;
  const famKey = familyScrollMode
    ? `browse:families:${storeId}:${JSON.stringify({ filters, sort })}`
    : null;
  const famRes = useCachedResource<{
    groups: FamilyGroup[];
    hasMore: boolean;
    nextOffset: number;
    unavailable?: boolean;
  }>(famKey, async () => {
    const r = await browseFamilies({
      filters: {
        category: filters.category ?? null,
        ada_number: filters.ada_number ?? null,
        min_price: filters.min_price ?? null,
        max_price: filters.max_price ?? null,
        min_proof: filters.min_proof ?? null,
        max_proof: filters.max_proof ?? null,
      },
      sort,
      limit: 30,
      offset: 0,
    });
    if (!r.ok) {
      if (r.error === "rpc_missing") {
        // Migration not applied yet — mark unavailable so the flat grid
        // takes over quietly (cached, so we don't re-ask every render).
        return { groups: [], hasMore: false, nextOffset: 0, unavailable: true };
      }
      throw new Error(r.error);
    }
    return { groups: r.groups, hasMore: r.hasMore, nextOffset: 30 };
  });
  const famGroups = familyScrollMode ? (famRes.data?.groups ?? []) : [];
  const showFamilyScroll =
    familyScrollMode && famRes.data != null && !famRes.data.unavailable && famGroups.length > 0;
  const [famLoadingMore, setFamLoadingMore] = useState(false);

  // Product list — cached per (filters + sort + query) combo so flipping
  // filters back and forth, or returning to the Catalog tab, is instant.
  // DISABLED (null key) while family cards are showing or still loading —
  // it only fetches flat results when grouping is off, or as the
  // fallback once a grouped search / family scroll comes back empty,
  // errored, or unavailable. Fail toward FLAT: never a dead tab.
  const flatListActive = groupedMode
    ? groupsRes.error != null ||
      (groupsRes.data != null && groupsRes.data.groups.length === 0)
    : familyScrollMode
      ? famRes.error != null ||
        (famRes.data != null && (famRes.data.unavailable === true || famRes.data.groups.length === 0))
      : true;
  const listKey = flatListActive
    ? `browse:list:${storeId}:${JSON.stringify({ filters, sort, query })}`
    : null;
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

  const products = flatListActive ? (listRes.data?.products ?? []) : [];
  const cursor = flatListActive ? (listRes.data?.cursor ?? null) : null;
  const loading = groupedMode
    ? groupsRes.loading || (flatListActive && listRes.loading)
    : familyScrollMode
      ? famRes.loading || (flatListActive && listRes.loading)
      : listRes.loading;

  /*
    "Load more" for family scrolling: fetch the next offset window and
    append into the cached blob so the longer list survives a tab switch
    (same pattern as the flat loadMore below).
  */
  const famLoadMore = useCallback(async () => {
    const cur = famRes.data;
    if (!cur || famLoadingMore || !cur.hasMore) return;
    setFamLoadingMore(true);
    try {
      const r = await browseFamilies({
        filters: {
          category: filters.category ?? null,
          ada_number: filters.ada_number ?? null,
          min_price: filters.min_price ?? null,
          max_price: filters.max_price ?? null,
          min_proof: filters.min_proof ?? null,
          max_proof: filters.max_proof ?? null,
        },
        sort,
        limit: 30,
        offset: cur.nextOffset,
      });
      if (r.ok) {
        famRes.mutate({
          groups: [...cur.groups, ...r.groups],
          hasMore: r.hasMore,
          nextOffset: cur.nextOffset + 30,
        });
      } else {
        setToast("Couldn't load more families. Check your connection and try again.");
      }
    } finally {
      setFamLoadingMore(false);
    }
  }, [famRes, famLoadingMore, filters, sort]);
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
    SORT_OPTIONS.find((o) => o.value === sort)?.chip ?? "Sort";

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

  const hasActiveSort = sort !== "name";
  const hasAnyFilter =
    !!filters.category ||
    !!filters.ada_number ||
    filters.bottle_size_ml != null ||
    filters.min_price != null ||
    filters.max_price != null ||
    filters.min_proof != null ||
    filters.max_proof != null ||
    !!query.trim() ||
    hasActiveSort;

  const clearAll = () => {
    setFilters({});
    setSort("name");
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

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => {
    const manyItemsMin = 12;
    const onScroll = () => {
      const y = window.scrollY;
      const vh = window.innerHeight;
      const many = products.length >= manyItemsMin;
      if (y > vh * 2) {
        setScrollFab("up");
      } else if (many && y < vh * 0.5) {
        setScrollFab("down");
      } else {
        setScrollFab(null);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [products.length]);

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

      <div className="browse-chips browse-chips-v2" role="group" aria-label="Filters">
        <BrowseFilterChip
          label={sortChipLabel}
          active={hasActiveSort}
          onClick={() => setOpenPicker("sort")}
        />
        <BrowseFilterChip
          label={categoryChipLabel}
          active={!!filters.category}
          onClick={() => setOpenPicker("category")}
        />
        <BrowseFilterChip
          label={adaChipLabel}
          active={!!filters.ada_number}
          onClick={() => setOpenPicker("ada")}
        />
        <BrowseFilterChip
          label={sizeChipLabel}
          active={filters.bottle_size_ml != null}
          onClick={() => setOpenPicker("size")}
        />
        <BrowseFilterChip
          label={priceChipLabel}
          active={filters.min_price != null || filters.max_price != null}
          onClick={() => {
            setPriceMinInput(filters.min_price?.toString() ?? "");
            setPriceMaxInput(filters.max_price?.toString() ?? "");
            setOpenPicker("price");
          }}
        />
        <BrowseFilterChip
          label={proofChipLabel}
          active={filters.min_proof != null || filters.max_proof != null}
          onClick={() => {
            setProofMinInput(filters.min_proof?.toString() ?? "");
            setProofMaxInput(filters.max_proof?.toString() ?? "");
            setOpenPicker("proof");
          }}
        />
        {hasAnyFilter ? (
          <button
            type="button"
            className="browse-chip browse-chip-v2 browse-chip-v2--clear"
            onClick={clearAll}
          >
            Clear all
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

      {!loading && !showGroups && !showFamilyScroll && products.length === 0 && !error ? (
        <p className="muted small" style={{ padding: 24, textAlign: "center" }}>
          No bottles match these filters. Clear filters or try a different
          search.
        </p>
      ) : null}

      {/*
        Premium family cards (2026-07-12 design pass) — stacked full-width
        rows with photo, size-count badge, real size chips, price range,
        and glass/plastic signal. Two sources, same markup: search results
        grouped by family (2026-07-11) and full-catalog family SCROLLING
        (2026-07-12). Tap opens the ProductCard tree at the representative.
      */}
      {showGroups || showFamilyScroll ? (
        <div className="fam-list">
          {(showGroups ? groups : famGroups).map((g) => {
            const rep = g.representative;
            /*
              Badge truth (2026-07-12 Tito's audit): sizeCount is DISTINCT
              CODES, which counts pack variants — Tito's read "12 sizes"
              when it has ~4 actual sizes across 12 orderable variants.
              The sizes[] list is already deduped by label, so its length
              IS the size count; sizeCount stays as the fallback for
              payloads that predate the field.
            */
            const sizeN = g.sizes?.length || g.sizeCount;
            const multi = sizeN > 1;
            // Real size chips: first 3 labels + a "+N" overflow (Tony's
            // 2026-07-12 pick). Falls back to nothing when the payload
            // predates the sizes field — the badge still carries the count.
            const sizeChips = (g.sizes ?? []).slice(0, 3);
            const overflow = (g.sizes?.length ?? 0) - sizeChips.length;
            const price =
              g.minPrice != null && g.maxPrice != null && g.maxPrice > g.minPrice
                ? `${money(g.minPrice)}–${money(g.maxPrice)}`
                : money(g.minPrice ?? g.maxPrice ?? rep.licensee_price);
            return (
              <button
                key={`${g.familyKey || rep.code}|${g.category ?? ""}|${rep.code}`}
                type="button"
                className="fam-card"
                onClick={() => void openProduct(rep)}
              >
                <div className="fam-card__photo">
                  <FamCardImage product={rep} />
                  <span
                    className={`fam-card__badge${multi ? "" : " fam-card__badge--single"}`}
                  >
                    {multi ? `${sizeN} sizes` : "1 size"}
                  </span>
                </div>
                <div className="fam-card__body">
                  <div className="fam-card__name">{g.baseName}</div>
                  <div className="fam-card__chips">
                    {sizeChips.length > 0 ? (
                      sizeChips.map((s) => (
                        <span key={s} className="fam-chip">
                          {s}
                        </span>
                      ))
                    ) : g.category ? (
                      <span className="fam-chip fam-chip--cat">{g.category}</span>
                    ) : null}
                    {overflow > 0 ? (
                      <span className="fam-chip fam-chip--more">+{overflow}</span>
                    ) : null}
                    {sizeChips.length > 0 && !multi && g.category ? (
                      <span className="fam-chip fam-chip--cat">{g.category}</span>
                    ) : null}
                  </div>
                  <div className="fam-card__footer">
                    <span className="fam-card__price">{price}</span>
                    {g.mixedContainers ? (
                      <span className="fam-card__material">
                        <span className="fam-card__dot" aria-hidden />
                        glass &amp; plastic
                      </span>
                    ) : rep.is_new_item ? (
                      <span className="browse-card__new">NEW</span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {showFamilyScroll && famRes.data?.hasMore ? (
        <button
          type="button"
          className="btn secondary btn-block"
          onClick={() => void famLoadMore()}
          disabled={famLoadingMore}
          style={{ marginTop: 12 }}
        >
          {famLoadingMore ? "Loading…" : "Load more"}
        </button>
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
              {/* material + pack (2026-07-12 class sweep): flat cards must
                  distinguish pack variants like the chips do. */}
              {p.bottle_size_label ?? `${p.bottle_size_ml ?? "?"} mL`}
              {nonGlassContainerSuffix(p.container)}
              {packCountSuffix(p.pack_count)}
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

      <div ref={listEndRef} className="browse-list-end" aria-hidden />

      <button
        type="button"
        className={`browse-fab${scrollFab ? ` browse-fab--visible browse-fab--${scrollFab}` : ""}`}
        onClick={() => {
          if (scrollFab === "up") scrollToTop();
          else if (scrollFab === "down") scrollToBottom();
        }}
        aria-label={scrollFab === "up" ? "Scroll to top" : "Scroll to bottom"}
        tabIndex={scrollFab ? 0 : -1}
        aria-hidden={!scrollFab}
      >
        <IconChevronRight size={20} strokeWidth={2} className="browse-fab__chevron" />
      </button>

      {/* Picker drawer — premium dark bottom sheet */}
      {openPicker ? (
        <>
          <PickerScrollLock />
          <div
            className="browse-sheet-backdrop"
            onClick={() => setOpenPicker(null)}
            role="presentation"
          >
            <div
              className="browse-sheet"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`Pick ${openPicker}`}
            >
              <div className="browse-sheet__grab" aria-hidden="true" />
              <div className="browse-sheet__header">
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
              <ul className="browse-sheet__list">
                {openPicker === "category" ? (
                  <>
                    <li>
                      <BrowseSheetRow
                        selected={!filters.category}
                        onClick={() => {
                          setFilters((f) => ({ ...f, category: null }));
                          setOpenPicker(null);
                        }}
                      >
                        All categories
                      </BrowseSheetRow>
                    </li>
                    {facets?.categories.map((c) => (
                      <li key={c.name}>
                        <BrowseSheetRow
                          selected={filters.category === c.name}
                          onClick={() => {
                            setFilters((f) => ({ ...f, category: c.name }));
                            setOpenPicker(null);
                          }}
                        >
                          <span>{c.name}</span>
                          <span className="muted small">{c.count}</span>
                        </BrowseSheetRow>
                      </li>
                    ))}
                  </>
                ) : null}
                {openPicker === "ada" ? (
                  <>
                    <li>
                      <BrowseSheetRow
                        selected={!filters.ada_number}
                        onClick={() => {
                          setFilters((f) => ({ ...f, ada_number: null }));
                          setOpenPicker(null);
                        }}
                      >
                        All distributors
                      </BrowseSheetRow>
                    </li>
                    {facets?.adas.map((a) => (
                      <li key={a.number}>
                        <BrowseSheetRow
                          selected={filters.ada_number === a.number}
                          onClick={() => {
                            setFilters((f) => ({ ...f, ada_number: a.number }));
                            setOpenPicker(null);
                          }}
                        >
                          <span>{a.name}</span>
                          <span className="muted small">{a.count}</span>
                        </BrowseSheetRow>
                      </li>
                    ))}
                  </>
                ) : null}
                {openPicker === "size" ? (
                  <>
                    <li>
                      <BrowseSheetRow
                        selected={filters.bottle_size_ml == null}
                        onClick={() => {
                          setFilters((f) => ({ ...f, bottle_size_ml: null }));
                          setOpenPicker(null);
                        }}
                      >
                        All sizes
                      </BrowseSheetRow>
                    </li>
                    {facets?.sizes.map((s) => (
                      <li key={s.ml}>
                        <BrowseSheetRow
                          selected={filters.bottle_size_ml === s.ml}
                          onClick={() => {
                            setFilters((f) => ({ ...f, bottle_size_ml: s.ml }));
                            setOpenPicker(null);
                          }}
                        >
                          <span>{s.label}</span>
                          <span className="muted small">{s.count}</span>
                        </BrowseSheetRow>
                      </li>
                    ))}
                  </>
                ) : null}
                {openPicker === "sort" ? (
                  <>
                    {SORT_OPTIONS.map((o) => (
                      <li key={o.value}>
                        <BrowseSheetRow
                          selected={sort === o.value}
                          onClick={() => {
                            setSort(o.value);
                            setOpenPicker(null);
                          }}
                        >
                          {o.sheet}
                        </BrowseSheetRow>
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
        </>
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
            const sizeLabel = `${product.bottle_size_label ?? `${product.bottle_size_ml ?? ""} mL`}${nonGlassContainerSuffix(product.container)}${packCountSuffix(product.pack_count)}`;
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
function BrowseFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`browse-chip browse-chip-v2${active ? " browse-chip-v2--active" : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <IconChevronRight size={14} className="browse-chip-v2__chevron" aria-hidden />
    </button>
  );
}

function BrowseSheetRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`browse-sheet__row${selected ? " browse-sheet__row--selected" : ""}`}
      onClick={onClick}
    >
      <span className="browse-sheet__row-main">{children}</span>
      {selected ? (
        <IconCheck size={18} className="browse-sheet__row-check" aria-hidden />
      ) : null}
    </button>
  );
}

function PickerScrollLock() {
  useLockBodyScroll();
  return null;
}

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
  // Thumb first (≈360px WebP, ~10-25KB) — decoding multi-MB originals
  // into 150px tiles is the phone-overheating class (quality mandate,
  // 2026-06-12). Fall back to the full image until the backfill reaches
  // this code, then to the placeholder if that errors too.
  const url = product.imageThumbUrl ?? product.imageUrl;
  const showImage = !!url && !errored;
  return (
    <div className="browse-card__img browse-card-img-slot">
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

/**
 * Lean image for the premium family card (2026-07-12) — just the <img>
 * or placeholder, no wrapper/gradient (the .fam-card__photo frame owns
 * the surface). Same thumb-first + error-fallback logic as
 * BrowseCardImage so behavior and the phone-overheating guard match.
 */
function FamCardImage({ product }: { product: MlccProduct }) {
  const [errored, setErrored] = useState(false);
  const url = product.imageThumbUrl ?? product.imageUrl;
  if (url && !errored) {
    return (
      <img
        src={url}
        alt={product.name}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <PlaceholderBottle
      tint={tintForCategory(product.category)}
      name={product.name}
      seed={product.id}
    />
  );
}
