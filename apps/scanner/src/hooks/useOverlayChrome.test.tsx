/**
 * Overlay-chrome hooks × the Cart-page fix (2026-07-26). CartDrawer now
 * renders as a real page (layout="page") — these pin that the page mode
 * really opts out of the overlay behaviors, and that the drawer mode
 * keeps them. If someone drops the `active` param, the cart page goes
 * back to hiding the tab bar and freezing the body — Tony's exact bug.
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useHideTabBar } from "./useHideTabBar";
import { useLockBodyScroll } from "./useLockBodyScroll";

afterEach(() => {
  cleanup();
  document.body.className = "";
  document.body.removeAttribute("style");
});

describe("useHideTabBar(active)", () => {
  it("drawer mode (default): body gets the hide class, removed on unmount", () => {
    const { unmount } = renderHook(() => useHideTabBar());
    expect(document.body.classList.contains("lk-tab-bar-hidden")).toBe(true);
    unmount();
    expect(document.body.classList.contains("lk-tab-bar-hidden")).toBe(false);
  });

  it("page mode (active=false): the tab bar stays — it is how you leave the page", () => {
    renderHook(() => useHideTabBar(false));
    expect(document.body.classList.contains("lk-tab-bar-hidden")).toBe(false);
  });
});

describe("useLockBodyScroll(active)", () => {
  it("drawer mode (default): body is position-fixed, restored on unmount", () => {
    const { unmount } = renderHook(() => useLockBodyScroll());
    expect(document.body.style.position).toBe("fixed");
    unmount();
    expect(document.body.style.position).toBe("");
  });

  it("page mode (active=false): a page must scroll like a page", () => {
    renderHook(() => useLockBodyScroll(false));
    expect(document.body.style.position).toBe("");
    expect(document.body.style.overflow).toBe("");
  });
});
