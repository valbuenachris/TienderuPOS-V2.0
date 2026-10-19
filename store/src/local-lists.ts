import { useEffect, useState } from 'react';
import type { Product } from './api';

const FAVORITES_KEY = 'tienderu-store-favorites-v1';
const RECENT_KEY = 'tienderu-store-recent-v1';
const FAVORITES_EVENT = 'tienderu-favorites-changed';
const RECENT_LIMIT = 12;
const FAVORITES_LIMIT = 100;

export interface SavedProduct {
  id: number;
  name: string;
  price: string;
  image_url: string | null;
  seller_id: string;
  seller_name: string;
  average_rating: number | null;
  reviews_count: number;
}

function isSavedProduct(value: unknown): value is SavedProduct {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'number' &&
    typeof record.name === 'string' &&
    typeof record.price === 'string' &&
    (record.image_url === null || typeof record.image_url === 'string') &&
    typeof record.seller_id === 'string' &&
    typeof record.seller_name === 'string'
  );
}

function readList(key: string): SavedProduct[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedProduct);
  } catch {
    return [];
  }
}

function writeList(key: string, items: SavedProduct[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // almacenamiento no disponible
  }
}

export function snapshotProduct(product: Product): SavedProduct {
  return {
    id: product.id,
    name: product.name ?? `Producto ${product.id}`,
    price: product.price,
    image_url: product.image_url,
    seller_id: product.seller.id,
    seller_name: product.seller.name,
    average_rating: product.average_rating,
    reviews_count: product.reviews_count
  };
}

export function readFavorites(): SavedProduct[] {
  return readList(FAVORITES_KEY);
}

export function readRecent(): SavedProduct[] {
  return readList(RECENT_KEY);
}

export function toggleFavorite(product: SavedProduct): boolean {
  const current = readFavorites();
  const exists = current.some((line) => line.id === product.id);
  const next = exists
    ? current.filter((line) => line.id !== product.id)
    : [product, ...current].slice(0, FAVORITES_LIMIT);
  writeList(FAVORITES_KEY, next);
  try {
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  } catch {
    // sin eventos disponibles
  }
  return !exists;
}

export function pushRecent(product: SavedProduct): void {
  const current = readRecent().filter((line) => line.id !== product.id);
  writeList(RECENT_KEY, [product, ...current].slice(0, RECENT_LIMIT));
}

/** Ids favoritos reactivos (se actualizan al alternar en cualquier componente). */
export function useFavorites(): number[] {
  const [ids, setIds] = useState<number[]>(() => readFavorites().map((line) => line.id));
  useEffect(() => {
    const update = () => setIds(readFavorites().map((line) => line.id));
    window.addEventListener(FAVORITES_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(FAVORITES_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return ids;
}

/** Snapshot guardado → Product para reutilizar ProductCard (precios se revalidan al pagar). */
export function savedToProduct(saved: SavedProduct): Product {
  return {
    id: saved.id,
    code: null,
    name: saved.name,
    details: null,
    category_name: null,
    price: saved.price,
    image_url: saved.image_url,
    image_2_url: null,
    image_3_url: null,
    available_quantity: 0,
    seller: { id: saved.seller_id, name: saved.seller_name },
    average_rating: saved.average_rating,
    reviews_count: saved.reviews_count
  };
}
