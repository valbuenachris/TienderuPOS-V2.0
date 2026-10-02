const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const TOKEN_KEY = 'pos-gres-v2-token';

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

export interface PosUser {
  id: number;
  tenant_id: string;
  username: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  group_id: number | null;
  group_name: string | null;
  store_id: number | null;
  active: number;
}

export interface Product {
  id: number;
  code: string | null;
  name: string | null;
  price: string | null;
  tax: string | null;
  available_quantity: string | null;
  type: string | null;
  image_url: string | null;
  image_full_url: string | null;
}

export interface Customer {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface Store {
  id: number;
  name: string;
  code: string | null;
}

export interface SaleResult {
  id: number;
  customer_name: string | null;
  store_id: number;
  total: string;
  tax_total: string;
  grand_total: string;
  paid: string;
  status: string;
  paid_by?: string | null;
  amount_received?: string | null;
  change_amount?: string | null;
  total_reward_points?: number | null;
  created_at?: string | null;
  items: Array<{
    product_id: number;
    code?: string | null;
    name?: string | null;
    quantity: string;
    unit_price: string;
    subtotal: string;
  }>;
}

export type SalePaymentMethod = 'cash' | 'CC' | 'Transferencia' | 'Sistecredito' | 'ADI' | 'credito';

export interface CreateSalePayload {
  store_id: number;
  customer_id?: number;
  items: Array<{ product_id: number; quantity: string }>;
  paid_by?: SalePaymentMethod;
  amount_received?: string;
  change_amount?: string;
}

export interface PosSettings {
  site_name: string;
  currency_prefix: string;
  default_customer: number | null;
}

export interface SaleListRow {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  total: string | null;
  grand_total: string | null;
  paid: string | null;
  total_items: number | null;
  total_quantity: string | null;
  status: string | null;
  created_at: string | null;
  created_by: number | null;
  store_id: number | null;
}

export interface DailyReport {
  day: string;
  sales_count: number;
  total: string;
  grand_total: string;
  paid: string;
}

export interface ManagedProduct {
  id: number;
  code: string | null;
  name: string | null;
  price: string | null;
  cost: string | null;
  tax: string | null;
  type: string | null;
  reward_points: number | null;
  image: string | null;
  image_2: string | null;
  image_3: string | null;
  details: string | null;
  store_quantity: number | null;
  store_price: string | null;
}

export interface ManagedProductPayload {
  code: string;
  name: string;
  price: string;
  cost?: string;
  tax?: string;
  reward_points?: number;
  details?: string;
  store_id?: number;
  quantity?: number;
}

export interface ManagedCustomer {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  store_id: number | null;
}

export interface ManagedCustomerPayload {
  name: string;
  email?: string;
  phone?: string;
  store_id?: number;
}

export interface ExpenseRecord {
  id: number;
  date: string | null;
  reference: string | null;
  amount: string | null;
  note: string | null;
  created_by: number | null;
}

export interface ExpensePayload {
  reference: string;
  amount: string;
  date?: string;
  note?: string;
}

export interface ReportDay {
  day: string;
  sales_count: number;
  total: string;
  grand_total: string;
  paid: string;
  due: string;
}

export interface ReportTotals {
  sales_count: number;
  subtotal: string;
  grand_total: string;
  paid: string;
  due: string;
}

export interface ReportMonthPoint {
  month: string;
  sales: string;
  purchases: string;
  expenses: string;
}

export interface ReportSummary {
  from: string;
  to: string;
  days: ReportDay[];
  totals: ReportTotals;
  purchases_total: string;
  expenses_total: string;
  net_profit: string;
  monthly: ReportMonthPoint[];
}

export interface TopProduct {
  product_id: number;
  code: string | null;
  name: string | null;
  quantity: string;
  subtotal: string;
}

export interface UserRecord {
  id: number;
  username: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  group_name: string | null;
  store_id: number | null;
  active: number | null;
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) return 'No fue posible completar la solicitud';
  if (typeof payload.message === 'string') return payload.message;
  if (isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message;
  return 'No fue posible completar la solicitud';
}

function withQuery(path: string, params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readErrorMessage(payload));
  }
  return payload as T;
}

export const loginPos = (identity: string, password: string) =>
  apiRequest<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identity, password })
  });

export const logoutPos = () => apiRequest('/auth/logout', { method: 'POST' });

export const fetchPosUser = () =>
  apiRequest<{ tenant_id: string; user: PosUser }>('/auth/me');

export const fetchStores = () => apiRequest<Store[]>('/catalog/stores');

export const fetchCustomers = (storeId: number, search = '') =>
  apiRequest<Customer[]>(withQuery('/catalog/customers', { store_id: storeId, q: search }));

