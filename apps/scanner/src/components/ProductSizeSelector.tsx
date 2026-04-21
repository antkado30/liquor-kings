import type { MlccProduct } from "../types";

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
};

function sizeLabel(p: MlccProduct): string {
  if (p.bottle_size_label) return p.bottle_size_label;
  if (p.bottle_size_ml != null) return `${p.bottle_size_ml} ML`;
  return p.code;
}

export function ProductSizeSelector({ sizes, selected, onSelect }: ProductSizeSelectorProps) {
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
              {sizeLabel(p)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
