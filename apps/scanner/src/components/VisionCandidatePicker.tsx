/**
 * VisionCandidatePicker — modal that shows what Claude saw in the photo
 * + the top MLCC catalog candidates. User taps one to open ProductCard,
 * or "Try a different photo" to retake, or search by name to fall back.
 */
import { useMemo } from "react";
import type { MlccProduct } from "../types";
import type { VisionExtracted } from "../api/catalog-vision";
import { useHideTabBar } from "../hooks/useHideTabBar";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import {
  IconCamera,
  IconCheck,
  IconChevronRight,
  IconSparkles,
} from "./Icons";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatSize(product: MlccProduct): string {
  return product.bottle_size_label ?? `${product.bottle_size_ml ?? "?"} mL`;
}

function normalizeSizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sizeMatchesLabel(
  extractedLabel: string | null | undefined,
  product: MlccProduct,
): boolean {
  if (!extractedLabel?.trim()) return false;
  const ext = normalizeSizeToken(extractedLabel);
  if (!ext) return false;
  const label = normalizeSizeToken(product.bottle_size_label ?? "");
  const ml =
    product.bottle_size_ml != null
      ? normalizeSizeToken(`${product.bottle_size_ml}ml`)
      : "";
  return (
    (label.length > 0 && (ext.includes(label) || label.includes(ext))) ||
    (ml.length > 0 && (ext.includes(ml) || ml.includes(ext)))
  );
}

function sizeMatches(extracted: VisionExtracted, product: MlccProduct): boolean {
  if (extracted.size_ml != null && product.bottle_size_ml != null) {
    return extracted.size_ml === product.bottle_size_ml;
  }
  return sizeMatchesLabel(extracted.size_label, product);
}

function pickRecommended(
  candidates: MlccProduct[],
  extracted: VisionExtracted,
): MlccProduct | null {
  if (candidates.length === 0) return null;
  if (extracted.size_ml != null) {
    const match = candidates.find((c) => c.bottle_size_ml === extracted.size_ml);
    if (match) return match;
  }
  if (extracted.size_label?.trim()) {
    const match = candidates.find((c) => sizeMatchesLabel(extracted.size_label, c));
    if (match) return match;
  }
  return candidates[0];
}

function formatExtractedSize(extracted: VisionExtracted): string | null {
  if (extracted.size_ml != null) return `${extracted.size_ml} mL`;
  const label = extracted.size_label?.trim();
  return label || null;
}

type VisionCandidatePickerProps = {
  extracted: VisionExtracted;
  candidates: MlccProduct[];
  hint: string | null;
  onSelect: (product: MlccProduct) => void;
  onRetake: () => void;
  onCancel: () => void;
  onSearchByName: (query: string) => void;
};

