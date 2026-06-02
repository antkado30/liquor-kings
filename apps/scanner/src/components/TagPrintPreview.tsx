/**
 * TagPrintPreview — in-app modal that previews and prints shelf tag
 * HTML (task #22 follow-up, 2026-06-02).
 *
 * iOS PWA bug: when the scanner is added to the home screen, the app
 * runs in standalone mode and window.open() is blocked entirely (no
 * Safari to open the new tab in). So we can't pop a new window for
 * print preview. Instead we render the HTML in an iframe inside a
 * full-screen modal and call iframe.contentWindow.print() when the
 * user taps Print. Works in both Safari and standalone PWA modes.
 *
 * Bonus UX: user sees the tag before printing instead of getting an
 * instant print dialog. Catches typos / wrong product / wrong price
 * BEFORE wasting a label.
 */
import { useEffect, useRef, useState } from "react";

type TagPrintPreviewProps = {
  /** Server-rendered HTML page (from POST /tags/render). */
  html: string;
  onClose: () => void;
};

export function TagPrintPreview({ html, onClose }: TagPrintPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [printing, setPrinting] = useState(false);
  const [ready, setReady] = useState(false);

  /*
    Wait for the iframe to load before allowing print — otherwise the
    embedded fitText script hasn't had a chance to run and the price
    would print at its initial 260px size, overflowing the label.
    Listen for the iframe's load event; on iOS this fires after the
    inline <script> finishes its first synchronous pass.
  */
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => setReady(true);
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [html]);

  const handlePrint = () => {
    if (printing) return;
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) {
      onClose();
      return;
    }
    setPrinting(true);
    try {
      // Defer slightly so the fitText script has settled before the
      // print snapshot is captured. ~250ms is the sweet spot on
      // iPhone 13 / iOS 17 testing.
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (err) {
          console.warn("[tag-print] iframe print failed:", err);
        } finally {
          setPrinting(false);
        }
      }, 250);
    } catch {
      setPrinting(false);
    }
  };

  return (
    <div
      className="product-card-backdrop tag-print-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Shelf tag preview"
      onClick={onClose}
    >
      <div className="tag-print-card" onClick={(e) => e.stopPropagation()}>
        <div className="tag-print-card__header">
          <h2 className="tag-print-card__title">Print shelf tag</h2>
          <button
            type="button"
            className="product-card-close product-card-close--labeled"
            onClick={onClose}
            aria-label="Done — close preview"
          >
            Done
          </button>
        </div>

        <div className="tag-print-preview-wrap">
          <iframe
            ref={iframeRef}
            title="Shelf tag preview"
            srcDoc={html}
            className="tag-print-preview-frame"
            sandbox="allow-same-origin allow-scripts allow-modals"
          />
        </div>

        <div className="tag-print-actions">
          <button
            type="button"
            className="btn primary btn-block"
            disabled={!ready || printing}
            onClick={handlePrint}
          >
            {printing ? "Opening print dialog…" : "🖨️ Print"}
          </button>
          <p className="muted small" style={{ textAlign: "center", margin: "8px 0 0" }}>
            {ready
              ? "Tip: pick Brother QL-810W in the print dialog. Margins None, scale 100%."
              : "Loading preview…"}
          </p>
        </div>
      </div>
    </div>
  );
}
