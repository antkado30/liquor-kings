/**
 * AssistantPage — full-screen AI assistant route (task 2026-06-07).
 *
 * The assistant is its own destination at /assistant. The scanner
 * camera is not mounted behind it — only this chat UI renders.
 */
import { useState } from "react";
import { useCart } from "../hooks/useCart";
import { AssistantChat } from "../components/AssistantChat";
import { BulkAddSheet } from "../components/BulkAddSheet";
import { IconSparkles } from "../components/Icons";

export function AssistantPage() {
  const cart = useCart();
  const [bulkOpen, setBulkOpen] = useState(false);

  return (
    <div className="page-shell assistant-page">
      <header className="assistant-page-header">
        <span className="assistant-page-icon" aria-hidden>
          <IconSparkles size={22} strokeWidth={1.9} />
        </span>
        <div className="assistant-page-header__copy">
          <h1 className="assistant-page-title">Assistant</h1>
          <p className="assistant-page-subtitle muted">
            Your catalog, orders, MLCC rules — plus photo questions.
          </p>
        </div>
        <button
          className="assistant-bulk-btn"
          onClick={() => setBulkOpen(true)}
          type="button"
        >
          Paste an order
        </button>
      </header>
      <AssistantChat cart={cart} layout="page" />
      {bulkOpen ? (
        <BulkAddSheet cart={cart} onClose={() => setBulkOpen(false)} />
      ) : null}
    </div>
  );
}
