/**
 * ResolvedOrderCard — inline "Add to cart" card the chat renders when the
 * assistant resolves specific bottles (resolve_bottles tool). Type an order in
 * chat → this card appears → tweak qty / swap a match / skip → "Add to cart".
 *
 * GLANCEABILITY REBUILD (2026-07-24, Tony: "u have to click on each one to
 * actually figure that out which gets really annoying"):
 *   - The MATCHED BOTTLE is the headline — name, then a truth line of
 *     size · price · code — all visible AT REST. Before this, the match lived
 *     only inside the <select>'s option text (truncated native picker box),
 *     so seeing what matched required tapping every line.
 *   - "You said: …" is the small receipt underneath (raw line when we have it).
 *   - size_mismatch renders a LOUD inline flag with our own human copy
 *     (requested Xml — this is Yml). The *_note strings from the server are
 *     written for the model, not the UI.
 *   - case_intent prefills qty with suggested_qty (one full case). Before
 *     this the card DROPPED suggested_qty — "Tito's x case" showed qty 1.
 *   - Swapping is an explicit "Swap match" chip: a native <select> overlaid
 *     invisibly (iOS-reliable) — one tap when you WANT alternatives, never
 *     required just to see the match.
 *
 * Uncertain lines (no match / not fully sure) float to the top with a loud flag
 * so they can't be missed. Adds via the existing authed cart API (useCart).
 */
import { useState } from "react";
import type { CartContextValue } from "../hooks/useCart";
import type { MlccProduct } from "../types";
import type { ResolvedOrderLine, ResolvedCandidate } from "../api/assistant";
import { nonGlassContainerSuffix, packCountSuffix } from "../lib/container-label";

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
    // Identity truth rides into the cart line (2026-07-12): without
    // these, an AI-resolved 12-pack showed as a plain "50 ML" from the
    // cart line all the way to the pre-submit confirm.
    container: c.container ?? null,
    pack_count: c.pack_count ?? null,
  };
}

const money = (c: number | null) => (c == null ? "" : `$${c.toFixed(2)}`);
// Size + material + pack — the same truth chain as the size chips; the
// verify card is the LAST look before "Add all to cart".
const sizeLabel = (c: ResolvedCandidate) =>
  `${c.bottle_size_label || (c.bottle_size_ml ? `${c.bottle_size_ml}ml` : "")}${nonGlassContainerSuffix(c.container)}${packCountSuffix(c.pack_count)}`;

const CONF: Record<ResolvedOrderLine["confidence"], { label: string; color: string }> = {
  high: { label: "match", color: "#1f9d55" },
  medium: { label: "check", color: "#b7791f" },
  review: { label: "review", color: "#b7791f" },
  none: { label: "no match", color: "#c0392b" },
};

interface Row {
  key: string;
  requestedName: string;
  /** Verbatim line when the tool got one (photo/paste) — the honest receipt. */
  requestedRaw: string | null;
  requestedSize: string | null;
  qty: number;
  candidates: ResolvedCandidate[];
  chosenIdx: number;
  confidence: ResolvedOrderLine["confidence"];
  sizeMismatch: boolean;
  requestedSizeMl: number | null;
  caseIntent: boolean;
}

