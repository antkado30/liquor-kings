import { useState } from "react";
import { confirmUpcMapping } from "../api/catalog";
import type { MlccProduct } from "../types";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function CandidateThumb({ url }: { url: string | null | undefined }) {
  const [hide, setHide] = useState(false);
  if (!url || hide) return null;
  return (
    <img
      className="upc-candidate-row__image"
      src={url}
      alt=""
      onError={() => setHide(true)}
    />
  );
}

type UpcCandidatePickerProps = {
  upcProductName: string;
  upcBrand?: string;
  candidates: MlccProduct[];
  upc: string;
  onSelect: (product: MlccProduct) => void;
  onNoneMatch: () => void;
  onCancel: () => void;
};

export function UpcCandidatePicker({
  upcProductName,
  upcBrand,
  candidates,
  upc,
  onSelect,
  onNoneMatch,
  onCancel,
}: UpcCandidatePickerProps) {
  const subtitleParts = [upcBrand, upcProductName].filter((s) => s && String(s).trim());
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" ") : "—";

  const handlePick = async (candidate: MlccProduct) => {
    await confirmUpcMapping(upc, candidate.code, upcProductName, upcBrand);
    onSelect(candidate);
  };

  return (
    <div className="upc-candidate-picker-overlay" onClick={onCancel} role="presentation">
      <div className="upc-candidate-picker-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="upc-candidate-title">
        <div className="upc-candidate-header">
          <h2 id="upc-candidate-title">Which product is this?</h2>
        </div>
        <p className="upc-candidate-subtitle">Scanned: {subtitle}</p>

        <ul className="upc-candidate-list">
          {candidates.map((c) => {
            const size = c.bottle_size_label ?? `${c.bottle_size_ml ?? ""} ML`;
            const brandLine = `${c.brand_family ?? c.name} · ${size}`;
            const cat = c.category ?? "—";
            return (
              <li key={c.id}>
                <button type="button" className="upc-candidate-row" onClick={() => void handlePick(c)}>
                  <CandidateThumb url={c.imageUrl} />
                  <div className="upc-candidate-row-body">
                    <div className="upc-candidate-row-title">{brandLine}</div>
                    <div className="upc-candidate-row-meta muted">{cat}</div>
                    <div className="upc-candidate-row-code mono">{c.code}</div>
                  </div>
                  <div className="upc-candidate-row-price">{money(c.licensee_price)}</div>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="upc-candidate-row--none" onClick={onNoneMatch}>
          None of these — search by name instead
        </button>

        <button type="button" className="upc-candidate-cancel btn secondary btn-block" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
