/**
 * ResolvedOrderCard — inline "Add to cart" card the chat renders when the
 * assistant resolves specific bottles (resolve_bottles tool). Type an order in
 * chat → this card appears → tweak qty / swap a match / skip → "Add to cart".
 *
 * Uncertain lines (no match / not fully sure) float to the top with a loud flag
 * so they can't be missed. Adds via the existing authed cart API (useCart).
 */
import { useState } from "react";
import type { CartContextValue } from "../hooks/useCart";
import type { MlccProduct } from "../types";
import type { ResolvedOrderLine, ResolvedCandidate } from "../api/assistant";

function rank(c: ResolvedOrderLine["confidence"]): number {
  return c === "none" ? 0 : c === "review" ? 1 : c === "medium" ? 2 : 3;
}

function toProduct(c: ResolvedCandidate): MlccProduct {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    brand_family: null,
    category: null,
    ada_number: c.ada_number,
    ada_name: c.ada_name ?? "",
    proof: c.proof ?? null,
    bottle_size_label: c.bottle_size_label ?? null,
    bottle_size_ml: c.bottle_size_ml ?? null,
    case_size: c.case_size ?? null,
    licensee_price: c.licensee_price ?? null,
    min_shelf_price: c.min_shelf_price ?? null,
    base_price: c.base_price ?? null,
    is_new_item: false,
  };
}

const money = (c: number | null) => (c == null ? "" : `$${c.toFixed(2)}`);
const sizeLabel = (c: ResolvedCandidate) =>
  c.bottle_size_label || (c.bottle_size_ml ? `${c.bottle_size_ml}ml` : "");

const CONF: Record<ResolvedOrderLine["confidence"], { label: string; color: string }> = {
  high: { label: "match", color: "#1f9d55" },
  medium: { label: "check size", color: "#b7791f" },
  review: { label: "review", color: "#b7791f" },
  none: { label: "no match", color: "#c0392b" },
};

interface Row {
  key: string;
  requestedName: string;
  qty: number;
  candidates: ResolvedCandidate[];
  chosenIdx: number;
  confidence: ResolvedOrderLine["confidence"];
}

export function ResolvedOrderCard({
  lines,
  cart,
}: {
  lines: ResolvedOrderLine[];
  cart: CartContextValue;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    [...lines]
      .sort((a, b) => rank(a.confidence) - rank(b.confidence))
      .map((l, i) => {
        const candidates = [l.best, ...l.alternates].filter(
          (c): c is ResolvedCandidate => Boolean(c),
        );
        return {
          key: `${i}-${l.requested.name}`,
          requestedName: l.requested.name,
          qty: l.requested.qty && l.requested.qty > 0 ? l.requested.qty : 1,
          candidates,
          chosenIdx: candidates.length > 0 ? 0 : -1,
          confidence: l.confidence,
        };
      }),
  );
  const [addedCount, setAddedCount] = useState<number | null>(null);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addAll() {
    let n = 0;
    for (const r of rows) {
      if (r.chosenIdx < 0) continue;
      const c = r.candidates[r.chosenIdx];
      if (!c) continue;
      cart.addItem(toProduct(c), r.qty);
      n += 1;
    }
    setAddedCount(n);
  }

  const includedCount = rows.filter(
    (r) => r.chosenIdx >= 0 && r.candidates[r.chosenIdx],
  ).length;
  const needEye = rows.filter(
    (r) => r.candidates.length === 0 || r.confidence !== "high",
  ).length;

  if (addedCount != null) {
    return (
      <div className="banner banner-ok ordercard-done">
        Added {addedCount} {addedCount === 1 ? "item" : "items"} to your cart —
        open Cart to review and validate.
      </div>
    );
  }

  return (
    <div className="ordercard">
      {needEye > 0 ? (
        <div className="bulkadd-summary bulkadd-summary--warn">
          <strong>{needEye} need your eye</strong> (shown first) · {includedCount} ready
        </div>
      ) : (
        <div className="bulkadd-summary">All {includedCount} matched — review and add.</div>
      )}
      <div className="bulkadd-list">
        {rows.map((r) => {
          const conf = CONF[r.confidence];
          const cls =
            r.candidates.length === 0
              ? "bulkadd-row bulkadd-row--none"
              : r.confidence !== "high"
                ? "bulkadd-row bulkadd-row--review"
                : "bulkadd-row";
          return (
            <div key={r.key} className={cls}>
              <div className="bulkadd-row-top">
                <span className="bulkadd-input-name">{r.requestedName}</span>
                <span className="bulkadd-conf" style={{ color: conf.color }}>
                  {conf.label}
                </span>
              </div>
              {r.candidates.length > 0 ? (
                <div className="bulkadd-row-controls">
                  <select
                    className="bulkadd-select"
                    value={r.chosenIdx}
                    onChange={(e) => update(r.key, { chosenIdx: Number(e.target.value) })}
                  >
                    {r.candidates.map((c, i) => (
                      <option key={c.code} value={i}>
                        {c.code} · {c.name} · {sizeLabel(c)} · {money(c.licensee_price)}
                      </option>
                    ))}
                    <option value={-1}>Skip</option>
                  </select>
                  <input
                    className="bulkadd-qty"
                    type="number"
                    min={1}
                    value={r.qty}
                    onChange={(e) =>
                      update(r.key, {
                        qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                      })
                    }
                  />
                </div>
              ) : (
                <div className="muted bulkadd-nomatch">No match — search for it manually.</div>
              )}
            </div>
          );
        })}
      </div>
      <button className="bulkadd-primary" onClick={addAll} disabled={includedCount === 0}>
        Add {includedCount} to cart
      </button>
    </div>
  );
}
