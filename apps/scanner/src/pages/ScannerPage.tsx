import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { AssistantPanel } from "../components/AssistantPanel";
import { ProductCard } from "../components/ProductCard";
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

  const [scannerActive, setScannerActive] = useState(true);
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
  const [showAssistant, setShowAssistant] = useState(false);
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
  const [priceBookAge, setPriceBookAge] = useState<{
    status: "aging" | "stale";
    daysSinceUpdate: number;
  } | null>(null);
  /**
   * Latest price book date (YYYY-MM-DD) from /price-book/status.
   * Captured separately from `priceBookAge` because ProductCard's
   * freshness heuristic (task #44) needs the absolute date even when
   * the cart-wide age banner is hidden (status=fresh). Null until the
   * status endpoint responds.
   */
  const [latestPriceBookDate, setLatestPriceBookDate] = useState<string | null>(null);
  const [dismissPriceBookBanner, setDismissPriceBookBanner] = useState(false);
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
    void (async () => {
      const s = await getPriceBookStatus();
      if (s.ok && (s.status === "aging" || s.status === "stale") && s.daysSinceUpdate != null) {
        setPriceBookAge({ status: s.status, daysSinceUpdate: s.daysSinceUpdate });
      }
      // Always capture the latest date if the endpoint returned one,
      // even when status=fresh. ProductCard needs it for per-product
      // freshness checks (task #44 discontinuation detection).
      if (s.ok && typeof s.priceBookDate === "string" && s.priceBookDate.trim() !== "") {
        setLatestPriceBookDate(s.priceBookDate.trim());
      }
    })();
  }, []);

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
    const fam = await getProductFamily(p.code);
    if (fam) {
      setProductCardInitialCode(p.code);
      if (opts?.upcForFlag != null && String(opts.upcForFlag).trim() !== "") {
        setUpcScanContext({ upc: String(opts.upcForFlag).trim() });
      } else {
        setUpcScanContext(null);
      }
      setCurrentFamily(fam);
      setShowProductCard(true);
    }
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
    <div className="page scanner-page">
      <header className="top-bar">
        <h1 className="top-bar-title">Liquor Kings</h1>
        <div className="top-bar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowAssistant(true)}
            aria-label="Open assistant"
          >
            <span className="assistant-glyph" aria-hidden>
              💬
            </span>
          </button>
          <button type="button" className="icon-btn cart-btn" onClick={() => setShowCart(true)} aria-label="Open cart">
            <span className="cart-glyph" aria-hidden>
              🛒
            </span>
            {cart.totalItems > 0 ? <span className="cart-badge">{cart.totalItems}</span> : null}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setConfirmSignOut(true)}
            aria-label="Sign out"
            title="Sign out"
          >
            <span className="signout-glyph" aria-hidden>
              ⎋
            </span>
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

      {priceBookAge && !dismissPriceBookBanner ? (
        <div
          className={`price-book-age-banner ${
            priceBookAge.status === "stale" ? "price-book-age-banner--stale" : "price-book-age-banner--aging"
          }`}
        >
          <span>
            {priceBookAge.status === "stale"
              ? `Prices are ${priceBookAge.daysSinceUpdate} days old. Update price book before ordering.`
              : `Prices last updated ${priceBookAge.daysSinceUpdate} days ago. Refresh soon.`}
          </span>
          <button
            type="button"
            className="price-book-age-banner__close"
            aria-label="Dismiss"
            onClick={() => setDismissPriceBookBanner(true)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="scanner-toggle-row">
        <label className="toggle">
          <input type="checkbox" checked={scannerActive} onChange={(e) => setScannerActive(e.target.checked)} />
          <span>Camera scanner on</span>
        </label>
      </div>

      {scannerActive ? (
        <BarcodeScanner
          active={scannerActive}
          onScan={handleScan}
          onPhotoCapture={visionBusy ? undefined : handlePhotoCapture}
        />
      ) : null}

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
            ×
          </button>
        </div>
      ) : null}

      <SearchBar
        value={search.query}
        onChange={search.setQuery}
        placeholder={
          upcBeingMapped
            ? `Map UPC ${upcBeingMapped} — search MLCC name…`
            : undefined
        }
      />

      {scanInFlight ? (
        <p className="banner" role="status" aria-live="polite">
          Looking up code…
        </p>
      ) : null}
      {networkWarn ? <p className="banner toast--warning">Having trouble connecting…</p> : null}
      {notFoundMsg ? <p className="banner banner-warn">Product not found — try searching</p> : null}
      {toast ? <p className="banner banner-ok">{toast}</p> : null}

      {search.loading ? <p className="muted center">Searching…</p> : null}
      {search.error ? <p className="banner banner-err">{search.error}</p> : null}

      {search.results.length > 0 ? (
        <ul className="result-list">
          {search.results.map((p) => {
            const size = p.bottle_size_label ?? `${p.bottle_size_ml ?? ""} ML`;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="result-row"
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
                  <span className="result-name">{p.name}</span>
                  <span className="result-meta muted">{size}</span>
                  <span className="result-price">{money(p.licensee_price)}</span>
                </button>
              </li>
            );
          })}
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

      {showAssistant ? <AssistantPanel onClose={() => setShowAssistant(false)} /> : null}

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
            const el = document.querySelector<HTMLInputElement>(".scanner-manual-input");
            el?.focus();
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
      ) : null}
      {visionError && !visionResult ? (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: 12,
            right: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(248, 113, 113, 0.18)",
            borderLeft: "3px solid #f87171",
            color: "#fecaca",
            zIndex: 1100,
          }}
        >
          Vision error: {visionError}
        </div>
      ) : null}
    </div>
  );
}
