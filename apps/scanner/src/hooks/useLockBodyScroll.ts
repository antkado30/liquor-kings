import { useEffect } from "react";

/**
 * Lock the page body from scrolling while a modal/overlay is open (2026-06-09).
 *
 * THE BUG THIS FIXES: on the scanner, opening a modal (ProductCard, vision
 * picker, etc.) over the live camera — then trying to scroll inside the modal —
 * scrolled the SCANNER PAGE BEHIND it instead. The modal got cut off and its
 * options were unreachable (Tony hit this at Colony).
 *
 * iOS Safari IGNORES `overflow: hidden` on <body> for touch scrolling, so the
 * only reliable lock is `position: fixed` on the body with the current scroll
 * offset preserved — then restore it (and the scroll position) on unmount.
 * Pair this with `overscroll-behavior: contain` on the modal's scroll container
 * so the inner scroll never chains out to the page.
 */
export function useLockBodyScroll(): void {
  useEffect(() => {
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      // Restore the scroll position the page had before we locked it.
      window.scrollTo(0, scrollY);
    };
  }, []);
}