export function VisionCandidatePicker({
  extracted,
  candidates,
  hint,
  onSelect,
  onRetake,
  onCancel,
  onSearchByName,
}: VisionCandidatePickerProps) {
  useLockBodyScroll();
  useHideTabBar();

  const seenLabel = [extracted.brand, extracted.product_name]
    .filter((s) => s && s.trim())
    .join(" ")
    .trim();

  const recommended = useMemo(
    () => pickRecommended(candidates, extracted),
    [candidates, extracted],
  );

  const otherMatches = useMemo(
    () =>
      recommended
        ? candidates.filter((c) => c.id !== recommended.id)
        : candidates,
    [candidates, recommended],
  );

  const extractedSizeDisplay = formatExtractedSize(extracted);
  const hasExtractedSize = extracted.size_ml != null || Boolean(extracted.size_label?.trim());

  return (
    <div
      className="product-card-backdrop vision-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vision-picker-title"
    >
      <div className="product-card vision-picker-sheet">
        <div className="vision-picker-sheet__header">
          <div className="product-card-header">
            <h2 className="product-card-brand" id="vision-picker-title">
              Pick the bottle
            </h2>
            <button
              type="button"
              className="product-card-close product-card-close--labeled"
              onClick={onCancel}
              aria-label="Done — close picker"
            >
              Done
            </button>
          </div>

          <div className="vision-picker-saw vision-picker-saw--context">
            <span className="vision-picker-saw__label">Vision saw</span>
            <span className="vision-picker-saw__value">{seenLabel || "—"}</span>
            {extractedSizeDisplay ? (
              <span className="vision-picker-saw__size">{extractedSizeDisplay}</span>
            ) : null}
            <span
              className={`vision-picker-saw__confidence vision-picker-saw__confidence--${extracted.confidence}`}
            >
              {extracted.confidence} confidence
            </span>
          </div>

          {hint ? <p className="vision-picker-hint muted small">{hint}</p> : null}

          {!hasExtractedSize && recommended ? (
            <p className="vision-picker-size-hint">
              Confirm the size — we couldn&apos;t read it from the photo.
            </p>
          ) : null}
        </div>

        <div className="vision-picker-scroll">
          {recommended ? (
            <section className="vision-picker-hero" aria-label="Recommended match">
              <div className="vision-picker-hero__badge">
                <IconSparkles size={14} strokeWidth={2} aria-hidden />
                Recommended
              </div>
              <div className="vision-picker-hero__body">
                <div className="vision-picker-hero__main">
                  <div className="vision-picker-hero__name">{recommended.name}</div>
                  <div className="vision-picker-hero__meta muted small">
                    {recommended.ada_name || `ADA ${recommended.ada_number}`}
                    <span className="vision-picker-row__dot" aria-hidden>
                      ·
                    </span>
                    MLCC #{recommended.code}
                  </div>
                  <div className="vision-picker-hero__tags">
                    <span className="vision-picker-size-pill">
                      {formatSize(recommended)}
                    </span>
                    {sizeMatches(extracted, recommended) ? (
                      <span className="vision-picker-match-tag">Matches size</span>
                    ) : null}
                  </div>
                </div>
                <div className="vision-picker-hero__price">
                  {money(recommended.licensee_price)}
                </div>
              </div>
              <button
                type="button"
                className="btn primary btn-block vision-picker-hero__cta"
                onClick={() => onSelect(recommended)}
              >
                <IconCheck size={18} strokeWidth={2.2} aria-hidden />
                Add this
              </button>
            </section>
          ) : (
            <p className="vision-picker-empty muted small">
              No exact catalog match. Try a clearer photo, or search by name below.
            </p>
          )}

          {otherMatches.length > 0 ? (
            <section className="vision-picker-others" aria-label="Other matches">
              <h3 className="vision-picker-others__title">Other matches</h3>
              <ul className="vision-picker-list">
                {otherMatches.map((c) => (
                  <li key={c.id} className="vision-picker-row">
                    <button
                      type="button"
                      className="vision-picker-row__button"
                      onClick={() => onSelect(c)}
                    >
                      <div className="vision-picker-row__main">
                        <div className="vision-picker-row__top">
                          <div className="vision-picker-row__name">{c.name}</div>
                          <span className="vision-picker-size-pill vision-picker-size-pill--compact">
                            {formatSize(c)}
                          </span>
                        </div>
                        <div className="vision-picker-row__meta muted small">
                          {c.ada_name || `ADA ${c.ada_number}`}
                          <span className="vision-picker-row__dot" aria-hidden>
                            ·
                          </span>
                          MLCC #{c.code}
                          {sizeMatches(extracted, c) ? (
                            <>
                              <span className="vision-picker-row__dot" aria-hidden>
                                ·
                              </span>
                              <span className="vision-picker-match-tag vision-picker-match-tag--inline">
                                Matches size
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="vision-picker-row__aside">
                        <div className="vision-picker-row__price">
                          {money(c.licensee_price)}
                        </div>
                        <IconChevronRight
                          size={18}
                          strokeWidth={2}
                          className="vision-picker-row__chevron"
                          aria-hidden
                        />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="vision-picker-footer">
          <div className="vision-picker-actions">
            <button
              type="button"
              className="btn secondary btn-block"
              onClick={onRetake}
            >
              <IconCamera size={18} strokeWidth={1.9} aria-hidden />
              Try a different photo
            </button>
            <button
              type="button"
              className="btn btn-block"
              onClick={() =>
                seenLabel ? onSearchByName(seenLabel) : onCancel()
              }
            >
              {seenLabel ? `Search "${seenLabel}"` : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
