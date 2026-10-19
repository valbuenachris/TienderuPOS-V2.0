export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const TOKEN_KEY = 'tienderu-store-token';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // almacenamiento no disponible
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (!(init.body instanceof FormData) && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('No hay conexión con la tienda. Revisa tu internet e intenta de nuevo.', 0);
  }
  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const message = extractMessage(payload) ?? `Error ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

function extractMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim() !== '') return payload;
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const message = record.message;
    if (typeof message === 'string' && message.trim() !== '') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    const error = record.error;
    if (typeof error === 'string' && error.trim() !== '') return error;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tipos del marketplace (contrato /api/marketplace/*)
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Seller {
  id: string;
  name: string;
}

export interface Product {
  id: number;
  code: string | null;
  name: string | null;
  details: string | null;
  category_name: string | null;
  price: string;
  image_url: string | null;
  image_2_url: string | null;
  image_3_url: string | null;
  available_quantity: number;
  seller: Seller;
  average_rating: number | null;
  reviews_count: number;
}

export interface ProductDetail extends Product {
  related: Product[];
}

export interface Category {
  name: string;
  products_count: number;
}

export interface Banner {
  id: number;
  image_url: string;
}

export interface StoreBranding {
  logo_url: string | null;
  favicon_url: string | null;
  footer: {
    description: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    address: string | null;
    instagram: string | null;
    facebook: string | null;
  };
}

export interface PromoBanner {
  id: number;
  title: string | null;
  image_url: string;
  target_url: string | null;
}

export interface StoreHome {
  banners: Banner[];
  categories: Category[];
  newest: Product[];
  top_rated: Product[];
  promos?: PromoBanner[];
}

export interface StoreConfig {
  currency: string;
  shipping_flat: string;
  payment_enabled?: boolean;
  payment_ttl_minutes?: number;
  branding?: StoreBranding | null;
}

export interface Review {
  id: number;
  rating: number;
  comment: string | null;
  created_at: string | null;
  customer_name: string | null;
}

export interface ReviewsPayload {
  product_id: number;
  average_rating: string | null;
  reviews_count: number;
  reviews: Paginated<Review>;
}

export interface SellerPage {
  seller: { id: string; name: string; logo_url: string | null };
  products: Paginated<Product>;
}

export interface MarketplaceCustomer {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface Address {
  id: number;
  customer_id: number;
  recipient_name: string;
  label: string;
  street_address: string;
  neighborhood: string | null;
  city: string | null;
  phone: string | null;
  additional_notes: string | null;
  is_default: boolean | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  suborder_id: number;
  product_id: number;
  product_code: string | null;
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface Suborder {
  id: number;
  order_id: number;
  tenant_id: string;
  sale_id: number | null;
  suborder_number: string;
  status: 'pending' | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';
  products_total: string;
  tenant_total: string;
  commission: string;
  tracking_note: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  tenant_name: string;
  items: OrderItem[];
}

export interface Order {
  id: number;
  order_number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_recipient: string;
  shipping_phone: string;
  shipping_address: string;
  shipping_neighborhood: string | null;
  shipping_city: string;
  shipping_notes: string | null;
  products_total: string;
  shipping_total: string;
  grand_total: string;
  status: 'pending_payment' | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';
  payment_status: 'pending' | 'paid' | 'failed';
  checkout_url: string | null;
  paid_at: string | null;
  created_at: string | null;
}

export interface OrderWithSuborders extends Order {
  suborders: Suborder[];
}

export interface CheckoutResponse {
  id: number;
  order_number: string;
  status: string;
  payment_method: string;
  products_total: string;
  shipping_total: string;
  grand_total: string;
  payment_url: string | null;
}

export const payMarketplaceOrder = (orderId: number) =>
  apiRequest<{ order_id: number; order_number: string; payment_url: string; payment_method: string }>(
    `/marketplace/orders/${orderId}/pay`,
    { method: 'POST' }
  );

export const cancelMarketplaceOrder = (orderId: number) =>
  apiRequest<OrderWithSuborders>(`/marketplace/orders/${orderId}/cancel`, { method: 'POST' });

export const changeMarketplacePassword = (currentPassword: string, newPassword: string) =>
  apiRequest<{ ok: boolean }>('/marketplace/account/password', {
    method: 'PUT',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
  });

/** Métrica de clic de banner (v0.11.2): best-effort, nunca bloquea la navegación. */
export function trackBannerClick(bannerId: number): void {
  try {
    void fetch(`${API_BASE}/marketplace/banners/${bannerId}/click`, {
      method: 'POST',
      keepalive: true
    }).catch(() => {});
  } catch {
    // métrica best-effort
  }
}

export interface AuthPayload {
  access_token: string;
  token_type: string;
  expires_in: number;
  customer: MarketplaceCustomer;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pago pendiente',
  paid: 'Pagado',
  preparing: 'Preparando',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

export const SUBORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pago pendiente',
  paid: 'Pagado',
  preparing: 'Preparando',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

export function formatMoney(value: string | number | null | undefined): string {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return '$ 0';
  return `$ ${amount.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}
