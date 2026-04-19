import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getProductByCode, getProductFamily } from "../api/catalog";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { CartDrawer } from "../components/CartDrawer";
import { ProductCard } from "../components/ProductCard";
import { SearchBar } from "../components/SearchBar";
import { useCart } from "../hooks/useCart";
import { useCatalogSearch } from "../hooks/useCatalogSearch";
import type { MlccProduct, ProductFamily } from "../types";

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
  const [showCart, setShowCart] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [notFoundMsg, setNotFoundMsg] = useState(false);

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
      setCurrentFamily(fam);
      setShowProductCard(true);
    }
  }, []);

  const handleScan = useCallback(
    async (code: string) => {
      const found = await getProductByCode(code.trim());
      if (!found) {
        setNotFoundMsg(true);
        return;
      }
      const fam = await getProductFamily(found.code);
      if (fam) {
        setCurrentFamily(fam);
        setShowProductCard(true);
      }
    },
    [],
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
          onDismiss={() => {
            setShowProductCard(false);
            setCurrentFamily(null);
          }}
          onAddToCart={(product, quantity) => {
            cart.addItem(product, quantity);
            setToast("Added to cart");
            setShowProductCard(false);
            setCurrentFamily(null);
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
    </div>
  );
}
