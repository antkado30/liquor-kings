import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getProductByCode, getProductByUpc, getProductFamily } from "../api/catalog";
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!notFoundMsg) return;
    const t = setTimeout(() => setNotFoundMsg(false), 2000);
    return () => clearTimeout(t);
  }, [notFoundMsg]);

  const openFamily = useCallback(async (p: MlccProduct) => {
    const fam = await getProductFamily(p.code);
    if (fam) {
      setProductCardInitialCode(p.code);
      setCurrentFamily(fam);
      setShowProductCard(true);
    }
  }, []);

  const handleScan = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      const found = await getProductByCode(trimmed);
      if (found) {
        const fam = await getProductFamily(found.code);
        if (fam) {
          setProductCardInitialCode(found.code);
          setCurrentFamily(fam);
          setShowProductCard(true);
        }
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
        const fam = await getProductFamily(upcRes.product.code);
        if (fam) {
          setProductCardInitialCode(upcRes.product.code);
          setCurrentFamily(fam);
          setShowProductCard(true);
        }
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
        setToast(`Found bottle but no MLCC match. Try searching: ${name}`);
        search.setQuery(name);
        return;
      }

      if (upcRes.error === "upc_not_found") {
        setNotFoundMsg(true);
        return;
      }

      setNotFoundMsg(true);
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

      <div className="scanner-toggle-row">
        <label className="toggle">
          <input type="checkbox" checked={scannerActive} onChange={(e) => setScannerActive(e.target.checked)} />
          <span>Camera scanner on</span>
        </label>
      </div>

      {scannerActive ? <BarcodeScanner active={scannerActive} onScan={handleScan} /> : null}

      <SearchBar value={search.query} onChange={search.setQuery} />

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
                <button type="button" className="result-row" onClick={() => void openFamily(p)}>
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
          onDismiss={() => {
            setShowProductCard(false);
            setCurrentFamily(null);
            setProductCardInitialCode(undefined);
          }}
          onAddToCart={(product, quantity) => {
            cart.addItem(product, quantity);
            setToast("Added to cart");
            setShowProductCard(false);
            setCurrentFamily(null);
            setProductCardInitialCode(undefined);
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
            onSelect={(product) => {
              setUpcCandidates(null);
              void openFamily(product);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
