import type { MlccProduct } from "../types";
import { containerDisplay, packCountSuffix } from "../lib/container-label";

/**
 * Tony's chip order (decided 2026-07-14 after the first on-device pack
 * walkthrough): plain bottles first, small → large, biggest at the far
 * right — then ALL multi-packs together at the tail (by size, then pack
 * count). Packs interleaved among singles read as scatter; grouped at
 * the end they read as what they are: special formats after the range.
 * GIFT PACK combos ride with the packs (they're multi-bottle too).
 * Pure + stable: code is the final tiebreak so order never flickers.
 */
export function orderSizesForDisplay(sizes: MlccProduct[]): MlccProduct[] {
  const isPackish = (p: MlccProduct) =>
    (p.pack_count ?? 1) >= 2 || (p.bottle_size_label ?? "").includes("GIFT PACK");
  const ml = (p: MlccProduct) => p.bottle_size_ml ?? Number.MAX_SAFE_INTEGER;
  const cont = (p: MlccProduct) => (p.container ?? "glass").toLowerCase();
  const singles = sizes
    .filter((p) => !isPackish(p))
    .sort((a, b) => ml(a) - ml(b) || cont(a).localeCompare(cont(b)) || a.code.localeCompare(b.code));
  const packs = sizes
    .filter(isPackish)
    .sort(
      (a, b) =>
        ml(a) - ml(b) || (a.pack_count ?? 0) - (b.pack_count ?? 0) || a.code.localeCompare(b.code),
    );
  return [...singles, ...packs];
}

/** Pick the size tab that matches a scanned MLCC code, else the first DISPLAYED member (smallest single). */
export function pickInitialSizeByCode(sizes: MlccProduct[], initialSelectedCode?: string): MlccProduct {
  if (initialSelectedCode) {
    const match = sizes.find((s) => s.code === initialSelectedCode);
    if (match) return match;
  }
  return orderSizesForDisplay(sizes)[0]!;
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
 * Chip label: size, then container material when it matters, then pack
 * count when the row is a multi-bottle pack.
 * - Mixed family → every chip labeled with its material.
 * - Uniform family → only a NON-glass material is labeled (all-plastic
 *   lines still say so; all-glass stays quiet — glass is the default).
 * - Pack SKUs (pack_count ≥ 2) always say so — "50 ML · Glass · 12-pack".
 *   A pack and a single share size+material but are different products
 *   with different prices and case rules; the 2026-07-12 Tito's audit
 *   showed three identical "50 ML · Glass" chips reading as corruption.
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
  const withMaterial =
    material && (mixedContainers === true || material !== "Glass")
      ? `${base} · ${material}`
      : base;
  return `${withMaterial}${packCountSuffix(p.pack_count)}`;
}

export function ProductSizeSelector({ sizes, selected, onSelect, mixedContainers }: ProductSizeSelectorProps) {
  /*
    Last-resort disambiguation (doctrine: an ambiguous order control is
    a lie). If two chips STILL read identically after size + material +
    pack labeling (e.g. MLCC lists the same configuration under two
    codes), append the MLCC code — same "· #1505" convention the cart
    line already uses. Honest and ugly beats pretty and ambiguous;
    duplicates past the label chain should be near-zero in practice.
  */
  const ordered = orderSizesForDisplay(sizes);
  const labels = ordered.map((p) => sizeLabel(p, mixedContainers));
  const labelCounts = new Map<string, number>();
  for (const l of labels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);

  return (
    <div className="size-selector">
      <div className="size-selector-scroll" role="tablist" aria-label="Bottle sizes">
        {ordered.map((p, i) => {
          const active = p.id === selected.id;
          const label =
            (labelCounts.get(labels[i]!) ?? 0) > 1
              ? `${labels[i]} · #${p.code}`
              : labels[i];
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`size-chip${active ? " active" : ""}`}
              onClick={() => onSelect(p)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
