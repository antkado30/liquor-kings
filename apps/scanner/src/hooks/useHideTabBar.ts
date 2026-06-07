/**
 * useHideTabBar — toggles a body class so the BottomTabBar can hide
 * via CSS when a full-screen overlay/modal is open (task 2026-06-07
 * critical fix).
 *
 * Why this hook exists: the BottomTabBar is fixed-position at the
 * bottom of the viewport. Modals like CartDrawer and AssistantPanel
 * also stretch to the bottom, but they don't know about the tab bar
 * — so the tab bar OVERLAPS the modal's input controls / submit
 * buttons. Tony hit this immediately: the assistant text input was
 * hidden behind the tab bar; the cart drawer submit button was
 * covered up.
 *
 * Doctrine alignment: discipline #5 (loud failures only) — the
 * inability to reach a critical UI element is a silent failure mode.
 * We don't want to silently let users be unable to interact.
 *
 * Implementation: simple body class toggle. CSS in index.css has:
 *
 *   body.lk-tab-bar-hidden nav[aria-label="Primary navigation"] {
 *     display: none;
 *   }
 *
 * Pure CSS — no React state needed for the tab bar. Any overlay
 * component just calls useHideTabBar() and the tab bar disappears
 * for as long as the component is mounted.
 */
import { useEffect } from "react";

const BODY_CLASS = "lk-tab-bar-hidden";

export function useHideTabBar(active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    document.body.classList.add(BODY_CLASS);
    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, [active]);
}
