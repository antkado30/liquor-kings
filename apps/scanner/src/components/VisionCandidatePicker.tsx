/**
 * VisionCandidatePicker — modal that shows what Claude saw in the photo
 * + the top MLCC catalog candidates. User taps one to open ProductCard,
 * or "Try a different photo" to retake, or "Type code instead" to fall
 * back to manual entry. Built for task #37 (2026-06-01).
 *
 * Distinct from UpcCandidatePicker (which is specifically for UPC →
 * mapping confirmation) — vision results never write to upc_mappings
 * because Claude's identification is not a stable barcode-level match.
 * It's a "best guess from a photo, please confirm."
 */
import type { MlccProduct } from "../types";
import type { VisionExtracted } from "../api/catalog-vision";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type VisionCandidatePickerProps = {
  extracted: VisionExtracted;
  candidates: MlccProduct[];
  hint: string | null;
  onSelect: (product: MlccProduct) => void;
  onRetake: () => void;
  onCancel: () => void;
};

export function VisionCandidatePicker({
  extracted,
  candidates,
  hint,
  onSelect,
  onRetake,
  onCancel,
}: VisionCandidatePickerProps) {
  const seenLabel = [extracted.brand, extracted.product_name]
    .filter((s) => s && s.trim())
    .join(" ")
    .trim();

  return (
    <div className="product-card-backdrop" role="dialog" aria-modal="true" aria-label="Pick the bottle">
      <div className="product-card">
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
        {/*
          Show what Claude saw so the user can sanity-check the
          identification. If the model misread the bottle, the user
          knows to retake the photo instead of picking a wrong row.
        */}
        <div className="vision-picker-saw">
          <span className="vision-picker-saw__label">Vision saw</span>
          <span className="vision-picker-saw__value">{seenLabel || "—"}</span>
          {extracted.size_label ? (
            <span className="vision-picker-saw__size">{extracted.size_label}</span>
          ) : null}
          <span className={`vision-picker-saw__confidence vision-picker-saw__confidence--${extracted.confidence}`}>
            {extracted.confidence} confidence
          </span>
        </div>

        {hint ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            {hint}
          </p>
        ) : null}

        {candidates.length > 0 ? (
          <ul className="vision-picker-list">
            {candidates.map((c) => (
              <li key={c.id} className="vision-picker-row">
                <button
                  type="button"
                  className="vision-picker-row__button"
                  onClick={() => onSelect(c)}
                >
                  <div className="vision-picker-row__main">
                    <div className="vision-picker-row__name">{c.name}</div>
                    <div className="muted small">
                      {c.bottle_size_label ?? `${c.bottle_size_ml ?? "?"} mL`}
                      {" · "}
                      {c.ada_name || "ADA " + c.ada_number}
                      {" · "}
                      MLCC #{c.code}
                    </div>
                  </div>
                  <div className="vision-picker-row__price">
                    {money(c.licensee_price)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small" style={{ marginTop: 12 }}>
            No catalog matches. Try a clearer photo or type the MLCC code from the bottle.
          </p>
        )}

        <div className="vision-picker-actions">
          <button type="button" className="btn secondary btn-block" onClick={onRetake}>
            Try a different photo
          </button>
          <button type="button" className="btn btn-block" onClick={onCancel}>
            Type code instead
          </button>
        </div>
      </div>
    </div>
  );
}
