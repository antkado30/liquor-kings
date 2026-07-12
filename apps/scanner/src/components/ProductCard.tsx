import { useEffect, useMemo, useRef, useState } from "react";
import { flagIncorrectMatch } from "../api/catalog";
import { reportWrongPhoto, uploadBottlePhoto } from "../api/catalog-photo";
import { fetchTagsHtml } from "../api/tags";
import { downscaleImageFile } from "../lib/downscaleImage";
import { IconAlert, IconCamera, IconCheck, IconInfo, IconTag } from "./Icons";
import { TagPrintPreview } from "./TagPrintPreview";
import {
  generateValidQuantities,
  getOrderingRuleDisplay,
  stepValidQuantity,
} from "../lib/mlcc-ordering-rules";
import { computeProductFreshness } from "../lib/product-freshness";
import type { MlccProduct, ProductFamily } from "../types";
import { pickInitialSizeByCode, ProductSizeSelector } from "./ProductSizeSelector";
import { PlaceholderBottle, tintForCategory } from "./BottleArt";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type ProductCardProps = {
  family: ProductFamily;
  /** MLCC code of the product that was scanned or tapped — selects matching size tab on open. */
  initialSelectedCode?: string;
  onAddToCart: (product: MlccProduct, quantity: number) => void;
  onDismiss: () => void;
  /** UPC from the barcode that led to this card (UPCitemdb path only). */
  scannedUpc?: string | null;
  /** True when this card was opened from a camera scan that used UPC matching (not name search). */
  wasUpcScanMatch?: boolean;
  /**
   * Latest MLCC price book date (YYYY-MM-DD) — drives the freshness /
   * discontinuation heuristic (task #44). Null when /price-book/status
   * hasn't returned yet; in that case freshness defaults to "fresh"
   * (we don't falsely accuse). Provided by ScannerPage.
   */
  latestPriceBookDate?: string | null;
  onToast?: (message: string) => void;
};

