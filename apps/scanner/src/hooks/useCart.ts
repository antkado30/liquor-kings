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
import { Sentry } from "../lib/sentry";
import {
  generateValidQuantities,
  getOrderingRuleDisplay,
  stepValidQuantity,
} from "../lib/mlcc-ordering-rules";

const STORAGE_KEY = "lk-scanner-cart-v1";

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

export type CartContextValue = {
  items: CartItem[];
  groupedByAda: AdaGroup[];
  addItem: (product: MlccProduct, quantity: number) => void;
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
