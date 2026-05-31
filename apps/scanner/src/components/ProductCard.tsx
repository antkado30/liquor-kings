import { useEffect, useMemo, useState } from "react";
import { flagIncorrectMatch } from "../api/catalog";
import { getOrderingRuleDisplay } from "../lib/mlcc-ordering-rules";
import { computeProductFreshness } from "../lib/product-freshness";
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
  /**
   * Latest MLCC price book date (YYYY-MM-DD) — drives the freshness /
   * discontinuation heuristic (task #44). Null when /price-book/status
   * hasn't returned yet; in that case freshness defaults to "fresh"
   * (we don't falsely accuse). Provided by ScannerPage.
   */
  latestPriceBookDate?: string | null;
  onToast?: (message: string) => void;
};

export function ProductCard({
  family,
  initialSelectedCode,
  onAddToCart,
  onDismiss,
  scannedUpc = null,
  wasUpcScanMatch = false,
  latestPriceBookDate = null,
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

  /*
    MLCC ordering rules for the SELECTED size (task #43, 2026-05-30).
    Surface at scan time so the user knows split-case rules and full-
    case multiples BEFORE picking a quantity. Re-computed when the
    user flips between sizes — 750ml vs 50ml have wildly different
    rules. Pure function, no fetch — see lib/mlcc-ordering-rules.ts
    for the rule table source.
  */
  const orderingRule = useMemo(
    () =>
      getOrderingRuleDisplay({
        code: selectedProduct.code,
        bottle_size_ml: selectedProduct.bottle_size_ml,
        case_size: selectedProduct.case_size,
        ada_name: selectedProduct.ada_name,
      }),
    [
      selectedProduct.code,
      selectedProduct.bottle_size_ml,
      selectedProduct.case_size,
      selectedProduct.ada_name,
    ],
  );

  /*
    Freshness / discontinuation check (task #44, 2026-05-30). Compares
    the selected size's last_price_book_date against the latest book
    date we know about. Surfaces "aging" (14+ days behind) or
    "likely_discontinued" (30+ days behind) banners so the user doesn't
    waste an RPA run on a SKU that's no longer carried.

    Why per-selected-size: a brand may have a current 750ml SKU AND a
    discontinued 1.75L SKU in the same family. The banner needs to
    reflect THIS size, not the family.
  */
  const freshness = useMemo(
    () =>
      computeProductFreshness(
        {
          last_price_book_date: selectedProduct.last_price_book_date,
          is_active: selectedProduct.is_active,
        },
        latestPriceBookDate,
      ),
    [
      selectedProduct.last_price_book_date,
      selectedProduct.is_active,
      latestPriceBookDate,
    ],
  );
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

        {/*
          Freshness banner (task #44, 2026-05-30). Only renders when the
          selected size hasn't appeared in MLCC's last 14+ days of price
          books. "aging" = soft yellow info; "likely_discontinued" = red
          warn with stronger language. The user can still add to cart
          (we never block — sometimes a "discontinued" SKU comes back
          the next week), but they go in eyes open.
        */}
        {freshness.status !== "fresh" && freshness.message ? (
          <div
            className={`product-card-freshness product-card-freshness--${freshness.status}`}
            role="status"
          >
            <span className="product-card-freshness__icon" aria-hidden>
              {freshness.status === "likely_discontinued" ? "⚠" : "ℹ"}
            </span>
            <span className="product-card-freshness__text">{freshness.message}</span>
          </div>
        ) : null}

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

        {/*
          MLCC ordering rule callout (task #43, 2026-05-30). Sits above
          the qty stepper so the user reads "must order in cases of 60"
          BEFORE typing 1. The actual quantity stepper doesn't enforce
          these yet — that's task #45. For now this is informational
          only; the cart's per-line rule-engine validation still catches
          violations before validate is allowed.
        */}
        <div
          className={`product-card-rules${orderingRule.isConstrained ? " product-card-rules--constrained" : ""}`}
        >
          <span className="product-card-rules__label">MLCC ordering</span>
          <span className="product-card-rules__primary">{orderingRule.primary}</span>
          {orderingRule.secondary ? (
            <span className="product-card-rules__secondary muted small">
              {orderingRule.secondary}
            </span>
          ) : null}
        </div>

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
