import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CartItem, MlccProduct } from "../types";
import { addGuardVerdict, type AddGuardVerdict } from "../lib/add-guard";
import { Sentry } from "../lib/sentry";
import {
  generateValidQuantities,
  getOrderingRuleDisplay,
  stepValidQuantity,
} from "../lib/mlcc-ordering-rules";

const STORAGE_KEY = "lk-scanner-cart-v1";
/** #28 save-for-later (2026-08-10, "Amazon-style"): its own bucket. */
const SAVED_STORAGE_KEY = "lk-scanner-saved-v1";

type PersistedCartV1 = {
  version: 1;
  lines: CartItem[];
  updatedAt: string;
};

export type AdaGroup = {
  adaNumber: string;
  adaName: string;
  lines: CartItem[];
  liters: number;
  subtotalCost: number;
  meetsMinimum: boolean;
};

function captureStorageError(error: unknown): void {
  if (typeof Sentry?.captureException === "function") {
    Sentry.captureException(error);
  }
}

/** Stable id for a cart line (same logic as merge key in addItem). */
export function cartLineId(product: MlccProduct): string {
  return `${product.code}::${product.ada_number}`;
}

function lineKey(p: MlccProduct): string {
  return cartLineId(p);
}

function isPlainCartItem(x: unknown): x is CartItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.quantity !== "number" || !Number.isFinite(o.quantity) || o.quantity < 1) return false;
  const p = o.product;
  if (!p || typeof p !== "object") return false;
  const pr = p as Record<string, unknown>;
  return (
    typeof pr.id === "string" &&
    typeof pr.code === "string" &&
    typeof pr.name === "string" &&
    typeof pr.ada_number === "string"
  );
}

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const o = parsed as Record<string, unknown>;
    if (o.version !== 1) return [];
    if (!Array.isArray(o.lines)) return [];
    return o.lines.filter(isPlainCartItem);
  } catch (error) {
    captureStorageError(error);
    return [];
  }
}

