import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  confirmUpcMapping,
  getPriceBookStatus,
  getProductByCode,
  getProductByUpc,
  getProductFamily,
  reportUpcNoMatch,
} from "../api/catalog";
import { signOut } from "../lib/supabase";
import { Sentry } from "../lib/sentry";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { CartDrawer } from "../components/CartDrawer";
import { ProductCard } from "../components/ProductCard";
// Heavy, on-demand overlays — lazy-loaded so they're not in the home bundle.
const AnalyticsDashboard = lazy(() =>
  import("../components/AnalyticsDashboard").then((m) => ({
    default: m.AnalyticsDashboard,
  })),
);
import { ScheduledTemplateBanner } from "../components/ScheduledTemplateBanner";
import { SmartCards } from "../components/SmartCards";
import { VerifyMlccBanner } from "../components/VerifyMlccBanner";
import type { StoreVerificationMeta } from "../api/home";
import { PlaceholderBottle, tintForCategory } from "../components/BottleArt";
import {
  IconCart,
  IconChevronRight,
  IconSparkles,
  IconX,
} from "../components/Icons";
import { UpcCandidatePicker } from "../components/UpcCandidatePicker";
import { VisionCandidatePicker } from "../components/VisionCandidatePicker";
import {
  identifyFromImage,
  type VisionExtracted,
} from "../api/catalog-vision";
import { SearchBar } from "../components/SearchBar";
import { useCart } from "../hooks/useCart";
import { useCatalogSearch } from "../hooks/useCatalogSearch";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useBackgroundPreValidate } from "../hooks/useBackgroundPreValidate";
import { useCachedResource } from "../lib/swr";
import { getCurrentStoreId } from "../lib/currentStore";
import type { MlccProduct, ProductFamily, UpcLookupResponse } from "../types";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function ScannerPage() {
  const cart = useCart();
  const search = useCatalogSearch();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  /*
    Background pre-validate (task #47, 2026-06-02). Lives at the
    ScannerPage level so the cart-watch effect keeps running even
    when the cart drawer is closed (which is the whole point — the
    user scans bottles, we silently validate them, by the time they
    open the drawer the result is waiting). CartDrawer receives the
    cache via props and threads it into useSubmission.
  */
  const preValidate = useBackgroundPreValidate(cart.items);

  // Camera is ALWAYS on (home simplification 2026-06-02). The previous
  // "Camera scanner on" toggle added zero value — every user wanted the
  // camera. Removed.
  /**
   * True from the moment a code is scanned/typed until the lookup resolves
   * (or fails). Lets us show a loading indicator so a slow network doesn't
   * look like the scanner froze. Cleared in handleScan's finally block.
   */
  const [scanInFlight, setScanInFlight] = useState(false);
  /**
   * Confirmation modal state for sign-out — guards against an accidental
   * tap on the header button mid-shift.
   */
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [showProductCard, setShowProductCard] = useState(false);
  const [currentFamily, setCurrentFamily] = useState<ProductFamily | null>(null);
  /** MLCC code of the row that opened the card — drives initial size tab in ProductCard. */
  const [productCardInitialCode, setProductCardInitialCode] = useState<string | undefined>(undefined);
  const [showCart, setShowCart] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  /*
   * Auto-open Dashboard / Cart overlays when the user navigates
   * to / with a query param (task #90, 2026-06-07). The More page
   * uses this — `?view=dashboard`. Legacy `?view=assistant` redirects
   * to /assistant. After the overlay opens we strip the query string
   * so a back-button press doesn't keep re-opening it.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const view = searchParams.get("view");
    if (view === "dashboard") {
      setShowDashboard(true);
      searchParams.delete("view");
      setSearchParams(searchParams, { replace: true });
    } else if (view === "assistant") {
      searchParams.delete("view");
      setSearchParams(searchParams, { replace: true });
      navigate("/assistant", { replace: true });
    } else if (view === "cart") {
      // Cart tab routes here so the real CartDrawer opens (the
      // standalone CartPage was a stub — Tony's 2026-06-07 fix).
      setShowCart(true);
      searchParams.delete("view");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, navigate]);
  /*
   * Persistent activation state (task #88). storeMeta comes back
   * with the smart-cards fetch — undefined while loading, then an
   * object after the API resolves. If
   * mlcc_credentials_last_verified_at is null/missing, render the
   * VerifyMlccBanner above SmartCards. `verifyRefreshKey` is a
   * counter we bump after a successful probe to force SmartCards
   * to re-fetch so the banner disappears.
   */
  const [storeMeta, setStoreMeta] = useState<
    StoreVerificationMeta | undefined
  >(undefined);
  const [verifyRefreshKey, setVerifyRefreshKey] = useState(0);
  const needsMlccVerification =
    storeMeta !== undefined && !storeMeta.mlcc_credentials_last_verified_at;
  const [toast, setToast] = useState<string | null>(null);
  const [notFoundMsg, setNotFoundMsg] = useState(false);
  const [upcCandidates, setUpcCandidates] = useState<{
    candidates: MlccProduct[];
    upc: string;
    upcProductName: string;
    upcBrand?: string;
    confidenceWarning?: string;
  } | null>(null);
  /** When set, ProductCard may flag this UPC (camera scan + UPCitemdb match path only). */
  const [upcScanContext, setUpcScanContext] = useState<{ upc: string } | null>(null);
  /** When set, a search result tap writes `upc_mappings` for this scanned UPC. */
  const [upcBeingMapped, setUpcBeingMapped] = useState<string | null>(null);
  const [upcMappingExpectedQuery, setUpcMappingExpectedQuery] = useState<string | null>(null);
  // Price-book staleness was previously rendered as a banner here;
  // smart cards now handle that surfacing (task #63). We still need
  // the latest book date for ProductCard's per-product freshness
  // check (#44), so that state stays.
  // Cached price-book date — was refetched on every home visit. ProductCard
  // needs it for per-product freshness (#44). Stable for days, so cache long.
  const priceBookRes = useCachedResource<string | null>(
    `pricebook:status:${getCurrentStoreId() ?? "none"}`,
    async () => {
      const s = await getPriceBookStatus();
      return s.ok &&
        typeof s.priceBookDate === "string" &&
        s.priceBookDate.trim() !== ""
        ? s.priceBookDate.trim()
        : null;
    },
    10 * 60_000,
  );
  const latestPriceBookDate = priceBookRes.data ?? null;
  const [networkWarn, setNetworkWarn] = useState(false);
  /*
    Vision identification state (task #37, 2026-06-01). When the user
    taps "Take a photo" from the scanner's trouble panel, we POST the
    frame to /catalog/identify-from-image and stash the result here.
    Null when not in flight or no result yet.
    visionBusy gates the camera button while the API call is running.
  */
  const [visionResult, setVisionResult] = useState<{
    extracted: VisionExtracted;
    candidates: MlccProduct[];
    hint: string | null;
  } | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!notFoundMsg) return;
    const t = setTimeout(() => setNotFoundMsg(false), 2000);
    return () => clearTimeout(t);
  }, [notFoundMsg]);

  useEffect(() => {
    if (upcBeingMapped == null) return;
    if (upcMappingExpectedQuery == null) return;
    // Auto-fill was non-empty AND user has cleared the search -> they abandoned this scan.
    if (upcMappingExpectedQuery.trim().length > 0 && search.query.trim().length === 0) {
      setUpcBeingMapped(null);
      setUpcMappingExpectedQuery(null);
    }
  }, [search.query, upcBeingMapped, upcMappingExpectedQuery]);

  const openFamily = useCallback(async (p: MlccProduct, opts?: { upcForFlag?: string | null }) => {
    // Try to load the full size-family for this brand. If that lookup fails
    // (transient error, OR a SKU the server can't group — e.g. Tony's
    // double-shot Smirnoff at Colony), DON'T silently drop the tap: we already
    // have the full product `p` from the scan/vision/search, so open the card
    // with a single-size fallback family. The card must ALWAYS open so the
    // user can add the bottle to their order. (Doctrine: no silent failures.)
    const fam: ProductFamily =
      (await getProductFamily(p.code)) ?? { baseName: p.name, sizes: [p] };
    setProductCardInitialCode(p.code);
    if (opts?.upcForFlag != null && String(opts.upcForFlag).trim() !== "") {
      setUpcScanContext({ upc: String(opts.upcForFlag).trim() });
    } else {
      setUpcScanContext(null);
    }
    setCurrentFamily(fam);
    setShowProductCard(true);
  }, []);

  /*
    Vision capture handler (task #37, 2026-06-01). Called by
    BarcodeScanner when the user taps "Take a photo" from the trouble
    panel. POSTs the JPEG to /catalog/identify-from-image and stashes
    the result so VisionCandidatePicker can render the choices. Errors
    surface as a toast — the user can retry without losing context.
  */
  const handlePhotoCapture = useCallback(async (jpegDataUri: string) => {
    setVisionBusy(true);
    setVisionError(null);
    setToast("Identifying bottle…");
    try {
      const result = await identifyFromImage(jpegDataUri);
      if (!result.ok) {
        setVisionError(result.error);
        setToast(`Couldn't identify bottle: ${result.error}`);
        return;
      }
      setVisionResult({
        extracted: result.extracted,
        candidates: result.candidates,
        hint: result.hint,
      });
      setToast(null);
    } finally {
      setVisionBusy(false);
    }
  }, []);

  const handleScan = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      setUpcBeingMapped(null);
      setUpcMappingExpectedQuery(null);
      setScanInFlight(true);
      try {
        const found = await getProductByCode(trimmed);
        if (found) {
          await openFamily(found);
          return;
        }

        const upcRes: UpcLookupResponse = await getProductByUpc(trimmed);

        if (upcRes.ok && upcRes.product && !upcRes.needsUserConfirmation) {
          if (upcRes.confidenceWarning) {
            const capture = Sentry?.captureMessage;
            if (typeof capture === "function") {
              capture("upc_confidence_warning", {
                level: "info",
                tags: { upc_confidence_warning: upcRes.confidenceWarning },
                extra: { upc: trimmed, confidenceWarning: upcRes.confidenceWarning, path: "confident" },
              });
            }
          }
          await openFamily(upcRes.product, { upcForFlag: trimmed });
          return;
        }

        if (upcRes.needsUserConfirmation && upcRes.candidates && upcRes.candidates.length > 0) {
          if (upcRes.confidenceWarning) {
            const capture = Sentry?.captureMessage;
            if (typeof capture === "function") {
              capture("upc_confidence_warning", {
                level: "info",
                tags: { upc_confidence_warning: upcRes.confidenceWarning },
                extra: { upc: trimmed, confidenceWarning: upcRes.confidenceWarning },
              });
            }
          }
          setUpcCandidates({
            candidates: upcRes.candidates,
            upc: trimmed,
            upcProductName: upcRes.upcProductName ?? "",
            upcBrand: upcRes.upcBrand,
            confidenceWarning: upcRes.confidenceWarning,
          });
          return;
        }

        if (upcRes.error === "upc_found_but_no_mlcc_match") {
          const name = upcRes.productName ?? "";
          setUpcBeingMapped(trimmed);
          setUpcMappingExpectedQuery(name);
          search.setQuery(name);
          return;
        }

        if (upcRes.error === "no_upc_data_found" || upcRes.error === "upc_not_found") {
          setUpcBeingMapped(upcRes.upc ?? trimmed);
          setUpcMappingExpectedQuery("");
          search.setQuery("");
          return;
        }

        setNotFoundMsg(true);
      } catch {
        setNetworkWarn(true);
        setTimeout(() => {
          setNetworkWarn(false);
          setNotFoundMsg(true);
        }, 2000);
      } finally {
        // Always clear the in-flight flag, success or fail — otherwise a
        // failed lookup leaves the spinner spinning forever.
        setScanInFlight(false);
      }
    },
    [search.setQuery, openFamily],
  );

  return (
    <div className="page scanner-page scanhm-page">
      {/*
        Header redesign (task #90, 2026-06-07). Per Tony, all the
        scattered top icons (chat, dashboard, orders, browse, settings,
        sign-out) moved to the bottom tab bar / More page. The ONE icon
        that stays here is Cart, because Tony explicitly wants to peek
        at the cart from the scan page without bouncing to a separate
        screen. Bottom tab Cart navigates to /cart (full page); top-right
        cart icon opens the inline drawer (quick peek + adjust).
      */}
      <header className="top-bar scanhm-header">
        <h1 className="scanhm-wordmark">
          <span className="scanhm-wordmark__liquor">Liquor</span>{" "}
          <span className="scanhm-wordmark__kings">Kings</span>
        </h1>
        <div className="top-bar-actions">
          <button
            type="button"
            className="icon-btn cart-btn scanhm-cart-btn"
            onClick={() => setShowCart(true)}
            aria-label="Open cart drawer"
          >
            <IconCart size={24} strokeWidth={1.85} />
            {cart.totalItems > 0 ? (
              <span className="cart-badge">{cart.totalItems}</span>
            ) : null}
          </button>
        </div>
      </header>

      {/*
        Offline banner — fires the moment the browser reports a network drop.
        Persistent (no dismiss) because scanning a bottle while offline produces
        a confusing failed-lookup chain; better to make the state obvious.
      */}
      {!isOnline ? (
        <div className="price-book-age-banner price-book-age-banner--stale">
          <span>
            You're offline. Scans and cart actions will fail until the
            connection is back.
          </span>
        </div>
      ) : null}

      {/*
        Home simplification 2026-06-02 (Tony's request after seeing the
        cluttered home in PWA): removed the "Prices are 21 days old"
        banner (smart cards handles that) AND the "Camera scanner on"
        checkbox toggle (camera is always on now — it's the primary
        action). Search bar moves up; BarcodeScanner's own manual-entry
        input gets hidden by passing hideManualInput. Smart cards stay
        above the camera as the highest-attention slot.
      */}
      {/*
        Scheduled template banner (task #75). Renders at the very top
        of the home — above smart cards — because "your weekly order
        is ready" is the highest-attention nudge we ever show. Renders
        nothing when no template's scheduler has fired today.
      */}
      <div className="scanhm-zone scanhm-zone--banners">
        <ScheduledTemplateBanner
          cart={cart}
          onLoaded={() => setShowCart(true)}
        />
        {needsMlccVerification ? (
          <VerifyMlccBanner
            onVerified={() => {
              // Bump the refresh key so SmartCards re-fetches and
              // hides the banner naturally (last_verified_at now stamped).
              setVerifyRefreshKey((k) => k + 1);
            }}
          />
        ) : null}
      </div>

      {/*
        AI Assistant hero card (task #92, 2026-06-07). Tony's call:
        "the AI assistant is our MOAT, why is it hidden in More" —
        promoting it to prime real estate on the home screen,
        impossible to miss, above smart cards. Tap = opens /assistant.
      */}
      <button
        type="button"
        onClick={() => navigate("/assistant")}
        className="scanhm-hero"
        aria-label="Open AI assistant"
      >
        <div className="scanhm-hero__icon">
          <IconSparkles size={26} strokeWidth={1.9} />
        </div>
        <div className="scanhm-hero__body">
          <div className="scanhm-hero__eyebrow">Your AI assistant</div>
          <div className="scanhm-hero__title">
            Ask anything — your store, your catalog, or liquor in general
          </div>
        </div>
        <IconChevronRight size={20} className="scanhm-hero__chevron" aria-hidden />
      </button>

      <div className="scanhm-zone scanhm-zone--cards">
        {storeMeta === undefined ? <SmartCardsSkeleton /> : null}
        <SmartCards
          onTapProduct={(code) => {
            void getProductByCode(code)
              .then((p) => {
                if (p) {
                  void openFamily(p);
                } else {
                  // Doctrine: no silent failures. Tell the user instead of a dead tap.
                  setToast("Couldn't open that bottle — try again.");
                  setTimeout(() => setToast(null), 2500);
                }
              })
              .catch(() => {
                setToast("Couldn't open that bottle — check your connection.");
                setTimeout(() => setToast(null), 2500);
              });
          }}
          onStoreMeta={setStoreMeta}
          refreshKey={verifyRefreshKey}
        />
      </div>

      <div className="scanhm-camera">
        <p className="scanhm-camera__hint">
          Point at a barcode on the bottle or shelf tag
        </p>
        <BarcodeScanner
          /*
           * Quality mandate (2026-06-12): the camera + ZXing decode loop
           * must SLEEP whenever an overlay covers it. It used to run
           * hardcoded-active behind the cart drawer for entire validate
           * waits — camera streaming + ~4.5 full-frame JS decodes/sec the
           * whole time. That burns CPU, heats the phone, and lags every
           * tap. Camera resumes the moment the overlay closes.
           */
          active={
            !showProductCard &&
            !showCart &&
            !showDashboard &&
            !upcCandidates &&
            !visionResult &&
            !confirmSignOut
          }
          onScan={handleScan}
          onPhotoCapture={visionBusy ? undefined : handlePhotoCapture}
          hideManualInput={true}
        />
      </div>

      {upcBeingMapped ? (
        <div className="upc-mapping-banner" role="status" aria-live="polite">
          <div className="upc-mapping-banner__body">
            <strong>Mapping UPC {upcBeingMapped}</strong>
            <span className="upc-mapping-banner__hint">
              Pick the matching product below — your selection saves the mapping forever.
            </span>
          </div>
          <button
            type="button"
            className="upc-mapping-banner__close"
            aria-label="Cancel mapping"
            onClick={() => {
              setUpcBeingMapped(null);
              setUpcMappingExpectedQuery(null);
            }}
          >
            <IconX size={18} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      <div className="scanhm-search">
        <SearchBar
          value={search.query}
          onChange={search.setQuery}
          placeholder={
            upcBeingMapped
              ? `Map UPC ${upcBeingMapped} — search MLCC name…`
              : undefined
          }
        />
      </div>

      <div className="scanhm-statuses">
        {scanInFlight ? (
          <div className="scanhm-status scanhm-status--lookup" role="status" aria-live="polite">
            <div className="scanhm-shimmer scanhm-shimmer--status" aria-hidden />
            <span>Looking up code…</span>
          </div>
        ) : null}
        {networkWarn ? (
          <p className="scanhm-status scanhm-status--warn">Having trouble connecting…</p>
        ) : null}
        {notFoundMsg ? (
          <p className="scanhm-status scanhm-status--warn">Product not found — try searching</p>
        ) : null}
        {toast ? <p className="scanhm-status scanhm-status--ok">{toast}</p> : null}
        {search.error ? (
          <p className="scanhm-status scanhm-status--err">{search.error}</p>
        ) : null}
      </div>

      {search.loading && search.results.length === 0 ? (
        <div className="scanhm-results-skeleton" aria-hidden>
          <div className="scanhm-shimmer scanhm-shimmer--result" />
          <div className="scanhm-shimmer scanhm-shimmer--result" />
          <div className="scanhm-shimmer scanhm-shimmer--result" />
        </div>
      ) : null}

      {search.results.length > 0 ? (
        <ul className="scanhm-results">
          {search.results.map((p) => {
            const size = p.bottle_size_label ?? `${p.bottle_size_ml ?? ""} ML`;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="scanhm-result-row"
                  onClick={() => {
                    const mapUpc = upcBeingMapped;
                    if (mapUpc) {
                      void (async () => {
                        try {
                          await confirmUpcMapping(
                            mapUpc,
                            p.code,
                            search.query,
                            undefined,
                            "scanner-user-manual-search",
                          );
                        } catch (error) {
                          const capture = Sentry?.captureException;
                          if (typeof capture === "function") capture(error);
                        }
                      })();
                      setUpcBeingMapped(null);
                      setUpcMappingExpectedQuery(null);
                    }
                    void openFamily(p, { upcForFlag: mapUpc ?? undefined });
                  }}
                >
                  <ScanResultThumb product={p} />
                  <div className="scanhm-result-row__main">
                    <span className="scanhm-result-row__name">{p.name}</span>
                    <span className="scanhm-result-row__meta">{size}</span>
                  </div>
                  <span className="scanhm-result-row__price">
                    {money(p.licensee_price)}
                  </span>
                </button>
              </li>
            );
          })}
          {search.hasMore ? (
            <li>
              <button
                type="button"
                className="scanhm-result-more"
                onClick={() => void search.loadMore()}
                disabled={search.loadingMore}
              >
                {search.loadingMore ? (
                  <span className="scanhm-result-more__loading">
                    <span className="scanhm-shimmer scanhm-shimmer--pill" aria-hidden />
                    Loading…
                  </span>
                ) : (
                  "Load more results"
                )}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {showProductCard && currentFamily ? (
        <ProductCard
          family={currentFamily}
          initialSelectedCode={productCardInitialCode}
          scannedUpc={upcScanContext?.upc ?? null}
          wasUpcScanMatch={Boolean(upcScanContext?.upc)}
          /* task #44: latest price book date drives the freshness/discontinuation banner */
          latestPriceBookDate={latestPriceBookDate}
          onToast={(msg) => setToast(msg)}
          onDismiss={() => {
            setShowProductCard(false);
            setCurrentFamily(null);
            setProductCardInitialCode(undefined);
            setUpcScanContext(null);
          }}
          onAddToCart={(product, quantity) => {
            cart.addItem(product, quantity);
            // Task #58 (2026-05-31): card stays open after Add so the
            // user can pick another size of the same brand without re-
            // scanning. Toast still fires for global feedback; the
            // ProductCard renders its own inline last-added indicator
            // and resets quantity to 1 internally. Dismissal is now
            // ONLY via the "Done" button (formerly ×) — gives the user
            // explicit control of when to move on to the next scan.
            const sizeLabel =
              product.bottle_size_label ?? `${product.bottle_size_ml ?? ""} mL`;
            setToast(`Added ${quantity} × ${sizeLabel}`);
          }}
        />
      ) : null}

      {showCart ? (
        <CartDrawer
          cart={cart}
          preValidate={preValidate}
          /*
           * Plumb store identity into CartDrawer (task #89, 2026-06-07)
           * so the pre-submit verification modal can render
           * "Sending to MILO for Colony Party Store (430342)" at the
           * top of the confirm card. Catches the rare "wrong store"
           * mistake as part of the integrity-doctrine check.
           */
          storeName={storeMeta?.store_name ?? null}
          storeLicense={storeMeta?.liquor_license ?? null}
          /*
           * AUDIT #15b (2026-06-13): tell the user UP FRONT — before they
           * commit to the ~2-minute RPA run — whether this store is armed
           * for real MLCC orders or Submit will run as a preview only.
           * Defaults to false (preview) if storeMeta hasn't loaded yet,
           * which is the safe assumption.
           */
          allowOrderSubmission={storeMeta?.allow_order_submission ?? false}
          onClose={() => setShowCart(false)}
          onSubmit={() => {
            setShowCart(false);
            navigate("/cart");
          }}
          /*
           * Task #51 (2026-05-30): Amazon-style sibling browsing from cart.
           * Tap a cart line's product name → open ProductCard for that bottle's
           * family. The cart drawer stays open underneath so dismissing the
           * product card returns the user right back to where they were.
           * z-index is bumped on product-card-backdrop to overlay the drawer
           * (CSS change in index.css).
           */
          onLineProductClick={(product) => {
            void openFamily(product);
          }}
        />
      ) : null}

      {showDashboard ? (
        <Suspense fallback={null}>
          <AnalyticsDashboard onClose={() => setShowDashboard(false)} />
        </Suspense>
      ) : null}

      {confirmSignOut ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Sign out"
          onClick={() => setConfirmSignOut(false)}
        >
          <div
            className="confirm-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="confirm-title">Sign out?</h2>
            <p className="confirm-body">
              You'll need to sign in again before scanning. Your cart is
              saved on the server and will still be there.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setConfirmSignOut(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  setConfirmSignOut(false);
                  void signOut();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {upcCandidates ? (
        <>
          {upcCandidates.confidenceWarning === "category_filter_excluded_all" ? (
            <p
              className="muted small"
              style={{
                position: "fixed",
                top: 8,
                left: 12,
                right: 12,
                zIndex: 1001,
                textAlign: "center",
                margin: 0,
                pointerEvents: "none",
              }}
            >
              Best matches — please verify carefully
            </p>
          ) : null}
          <UpcCandidatePicker
            upc={upcCandidates.upc}
            candidates={upcCandidates.candidates}
            upcProductName={upcCandidates.upcProductName}
            upcBrand={upcCandidates.upcBrand}
            onCancel={() => setUpcCandidates(null)}
            onNoneMatch={() => {
              const ctx = upcCandidates;
              setUpcCandidates(null);
              const fallbackName = (ctx.upcProductName ?? "").trim();
              if (fallbackName) search.setQuery(fallbackName);
              setToast("Search by name — the scanned bottle may need manual lookup");
              void (async () => {
                try {
                  await reportUpcNoMatch(ctx.upc, ctx.upcProductName, ctx.upcBrand);
                } catch (error) {
                  const capture = Sentry?.captureException;
                  if (typeof capture === "function") capture(error);
                }
              })();
            }}
            onSelect={(product) => {
              const u = upcCandidates.upc;
              const upcProductName = upcCandidates.upcProductName;
              const upcBrand = upcCandidates.upcBrand;
              setUpcCandidates(null);
              void (async () => {
                try {
                  await confirmUpcMapping(
                    u,
                    String(product.code ?? ""),
                    upcProductName,
                    upcBrand,
                    "scanner-user",
                  );
                } catch (error) {
                  const capture = Sentry?.captureException;
                  if (typeof capture === "function") capture(error);
                }
              })();
              void openFamily(product, { upcForFlag: u });
            }}
          />
        </>
      ) : null}

      {/*
        Vision candidate picker (task #37, 2026-06-01). Renders when
        handlePhotoCapture has a result. User picks a candidate →
        ProductCard opens via openFamily; cancels → fall back to manual
        entry or scan again; "Try a different photo" clears the result
        and the user can re-trigger from the trouble panel.
      */}
      {visionResult ? (
        <VisionCandidatePicker
          extracted={visionResult.extracted}
          candidates={visionResult.candidates}
          hint={visionResult.hint}
          onSelect={(product) => {
            setVisionResult(null);
            setVisionError(null);
            void openFamily(product);
          }}
          onRetake={() => {
            setVisionResult(null);
            setVisionError(null);
            // Stay in scanner mode — user re-frames + retaps "Take a photo"
            // from the trouble panel.
          }}
          onCancel={() => {
            setVisionResult(null);
            setVisionError(null);
          }}
          onSearchByName={(q) => {
            // The barcode failed + AI couldn't pin an exact catalog match, so
            // drop what the photo showed into the search bar — the user finds
            // it by name and taps it. Completes the scan-fallback loop.
            setVisionResult(null);
            setVisionError(null);
            search.setQuery(q);
            const el = document.querySelector<HTMLInputElement>(".search-bar-input");
            el?.focus();
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
      ) : null}
      {visionError && !visionResult ? (
        <div className="scanhm-vision-error">
          Vision error: {visionError}
        </div>
      ) : null}
    </div>
  );
}

function SmartCardsSkeleton() {
  return (
    <div className="scanhm-cards-skeleton">
      <div className="scanhm-shimmer scanhm-shimmer--card" />
      <div className="scanhm-shimmer scanhm-shimmer--card" />
    </div>
  );
}

function ScanResultThumb({ product }: { product: MlccProduct }) {
  const [errored, setErrored] = useState(false);
  // Same overheat class as the Browse grid (quality mandate 2026-06-12):
  // tiny row thumbs must never decode multi-MB originals.
  const url = product.imageThumbUrl ?? product.imageUrl;
  const showImage = !!url && !errored;
  return (
    <div className="scanhm-result-thumb">
      {showImage ? (
        <img
          src={url ?? undefined}
          alt=""
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
