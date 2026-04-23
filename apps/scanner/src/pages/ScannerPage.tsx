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
import { Sentry } from "../lib/sentry";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { CartDrawer } from "../components/CartDrawer";
import { ProductCard } from "../components/ProductCard";
import { UpcCandidatePicker } from "../components/UpcCandidatePicker";
import { SearchBar } from "../components/SearchBar";
import { useCart } from "../hooks/useCart";
import { useCatalogSearch } from "../hooks/useCatalogSearch";
import type { MlccProduct, ProductFamily, UpcLookupResponse } from "../types";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function ScannerPage() {
  const cart = useCart();
  const search = useCatalogSearch();
  const navigate = useNavigate();

  const [scannerActive, setScannerActive] = useState(true);
  const [showProductCard, setShowProductCard] = useState(false);
  const [currentFamily, setCurrentFamily] = useState<ProductFamily | null>(null);
  /** MLCC code of the row that opened the card — drives initial size tab in ProductCard. */
  const [productCardInitialCode, setProductCardInitialCode] = useState<string | undefined>(undefined);
  const [showCart, setShowCart] = useState(false);
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
  const [priceBookAge, setPriceBookAge] = useState<{
    status: "aging" | "stale";
    daysSinceUpdate: number;
  } | null>(null);
  const [dismissPriceBookBanner, setDismissPriceBookBanner] = useState(false);
  const [networkWarn, setNetworkWarn] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await getPriceBookStatus();
      if (s.ok && (s.status === "aging" || s.status === "stale") && s.daysSinceUpdate != null) {
        setPriceBookAge({ status: s.status, daysSinceUpdate: s.daysSinceUpdate });
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

  const handleScan = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      setUpcBeingMapped(null);
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
          setToast(
            "Found the bottle online but no MLCC row yet — search below. Your pick teaches the system.",
          );
          search.setQuery(name);
          return;
        }

        if (upcRes.error === "no_upc_data_found" || upcRes.error === "upc_not_found") {
          setUpcBeingMapped(upcRes.upc ?? trimmed);
          setToast(
            "Bottle not in our database yet — search for it below. Your selection teaches the system.",
          );
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
      }
    },
    [search.setQuery, openFamily],
  );

  return (
    <div className="page scanner-page">
      <header className="top-bar">
        <h1 className="top-bar-title">Liquor Kings</h1>
        <div className="top-bar-actions">
          <button type="button" className="icon-btn cart-btn" onClick={() => setShowCart(true)} aria-label="Open cart">
            <span className="cart-glyph" aria-hidden>
              🛒
            </span>
            {cart.totalItems > 0 ? <span className="cart-badge">{cart.totalItems}</span> : null}
          </button>
        </div>
      </header>

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

      {scannerActive ? <BarcodeScanner active={scannerActive} onScan={handleScan} /> : null}

      <SearchBar
        value={search.query}
        onChange={search.setQuery}
        placeholder={
          upcBeingMapped
            ? `Map UPC ${upcBeingMapped} — search MLCC name…`
            : undefined
        }
      />

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
          onToast={(msg) => setToast(msg)}
          onDismiss={() => {
            setShowProductCard(false);
            setCurrentFamily(null);
            setProductCardInitialCode(undefined);
            setUpcScanContext(null);
          }}
          onAddToCart={(product, quantity) => {
            cart.addItem(product, quantity);
            setToast("Added to cart");
            setShowProductCard(false);
            setCurrentFamily(null);
            setProductCardInitialCode(undefined);
            setUpcScanContext(null);
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
        />
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
    </div>
  );
}
