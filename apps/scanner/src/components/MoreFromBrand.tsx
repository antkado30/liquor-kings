/**
 * MoreFromBrand — "the store keeps selling" section on every product card
 * (Tony, 2026-07-26, TONY-WANTS: design locked via Q&A).
 *
 * Ranked server-side by the all-LK-stores order aggregate (Tony's hybrid:
 * "Michigan-wide, but collect data from stores to see what actually is
 * top"), scans as tiebreak. Thin brands fall back to same-kind +
 * similar-price ("More like this"). One row per FAMILY; tapping loads
 * that family and the parent swaps the open card — all sizes included.
 *
 * Fails SOFT everywhere: no data / API error → the section simply does
 * not render. Suggestions must never break the card that's already open.
 */
import { useEffect, useState } from "react";
import { getProductFamily, getRelatedProducts } from "../api/catalog";
import type { RelatedProducts } from "../api/catalog";
import type { ProductFamily } from "../types";
import { IconChevronRight } from "./Icons";
import { PlaceholderBottle, tintForCategory } from "./BottleArt";

type MoreFromBrandProps = {
  /** Any code in the open family — the server resolves brand + family. */
  anchorCode: string;
  /** Parent swaps the open card to the tapped family (all sizes ride in). */
  onOpenProduct?: (family: ProductFamily, code: string) => void;
};

export function MoreFromBrand({ anchorCode, onOpenProduct }: MoreFromBrandProps) {
  const [data, setData] = useState<RelatedProducts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    void getRelatedProducts(anchorCode).then((r) => {
      if (!alive) return;
      setData(r);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [anchorCode]);

  const openRow = async (code: string) => {
    if (!onOpenProduct || busyCode) return;
    setBusyCode(code);
    try {
      const fam = await getProductFamily(code);
      if (fam) {
        onOpenProduct(fam, code);
      } else {
        console.warn("[morefrom] family load came back empty for", code);
      }
    } finally {
      setBusyCode(null);
    }
  };

  if (loading) {
    return (
      <div className="morefrom" aria-hidden>
        <div className="morefrom__skeleton-line" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="morefrom__row morefrom__row--skeleton" />
        ))}
      </div>
    );
  }

  if (!data || data.items.length === 0) return null;

  return (
    <div className="morefrom">
      <h3 className="morefrom__title">
        {data.mode === "brand" && data.brand
          ? `More from ${data.brand}`
          : "More like this"}
      </h3>
      <ul className="morefrom__list">
        {data.items.map(({ product, sizes_count, from_price }) => (
          <li key={product.code}>
            <button
              type="button"
              className="morefrom__row"
              disabled={busyCode != null}
              onClick={() => void openRow(product.code)}
            >
              <span className="morefrom__thumb" aria-hidden>
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" loading="lazy" />
                ) : (
                  <PlaceholderBottle
                    tint={tintForCategory(product.category)}
                    name={product.name}
                    seed={product.code}
                  />
                )}
              </span>
              <span className="morefrom__copy">
                <span className="morefrom__name">{product.name}</span>
                <span className="morefrom__meta muted">
                  {sizes_count} size{sizes_count === 1 ? "" : "s"}
                  {from_price != null ? ` · from $${from_price.toFixed(2)}` : ""}
                </span>
              </span>
              <span className="morefrom__chev" aria-hidden>
                {busyCode === product.code ? (
                  <span className="morefrom__spinner" />
                ) : (
                  <IconChevronRight size={18} />
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
