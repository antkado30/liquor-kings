import { useHideTabBar } from "../hooks/useHideTabBar";
import type { CartContextValue } from "../hooks/useCart";
import { AssistantChat } from "./AssistantChat";

type AssistantPanelProps = {
  onClose: () => void;
  /** Cart state to drive contextual suggestions. Optional for back-compat. */
  cart?: CartContextValue;
};

/**
 * In-app AI assistant chat panel. Drawer-style overlay (shares the
 * drawer-backdrop / drawer shell with CartDrawer). Kept for backward
 * compatibility; primary entry is now /assistant (AssistantPage).
 */
export function AssistantPanel({ onClose, cart }: AssistantPanelProps) {
  useHideTabBar();

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
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
            onClick={onClose}
            aria-label="Close assistant"
          >
            ×
          </button>
        </div>
        <AssistantChat cart={cart} layout="drawer" />
      </div>
    </div>
  );
}
