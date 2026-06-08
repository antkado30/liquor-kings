/**
 * AssistantPage — full-screen AI assistant route (task 2026-06-07).
 *
 * The assistant is its own destination at /assistant. The scanner
 * camera is not mounted behind it — only this chat UI renders.
 */
import { useCart } from "../hooks/useCart";
import { AssistantChat } from "../components/AssistantChat";
import { IconSparkles } from "../components/Icons";

export function AssistantPage() {
  const cart = useCart();

  return (
    <div className="page assistant-page">
      <header className="assistant-page-header">
        <span className="assistant-page-icon" aria-hidden>
          <IconSparkles size={24} strokeWidth={1.9} />
        </span>
        <div>
          <h1 className="assistant-page-title">Assistant</h1>
          <p className="assistant-page-subtitle muted">
            Your catalog, orders, MLCC rules — plus photo questions.
          </p>
        </div>
      </header>
      <AssistantChat cart={cart} layout="page" />
    </div>
  );
}
