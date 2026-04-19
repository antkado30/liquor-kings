import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CartItem, MlccProduct } from "../types";

export type CartContextValue = {
  items: CartItem[];
  addItem: (product: MlccProduct, quantity: number) => void;
  removeItem: (mlccCode: string) => void;
  updateQuantity: (mlccCode: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalCost: number;
  storeId: string | null;
};

const CartContext = createContext<CartContextValue | null>(null);

function lineKey(p: MlccProduct): string {
  return `${p.code}::${p.ada_number}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [storeId] = useState<string | null>(null);

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
      clearCart,
      totalItems,
      totalCost,
      storeId,
    }),
    [items, addItem, removeItem, updateQuantity, clearCart, totalItems, totalCost, storeId],
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