export const fetchSettings = () => apiRequest<PosSettings>('/settings');

export const fetchProducts = (storeId: number, search: string) => {
  const query = new URLSearchParams({ store_id: String(storeId), q: search });
  return apiRequest<Product[]>(`/catalog/products?${query.toString()}`);
};

export const createSale = (payload: CreateSalePayload) =>
  apiRequest<SaleResult>('/sales', { method: 'POST', body: JSON.stringify(payload) });

export const fetchSales = (from: string | undefined, to: string | undefined, page = 1, limit = 20) =>
  apiRequest<Paginated<SaleListRow>>(withQuery('/sales', { from, to, page, limit }));

export interface SaleDetailItem {
  id: number;
  product_id: number | null;
  code: string | null;
  name: string | null;
  quantity: string | null;
  unit_price: string | null;
  subtotal: string | null;
  reward_points: number | null;
}

export interface SalePayment {
  id: number;
  amount: string | null;
  paid_by: string | null;
  created_at: string | null;
}

export interface SaleDetail extends SaleListRow {
  items: SaleDetailItem[];
  payments: SalePayment[];
}

export interface UpdateSalePayload {
  customer_id?: number | null;
  items: Array<{ product_id: number; quantity: string }>;
}

export const fetchSaleDetail = (id: number) => apiRequest<SaleDetail>(`/sales/${id}`);

export const updateSale = (id: number, payload: UpdateSalePayload) =>
  apiRequest<SaleDetail>(`/sales/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteSale = (id: number) =>
  apiRequest<{ id: number; deleted: boolean }>(`/sales/${id}`, { method: 'DELETE' });

export const fetchDailyReport = (date: string) =>
  apiRequest<DailyReport>(withQuery('/sales/daily', { date }));

export const fetchManagedProducts = (storeId: number, search: string, page = 1, limit = 20) =>
  apiRequest<Paginated<ManagedProduct>>(withQuery('/products', { store_id: storeId, q: search, page, limit }));

export const createManagedProduct = (payload: ManagedProductPayload) =>
  apiRequest<{ id: number }>('/products', { method: 'POST', body: JSON.stringify(payload) });

export const updateManagedProduct = (
  id: number,
  payload: Omit<ManagedProductPayload, 'store_id' | 'quantity'>
) => apiRequest<ManagedProduct>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const setManagedProductStock = (id: number, payload: { store_id: number; quantity: number }) =>
  apiRequest<{ product_id: number; store_id: number; quantity: number }>(
    `/products/${id}/stock`,
    { method: 'PUT', body: JSON.stringify(payload) }
  );

export const uploadProductImage = (productId: number, slot: 1 | 2 | 3, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<{ slot: number; image_url: string }>(`/products/${productId}/images/${slot}`, {
    method: 'POST',
    body: form
  });
};

export const deleteProductImage = (productId: number, slot: 1 | 2 | 3) =>
  apiRequest<{ slot: number; image_url: null }>(`/products/${productId}/images/${slot}`, { method: 'DELETE' });

export const fetchManagedCustomers = (search: string, page = 1, limit = 20) =>
  apiRequest<Paginated<ManagedCustomer>>(withQuery('/customers', { q: search, page, limit }));

export const createManagedCustomer = (payload: ManagedCustomerPayload) =>
  apiRequest<ManagedCustomer>('/customers', { method: 'POST', body: JSON.stringify(payload) });

export const updateManagedCustomer = (id: number, payload: ManagedCustomerPayload) =>
  apiRequest<ManagedCustomer>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const fetchExpenses = (from: string | undefined, to: string | undefined, page = 1, limit = 20) =>
  apiRequest<Paginated<ExpenseRecord>>(withQuery('/expenses', { from, to, page, limit }));

export const createExpense = (payload: ExpensePayload) =>
  apiRequest<ExpenseRecord>('/expenses', { method: 'POST', body: JSON.stringify(payload) });

export const updateExpense = (id: number, payload: ExpensePayload) =>
  apiRequest<ExpenseRecord>(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const fetchReportSummary = (from: string, to: string) =>
  apiRequest<ReportSummary>(withQuery('/reports/summary', { from, to }));

export const fetchTopProducts = (from: string, to: string) =>
  apiRequest<TopProduct[]>(withQuery('/reports/top-products', { from, to }));

export type ReportCalendarGroup = 'day' | 'month';

export interface ReportCalendarPoint {
  key: string;
  sales_total: string;
  sales_count: number;
  purchases_total: string;
  purchases_count: number;
  expenses_total: string;
  expenses_count: number;
  pending_total: string;
  net_profit: string;
}

export interface ReportCalendar {
  from: string;
  to: string;
  group: ReportCalendarGroup;
  points: ReportCalendarPoint[];
  totals: Omit<ReportCalendarPoint, 'key'>;
}

export const fetchReportCalendar = (from: string, to: string, group: ReportCalendarGroup) =>
  apiRequest<ReportCalendar>(withQuery('/reports/calendar', { from, to, group }));

export const fetchUsers = (search = '', page = 1, limit = 20) =>
  apiRequest<Paginated<UserRecord>>(withQuery('/users', { q: search, page, limit }));

export interface UserPayload {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'admin' | 'staff';
  store_id?: number;
  active?: boolean;
  password?: string;
}

export const createUser = (payload: UserPayload) =>
  apiRequest<UserRecord>('/users', { method: 'POST', body: JSON.stringify(payload) });

export const updateUser = (id: number, payload: Partial<UserPayload>) =>
  apiRequest<UserRecord>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const setUserActive = (id: number, active: boolean) =>
  apiRequest<UserRecord>(`/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });

