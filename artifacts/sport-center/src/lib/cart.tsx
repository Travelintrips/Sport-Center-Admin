import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface CartItem {
  id: string; // uuid lokal
  facilityId: number;
  facilityName: string;
  facilityCategory: string;
  facilityPricePerHour: number;
  /** Harga total satu sesi untuk fasilitas Konsumsi. */
  customPrice?: number;
  date: string;          // "yyyy-MM-dd"
  startTime: string;     // "HH:mm" (kosong jika walk_in)
  duration: number;      // jam
  activityType?: string; // untuk Multiguna
  mode: "time_slot" | "walk_in";
}

interface CartContextValue {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "id">) => void;
  updateItem: (id: string, updates: Partial<Pick<CartItem, "customPrice">>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "sc_booking_cart";

export function isCustomPriceFacility(item: Pick<CartItem, "facilityName">) {
  return /konsumsi/i.test(item.facilityName);
}

function isValidCartItem(v: unknown): v is CartItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.facilityId === "number" &&
    typeof o.facilityName === "string" &&
    typeof o.facilityCategory === "string" &&
    typeof o.facilityPricePerHour === "number" &&
    typeof o.date === "string" &&
    typeof o.startTime === "string" &&
    typeof o.duration === "number" &&
    (o.mode === "time_slot" || o.mode === "walk_in")
  );
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidCartItem);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = (item: Omit<CartItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { ...item, id }]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const updateItem = (id: string, updates: Partial<Pick<CartItem, "customPrice">>) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...updates } : item));
  };

  const clearCart = () => setItems([]);

  const totalItems = items.length;
  const totalPrice = items.reduce((sum, item) => {
    const price = isCustomPriceFacility(item)
      ? Math.max(0, Number(item.customPrice ?? 0))
      : item.mode === "walk_in"
        ? item.facilityPricePerHour
        : item.facilityPricePerHour * item.duration;
    return sum + price;
  }, 0);

  return (
    <CartContext.Provider value={{ items, addItem, updateItem, removeItem, clearCart, totalItems, totalPrice }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
