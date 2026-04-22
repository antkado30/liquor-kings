import { useEffect, useState } from "react";
import { flagIncorrectMatch } from "../api/catalog";
import type { MlccProduct, ProductFamily } from "../types";
import { pickInitialSizeByCode, ProductSizeSelector } from "./ProductSizeSelector";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type ProductCardProps = {
  family: ProductFamily;
  /** MLCC code of the product that was scanned or tapped — selects matching size tab on open. */
  initialSelectedCode?: string;
  onAddToCart: (product: MlccProduct, quantity: number) => void;
  onDismiss: () => void;
  /** UPC from the barcode that led to this card (UPCitemdb path only). */
  scannedUpc?: string | null;
  /** True when this card was opened from a camera scan that used UPC matching (not name search). */
  wasUpcScanMatch?: boolean;
  onToast?: (message: string) => void;
};

export function ProductCard({
  family,
  initialSelectedCode,
  onAddToCart,
  onDismiss,
  scannedUpc = null,
  wasUpcScanMatch = false,
  onToast,
}: ProductCardProps) {
  const [selectedProduct, setSelectedProduct] = useState<MlccProduct>(() =>
    pickInitialSizeByCode(family.sizes, initialSelectedCode),
  );
  const [quantity, setQuantity] = useState(1);
  const [flagBusy, setFlagBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [selectedProduct.id]);

  const bump = (delta: number) => {
    setQuantity((q) => Math.min(99, Math.max(1, q + delta)));
  };

  const onAdd = () => {
    onAddToCart(selectedProduct, quantity);
    setQuantity(1);
  };

  const onFlagWrongMatch = async () => {
    const u = scannedUpc?.trim();
    if (!u || flagBusy || !wasUpcScanMatch) return;
    if (
      !window.confirm(
        "Mark this as incorrect? The next person to scan this bottle will re-match from scratch.",
      )
    ) {
      return;
    }
    setFlagBusy(true);
    const r = await flagIncorrectMatch(u, "user_says_wrong");
    setFlagBusy(false);
    if (import.meta.env.DEV) {
      console.log("[scanner-upc-flag]", JSON.stringify({ tapped: true, upc: u, ok: r.ok }));
    }
    if (r.ok) {
      onToast?.("Match flagged thank you for helping improve the system");
      onDismiss();
    } else {
      onToast?.("Could not flag match right now, please try again");
    }
  };

  const cat = selectedProduct.category ?? "—";
  const showFlag = wasUpcScanMatch && Boolean(scannedUpc?.trim());
  const cardImageUrl =
    (!imageFailed &&
      (family.sizes.map((s) => s.imageUrl).find((u) => u && String(u).trim()) ??
        selectedProduct.imageUrl)) ||
    null;

  return (
    <div className="product-card-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-card-title">
      <div className="product-card">
        {cardImageUrl ? (
          <img
            className="product-card__image"
            src={cardImageUrl}
            alt=""
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <div className="product-card-header">
          <h2 id="product-card-title" className="product-card-brand">
            {family.baseName}
          </h2>
          {selectedProduct.is_new_item ? <span className="badge-new">New Item</span> : null}
          <button type="button" className="product-card-close" onClick={onDismiss} aria-label="Close">
            ×
          </button>
        </div>
        <p className="product-card-category muted">{cat}</p>

        <p className="label">Size</p>
        <ProductSizeSelector
          sizes={family.sizes}
          selected={selectedProduct}
          onSelect={setSelectedProduct}
        />

        <dl className="product-card-details">
          <div>
            <dt>ADA</dt>
            <dd>{selectedProduct.ada_name || "—"}</dd>
          </div>
          <div>
            <dt>MLCC code</dt>
            <dd className="mono">{selectedProduct.code}</dd>
          </div>
          <div>
            <dt>Licensee price</dt>
            <dd className="price-accent">{money(selectedProduct.licensee_price)}</dd>
          </div>
          <div>
            <dt>Minimum shelf price</dt>
            <dd>{money(selectedProduct.min_shelf_price)}</dd>
          </div>
          <div>
            <dt>Case size</dt>
            <dd>{selectedProduct.case_size ?? "—"}</dd>
          </div>
          <div>
            <dt>Proof</dt>
            <dd>{selectedProduct.proof ?? "—"}</dd>
          </div>
        </dl>

        <div className="quantity-row">
          <button type="button" className="qty-btn" onClick={() => bump(-1)} aria-label="Decrease quantity">
            −
          </button>
          <input
            className="qty-input"
            type="number"
            min={1}
            max={99}
            value={quantity}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(v)) setQuantity(Math.min(99, Math.max(1, v)));
            }}
          />
          <button type="button" className="qty-btn" onClick={() => bump(1)} aria-label="Increase quantity">
            +
          </button>
        </div>

        <button type="button" className="btn primary btn-block" onClick={onAdd}>
          Add to Cart
        </button>

        {showFlag ? (
          <div className="product-card-flag-row">
            <button
              type="button"
              className="product-card__flag-button"
              disabled={flagBusy}
              onClick={() => void onFlagWrongMatch()}
            >
              Flag wrong match
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
