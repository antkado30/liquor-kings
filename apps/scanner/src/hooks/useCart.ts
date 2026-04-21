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

const STORAGE_KEY = "lk-scanner-cart-v1";

type PersistedCartV1 = {
  version: 1;
  lines: CartItem[];
  updatedAt: string;
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

  const addItem = useCallback((product: MlccProduct, quantity: number) => {
    const q = Math.max(1, Math.min(99, Math.floor(quantity)));
    setItems((prev) => {
      const k = lineKey(product);
      const idx = prev.findIndex((c) => lineKey(c.product) === k);
      if (idx >= 0) {
        const next = [...prev];
        const nq = Math.min(99, next[idx].quantity + q);
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
    const q = Math.max(1, Math.min(99, Math.floor(quantity)));
    setItems((prev) =>
      prev.map((c) => (c.product.code === mlccCode ? { ...c, quantity: q } : c)),
    );
  }, []);

  const incrementQuantity = useCallback((lineId: string) => {
    setItems((prev) =>
      prev.map((c) => (lineKey(c.product) === lineId ? { ...c, quantity: c.quantity + 1 } : c)),
    );
  }, []);

  const decrementQuantity = useCallback((lineId: string) => {
    setItems((prev) =>
      prev.map((c) =>
        lineKey(c.product) === lineId ? { ...c, quantity: Math.max(1, c.quantity - 1) } : c,
      ),
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const totalItems = useMemo(() => items.reduce((s, c) => s + c.quantity, 0), [items]);
  const totalCost = useMemo(
    () => items.reduce((s, c) => s + (c.product.licensee_price ?? 0) * c.quantity, 0),
    [items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
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
