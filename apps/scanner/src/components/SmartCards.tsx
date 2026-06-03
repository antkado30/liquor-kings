/**
 * SmartCards — actionable cards on the scanner home (task #63, 2026-06-02).
 * Surfaces:
 *   - Price book staleness warning (with how-to)
 *   - MLCC price changes on products the store carries
 *   - Reorder suggestions based on same-day-of-week patterns
 *
 * Cards are tappable when they carry a productCode; tap opens
 * ProductCard for that bottle so the user can add to cart in one
 * tap. Dismissed cards (per-id) are remembered in localStorage so
 * they don't re-surface every session.
 */
import { useEffect, useState } from "react";
import { getSmartCards, type SmartCard } from "../api/home";

const DISMISSED_KEY = "lk-smart-cards-dismissed-v1";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(s: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]));
  } catch {
    /* storage full / private mode — silently ignore */
  }
}

type SmartCardsProps = {
  /** Called when user taps a card with a productCode — opens ProductCard. */
  onTapProduct: (code: string) => void;
};

export function SmartCards({ onTapProduct }: SmartCardsProps) {
  const [cards, setCards] = useState<SmartCard[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSmartCards().then((r) => {
      if (r.ok) {
        setCards(r.cards);
      } else {
        setError(r.error);
      }
    });
  }, []);

  if (error) {
    // Fail silently in production — don't block the scanner UI on
    // an optional decoration. Logged via console for diagnosis.
    console.warn("[smart-cards] load failed:", error);
    return null;
  }

  if (!cards) return null;

  const visible = cards.filter((c) => !dismissed.has(c.id));
  if (visible.length === 0) return null;

  const handleDismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  };

  return (
    <section className="smart-cards" aria-label="Suggestions">
      {visible.map((c) => (
        <article
          key={c.id}
          className={`smart-card smart-card--${c.kind}`}
          aria-label={c.title}
        >
          <button
            type="button"
            className="smart-card__body-btn"
            onClick={() => {
              if (c.productCode) onTapProduct(c.productCode);
            }}
            disabled={!c.productCode}
          >
            <div className="smart-card__kind-pill">
              {kindLabel(c.kind)}
            </div>
            <div className="smart-card__title">{c.title}</div>
            <div className="smart-card__body">{c.body}</div>
          </button>
          <button
            type="button"
            className="smart-card__dismiss"
            onClick={() => handleDismiss(c.id)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </article>
      ))}
    </section>
  );
}

function kindLabel(kind: SmartCard["kind"]): string {
  switch (kind) {
    case "price_change":
      return "Price changed";
    case "reorder_suggestion":
      return "Reorder?";
    case "price_book_stale":
      return "Price book stale";
    default:
      return "Heads up";
  }
}
