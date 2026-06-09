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
import { getAuthBearer } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";

type TagPrintPreviewProps = {
  /** Server-rendered HTML page (from POST /tags/render). */
  html: string;
  /**
   * MLCC code(s) for the tag(s). When provided, enables the "Share to
   * printer app" button which fetches a PDF version from
   * /tags/render.pdf and surfaces it via the iOS share sheet. Bypasses
   * the AirPrint die-cut-only limitation (#76 fix).
   */
  mlccCode?: string;
  onClose: () => void;
};

export function TagPrintPreview({ html, mlccCode, onClose }: TagPrintPreviewProps) {
  useLockBodyScroll();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [printing, setPrinting] = useState(false);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

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

  /*
   * Universal share-PDF flow (task #76, 2026-06-04). Fetches a PDF
   * version of the tag from the backend and surfaces it via the iOS
   * share sheet. The user picks Brother iPrint&Label (for continuous
   * rolls like DK-2205), AirPrint (for die-cut), or any other printer
   * app they have installed. No paper-size lock-in.
   */
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    // Older Safari (iOS < 15) has navigator.share but no file support.
    // canShare with files probes it without firing the sheet.
    typeof navigator.canShare === "function";

  const handleSharePdf = async () => {
    if (sharing || !mlccCode) return;
    setSharing(true);
    setShareError(null);
    try {
      // The /tags/* mount is auth-gated by resolveAuthenticatedStore.
      // Without these headers the request 401s before reaching the
      // PDF renderer. (Hit this 2026-06-04 on first smoke test.)
      const bearer = await getAuthBearer();
      const storeId = getCurrentStoreId();
      if (!bearer || !storeId) {
        throw new Error("not_signed_in");
      }
      const res = await fetch(
        `/tags/render.pdf?code=${encodeURIComponent(mlccCode)}`,
        {
          headers: {
            Authorization: `Bearer ${bearer}`,
            "X-Store-Id": storeId,
          },
        },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const file = new File([blob], `lk-tag-${mlccCode}.pdf`, {
        type: "application/pdf",
      });
      const shareData = { files: [file], title: `LK shelf tag ${mlccCode}` };
      if (navigator.canShare && !navigator.canShare(shareData)) {
        // Some iOS versions support navigator.share but not files —
        // fall back to opening the PDF in a new tab so the user can
        // hit the iOS native share button from Safari.
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        return;
      }
      await navigator.share(shareData);
    } catch (err) {
      // User-cancelled share throws AbortError — silent.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/abort/i.test(msg)) {
        setShareError(msg);
      }
    } finally {
      setSharing(false);
    }
  };

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
            {printing ? "Opening print dialog…" : "🖨️ Print (AirPrint)"}
          </button>
          {/*
            Universal share-PDF flow (#76). Only show when we know the
            MLCC code AND browser supports Web Share with files. Lets
            user print via Brother iPrint&Label (continuous DK-2205) or
            any other installed printer app — bypasses the AirPrint
            die-cut-only paper-size lock-in.
          */}
          {mlccCode && canShare ? (
            <button
              type="button"
              className="btn secondary btn-block"
              disabled={sharing}
              onClick={() => void handleSharePdf()}
              style={{ marginTop: 8 }}
            >
              {sharing ? "Preparing PDF…" : "📤 Share to printer app"}
            </button>
          ) : null}
          {shareError ? (
            <p className="muted small" style={{ textAlign: "center", margin: "6px 0 0", color: "#fca5a5" }}>
              Share failed: {shareError}
            </p>
          ) : null}
          <p className="muted small" style={{ textAlign: "center", margin: "8px 0 0" }}>
            {ready
              ? mlccCode
                ? "AirPrint works with DK-1202 die-cut labels. Use Share for continuous DK-2205 (Brother iPrint&Label app)."
                : "Tip: pick Brother QL-810W. Margins None, scale 100%."
              : "Loading preview…"}
          </p>
        </div>
      </div>
    </div>
  );
}