export const deleteUser = (id: number) =>
  apiRequest<UserRecord>(`/users/${id}`, { method: 'DELETE' });

export interface SupplierRecord {
  id: number;
  name: string | null;
  cf1: string | null;
  cf2: string | null;
  phone: string | null;
  email: string | null;
}

export interface SupplierPayload {
  name: string;
  cf1?: string;
  cf2?: string;
  phone?: string;
  email?: string;
}

export interface PurchaseListRow {
  id: number;
  reference: string | null;
  date: string | null;
  note: string | null;
  total: string | null;
  received: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  store_id: number | null;
  created_by: number | null;
}

export interface PurchaseItemPayload {
  product_id: number;
  quantity: string;
  cost: string;
  sale_price?: string;
}

export interface PurchasePayload {
  supplier_id?: number;
  reference?: string;
  date?: string;
  note?: string;
  store_id?: number;
  items: PurchaseItemPayload[];
}

export interface RegisterRecord {
  id: number;
  date: string | null;
  user_id: number | null;
  cash_in_hand: string | null;
  status: string | null;
  total_cash: string | null;
  total_cash_submitted: string | null;
  note: string | null;
  closed_at: string | null;
  closed_by: number | null;
  store_id: number | null;
}

export interface RegisterSummary {
  store_id: number;
  date: string;
  payments: {
    cash: string;
    card: string;
    transfer: string;
    sistecredito: string;
    adi: string;
    credit: string;
    paid_total: string;
    payments_count: number;
    card_count: number;
  };
  sales: {
    sales_count: number;
    subtotal: string;
    grand_total: string;
    paid: string;
  };
}

export interface RegisterCloseResult {
  register: RegisterRecord;
  totals: RegisterSummary['payments'];
}

export const fetchSuppliers = (search: string, page = 1, limit = 20) =>
  apiRequest<Paginated<SupplierRecord>>(withQuery('/suppliers', { q: search, page, limit }));

export const createSupplier = (payload: SupplierPayload) =>
  apiRequest<SupplierRecord>('/suppliers', { method: 'POST', body: JSON.stringify(payload) });

export const updateSupplier = (id: number, payload: SupplierPayload) =>
  apiRequest<SupplierRecord>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const fetchPurchases = (from: string | undefined, to: string | undefined, page = 1, limit = 20) =>
  apiRequest<Paginated<PurchaseListRow>>(withQuery('/purchases', { from, to, page, limit }));

export const createPurchase = (payload: PurchasePayload) =>
  apiRequest<{ id: number; reference: string; total: string; store_id: number; supplier_id: number | null; items: number }>(
    '/purchases',
    { method: 'POST', body: JSON.stringify(payload) }
  );

export const fetchRegisters = () => apiRequest<RegisterRecord[]>('/registers');

export const fetchCurrentRegister = (storeId?: number) =>
  apiRequest<RegisterRecord | null>(withQuery('/registers/current', { store_id: storeId }));

export const fetchRegisterSummary = (date: string, storeId?: number) =>
  apiRequest<RegisterSummary>(withQuery('/registers/summary', { date, store_id: storeId }));

export const openRegister = (payload: { store_id?: number; cash_in_hand: string }) =>
  apiRequest<RegisterRecord>('/registers/open', { method: 'POST', body: JSON.stringify(payload) });

export const closeRegister = (id: number, payload: { note?: string; total_cash_submitted?: string }) =>
  apiRequest<RegisterCloseResult>(`/registers/${id}/close`, { method: 'POST', body: JSON.stringify(payload) });