function loadSaved(): CartItem[] {
  try {
    const raw = localStorage.getItem(SAVED_STORAGE_KEY);
    if (raw == null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const o = parsed as Record<string, unknown>;
    if (o.version !== 1) return [];
    if (!Array.isArray(o.lines)) return [];
    return o.lines.filter(isPlainCartItem);
  } catch (error) {
    captureStorageError(error);
    return [];
  }
}

function persistSaved(lines: CartItem[]): void {
  try {
    localStorage.setItem(
      SAVED_STORAGE_KEY,
      JSON.stringify({ version: 1, lines, updatedAt: new Date().toISOString() }),
    );
  } catch (error) {
    captureStorageError(error);
  }
}

function saveCart(lines: CartItem[]): void {
  try {
    const payload: PersistedCartV1 = {
      version: 1,
      lines,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    captureStorageError(error);
  }
}

/**
 * A guarded add waiting on the owner's confirm (#29 UI wiring,
 * 2026-08-10). Set by addItemGuarded when the add-guard trips
 * (duplicate line and/or unusually big line); rendered by the global
 * AddGuardDialog; resolved by confirmPendingAdd / cancelPendingAdd.
 */
export type PendingAdd = {
  product: MlccProduct;
  quantity: number;
  verdict: AddGuardVerdict;
};

export type CartContextValue = {
  items: CartItem[];
  groupedByAda: AdaGroup[];
  addItem: (product: MlccProduct, quantity: number) => void;
  /**
   * The guarded door (#29): same signature as addItem, but runs the
   * add-guard first. Clean adds go straight through; trips park in
   * pendingAdd for the global confirm dialog. Use this on
   * SINGLE-LINE, user-initiated surfaces (scan, browse, search,
   * resolve cards). Bulk restores/reorders keep raw addItem on
   * purpose — re-adding a known past order line by line would spam
   * confirms.
   */
  addItemGuarded: (product: MlccProduct, quantity: number) => void;
  pendingAdd: PendingAdd | null;
  confirmPendingAdd: () => void;
  cancelPendingAdd: () => void;
  /**
   * #28 save-for-later (2026-08-10, "Amazon-style"). A saved line is
   * OUT of the cart: it doesn't count toward totals, rules, Check, or
   * Place — it's a parking spot for "not this week." Restore merges
   * back through raw addItem (deliberate action, no guard prompt).
   * Prices on a saved line can go stale; the cart re-prices nothing —
   * rule/Check validation catches reality when it returns.
   */
  savedItems: CartItem[];
  saveForLater: (lineId: string) => void;
  moveSavedToCart: (lineId: string) => void;
  removeSaved: (lineId: string) => void;
  removeItem: (mlccCode: string) => void;
  updateQuantity: (mlccCode: string, quantity: number) => void;
  incrementQuantity: (lineId: string) => void;
  decrementQuantity: (lineId: string) => void;
  clearCart: () => void;
  totalItems: number;
  totalCost: number;
  storeId: string | null;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => loadCart());
  const [storeId] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const t = window.setTimeout(() => saveCart(itemsRef.current), 100);
    return () => {
      window.clearTimeout(t);
      saveCart(itemsRef.current);
    };
  }, [items]);

  /*
    2026-05-31 (#45 follow-up): dropped the 99-bottle cap that used to
    live on addItem / updateQuantity / merge math. Real liquor-store
    orders can be 100s of bottles per SKU (Tony's actual case: 480 of
    a 50ml × 60 = 8 full cases). The rule engine validates quantities
    at validate-time anyway, so a client-side ceiling just frustrated
    legitimate orders. Floor stays at 1 — cart lines with qty=0 don't
    make sense; user removes via the trash icon instead.
  */
  const addItem = useCallback((product: MlccProduct, quantity: number) => {
    const q = Math.max(1, Math.floor(quantity));
    setItems((prev) => {
      const k = lineKey(product);
      const idx = prev.findIndex((c) => lineKey(c.product) === k);
      if (idx >= 0) {
        const next = [...prev];
        const nq = next[idx].quantity + q;
        next[idx] = { ...next[idx], quantity: nq };
        return next;
      }
      return [...prev, { product, quantity: q }];
    });
  }, []);

  /*
    #29 guard wiring (2026-08-10). The decision engine (lib/add-guard,
    shipped 8/8 with 8 pins) finally gets a door. itemsRef (already
    maintained for the persist debounce) gives the CURRENT cart
    synchronously, so the verdict never races a pending setItems.
  */
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

  const addItemGuarded = useCallback(
    (product: MlccProduct, quantity: number) => {
      const k = lineKey(product);
      const existing = itemsRef.current.find((c) => lineKey(c.product) === k);
      const verdict = addGuardVerdict({
        addQty: quantity,
        existingQty: existing?.quantity ?? 0,
        unitPrice: product.licensee_price ?? null,
        name: product.name,
      });
      if (!verdict) {
        addItem(product, quantity);
        return;
      }
      setPendingAdd({ product, quantity, verdict });
    },
    [addItem],
  );

  const confirmPendingAdd = useCallback(() => {
    setPendingAdd((pending) => {
      if (pending) addItem(pending.product, pending.quantity);
      return null;
    });
  }, [addItem]);

  const cancelPendingAdd = useCallback(() => setPendingAdd(null), []);

  /* #28 save-for-later — state, persistence, moves. */
  const [savedItems, setSavedItems] = useState<CartItem[]>(() => loadSaved());
  const savedRef = useRef(savedItems);
  savedRef.current = savedItems;
  useEffect(() => {
    const t = window.setTimeout(() => persistSaved(savedRef.current), 100);
    return () => {
      window.clearTimeout(t);
      persistSaved(savedRef.current);
    };
  }, [savedItems]);

  const saveForLater = useCallback((lineId: string) => {
    const line = itemsRef.current.find((c) => lineKey(c.product) === lineId);
    if (!line) return;
    setItems((prev) => prev.filter((c) => lineKey(c.product) !== lineId));
    setSavedItems((prev) => {
      // Same product saved twice → merge quantities (mirrors cart merge).
      const idx = prev.findIndex((c) => lineKey(c.product) === lineId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + line.quantity };
        return next;
      }
      return [...prev, line];
    });
  }, []);

  const moveSavedToCart = useCallback(
    (lineId: string) => {
      const line = savedRef.current.find((c) => lineKey(c.product) === lineId);
      if (!line) return;
      setSavedItems((prev) => prev.filter((c) => lineKey(c.product) !== lineId));
      addItem(line.product, line.quantity);
    },
    [addItem],
  );

  const removeSaved = useCallback((lineId: string) => {
    setSavedItems((prev) => prev.filter((c) => lineKey(c.product) !== lineId));
  }, []);

  const removeItem = useCallback((mlccCode: string) => {
    setItems((prev) => prev.filter((c) => c.product.code !== mlccCode));
  }, []);

  const updateQuantity = useCallback((mlccCode: string, quantity: number) => {
    const q = Math.max(1, Math.floor(quantity));
    setItems((prev) =>
      prev.map((c) => (c.product.code === mlccCode ? { ...c, quantity: q } : c)),
    );
  }, []);

  /*
    Cart-line steppers (2026-05-31, fix for #45): snap to valid MLCC
    quantities for THIS line's product instead of plain ±1. So `+` on
    a 750ml Tito's line at qty=12 jumps to 24 (next full case), not 13.
    `−` from 12 → 6, then 3, then 1. At smallest valid (e.g. 1 for
    750ml), `−` clamps — user uses trash icon to remove entirely.

    Why not strip the cap further? A cart line with qty=0 is a UX
    paradox (it's "in" the cart but doesn't exist). Removal is the
    intentional action, deserves its own affordance.
  */
  const stepLineQuantity = (
    line: CartItem,
    delta: number,
  ): number => {
    const rule = getOrderingRuleDisplay({
      code: line.product.code,
      bottle_size_ml: line.product.bottle_size_ml,
      case_size: line.product.case_size,
      ada_name: line.product.ada_name,
    });
    const valid = generateValidQuantities(rule);
    if (valid.length === 0) {
      // Unknown size — fall back to plain ±1 (free).
      return Math.max(1, line.quantity + (delta > 0 ? 1 : -1));
    }
    const next = stepValidQuantity(line.quantity, delta, valid);
    // Clamp to smallest valid; removal is the trash icon's job.
    return Math.max(valid[0], next);
  };

  const incrementQuantity = useCallback((lineId: string) => {
    setItems((prev) =>
      prev.map((c) =>
        lineKey(c.product) === lineId
          ? { ...c, quantity: stepLineQuantity(c, +1) }
          : c,
      ),
    );
  }, []);

  const decrementQuantity = useCallback((lineId: string) => {
    setItems((prev) =>
      prev.map((c) =>
        lineKey(c.product) === lineId
          ? { ...c, quantity: stepLineQuantity(c, -1) }
          : c,
      ),
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const totalItems = useMemo(() => items.reduce((s, c) => s + c.quantity, 0), [items]);
  const totalCost = useMemo(
    () => items.reduce((s, c) => s + (c.product.licensee_price ?? 0) * c.quantity, 0),
    [items],
  );
  const groupedByAda = useMemo<AdaGroup[]>(() => {
    const byAda = new Map<string, AdaGroup>();
    for (const line of items) {
      const adaNumber = line.product.ada_number;
      const existing = byAda.get(adaNumber);
      const liters = ((line.product.bottle_size_ml ?? 0) * line.quantity) / 1000;
      const lineSubtotal = (line.product.licensee_price ?? 0) * line.quantity;
      if (existing) {
        existing.lines.push(line);
        existing.liters += liters;
        existing.subtotalCost += lineSubtotal;
        existing.meetsMinimum = existing.liters >= 9;
      } else {
        byAda.set(adaNumber, {
          adaNumber,
          adaName: line.product.ada_name || `ADA ${adaNumber}`,
          lines: [line],
          liters,
          subtotalCost: lineSubtotal,
          meetsMinimum: liters >= 9,
        });
      }
    }
    return [...byAda.values()].sort((a, b) => a.adaName.localeCompare(b.adaName));
  }, [items]);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      groupedByAda,
      addItem,
      addItemGuarded,
      pendingAdd,
      confirmPendingAdd,
      cancelPendingAdd,
      savedItems,
      saveForLater,
      moveSavedToCart,
      removeSaved,
      removeItem,
      updateQuantity,
      incrementQuantity,
      decrementQuantity,
      clearCart,
      totalItems,
      totalCost,
      storeId,
    }),
    [
      items,
      groupedByAda,
      addItem,
      addItemGuarded,
      pendingAdd,
      confirmPendingAdd,
      cancelPendingAdd,
      savedItems,
      saveForLater,
      moveSavedToCart,
      removeSaved,
      removeItem,
      updateQuantity,
      incrementQuantity,
      decrementQuantity,
      clearCart,
      totalItems,
      totalCost,
      storeId,
    ],
  );

  return createElement(CartContext.Provider, { value }, children);
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}

/**
 * Read-only cart lines with a graceful empty fallback (2026-07-16).
 * For display-only consumers (RunResultSheet's OOS name join) that render
 * fine without a provider — e.g. in component tests. NOT for anything
 * that mutates the cart; those keep the loud useCart() contract.
 */
export function useCartItemsOrEmpty(): CartItem[] {
  const ctx = useContext(CartContext);
  return ctx?.items ?? [];
}

/**
 * Full cart context, or null when no provider is mounted (2026-08-01,
 * remove-OOS-from-result-sheet). For chrome that rides ABOVE the app
 * (OrderStatusPill → RunResultSheet): in the real app the provider is
 * always there (App.tsx nesting), so removal works; in isolated
 * component tests there's no provider and the remove UI simply doesn't
 * render. Anything that REQUIRES the cart still uses the loud useCart().
 */
export function useCartOrNull(): CartContextValue | null {
  return useContext(CartContext);
}
