import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const CART_KEY = 'tienderu-store-cart-v1';

export interface CartItem {
  product_id: number;
  name: string;
  price: string;
  image_url: string | null;
  seller_id: string;
  seller_name: string;
  available_quantity: number;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  total: number;
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  removeItem: (productId: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CartItem => {
      if (typeof item !== 'object' || item === null) return false;
      const record = item as Record<string, unknown>;
      return typeof record.product_id === 'number'
        && typeof record.name === 'string'
        && typeof record.price === 'string'
        && (typeof record.seller_id === 'string')
        && typeof record.quantity === 'number'
        && record.quantity > 0;
    });
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(readCart);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      // almacenamiento no disponible
    }
  }, [items]);

  const addItem = useCallback((item: Omit<CartItem, 'quantity'>, quantity = 1) => {
    setItems((current) => {
      const existing = current.find((line) => line.product_id === item.product_id);
      if (existing) {
        return current.map((line) =>
          line.product_id === item.product_id
            ? { ...line, ...item, quantity: Math.min(line.quantity + quantity, item.available_quantity) }
            : line
        );
      }
      return [...current, { ...item, quantity: Math.min(Math.max(1, quantity), item.available_quantity) }];
    });
  }, []);

  const setQuantity = useCallback((productId: number, quantity: number) => {
    setItems((current) =>
      current
        .map((line) =>
          line.product_id === productId
            ? { ...line, quantity: Math.min(Math.max(0, quantity), line.available_quantity) }
            : line
        )
        .filter((line) => line.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((productId: number) => {
    setItems((current) => current.filter((line) => line.product_id !== productId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, line) => sum + line.quantity, 0);
    const total = items.reduce((sum, line) => sum + Number(line.price) * line.quantity, 0);
    return { items, count, total, addItem, setQuantity, removeItem, clear };
  }, [items, addItem, setQuantity, removeItem, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