export function ProductCard({
  family,
  initialSelectedCode,
  onAddToCart,
  onDismiss,
  scannedUpc = null,
  wasUpcScanMatch = false,
  latestPriceBookDate = null,
  onToast,
}: ProductCardProps) {
  useLockBodyScroll();
  const [selectedProduct, setSelectedProduct] = useState<MlccProduct>(() =>
    pickInitialSizeByCode(family.sizes, initialSelectedCode),
  );
  /*
    Default qty is 0 (task #45, 2026-05-31) — matches MLCC's actual
    behavior on milo: a scanned product shows qty=0 until the user
    taps `+` once, at which point it jumps to the smallest valid
    quantity for the size (1 for 750ml splits, 60 for a 50ml × 60
    case). Forces an explicit "yes I want this many" tap before Add
    to Cart fires; prevents oops-clicks on pre-filled defaults.
  */
  const [quantity, setQuantity] = useState(0);
  const [flagBusy, setFlagBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  /*
    Photo truth layer (2026-06-10). Tony: internet photos can't guarantee
    what the bottle on the truck looks like — the store's own camera can.
      - "Snap real bottle": capture → downscale → upload → becomes the
        canonical image for this code (image_source='in_store').
      - "Wrong photo?": clears a lying image NOW (placeholder renders)
        and quarantines the code from backfill re-fills.

    KEYED BY CODE (2026-07-11, photo-truth mandate): these are per-CODE
    facts, but they used to be single values — snap the pint, switch to
    the liter, and the pint's fresh photo (or a cleared state) leaked
    onto the liter. Keying by code kills the leak AND the mid-upload
    race: an upload that finishes after the user switched sizes stamps
    the code it was taken FOR, never whatever is selected when it lands.
  */
  const [localPhotoByCode, setLocalPhotoByCode] = useState<Record<string, string>>({});
  const [photoClearedCodes, setPhotoClearedCodes] = useState<Set<string>>(new Set());
  const [photoBusy, setPhotoBusy] = useState<"upload" | "report" | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const handlePhotoFile = async (file: File | null) => {
    if (!file || photoBusy) return;
    // Capture the code NOW — the user can switch sizes while the upload
    // runs; the result must apply to the bottle it was taken FOR.
    const codeAtCapture = selectedProduct.code;
    setPhotoBusy("upload");
    try {
      const dataUri = await downscaleImageFile(file, 1024, 0.85);
      const r = await uploadBottlePhoto(codeAtCapture, dataUri);
      if (r.ok) {
        const url = `${r.imageUrl}?v=${Date.now()}`;
        setLocalPhotoByCode((prev) => ({ ...prev, [codeAtCapture]: url }));
        setPhotoClearedCodes((prev) => {
          if (!prev.has(codeAtCapture)) return prev;
          const next = new Set(prev);
          next.delete(codeAtCapture);
          return next;
        });
        setImageFailed(false);
        onToast?.("Photo saved — this is now the real bottle for this code.");
      } else {
        onToast?.(`Couldn't save the photo (${r.error}). Try again.`);
      }
    } catch (e) {
      onToast?.(
        `Couldn't read that photo (${e instanceof Error ? e.message : String(e)}).`,
      );
    } finally {
      setPhotoBusy(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleReportWrongPhoto = async () => {
    if (photoBusy) return;
    const codeAtReport = selectedProduct.code;
    setPhotoBusy("report");
    const r = await reportWrongPhoto(codeAtReport);
    setPhotoBusy(null);
    if (r.ok) {
      setPhotoClearedCodes((prev) => new Set(prev).add(codeAtReport));
      setLocalPhotoByCode((prev) => {
        if (!(codeAtReport in prev)) return prev;
        const next = { ...prev };
        delete next[codeAtReport];
        return next;
      });
      onToast?.("Photo removed. Snap the real bottle when you have it.");
    } else {
      onToast?.(`Couldn't report the photo (${r.error}). Try again.`);
    }
  };

  /*
    Task #58 (2026-05-31) — stay-open behavior after Add to Cart.
    Card no longer dismisses on add; user picks more sizes or taps
    Done to close. lastAdded is the most-recent add receipt, used to
    render the inline success indicator above the Add button. Cleared
    whenever the user changes size so it doesn't lie about what's
    selected NOW vs what was just added.
  */
  const [lastAdded, setLastAdded] = useState<{
    quantity: number;
    sizeLabel: string;
    productCode: string;
  } | null>(null);

  /*
    Ref on the size selector — after a successful add, we scroll it
    back into view so the user (whose finger was on the Add button at
    the bottom of the card) sees the size chips again without having
    to scroll manually. Critical for taller phone screens where the
    card body scrolls.
  */
  const sizeSelectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setImageFailed(false);
  }, [selectedProduct.id]);

  const bump = (delta: number) => {
    if (isQtyConstrained) {
      // Constrained: snap to next/prev valid quantity. Going up from 0
      // jumps to the smallest valid (e.g. 0 → 60 for a 50ml shot case).
      setQuantity((q) => stepValidQuantity(q, delta, validQuantities));
      return;
    }
    // Unconstrained fallback (unknown size, no rule): plain ±1, no cap.
    setQuantity((q) => Math.max(0, Math.min(99, q + delta)));
  };

  /*
    Wrap setSelectedProduct so changing size also resets qty to 0 AND
    clears the lastAdded indicator. Qty=0 matches MLCC — user must
    explicitly tap `+` (or use the dropdown) to commit to a quantity
    for the new size. The indicator referenced a specific size; once
    the user picks a different one it would lie about which size the
    add applied to.
  */
  const handleSelectSize = (next: MlccProduct) => {
    setSelectedProduct(next);
    setQuantity(0);
    setLastAdded(null);
  };

  // Add to Cart is disabled when qty is 0 — explicit pick is required
  // (task #45). The button still renders so its position is stable.
  const canAdd = quantity > 0;

  const onAdd = () => {
    if (!canAdd) return;
    const addedQty = quantity;
    const addedSizeLabel =
      selectedProduct.bottle_size_label ??
      `${selectedProduct.bottle_size_ml ?? ""} mL`;
    onAddToCart(selectedProduct, addedQty);
    // Reset back to 0 so the user must re-pick a qty for the next add.
    // Matches MLCC — there's no implicit "do it again at the same qty".
    setQuantity(0);
    setLastAdded({
      quantity: addedQty,
      sizeLabel: addedSizeLabel,
      productCode: selectedProduct.code,
    });
    /*
      Smooth-scroll the size selector back into view so the next size
      pick is one tap away. Defer to next tick so the lastAdded indicator
      has been rendered above the button — otherwise the scroll lands
      on stale layout.
    */
    requestAnimationFrame(() => {
      sizeSelectorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  /*
    Print tag handler (task #22, 2026-06-02 — Pillar 3). Fetches the
    server-rendered HTML for the selected product's MLCC code and
    opens an in-app preview modal (TagPrintPreview). The modal
    embeds an iframe with the rendered tag and calls
    iframe.contentWindow.print() when the user taps Print.

    Why an in-app modal instead of window.open: when the scanner is
    installed as an iOS home-screen PWA, window.open is blocked
    outright. An iframe inside the same document works in both
    standalone PWA mode AND regular Safari. Bonus UX: user sees the
    tag BEFORE printing instead of getting an instant print dialog.
  */
  const [printing, setPrinting] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const onPrintTag = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const r = await fetchTagsHtml([selectedProduct.code]);
      if (!r.ok) {
        onToast?.(`Couldn't render tag: ${r.error}`);
        return;
      }
      setPreviewHtml(r.html);
    } finally {
      setPrinting(false);
    }
  };

  const onFlagWrongMatch = async () => {
    const u = scannedUpc?.trim();
    if (!u || flagBusy || !wasUpcScanMatch) return;
    if (
      !window.confirm(
        "Mark this as incorrect? The next person to scan this bottle will re-match from scratch.",
      )
    ) {
      return;
    }
    setFlagBusy(true);
    const r = await flagIncorrectMatch(u, "user_says_wrong");
    setFlagBusy(false);
    if (import.meta.env.DEV) {
      console.log("[scanner-upc-flag]", JSON.stringify({ tapped: true, upc: u, ok: r.ok }));
    }
    if (r.ok) {
      onToast?.("Match flagged thank you for helping improve the system");
      onDismiss();
    } else {
      onToast?.("Could not flag match right now, please try again");
    }
  };

  const cat = selectedProduct.category ?? "—";
  const showFlag = wasUpcScanMatch && Boolean(scannedUpc?.trim());

  /*
    MLCC ordering rules for the SELECTED size (task #43, 2026-05-30).
    Surface at scan time so the user knows split-case rules and full-
    case multiples BEFORE picking a quantity. Re-computed when the
    user flips between sizes — 750ml vs 50ml have wildly different
    rules. Pure function, no fetch — see lib/mlcc-ordering-rules.ts
    for the rule table source.
  */
  const orderingRule = useMemo(
    () =>
      getOrderingRuleDisplay({
        code: selectedProduct.code,
        bottle_size_ml: selectedProduct.bottle_size_ml,
        case_size: selectedProduct.case_size,
        ada_name: selectedProduct.ada_name,
      }),
    [
      selectedProduct.code,
      selectedProduct.bottle_size_ml,
      selectedProduct.case_size,
      selectedProduct.ada_name,
    ],
  );

  /*
    Enumerate the valid quantities for the currently-selected size
    (task #45, 2026-05-31). Drives both the constrained +/− stepper
    and the dropdown picker. Empty array means "unknown size, no
    constraint" — caller falls back to free input behavior. Recomputes
    on size change so a switch from 750ml → 100ml refreshes the list.
  */
  const validQuantities = useMemo(
    () => generateValidQuantities(orderingRule),
    [orderingRule],
  );
  const isQtyConstrained = validQuantities.length > 0;

  /*
    Freshness / discontinuation check (task #44, 2026-05-30). Compares
    the selected size's last_price_book_date against the latest book
    date we know about. Surfaces "aging" (14+ days behind) or
    "likely_discontinued" (30+ days behind) banners so the user doesn't
    waste an RPA run on a SKU that's no longer carried.

    Why per-selected-size: a brand may have a current 750ml SKU AND a
    discontinued 1.75L SKU in the same family. The banner needs to
    reflect THIS size, not the family.
  */
  const freshness = useMemo(
    () =>
      computeProductFreshness(
        {
          last_price_book_date: selectedProduct.last_price_book_date,
          is_active: selectedProduct.is_active,
        },
        latestPriceBookDate,
      ),
    [
      selectedProduct.last_price_book_date,
      selectedProduct.is_active,
      latestPriceBookDate,
    ],
  );
  /*
    PHOTO TRUTH (2026-07-11, Tony's mandate — "if I press a litre it'll
    be a pint picture… this goes against everything we stand for"):
    the image shown is the SELECTED size's OWN photo, or the honest
    placeholder. The previous code borrowed the first photo found
    anywhere in the family — so whichever sibling had a photo silently
    represented every size. A photo is an assertion about THIS exact
    bottle; a sibling's photo is a lie about it. Switching size chips
    now switches the image with them (or drops to the placeholder when
    that size has no photo yet — which is the truth).
  */
  const selectedImageUrl =
    typeof selectedProduct.imageUrl === "string" && selectedProduct.imageUrl.trim() !== ""
      ? selectedProduct.imageUrl
      : null;
  const cardImageUrl =
    localPhotoByCode[selectedProduct.code] ??
    ((!imageFailed && !photoClearedCodes.has(selectedProduct.code) && selectedImageUrl) ||
      null);

  return (
    <div className="product-card-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-card-title">
      <div className="product-card">
        {cardImageUrl ? (
          <img
            className="product-card__image"
            src={cardImageUrl}
            alt=""
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div
            className="product-card__image product-card__image--placeholder"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 150,
              padding: "12px 0",
            }}
          >
            <PlaceholderBottle
              tint={tintForCategory(selectedProduct.category)}
              name={family.baseName}
              seed={selectedProduct.id}
            />
          </div>
        )}
        {/*
          Photo truth actions (2026-06-10). Quiet text affordances under
          the image — capture the REAL bottle (always available) and
          flag a wrong photo (only when an image is showing). Hidden
          file input with capture="environment" opens the camera
          directly on iOS.
        */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => void handlePhotoFile(e.target.files?.[0] ?? null)}
        />
        <div className="pc-photo-actions">
          <button
            type="button"
            className="pc-photo-action"
            disabled={photoBusy !== null}
            onClick={() => photoInputRef.current?.click()}
          >
            <IconCamera size={14} />
            <span>
              {photoBusy === "upload"
                ? "Saving photo…"
                : cardImageUrl
                  ? "Replace with real bottle"
                  : "Snap the real bottle"}
            </span>
          </button>
          {cardImageUrl && !localPhotoByCode[selectedProduct.code] ? (
            <button
              type="button"
              className="pc-photo-action pc-photo-action--danger"
              disabled={photoBusy !== null}
              onClick={() => void handleReportWrongPhoto()}
            >
              {photoBusy === "report" ? "Removing…" : "Wrong photo?"}
            </button>
          ) : null}
        </div>
        <div className="product-card-header">
          <h2 id="product-card-title" className="product-card-brand">
            {family.baseName}
          </h2>
          {selectedProduct.is_new_item ? <span className="badge-new">New Item</span> : null}
          {/*
            Header dismiss button. Was a bare ×, now labeled "Done" so
            the user sees an explicit "I'm finished with this brand"
            affordance — important now that the card stays open after
            Add to Cart (task #58, 2026-05-31). The × glyph stays as a
            visual cue alongside the label.
          */}
          <button
            type="button"
            className="product-card-close product-card-close--labeled"
            onClick={onDismiss}
            aria-label="Done — close product card"
          >
            <span aria-hidden>Done</span>
          </button>
        </div>
        <p className="product-card-category muted">{cat}</p>

        {/*
          Freshness banner (task #44, 2026-05-30). Only renders when the
          selected size hasn't appeared in MLCC's last 14+ days of price
          books. "aging" = soft yellow info; "likely_discontinued" = red
          warn with stronger language. The user can still add to cart
          (we never block — sometimes a "discontinued" SKU comes back
          the next week), but they go in eyes open.
        */}
        {freshness.status !== "fresh" && freshness.message ? (
          <div
            className={`product-card-freshness product-card-freshness--${freshness.status}`}
            role="status"
          >
            <span className="product-card-freshness__icon" aria-hidden>
              {freshness.status === "likely_discontinued" ? (
                <IconAlert size={14} />
              ) : (
                <IconInfo size={14} />
              )}
            </span>
            <span className="product-card-freshness__text">{freshness.message}</span>
          </div>
        ) : null}

        <p className="label">Size</p>
        {/*
          ref wraps the size selector so onAdd can scrollIntoView after
          a successful add (task #58, 2026-05-31). Keeps the next size
          pick one tap away on tall phone screens.
        */}
        <div ref={sizeSelectorRef}>
          <ProductSizeSelector
            sizes={family.sizes}
            selected={selectedProduct}
            onSelect={handleSelectSize}
            mixedContainers={family.mixedContainers}
          />
        </div>

        <dl className="product-card-details">
          <div>
            <dt>ADA</dt>
            <dd>{selectedProduct.ada_name || "—"}</dd>
          </div>
          <div>
            <dt>MLCC code</dt>
            <dd className="mono">{selectedProduct.code}</dd>
          </div>
          <div>
            <dt>Licensee price</dt>
            <dd className="price-accent">{money(selectedProduct.licensee_price)}</dd>
          </div>
          <div>
            <dt>Minimum shelf price</dt>
            <dd>{money(selectedProduct.min_shelf_price)}</dd>
          </div>
          <div>
            <dt>Case size</dt>
            <dd>{selectedProduct.case_size ?? "—"}</dd>
          </div>
          <div>
            <dt>Proof</dt>
            <dd>{selectedProduct.proof ?? "—"}</dd>
          </div>
        </dl>

        {/*
          MLCC ordering rule callout (task #43, 2026-05-30). Sits above
          the qty stepper so the user reads "must order in cases of 60"
          BEFORE typing 1. The actual quantity stepper doesn't enforce
          these yet — that's task #45. For now this is informational
          only; the cart's per-line rule-engine validation still catches
          violations before validate is allowed.
        */}
        <div
          className={`product-card-rules${orderingRule.isConstrained ? " product-card-rules--constrained" : ""}`}
        >
          <span className="product-card-rules__label">MLCC ordering</span>
          <span className="product-card-rules__primary">{orderingRule.primary}</span>
          {orderingRule.secondary ? (
            <span className="product-card-rules__secondary muted small">
              {orderingRule.secondary}
            </span>
          ) : null}
        </div>

        <div className="quantity-row">
          <button
            type="button"
            className="qty-btn"
            onClick={() => bump(-1)}
            aria-label="Decrease quantity"
            disabled={quantity <= 0}
          >
            −
          </button>
          {isQtyConstrained ? (
            /*
              Constrained mode (task #45, 2026-05-31). The displayed
              number is a div (not an input — typing arbitrary numbers
              would let users land on invalid quantities). A native
              <select> is layered ON TOP of the display at opacity 0:
              tapping the number opens the OS-native picker (iOS gets
              the wheel modal, Android gets a dropdown), letting the
              user JUMP to any valid quantity instead of tapping `+`
              ten times to reach 60. The empty-state "—" shows when
              qty=0; option labels include " bottles" for clarity in
              the picker UI.
            */
            <div className="qty-picker-wrap" aria-live="polite">
              <span className="qty-picker-display">
                {quantity > 0 ? quantity : "—"}
              </span>
              <select
                className="qty-picker-select"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                aria-label="Quantity (tap to choose from valid amounts)"
              >
                <option value={0}>—</option>
                {validQuantities.map((q) => (
                  <option key={q} value={q}>
                    {q} bottles
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input
              className="qty-input"
              type="number"
              min={0}
              max={99}
              value={quantity}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(v)) setQuantity(Math.max(0, Math.min(99, v)));
              }}
            />
          )}
          <button
            type="button"
            className="qty-btn"
            onClick={() => bump(1)}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>

        {/*
          Inline last-added indicator (task #58, 2026-05-31). Sticky
          since the most recent successful add; cleared when the user
          changes size (because then it would lie about which size).
          Replaces the previous "card dismisses on add" UX — now the
          user sees explicit confirmation of what landed AND can pick
          another size without re-scanning.
        */}
        {lastAdded ? (
          <div
            className="product-card-last-added"
            role="status"
            aria-live="polite"
          >
            <span className="product-card-last-added__icon" aria-hidden>
              <IconCheck size={13} strokeWidth={2.5} />
            </span>
            <span className="product-card-last-added__text">
              Added {lastAdded.quantity} × {lastAdded.sizeLabel} — pick another
              size or tap <strong>Done</strong> to scan the next bottle
            </span>
          </div>
        ) : null}

        <button
          type="button"
          className="btn primary btn-block"
          onClick={onAdd}
          disabled={!canAdd}
          title={!canAdd ? "Choose a quantity first" : undefined}
        >
          {canAdd ? "Add to Cart" : "Add to Cart (choose qty first)"}
        </button>

        {/*
          Print shelf tag (Pillar 3, task #22, 2026-06-02). Opens the
          server-rendered HTML in a new window and triggers the
          browser print dialog. iOS users get AirPrint → Brother
          QL-810W if the printer is shared on Wi-Fi. macOS users get
          the standard print dialog.
        */}
        <button
          type="button"
          className="btn secondary btn-block btn-ico"
          onClick={() => void onPrintTag()}
          disabled={printing}
          style={{ marginTop: 8 }}
        >
          {printing ? (
            "Generating tag…"
          ) : (
            <>
              <IconTag size={15} />
              <span>Print shelf tag</span>
            </>
          )}
        </button>

        {showFlag ? (
          <div className="product-card-flag-row">
            <button
              type="button"
              className="product-card__flag-button"
              disabled={flagBusy}
              onClick={() => void onFlagWrongMatch()}
            >
              Flag wrong match
            </button>
          </div>
        ) : null}
      </div>
      {/*
        Shelf tag print preview modal. Renders above ProductCard via
        the higher-z product-card-backdrop variant (tag-print-backdrop)
        so the user sees the tag overlay while the underlying
        ProductCard stays in place.
      */}
      {previewHtml ? (
        <TagPrintPreview
          html={previewHtml}
          mlccCode={selectedProduct.code}
          onClose={() => setPreviewHtml(null)}
        />
      ) : null}
    </div>
  );
}
