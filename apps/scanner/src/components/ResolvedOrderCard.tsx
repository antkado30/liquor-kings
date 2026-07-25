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
import { recordAssistantMemory } from "../api/assistant";
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
  /** Store memory (2026-07-24): the match IS this store's saved choice. */
  remembered: boolean;
  /** 2026-07-25: brand matched nothing — likely not in the current book. */
  brandAbsent: boolean;
  /** The resolver's original pick — a different final choice = a correction
      worth teaching the store's memory (learn-on-swap). */
  originalBestCode: string | null;
  originalBestSizeMl: number | null;
  /** Size flip (2026-07-24): the family's other sizes; sizeIdx -1 = as matched. */
  sizes: ResolvedCandidate[];
  sizeIdx: number;
}

/** The bottle a row will actually add: size flip wins, else the chosen match. */
function finalCandidate(r: Row): ResolvedCandidate | null {
  if (r.sizeIdx >= 0 && r.sizes[r.sizeIdx]) return r.sizes[r.sizeIdx];
  return r.chosenIdx >= 0 ? (r.candidates[r.chosenIdx] ?? null) : null;
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
          remembered: l.remembered === true,
          brandAbsent: l.brand_absent === true,
          originalBestCode: l.best?.code ?? null,
          originalBestSizeMl: l.best?.bottle_size_ml ?? null,
          sizes: Array.isArray(l.sizes) ? l.sizes : [],
          sizeIdx: -1,
        };
      }),
  );
  // Added receipt (2026-07-24, Tony: "the actual bottle that I added
  // disappeared… I want it to be shown"): the done-state lists exactly what
  // landed in the cart — qty × name · size — not a bare count.
  const [added, setAdded] = useState<{ code: string; name: string; size: string; qty: number }[] | null>(
    null,
  );

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Swap keeps the case suggestion honest: if qty still equals the OLD
      candidate's untouched case suggestion, retarget it to the new one.
      A brand swap also clears any size flip — the sizes list belongs to the
      resolver's matched family, not the newly chosen brand. */
  function swapChoice(r: Row, nextIdx: number) {
    const prev = finalCandidate(r);
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
    update(r.key, { chosenIdx: nextIdx, qty, sizeIdx: -1 });
  }

  /** Size flip (2026-07-24): switch the line to another size of the SAME
      product family. Case suggestion retargets like a swap. */
  function sizeChoice(r: Row, idx: number) {
    const prev = finalCandidate(r);
    // Picking the size that IS the current match = back to "as matched".
    const current = r.chosenIdx >= 0 ? r.candidates[r.chosenIdx] : null;
    const normalized = idx >= 0 && r.sizes[idx]?.code === current?.code ? -1 : idx;
    const next = normalized >= 0 ? r.sizes[normalized] : current;
    let qty = r.qty;
    if (
      r.caseIntent &&
      prev?.case_size != null &&
      next?.case_size != null &&
      r.qty === prev.case_size
    ) {
      qty = next.case_size;
    }
    update(r.key, { sizeIdx: normalized, qty });
  }

  function addAll() {
    const receipt: { code: string; name: string; size: string; qty: number }[] = [];
    const corrections: {
      name: string;
      size?: string | null;
      raw?: string | null;
      mlcc_code: string;
    }[] = [];
    for (const r of rows) {
      const c = finalCandidate(r);
      if (!c) continue;
      // SET semantics, not merge-add: if this code is already in the cart (e.g.
      // from an earlier card in this same conversation), set it to the card's
      // quantity so a follow-up edit ("make that 6") corrects it instead of
      // stacking (3 + 6 = 9). New items are added normally.
      const inCart = cart.items.some((it) => it.product.code === c.code);
      if (inCart) cart.updateQuantity(c.code, r.qty);
      else cart.addItem(toProduct(c), r.qty);
      receipt.push({ code: c.code, name: c.name, size: sizeLabel(c), qty: r.qty });
      // LEARN-ON-SWAP (the moat, 2026-07-24, Tony's call: every swap teaches
      // silently): choosing a DIFFERENT bottle than the resolver's pick is a
      // correction — teach the store's memory so next time this phrase pins
      // "★ remembered". Choosing the default teaches nothing. GUARD: a SIZE
      // flip never teaches — the phrase's spoken size ("fifth") must never be
      // re-mapped to a different-size bottle by a one-off grab.
      if (
        r.originalBestCode &&
        c.code !== r.originalBestCode &&
        c.bottle_size_ml === r.originalBestSizeMl
      ) {
        corrections.push({
          name: r.requestedName,
          size: r.requestedSize,
          raw: r.requestedRaw,
          mlcc_code: c.code,
        });
      }
    }
    if (corrections.length > 0) {
      // Fire-and-forget: add-to-cart never waits on learning.
      void recordAssistantMemory(corrections);
    }
    setAdded(receipt);
  }

  const includedCount = rows.filter(
    (r) => r.chosenIdx >= 0 && r.candidates[r.chosenIdx],
  ).length;
  const needEye = rows.filter(
    (r) => r.candidates.length === 0 || r.confidence !== "high",
  ).length;

  if (added != null) {
    return (
      <div className="banner banner-ok ordercard-done">
        <div className="ordercard-done-title">
          Added {added.length} {added.length === 1 ? "item" : "items"} to your cart:
        </div>
        {added.map((a) => (
          <div key={a.code} className="ordercard-done-line">
            {a.qty}× {a.name}
            {a.size ? ` · ${a.size}` : ""}
          </div>
        ))}
        <div className="ordercard-done-hint">Open Cart to review and validate.</div>
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
          const chosen = finalCandidate(r);
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
                    {r.remembered ? (
                      <span className="bulkadd-conf" style={{ color: CONF.high.color }}>
                        ★ remembered
                      </span>
                    ) : (
                      <span className="bulkadd-conf" style={{ color: conf.color }}>
                        {conf.label}
                      </span>
                    )}
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
                  {r.brandAbsent && (
                    <div className="bulkadd-flag bulkadd-flag--size">
                      ⚠ Likely NOT in the current MLCC book (allocated, seasonal, or
                      discontinued) — this is only the closest different product.
                      Don't add it blind.
                    </div>
                  )}
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
                  {/* SIZE FLIP (2026-07-24): every size MLCC carries of this
                      family — grab the 375 alongside your usual 750 without
                      leaving the card. Hidden after a brand swap (the sizes
                      belong to the matched family). */}
                  {r.sizes.length > 1 && r.chosenIdx === 0 && (
                    <div className="bulkadd-swap">
                      <span className="bulkadd-swap-label">
                        Switch size ({r.sizes.length} carried) ⌄
                      </span>
                      <select
                        className="bulkadd-swap-select"
                        aria-label={`Switch size for ${r.requestedName}`}
                        value={
                          r.sizeIdx >= 0
                            ? r.sizeIdx
                            : r.sizes.findIndex((s) => s.code === chosen.code)
                        }
                        onChange={(e) => sizeChoice(r, Number(e.target.value))}
                      >
                        {r.sizes.map((s, i) => (
                          <option key={s.code} value={i}>
                            {s.code} · {sizeLabel(s)} · {money(s.licensee_price)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
