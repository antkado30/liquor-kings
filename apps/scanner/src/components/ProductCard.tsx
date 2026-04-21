import { useState } from "react";
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
};

export function ProductCard({ family, initialSelectedCode, onAddToCart, onDismiss }: ProductCardProps) {
  const [selectedProduct, setSelectedProduct] = useState<MlccProduct>(() =>
    pickInitialSizeByCode(family.sizes, initialSelectedCode),
  );
  const [quantity, setQuantity] = useState(1);

  const bump = (delta: number) => {
    setQuantity((q) => Math.min(99, Math.max(1, q + delta)));
  };

  const onAdd = () => {
    onAddToCart(selectedProduct, quantity);
    setQuantity(1);
  };

  const cat = selectedProduct.category ?? "—";

  return (
    <div className="product-card-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-card-title">
      <div className="product-card">
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
      </div>
    </div>
  );
}
