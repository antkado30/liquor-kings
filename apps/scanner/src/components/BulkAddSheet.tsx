/**
 * BulkAddSheet — paste a whole order, resolve every line to an MLCC code,
 * verify, then add all to the cart in one go.
 *
 * Why this exists: the assistant couldn't do bulk lookups (stateless +
 * 8-iteration tool cap). This flow sends the paste to POST
 * /assistant/resolve-order (LLM parses → deterministic code match), shows a
 * verify list you can fix per line, then adds confirmed lines via the normal
 * cart API (no new server cart-write path).
 *
 * NOTE: functional v1 — needs an on-device tap-test + a premium styling pass
 * before it's trusted for a real order.
 */
import { useState } from "react";
import type { CartContextValue } from "../hooks/useCart";
import type { MlccProduct } from "../types";
import { resolveOrder, type ResolvedCandidate } from "../api/assistant";

type Phase = "input" | "resolving" | "review" | "done";

interface ReviewLine {
  key: string;
  inputName: string;
  qty: number;
  candidates: ResolvedCandidate[];
  chosenIdx: number; // -1 = skip
  confidence: "high" | "medium" | "review" | "none";
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

const CONF_COPY: Record<ReviewLine["confidence"], { label: string; color: string }> = {
  high: { label: "match", color: "#1f9d55" },
  medium: { label: "check size", color: "#b7791f" },
  review: { label: "review", color: "#b7791f" },
  none: { label: "no match", color: "#c0392b" },
};

export function BulkAddSheet({
  cart,
  onClose,
}: {
  cart: CartContextValue;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [addedCount, setAddedCount] = useState(0);

  async function handleResolve() {
    setError(null);
    setPhase("resolving");
    const res = await resolveOrder(text);
    if (!res.ok) {
      setError(res.error);
      setPhase("input");
      return;
    }
    const reviewed: ReviewLine[] = res.lines.map((l, i) => {
      const candidates = [l.best, ...l.alternates].filter(
        (c): c is ResolvedCandidate => Boolean(c),
      );
      return {
        key: `${i}-${l.name}`,
        inputName: l.input.name || l.name,
        qty: l.qty && l.qty > 0 ? l.qty : 1,
        candidates,
        chosenIdx: candidates.length > 0 ? 0 : -1,
        confidence: l.confidence,
      };
    });
    setLines(reviewed);
    setPhase("review");
  }

  function update(key: string, patch: Partial<ReviewLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleAddAll() {
    let n = 0;
    for (const l of lines) {
      if (l.chosenIdx < 0) continue;
      const chosen = l.candidates[l.chosenIdx];
      if (!chosen) continue;
      cart.addItem(toProduct(chosen), l.qty);
      n += 1;
    }
    setAddedCount(n);
    setPhase("done");
  }

  const includedCount = lines.filter(
    (l) => l.chosenIdx >= 0 && l.candidates[l.chosenIdx],
  ).length;
  const readyCount = includedCount;
  // "Need your eye" = no match at all, or a match we're not fully sure of.
  const needsEyeCount = lines.filter(
    (l) => l.candidates.length === 0 || l.confidence !== "high",
  ).length;
  // Float the uncertain ones to the TOP so they can't be skipped.
  const CONF_RANK: Record<ReviewLine["confidence"], number> = {
    none: 0,
    review: 1,
    medium: 2,
    high: 3,
  };
  const orderedLines = [...lines].sort(
    (a, b) => CONF_RANK[a.confidence] - CONF_RANK[b.confidence],
  );

  return (
    <div className="bulkadd-backdrop" onClick={onClose}>
      <div
        className="bulkadd-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Bulk add to cart"
      >
        <header className="bulkadd-head">
          <h2 className="bulkadd-title">Paste your order</h2>
          <button className="bulkadd-x" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {phase === "input" || phase === "resolving" ? (
          <div className="bulkadd-body">
            <p className="muted bulkadd-hint">
              Paste your whole list — any format. I'll find every code, you
              verify, then add them all.
            </p>
            <textarea
              className="bulkadd-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Crown royal apple fifth 6, Tito's 1/2 gallon 6, Mohawk 80 plastic fifth 6…"
              rows={8}
              disabled={phase === "resolving"}
            />
            {error ? <div className="banner banner-err">{error}</div> : null}
            <button
              className="bulkadd-primary"
              onClick={handleResolve}
              disabled={phase === "resolving" || !text.trim()}
            >
              {phase === "resolving" ? "Finding codes…" : "Find codes"}
            </button>
          </div>
        ) : null}

        {phase === "review" ? (
          <div className="bulkadd-body">
            {/*
              Lesson from the 2026-06-16 real order: items that need a human
              decision MUST be impossible to miss. So they float to the TOP and
              the count is loud — a rushing user can't skip past them.
            */}
            {needsEyeCount > 0 ? (
              <div className="bulkadd-summary bulkadd-summary--warn">
                <strong>{needsEyeCount} need your eye</strong> (shown first) ·{" "}
                {readyCount} ready to add
              </div>
            ) : (
              <div className="bulkadd-summary">
                All {readyCount} matched cleanly — review and add.
              </div>
            )}
            <div className="bulkadd-list">
              {orderedLines.map((l) => {
                const conf = CONF_COPY[l.confidence];
                const rowClass =
                  l.candidates.length === 0
                    ? "bulkadd-row bulkadd-row--none"
                    : l.confidence !== "high"
                      ? "bulkadd-row bulkadd-row--review"
                      : "bulkadd-row";
                return (
                  <div key={l.key} className={rowClass}>
                    <div className="bulkadd-row-top">
                      <span className="bulkadd-input-name">{l.inputName}</span>
                      <span className="bulkadd-conf" style={{ color: conf.color }}>
                        {conf.label}
                      </span>
                    </div>
                    {l.candidates.length > 0 ? (
                      <div className="bulkadd-row-controls">
                        <select
                          className="bulkadd-select"
                          value={l.chosenIdx}
                          onChange={(e) =>
                            update(l.key, { chosenIdx: Number(e.target.value) })
                          }
                        >
                          {l.candidates.map((c, i) => (
                            <option key={c.code} value={i}>
                              {c.code} · {c.name} · {sizeLabel(c)} · {money(c.licensee_price)}
                            </option>
                          ))}
                          <option value={-1}>Skip this line</option>
                        </select>
                        <input
                          className="bulkadd-qty"
                          type="number"
                          min={1}
                          value={l.qty}
                          onChange={(e) =>
                            update(l.key, {
                              qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                            })
                          }
                        />
                      </div>
                    ) : (
                      <div className="muted bulkadd-nomatch">
                        No match found — search for it manually after.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              className="bulkadd-primary"
              onClick={handleAddAll}
              disabled={includedCount === 0}
            >
              Add {includedCount} to cart
            </button>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="bulkadd-body bulkadd-done">
            <div className="banner banner-ok">
              Added {addedCount} {addedCount === 1 ? "item" : "items"} to your
              cart. Review and validate before submitting.
            </div>
            <button className="bulkadd-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