/** Initial qty: the server's case suggestion wins, else the requested qty, else 1. */
function initialQty(l: ResolvedOrderLine): number {
  if (l.case_intent && typeof l.suggested_qty === "number" && l.suggested_qty > 0) {
    return l.suggested_qty;
  }
  return l.requested.qty && l.requested.qty > 0 ? l.requested.qty : 1;
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
          requestedRaw:
            typeof l.requested.raw === "string" && l.requested.raw.trim()
              ? l.requested.raw.trim()
              : null,
          requestedSize: l.requested.size ?? null,
          qty: initialQty(l),
          candidates,
          chosenIdx: candidates.length > 0 ? 0 : -1,
          confidence: l.confidence,
          sizeMismatch: l.size_mismatch === true,
          requestedSizeMl:
            typeof l.requested_size_ml === "number" ? l.requested_size_ml : null,
          caseIntent: l.case_intent === true,
        };
      }),
  );
  const [addedCount, setAddedCount] = useState<number | null>(null);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Swap keeps the case suggestion honest: if qty still equals the OLD
      candidate's untouched case suggestion, retarget it to the new one. */
  function swapChoice(r: Row, nextIdx: number) {
    const prev = r.chosenIdx >= 0 ? r.candidates[r.chosenIdx] : null;
    const next = nextIdx >= 0 ? r.candidates[nextIdx] : null;
    let qty = r.qty;
    if (
      r.caseIntent &&
      prev?.case_size != null &&
      next?.case_size != null &&
      r.qty === prev.case_size
    ) {
      qty = next.case_size;
    }
    update(r.key, { chosenIdx: nextIdx, qty });
  }

  function addAll() {
    let n = 0;
    for (const r of rows) {
      if (r.chosenIdx < 0) continue;
      const c = r.candidates[r.chosenIdx];
      if (!c) continue;
      // SET semantics, not merge-add: if this code is already in the cart (e.g.
      // from an earlier card in this same conversation), set it to the card's
      // quantity so a follow-up edit ("make that 6") corrects it instead of
      // stacking (3 + 6 = 9). New items are added normally.
      const inCart = cart.items.some((it) => it.product.code === c.code);
      if (inCart) cart.updateQuantity(c.code, r.qty);
      else cart.addItem(toProduct(c), r.qty);
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
          const chosen = r.chosenIdx >= 0 ? r.candidates[r.chosenIdx] : null;
          const cls =
            r.candidates.length === 0
              ? "bulkadd-row bulkadd-row--none"
              : r.confidence !== "high"
                ? "bulkadd-row bulkadd-row--review"
                : "bulkadd-row";
          const saidBits = [
            r.requestedRaw ?? r.requestedName,
            r.requestedRaw ? null : r.requestedSize,
          ].filter(Boolean);
          return (
            <div key={r.key} className={cls}>
              {r.candidates.length === 0 ? (
                <>
                  <div className="bulkadd-row-top">
                    <span className="bulkadd-match-name">{r.requestedName}</span>
                    <span className="bulkadd-conf" style={{ color: conf.color }}>
                      {conf.label}
                    </span>
                  </div>
                  <div className="muted bulkadd-nomatch">
                    No match — search for it manually.
                  </div>
                </>
              ) : chosen ? (
                <>
                  {/* THE GLANCE: matched name + truth line, visible at rest. */}
                  <div className="bulkadd-row-top">
                    <span className="bulkadd-match-name">{chosen.name}</span>
                    <span className="bulkadd-conf" style={{ color: conf.color }}>
                      {conf.label}
                    </span>
                  </div>
                  <div className="bulkadd-truth">
                    <span className="bulkadd-truth-size">{sizeLabel(chosen)}</span>
                    <span className="bulkadd-truth-dot">·</span>
                    <span className="bulkadd-truth-price">
                      {money(chosen.licensee_price) || "price n/a"}
                    </span>
                    <span className="bulkadd-truth-dot">·</span>
                    <span className="bulkadd-truth-code">#{chosen.code}</span>
                  </div>
                  <div className="bulkadd-said">You said: {saidBits.join(" · ")}</div>
                  {r.sizeMismatch && (
                    <div className="bulkadd-flag bulkadd-flag--size">
                      ⚠ No {r.requestedSizeMl ? `${r.requestedSizeMl} ml` : "requested size"}{" "}
                      for this one — this is {sizeLabel(chosen) || "a different size"}.
                      Swap or confirm.
                    </div>
                  )}
                  {r.caseIntent && chosen.case_size != null && (
                    <div className="bulkadd-flag bulkadd-flag--case">
                      “Case” = {chosen.case_size} bottles — qty set to{" "}
                      {r.qty === chosen.case_size ? "one case" : r.qty}.
                    </div>
                  )}
                  <div className="bulkadd-row-controls">
                    <div className="bulkadd-swap">
                      <span className="bulkadd-swap-label">
                        {r.candidates.length > 1
                          ? `Swap match (${r.candidates.length - 1} other${
                              r.candidates.length - 1 === 1 ? "" : "s"
                            }) ⌄`
                          : "Only match · skip? ⌄"}
                      </span>
                      <select
                        className="bulkadd-swap-select"
                        aria-label={`Swap match for ${r.requestedName}`}
                        value={r.chosenIdx}
                        onChange={(e) => swapChoice(r, Number(e.target.value))}
                      >
                        {r.candidates.map((c, i) => (
                          <option key={c.code} value={i}>
                            {c.code} · {c.name} · {sizeLabel(c)} · {money(c.licensee_price)}
                          </option>
                        ))}
                        <option value={-1}>Skip this line</option>
                      </select>
                    </div>
                    <input
                      className="bulkadd-qty"
                      type="number"
                      min={1}
                      aria-label={`Quantity for ${chosen.name}`}
                      value={r.qty}
                      onChange={(e) =>
                        update(r.key, {
                          qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Skipped by choice — visible, reversible. */}
                  <div className="bulkadd-row-top">
                    <span className="bulkadd-match-name bulkadd-match-name--skipped">
                      {r.requestedName}
                    </span>
                    <span className="bulkadd-conf" style={{ color: "#8a8f98" }}>
                      skipped
                    </span>
                  </div>
                  <div className="bulkadd-swap">
                    <span className="bulkadd-swap-label">Choose a match ⌄</span>
                    <select
                      className="bulkadd-swap-select"
                      aria-label={`Choose a match for ${r.requestedName}`}
                      value={-1}
                      onChange={(e) => swapChoice(r, Number(e.target.value))}
                    >
                      {r.candidates.map((c, i) => (
                        <option key={c.code} value={i}>
                          {c.code} · {c.name} · {sizeLabel(c)} · {money(c.licensee_price)}
                        </option>
                      ))}
                      <option value={-1}>Keep skipped</option>
                    </select>
                  </div>
                </>
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
