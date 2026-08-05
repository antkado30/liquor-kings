/**
 * CartPage — the Cart tab is a REAL page now (2026-07-26).
 *
 * Tony, from the floor: "when I press on the cart logo on the bottom
 * middle i want it to be an actual cart page not half cart with a
 * background of the scanner" — and the tab bar must not vanish.
 *
 * History: the original CartPage was a stub, then (2026-06-07) a
 * redirect to /?view=cart that opened CartDrawer OVER the scanner —
 * exactly the half-cart Tony called out. This page renders the SAME
 * CartDrawer component in `layout="page"` mode: identical Check/Place
 * machinery, zero logic changes — only the chrome differs (no backdrop,
 * no grab handle, no close X, tab bar visible, page scroll, sticky
 * footer clears the tab bar). The scanner's top-right cart icon still
 * opens the classic drawer for a quick peek — both live on.
 *
 * The page carries its own copies of the ScannerPage plumbing the
 * drawer needs:
 *   - useBackgroundPreValidate: silent validation while the user looks
 *     at the cart, so Check can short-circuit on a fresh cached result.
 *   - store meta (name / license / armed flag) for the pre-submit
 *     verification modal — fetched from /home/smart-cards, fail-soft
 *     (missing meta degrades to the safe "preview" messaging).
 *   - ProductCard host state so tapping a cart line's product name
 *     opens the bottle's family card (Amazon-style sibling browsing),
 *     including the More-from-brand tap-through.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartDrawer } from "../components/CartDrawer";
import { ProductCard } from "../components/ProductCard";
import { useCart } from "../hooks/useCart";
import { useBackgroundPreValidate } from "../hooks/useBackgroundPreValidate";
import { getSmartCards, type StoreVerificationMeta } from "../api/home";
import { fetchWithRetries } from "../lib/store-meta-retry";
import { getProductFamily } from "../api/catalog";
import { nonGlassContainerSuffix, packCountSuffix } from "../lib/container-label";
import type { MlccProduct, ProductFamily } from "../types";

export function CartPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const preValidate = useBackgroundPreValidate(cart.items);

  const [storeMeta, setStoreMeta] = useState<StoreVerificationMeta | undefined>(
    undefined,
  );
  useEffect(() => {
    let cancelled = false;
    /*
      Retry, don't shrug (2026-08-05). This payload carries
      allow_order_submission — the Place button's existence. The old
      one-shot fetch meant a single transient failure hid Place on a
      fully-armed store for the whole session (it happened, live, an
      hour after arming). Three patient tries; still fail-soft to the
      safe preview messaging if the network is truly gone.
    */
    void fetchWithRetries(
      async () => {
        const r = await getSmartCards();
        return r.ok && r.store_meta ? r.store_meta : null;
      },
      { tries: 3, delayMs: 3000, cancelled: () => cancelled },
    ).then((meta) => {
      if (!cancelled && meta) setStoreMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [currentFamily, setCurrentFamily] = useState<ProductFamily | null>(null);
  const [initialCode, setInitialCode] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const openFamily = useCallback(async (p: MlccProduct) => {
    // Same single-size fallback law as ScannerPage.openFamily: the card
    // must ALWAYS open (doctrine: no silent failures).
    const fam: ProductFamily =
      (await getProductFamily(p.code)) ?? { baseName: p.name, sizes: [p] };
    setInitialCode(p.code);
    setCurrentFamily(fam);
  }, []);

  return (
    <div className="page cart-page">
      <CartDrawer
        layout="page"
        cart={cart}
        preValidate={preValidate}
        storeName={storeMeta?.store_name ?? null}
        storeLicense={storeMeta?.liquor_license ?? null}
        allowOrderSubmission={storeMeta?.allow_order_submission ?? false}
        /*
          onClose on the PAGE means "this flow is finished, leave the
          cart" — after Place fires, the drawer machinery calls onClose
          so the persistent OrderStatusPill takes over; landing on the
          scanner home mirrors the drawer's behavior exactly.
        */
        onClose={() => navigate("/")}
        onLineProductClick={(product) => {
          void openFamily(product);
        }}
      />

      {currentFamily ? (
        <ProductCard
          family={currentFamily}
          initialSelectedCode={initialCode}
          onDismiss={() => {
            setCurrentFamily(null);
            setInitialCode(undefined);
          }}
          onAddToCart={(product, quantity) => {
            cart.addItem(product, quantity);
            const sizeLabel = `${product.bottle_size_label ?? `${product.bottle_size_ml ?? ""} mL`}${nonGlassContainerSuffix(product.container)}${packCountSuffix(product.pack_count)}`;
            setToast(`Added ${quantity} × ${sizeLabel}`);
          }}
          onToast={(msg) => setToast(msg)}
          onOpenProduct={(fam, code) => {
            setCurrentFamily(fam);
            setInitialCode(code);
          }}
        />
      ) : null}

      {toast ? (
        <div className="cart-page-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
