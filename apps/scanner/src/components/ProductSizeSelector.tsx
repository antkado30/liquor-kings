import type { MlccProduct } from "../types";
import { containerDisplay } from "../lib/container-label";

/** Pick the size tab that matches a scanned MLCC code, else the first family member (typically smallest). */
export function pickInitialSizeByCode(sizes: MlccProduct[], initialSelectedCode?: string): MlccProduct {
  if (initialSelectedCode) {
    const match = sizes.find((s) => s.code === initialSelectedCode);
    if (match) return match;
  }
  return sizes[0]!;
}

type ProductSizeSelectorProps = {
  sizes: MlccProduct[];
  selected: MlccProduct;
  onSelect: (p: MlccProduct) => void;
  /**
   * True when the family spans glass+plastic (server-computed,
   * 2026-07-11). In a mixed family EVERY chip carries its material label
   * (`750 ML · Plastic`) — never hidden, so the two materials of the
   * same size are impossible to confuse (catalog-family-tree-plan §B).
   */
  mixedContainers?: boolean;
};

/**
 * Chip label: size, then container material when it matters.
 * - Mixed family → every chip labeled with its material.
 * - Uniform family → only a NON-glass material is labeled (all-plastic
 *   lines still say so; all-glass stays quiet — glass is the default).
 * - GIFT PACK chips keep their combo label unstacked (the server already
 *   suffixed it; a third segment would be noise).
 * - Unknown container (pre-engine row) → no label, never a guess.
 */
function sizeLabel(p: MlccProduct, mixedContainers?: boolean): string {
  const base =
    p.bottle_size_label ??
    (p.bottle_size_ml != null ? `${p.bottle_size_ml} ML` : p.code);
  if (base.includes("GIFT PACK")) return base;
  const material = containerDisplay(p.container);
  if (!material) return base;
  if (mixedContainers === true || material !== "Glass") {
    return `${base} · ${material}`;
  }
  return base;
}

export function ProductSizeSelector({ sizes, selected, onSelect, mixedContainers }: ProductSizeSelectorProps) {
  return (
    <div className="size-selector">
      <div className="size-selector-scroll" role="tablist" aria-label="Bottle sizes">
        {sizes.map((p) => {
          const active = p.id === selected.id;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`size-chip${active ? " active" : ""}`}
              onClick={() => onSelect(p)}
            >
              {sizeLabel(p, mixedContainers)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
