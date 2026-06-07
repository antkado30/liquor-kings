import { useEffect, useMemo, useRef, useState } from "react";
import { askAssistant } from "../api/assistant";
import { useHideTabBar } from "../hooks/useHideTabBar";
import type { CartContextValue } from "../hooks/useCart";

type Message = { id: number; role: "user" | "assistant"; text: string };

/**
 * Compute context-aware suggestions for the assistant (task #74,
 * 2026-06-04). Static "what's the 9L rule" got stale fast — these
 * change based on what's happening in the app right now.
 *
 * Rules:
 *   - If cart has items: surface a question about it ("Will this cart
 *     pass MLCC validate?", "What's my best ADA balance?")
 *   - If cart is empty: surface inventory / order-history questions
 *   - Time-of-day awareness for the "what's selling today?" angle
 *   - Always fall back to a few evergreen MLCC questions so we never
 *     show an empty list
 */
function buildContextualSuggestions(
  cart: CartContextValue,
): string[] {
  const out: string[] = [];
  const hasItems = cart.items.length > 0;
  const distinctSkus = new Set(cart.items.map((it) => it.product.code)).size;
  const hour = new Date().getHours();
  const morning = hour >= 6 && hour < 12;
  const evening = hour >= 17 && hour < 22;

  if (hasItems) {
    out.push("Will my current cart pass MLCC validation?");
    if (distinctSkus >= 3) {
      out.push("Which distributor in my cart has the smallest subtotal?");
    }
    out.push("Are any of my cart items new MLCC arrivals?");
  } else {
    if (morning) {
      out.push("What price changes happened in the last 7 days?");
      out.push("What did I order last week?");
    } else if (evening) {
      out.push("Summarize today's orders");
      out.push("What's selling on my shelf this week?");
    } else {
      out.push("What price changes happened in the last 7 days?");
      out.push("What new MLCC arrivals came out this week?");
    }
  }

  // Always-available MLCC compliance questions — dad's actual day-to-day.
  out.push("What's the 9 liter rule?");
  out.push("Can I order 8 bottles of a 750ml?");

  // De-dupe + cap at 5 so the panel doesn't get overrun.
  return [...new Set(out)].slice(0, 5);
}

type AssistantPanelProps = {
  onClose: () => void;
  /** Cart state to drive contextual suggestions. Optional for back-compat. */
  cart?: CartContextValue;
};

/**
 * In-app AI assistant chat panel. Drawer-style overlay (shares the
 * drawer-backdrop / drawer shell with CartDrawer). Each question is an
 * independent call to POST /assistant/ask; the conversation is kept
 * client-side for display.
 */
export function AssistantPanel({ onClose, cart }: AssistantPanelProps) {
  // Hide the bottom tab bar — the input area would otherwise be
  // covered by it and the user couldn't type (Tony, 2026-06-07).
  useHideTabBar();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(1);

  // Dynamic suggestions — recomputed when the cart context changes.
  // Frozen for the empty-state view at first paint so they don't shuffle
  // mid-read if the user lingers.
  const suggestions = useMemo(
    () =>
      cart
        ? buildContextualSuggestions(cart)
        : [
            "What's the 9 liter rule?",
            "How much does code 100009 cost?",
            "Can I order 8 bottles of a 750ml?",
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart?.items.length],
  );

  // Keep the message list scrolled to the latest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, isAsking]);

  const submit = async (question: string) => {
    const q = question.trim();
    if (!q || isAsking) return;
    setError(null);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: nextIdRef.current++, role: "user", text: q },
    ]);
    setIsAsking(true);
    const result = await askAssistant(q);
    setIsAsking(false);
    if (result.ok) {
      setMessages((prev) => [
        ...prev,
        { id: nextIdRef.current++, role: "assistant", text: result.answer },
      ]);
    } else {
      setError(result.error);
    }
  };

  const handleClose = () => {
    if (isAsking) return;
    onClose();
  };

  return (
    <div className="drawer-backdrop" onClick={handleClose} role="presentation">
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Assistant"
      >
        <div className="drawer-header">
          <h2>Assistant</h2>
          <button
            type="button"
            className="drawer-close"
            onClick={handleClose}
            aria-label="Close assistant"
            disabled={isAsking}
          >
            ×
          </button>
        </div>

        <div className="assistant-messages" ref={listRef}>
          {messages.length === 0 ? (
            <div className="assistant-empty">
              <p className="muted">
                Ask anything about your catalog, pricing, MLCC rules, or orders.
              </p>
              <div className="assistant-suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="assistant-suggestion"
                    onClick={() => void submit(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`assistant-msg assistant-msg--${m.role}`}>
                {m.text}
              </div>
            ))
          )}
          {isAsking ? (
            <div className="assistant-msg assistant-msg--assistant assistant-msg--loading">
              Thinking…
            </div>
          ) : null}
        </div>

        {error ? <p className="banner banner-err">{error}</p> : null}

        <form
          className="assistant-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(input);
          }}
        >
          <input
            type="text"
            className="assistant-input"
            placeholder="Ask the assistant…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isAsking}
            aria-label="Ask the assistant"
          />
          <button
            type="submit"
            className="btn primary"
            disabled={isAsking || input.trim().length === 0}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
