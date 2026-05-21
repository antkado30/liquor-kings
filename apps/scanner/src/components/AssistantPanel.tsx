import { useEffect, useRef, useState } from "react";
import { askAssistant } from "../api/assistant";

type Message = { id: number; role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "What's the 9 liter rule?",
  "How much does code 100009 cost?",
  "Can I order 8 bottles of a 750ml?",
];

type AssistantPanelProps = {
  onClose: () => void;
};

/**
 * In-app AI assistant chat panel. Drawer-style overlay (shares the
 * drawer-backdrop / drawer shell with CartDrawer). Each question is an
 * independent call to POST /assistant/ask; the conversation is kept
 * client-side for display.
 */
export function AssistantPanel({ onClose }: AssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(1);

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
                {SUGGESTIONS.map((s) => (
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
