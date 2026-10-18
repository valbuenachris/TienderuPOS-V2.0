const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const TOKEN_KEY = 'pos-gres-v2-token';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  grand_total?: string;
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
  customer_phone?: string | null;
  cashier_name?: string | null;
  store_id: number;
  total: string;
  tax_total: string;
  grand_total: string;
  paid: string;
  status: string;
  paid_by?: string | null;
  amount_received?: string | null;
  change_amount?: string | null;
  order_discount?: string | null;
  total_discount?: string | null;
  order_discount_id?: string | null;
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
  /** Etiqueta libre para cuentas abiertas ("Mesa 5"); se ignora si viene customer_id. */
  customer_name?: string;
  items: Array<{ product_id: number; quantity: string }>;
  paid_by?: SalePaymentMethod;
  amount_received?: string;
  change_amount?: string;
  discount_type?: 'fixed' | 'percent';
  discount_value?: string;
}

export interface PosSettings {
  site_name: string;
  currency_prefix: string;
  default_customer: number | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  nit?: string | null;
  timezone?: string | null;
  language?: string | null;
  default_tax?: number | string | null;
  decimal_digits?: number | null;
  thank_you_message?: string | null;
  return_policy?: string | null;
  show_qr_on_ticket?: boolean | null;
  printer_width?: '58mm' | '80mm' | null;
  logo_url?: string | null;
  supported?: string[];
}

export interface UpdateSettingsPayload {
  site_name?: string;
  currency_prefix?: string;
  default_customer?: number | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  nit?: string | null;
  timezone?: string | null;
  language?: string | null;
  default_tax?: number | null;
  decimal_digits?: number | null;
  thank_you_message?: string | null;
  return_policy?: string | null;
  show_qr_on_ticket?: boolean;
  printer_width?: '58mm' | '80mm';
  logo_url?: string | null;
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
  total_reward_points?: number | null;
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
  line_total_value?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  points_cost?: number | null;
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
  category_id?: string | null;
  points_cost?: number;
}

export interface CategoryRecord {
  id: string;
  name: string;
  description: string | null;
  product_count: number;
  created_at: string | null;
}

export interface CategoryPayload {
  name: string;
  description?: string | null;
}

export const fetchCategories = () => apiRequest<CategoryRecord[]>('/categories');

export const createCategory = (payload: CategoryPayload) =>
  apiRequest<CategoryRecord>('/categories', { method: 'POST', body: JSON.stringify(payload) });

export const updateCategory = (id: string, payload: CategoryPayload) =>
  apiRequest<CategoryRecord>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteCategory = (id: string) =>
  apiRequest<void>(`/categories/${id}`, { method: 'DELETE' });

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
  if (Array.isArray(payload.message)) {
    const parts = payload.message.filter((item): item is string => typeof item === 'string');
    if (parts.length > 0) return parts.join(' · ');
  }
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
    if (response.status === 413) {
      throw new Error('El archivo supera el límite del proxy (413). Ajusta client_max_body_size a 5m en Nginx Proxy Manager.');
    }
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
  apiRequest<{ tenant_id: string; user: PosUser; super?: boolean }>('/auth/me');

export interface TenantRecord {
  id: string;
  name: string;
  host: string | null;
  status: string;
  created_at: string | null;
  users_count: number;
  stores_count: number;
  sales_count: number;
}

export interface CreateTenantPayload {
  name: string;
  host?: string;
  status?: 'active' | 'inactive';
}

export interface SwitchTenantResult {
  access_token: string;
  token_type: string;
  expires_in: number;
  tenant_id: string;
  tenant: { id: string; name: string | null };
}

export const fetchTenants = () => apiRequest<TenantRecord[]>('/tenants');

export interface TenantBootstrapResult extends TenantRecord {
  admin_username: string;
  admin_password: string;
}

export const createTenant = (payload: CreateTenantPayload) =>
  apiRequest<TenantBootstrapResult>('/tenants', { method: 'POST', body: JSON.stringify(payload) });

export interface UpdateTenantPayload {
  name?: string;
  host?: string | null;
  status?: 'active' | 'inactive';
}

export const updateTenant = (id: string, payload: UpdateTenantPayload) =>
  apiRequest<TenantRecord>(`/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteTenant = (id: string) =>
  apiRequest<void>(`/tenants/${id}`, { method: 'DELETE' });

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  max_users: number | null;
  max_stores: number | null;
  features: string[];
  is_active: boolean;
  created_at: string | null;
  tenants_count: number;
}

export interface SubscriptionPlanPayload {
  name: string;
  description?: string;
  price_monthly?: string;
  price_yearly?: string;
  max_users?: number;
  max_stores?: number;
  features?: string[];
  is_active?: boolean;
}

export interface TenantManagementRow {
  id: string;
  name: string;
  host: string | null;
  tenant_status: string;
  created_at: string | null;
  users_count: number;
  stores_count: number;
  admin_email: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  billing_cycle: string | null;
  last_payment_date: string | null;
  last_payment_amount: string | null;
  next_billing_date: string | null;
  auto_renew: boolean | null;
  plan_id: string | null;
  plan_name: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  max_users: number | null;
  max_stores: number | null;
}

export interface UpdateTenantSubscriptionPayload {
  plan_id?: string;
  billing_cycle?: 'monthly' | 'yearly';
  auto_renew?: boolean;
}

export interface ExtendTrialPayload {
  trial_end_date: string;
  reason?: string;
}

export interface SuspendManagedTenantPayload {
  reason: string;
  end_date?: string;
}

export interface TenantPayment {
  id: string;
  subscription_id: string;
  tenant_id: string;
  tenant_name?: string | null;
  plan_name?: string | null;
  amount: string;
  payment_date: string | null;
  payment_method: string | null;
  status: string | null;
  invoice_url: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface RecordTenantPaymentPayload {
  amount: string;
  payment_date?: string;
  payment_method?: string;
  notes?: string;
}

export interface TenantPaymentFilters {
  tenant_id?: string;
  status?: string;
  method?: string;
  from?: string;
  to?: string;
  min_amount?: string;
  max_amount?: string;
}

export interface TenantPaymentSummary {
  month: string;
  revenue_this_month: string;
  pending_total: string;
  failed_total: string;
  refunded_total: string;
  completed_this_month: number;
}

export interface TenantActivityLog {
  id: string;
  tenant_id: string;
  action: string;
  details: unknown;
  performed_by: number | null;
  performed_at: string | null;
}

export const fetchSubscriptionPlans = () =>
  apiRequest<SubscriptionPlan[]>('/tenant-management/plans');

export const createSubscriptionPlan = (payload: SubscriptionPlanPayload) =>
  apiRequest<SubscriptionPlan>('/tenant-management/plans', { method: 'POST', body: JSON.stringify(payload) });

export const updateSubscriptionPlan = (id: string, payload: Partial<SubscriptionPlanPayload>) =>
  apiRequest<SubscriptionPlan>(`/tenant-management/plans/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const fetchTenantManagement = () =>
  apiRequest<TenantManagementRow[]>('/tenant-management/tenants');

export const fetchTenantSubscription = (id: string) =>
  apiRequest<TenantManagementRow>(`/tenant-management/tenants/${id}/subscription`);

export const updateTenantSubscription = (id: string, payload: UpdateTenantSubscriptionPayload) =>
  apiRequest<TenantManagementRow>(`/tenant-management/tenants/${id}/subscription`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

export const extendTenantTrial = (id: string, payload: ExtendTrialPayload) =>
  apiRequest<TenantManagementRow>(`/tenant-management/tenants/${id}/trial/extend`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const suspendManagedTenant = (id: string, payload: SuspendManagedTenantPayload) =>
  apiRequest<TenantManagementRow>(`/tenant-management/tenants/${id}/suspend`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const reactivateManagedTenant = (id: string) =>
  apiRequest<TenantManagementRow>(`/tenant-management/tenants/${id}/reactivate`, { method: 'POST' });

export const fetchTenantPayments = (filters: TenantPaymentFilters, page = 1, limit = 20) =>
  apiRequest<Paginated<TenantPayment>>(
    withQuery('/tenant-management/payments', { ...filters, page, limit })
  );

export const fetchTenantPaymentsByTenant = (id: string, page = 1, limit = 20) =>
  apiRequest<Paginated<TenantPayment>>(
    withQuery(`/tenant-management/tenants/${id}/payments`, { page, limit })
  );

export const fetchTenantPaymentSummary = () =>
  apiRequest<TenantPaymentSummary>('/tenant-management/payments/summary');

export const recordTenantPayment = (id: string, payload: RecordTenantPaymentPayload) =>
  apiRequest<{ payment: TenantPayment; tenant_id: string; subscription_id: string }>(
    `/tenant-management/tenants/${id}/payments/record`,
    { method: 'POST', body: JSON.stringify(payload) }
  );

export const fetchTenantActivity = (id: string, page = 1, limit = 20) =>
  apiRequest<Paginated<TenantActivityLog>>(
    withQuery(`/tenant-management/tenants/${id}/activity`, { page, limit })
  );

export const confirmTenantPayment = (paymentId: string) =>
  apiRequest<TenantPayment>(`/tenant-management/payments/${paymentId}/confirm`, { method: 'PATCH' });

export interface AppOrderRow {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  total: string | null;
  grand_total: string | null;
  paid: string | null;
  status: string | null;
  status_delivery: string | null;
  payment_method: string | null;
  total_items: number | null;
  total_reward_points: number | null;
  created_at: string | null;
  store_id: number | null;
}

export interface AppCustomerRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  points_balance: number;
}

export interface ProductReviewRow {
  id: number;
  product_id: number;
  product_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string | null;
}

export interface BannerRecord {
  id: string;
  image_url: string;
  created_at: string | null;
}

export const fetchAppOrders = (page = 1, limit = 20) =>
  apiRequest<Paginated<AppOrderRow>>(withQuery('/admin/app-orders', { page, limit }));

export const updateAppOrderDelivery = (id: number, statusDelivery: string) =>
  apiRequest<AppOrderRow>(`/admin/app-orders/${id}/delivery`, {
    method: 'PATCH',
    body: JSON.stringify({ status_delivery: statusDelivery })
  });

export const fetchAppCustomers = (search = '', page = 1, limit = 20) =>
  apiRequest<Paginated<AppCustomerRow>>(withQuery('/admin/app-customers', { q: search, page, limit }));

export const adjustAppCustomerPoints = (id: number, payload: { amount: number; reason: string }) =>
  apiRequest<AppCustomerRow>(`/admin/customers/${id}/points`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

export const resetAppCustomerPassword = (id: number) =>
  apiRequest<{ id: number; reset: boolean }>(`/admin/customers/${id}/reset-password`, { method: 'POST' });

export const fetchAdminReviews = (page = 1, limit = 20) =>
  apiRequest<Paginated<ProductReviewRow>>(withQuery('/admin/reviews', { page, limit }));

export const deleteAdminReview = (id: number) =>
  apiRequest<void>(`/admin/reviews/${id}`, { method: 'DELETE' });

export const fetchAdminBanners = () => apiRequest<BannerRecord[]>('/admin/banners');

export const createAdminBanner = (payload: { image_url: string }) =>
  apiRequest<BannerRecord>('/admin/banners', { method: 'POST', body: JSON.stringify(payload) });

export const deleteAdminBanner = (id: string) =>
  apiRequest<void>(`/admin/banners/${id}`, { method: 'DELETE' });

export type BillingInvoiceStatus = 'paid' | 'pending' | 'overdue' | 'cancelled';

export interface BillingInvoice {
  id: string;
  invoice_number: string;
  tenant_id: string;
  subscription_id: string;
  plan_name: string | null;
  amount: string;
  issue_date: string;
  due_date: string;
  paid_date: string | null;
  status: BillingInvoiceStatus;
  payment_method: string | null;
  billing_cycle: string | null;
  notes: string | null;
}

export interface BillingSubscriptionInfo {
  subscription_id: string;
  status: string | null;
  plan_name: string | null;
  billing_cycle: string | null;
  auto_renew: boolean | null;
  next_billing_date: string | null;
  subscription_end_date: string | null;
  trial_end_date: string | null;
}

export interface CurrentInvoiceResult {
  subscription: BillingSubscriptionInfo | null;
  overdue: BillingInvoice | null;
  upcoming: BillingInvoice | null;
}

export interface BillingPaymentPayload {
  payment_method: string;
  notes?: string;
}

export const fetchBillingInvoices = () => apiRequest<BillingInvoice[]>('/billing/invoices');

export const fetchCurrentInvoice = () => apiRequest<CurrentInvoiceResult>('/billing/current-invoice');

export const requestBillingPayment = (invoiceId: string, payload: BillingPaymentPayload) =>
  apiRequest<{ id: string | null; invoice_number: string; amount: string; status: string }>(
    '/billing/pay',
    { method: 'POST', body: JSON.stringify({ invoice_id: invoiceId, ...payload }) }
  );

export const startBoldPayment = (invoiceId: string) =>
  apiRequest<{ id: string | null; invoice_number: string; amount: string; checkout_url: string }>(
    '/billing/pay-bold',
    { method: 'POST', body: JSON.stringify({ invoice_id: invoiceId }) }
  );

export const verifyBoldPayments = () =>
  apiRequest<{ confirmed: number; failed: number; pending: number }>('/billing/verify-bold', { method: 'POST' });

export const switchTenant = (tenantId: string) =>
  apiRequest<SwitchTenantResult>('/auth/switch-tenant', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId })
  });

export interface GlobalPlanCount {
  plan_id: string | null;
  plan_name: string | null;
  count: number;
}

export interface GlobalRecentSale {
  tenant_id: string;
  tenant_name: string;
  plan_name: string | null;
  amount: string;
  date: string | null;
  subscription_status: string | null;
}

export interface GlobalPlanChange {
  tenant_id: string;
  tenant_name: string;
  from_plan: string | null;
  to_plan: string | null;
  direction: string | null;
  date: string | null;
}

export interface GlobalDashboard {
  date: string;
  tenants: { total: number; active: number };
  active_subscriptions: { total: number; by_plan: GlobalPlanCount[] };
  plan_sales_today: { count: number; revenue: string };
  monthly_revenue: {
    total: string;
    payments_count: number;
    new_subscriptions: number;
    plan_changes: number;
    upgrades: number;
    downgrades: number;
    cancellations: number;
  };
  mrr: string;
  recent_sales: GlobalRecentSale[];
  recent_plan_changes: GlobalPlanChange[];
  payments_status: {
    pending_count: number;
    pending_amount: string;
    overdue_count: number;
    overdue_amount: string;
  };
  trials: { active: number; expiring_soon: number; converted: number };
}

export const fetchGlobalDashboard = () =>
  apiRequest<GlobalDashboard>('/dashboard/global');

export const fetchStores = () => apiRequest<Store[]>('/catalog/stores');

export const fetchCustomers = (storeId: number, search = '') =>
  apiRequest<Customer[]>(withQuery('/catalog/customers', { store_id: storeId, q: search }));

export const fetchSettings = () => apiRequest<PosSettings>('/settings');

export const fetchPosSettings = () => apiRequest<PosSettings>('/settings/pos');

export const updateSettings = (payload: UpdateSettingsPayload) =>
  apiRequest<PosSettings>('/settings', { method: 'PUT', body: JSON.stringify(payload) });

export const uploadSettingsLogo = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<{ logo_url: string }>('/settings/logo', { method: 'POST', body: form });
};

export const deleteSettingsLogo = () =>
  apiRequest<{ logo_url: null }>('/settings/logo', { method: 'DELETE' });

export const fetchProducts = (storeId: number, search: string) => {
  const query = new URLSearchParams({ store_id: String(storeId), q: search });
  return apiRequest<Product[]>(`/catalog/products?${query.toString()}`);
};

export const createSale = (payload: CreateSalePayload) =>
  apiRequest<SaleResult>('/sales', { method: 'POST', body: JSON.stringify(payload) });

export const fetchSales = (from: string | undefined, to: string | undefined, page = 1, limit = 20, customer = '', status = '') =>
  apiRequest<Paginated<SaleListRow>>(withQuery('/sales', { from, to, page, limit, customer, status }));

/** Agrega productos a una cuenta abierta (venta due/partial). */
export const appendSaleItems = (id: number, payload: { items: Array<{ product_id: number; quantity: string }> }) =>
  apiRequest<SaleDetail>(`/sales/${id}/items`, { method: 'POST', body: JSON.stringify(payload) });

export interface AiSettings {
  enabled: boolean;
  model: string | null;
  default_model: string;
  has_api_key: boolean;
  key_hint: string | null;
  source: 'tenant' | 'platform';
  table_ready: boolean;
}

export interface AiModelOption {
  id: string;
  label: string;
}

export const fetchAiSettings = () => apiRequest<AiSettings>('/ai/settings');

export const updateAiSettings = (payload: { model?: string; enabled?: boolean }) =>
  apiRequest<AiSettings>('/ai/settings', { method: 'PUT', body: JSON.stringify(payload) });

export const fetchAiModels = () =>
  apiRequest<{ models: AiModelOption[]; source: 'openrouter' | 'curated' }>('/ai/models');

export const sendAiChat = (messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
  apiRequest<{ reply: string; model: string; tools_used?: number }>('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages })
  });

export interface WhatsappSettings {
  configured: boolean;
  table_ready: boolean;
  instance_name: string | null;
  status: 'none' | 'open' | 'connecting' | 'close';
  connected_at: string | null;
  agent_enabled: boolean;
  agent_name: string | null;
  agent_tone: string;
  webhook_token_ready: boolean;
}

export const updateWhatsappAgent = (payload: { agent_enabled?: boolean; agent_name?: string; agent_tone?: string }) =>
  apiRequest<WhatsappSettings>('/whatsapp/settings', { method: 'PUT', body: JSON.stringify(payload) });

export const fetchWhatsappSettings = () => apiRequest<WhatsappSettings>('/whatsapp/settings');

export const createWhatsappInstance = () =>
  apiRequest<WhatsappSettings & { qr: string | null }>('/whatsapp/instance', { method: 'POST' });

export const connectWhatsapp = () =>
  apiRequest<{ state: string | null; qr: string | null }>('/whatsapp/connect', { method: 'POST' });

export const disconnectWhatsapp = () =>
  apiRequest<WhatsappSettings>('/whatsapp/disconnect', { method: 'POST' });

// ===== CRM =====

export interface CrmLead {
  id: number;
  tenant_id: string;
  customer_id: number | null;
  name: string | null;
  phone: string;
  email: string | null;
  source: string;
  stage: string;
  score: number;
  owner_id: number | null;
  opt_out: boolean;
  last_activity_at: string | null;
  next_followup_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CrmActivity {
  id: number;
  type: string;
  content: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_by: number | null;
  created_at: string | null;
}

export interface CrmLeadDetail {
  lead: CrmLead;
  customer: {
    id: number;
    name: string | null;
    email: string | null;
    phone: string | null;
    points_balance: number;
  } | null;
  activities: CrmActivity[];
  conversation: Array<{ id: number; direction: string; body: string | null; created_at: string | null }>;
  recent_sales: Array<{
    id: number;
    grand_total: string | null;
    paid: string | null;
    status: string | null;
    created_at: string | null;
  }>;
}

export interface CrmTemplate {
  id: number;
  name: string;
  body: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface CrmAutomation {
  id: number;
  name: string;
  trigger: string;
  delay_hours: number;
  template_id: number | null;
  enabled: boolean;
  last_run_at: string | null;
  template_name: string | null;
}

export interface CrmSummary {
  by_stage: Record<string, number>;
  total: number;
  new_this_month: number;
  won_this_month: number;
  conversion: number;
  overdue_tasks: number;
  automation_sends_7d: number;
}

export const fetchCrmLeads = (params: {
  stage?: string;
  source?: string;
  q?: string;
  overdue?: string;
  page?: number;
  limit?: number;
}) =>
  apiRequest<Paginated<CrmLead>>(
    withQuery('/crm/leads', {
      stage: params.stage,
      source: params.source,
      q: params.q,
      overdue: params.overdue,
      page: params.page ?? 1,
      limit: params.limit ?? 30
    })
  );

export const createCrmLead = (payload: {
  name?: string;
  phone: string;
  email?: string;
  source?: string;
  next_followup_at?: string;
}) => apiRequest<CrmLead>('/crm/leads', { method: 'POST', body: JSON.stringify(payload) });

export const fetchCrmLead = (id: number) => apiRequest<CrmLeadDetail>(`/crm/leads/${id}`);

export const updateCrmLead = (
  id: number,
  payload: {
    name?: string;
    email?: string;
    stage?: string;
    score?: number;
    opt_out?: boolean;
    next_followup_at?: string | null;
  }
) => apiRequest<CrmLead>(`/crm/leads/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const addCrmActivity = (id: number, payload: { type: string; content: string; due_at?: string }) =>
  apiRequest<{ id: number }>(`/crm/leads/${id}/activities`, { method: 'POST', body: JSON.stringify(payload) });

export const completeCrmActivity = (leadId: number, activityId: number) =>
  apiRequest<{ id: number; completed: boolean }>(`/crm/leads/${leadId}/activities/${activityId}/complete`, {
    method: 'PUT'
  });

export const sendCrmMessage = (id: number, content: string) =>
  apiRequest<{ sent: boolean; paused_bot: boolean }>(`/crm/leads/${id}/message`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });

export const fetchCrmTemplates = () => apiRequest<CrmTemplate[]>('/crm/templates');

export const createCrmTemplate = (payload: { name: string; body: string }) =>
  apiRequest<{ id: number }>('/crm/templates', { method: 'POST', body: JSON.stringify(payload) });

export const updateCrmTemplate = (id: number, payload: { name: string; body: string }) =>
  apiRequest<{ id: number; updated: boolean }>(`/crm/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

export const deleteCrmTemplate = (id: number) =>
  apiRequest<{ deleted: boolean }>(`/crm/templates/${id}`, { method: 'DELETE' });

export const fetchCrmAutomations = () => apiRequest<CrmAutomation[]>('/crm/automations');

export const createCrmAutomation = (payload: {
  name: string;
  trigger: string;
  delay_hours: number;
  template_id?: number;
  enabled?: boolean;
}) => apiRequest<{ id: number }>('/crm/automations', { method: 'POST', body: JSON.stringify(payload) });

export const updateCrmAutomation = (
  id: number,
  payload: { name: string; trigger: string; delay_hours: number; template_id?: number; enabled?: boolean }
) =>
  apiRequest<{ id: number; updated: boolean }>(`/crm/automations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

export const deleteCrmAutomation = (id: number) =>
  apiRequest<{ deleted: boolean }>(`/crm/automations/${id}`, { method: 'DELETE' });

export const fetchCrmSummary = () => apiRequest<CrmSummary>('/crm/summary');

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
  tax_total?: string | null;
  total_discount?: string | null;
  order_discount_id?: string | null;
  customer_phone?: string | null;
  cashier_name?: string | null;
  items: SaleDetailItem[];
  payments: SalePayment[];
}

export interface UpdateSalePayload {
  customer_id?: number | null;
  items: Array<{ product_id: number; quantity: string }>;
}

export const fetchSaleDetail = (id: number) => apiRequest<SaleDetail>(`/sales/${id}`);

export interface AddSalePaymentPayload {
  amount: string;
  paid_by: SalePaymentMethod;
}

export const addSalePayment = (id: number, payload: AddSalePaymentPayload) =>
  apiRequest<{
    id: number;
    sale_id: number;
    amount: string;
    paid_by: string | null;
    created_at: string | null;
    paid: string;
    status: string;
  }>(`/sales/${id}/payments`, { method: 'POST', body: JSON.stringify(payload) });

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
  reference_no: string | null;
  date: string | null;
  note: string | null;
  total: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
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
  reference_no?: string;
  date?: string;
  note?: string;
  store_id?: number;
  items: PurchaseItemPayload[];
}

export interface PurchaseDetailItem {
  id: number;
  product_id: number | null;
  code: string | null;
  product_name: string | null;
  quantity: string | null;
  cost: string | null;
  subtotal: string | null;
}

export interface PurchaseDetail {
  purchase: PurchaseListRow;
  items: PurchaseDetailItem[];
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
  store_id: number | null;
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

export const fetchPurchaseDetail = (id: number) =>
  apiRequest<PurchaseDetail>(`/purchases/${id}`);

export const createPurchase = (payload: PurchasePayload) =>
  apiRequest<{ id: number; reference_no: string; total: string; supplier_id: number | null; items: number }>(
    '/purchases',
    { method: 'POST', body: JSON.stringify(payload) }
  );

export const updatePurchase = (id: number, payload: PurchasePayload) =>
  apiRequest<{ id: number; reference_no: string; total: string; supplier_id: number | null; items: number }>(
    `/purchases/${id}`,
    { method: 'PUT', body: JSON.stringify(payload) }
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

// ---------------------------------------------------------------------------
// Marketplace Tienderu.com (v0.8.0) — panel del tenant y super admin
// ---------------------------------------------------------------------------

export interface MarketplaceSettings {
  tenant_id: string;
  enabled: boolean;
  markup_percent: string;
  store_display_name: string | null;
}

export interface MarketplaceOrderItemRow {
  id: number;
  suborder_id: number;
  product_id: number;
  product_code: string | null;
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface MarketplaceSuborderRow {
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
  payout_status: 'pending' | 'paid';
  paid_out_at: string | null;
  created_at: string | null;
  order_number: string;
  customer_name: string;
  shipping_city: string;
  items: MarketplaceOrderItemRow[];
}

export interface MarketplaceSummary {
  orders_count: number;
  pending_count: number;
  delivered_count: number;
  tenant_total: string;
  commission: string;
  payout_pending: string;
}

export interface MarketplaceAdminOrder {
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
  commission_total: string;
  tenant_total: string;
  status: string;
  payment_method: string;
  payment_status: string;
  paid_at: string | null;
  created_at: string | null;
  suborders_count: number;
  sellers: string;
  suborders: Array<{
    id: number;
    suborder_number: string;
    status: string;
    tenant_name: string;
    tenant_total: string;
    commission: string;
    payout_status: string;
    items: MarketplaceOrderItemRow[];
  }>;
}

export interface MarketplacePayoutTenant {
  id: string;
  name: string;
  orders_count: number;
  pending_payout: string;
  paid_out: string;
}

export interface MarketplaceAdminSummary {
  orders_count: number;
  paid_orders: number;
  gmv: string;
  commission: string;
  tenant_payable: string;
  pending_payment: number;
  pending_payout: string;
  tenants: MarketplacePayoutTenant[];
}

export const fetchMarketplaceSettings = () =>
  apiRequest<MarketplaceSettings>('/marketplace/settings');

export const updateMarketplaceSettings = (payload: {
  enabled?: boolean;
  markup_percent?: number;
  store_display_name?: string;
}) =>
  apiRequest<MarketplaceSettings>('/marketplace/settings', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

export const fetchMarketplaceOrders = (status?: string, page = 1, limit = 20) =>
  apiRequest<Paginated<MarketplaceSuborderRow>>(
    withQuery('/marketplace/orders', { status, page, limit })
  );

export const fetchMarketplaceOrderDetail = (id: number) =>
  apiRequest<MarketplaceSuborderRow & {
    customer_email: string | null;
    customer_phone: string | null;
    shipping_recipient: string;
    shipping_phone: string;
    shipping_address: string;
    shipping_neighborhood: string | null;
    shipping_notes: string | null;
    order_status: string;
    paid_at: string | null;
  }>(`/marketplace/orders/${id}`);

export const updateMarketplaceOrderStatus = (
  id: number,
  payload: { status: 'preparing' | 'shipped' | 'delivered'; note?: string }
) =>
  apiRequest<MarketplaceSuborderRow>(`/marketplace/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

export const fetchMarketplaceSummary = () =>
  apiRequest<MarketplaceSummary>('/marketplace/summary');

export const fetchMarketplaceAdminOrders = (status?: string, tenantId?: string, page = 1, limit = 20) =>
  apiRequest<Paginated<MarketplaceAdminOrder>>(
    withQuery('/marketplace/admin/orders', { status, tenant_id: tenantId, page, limit })
  );

export const fetchMarketplaceAdminSummary = () =>
  apiRequest<MarketplaceAdminSummary>('/marketplace/admin/summary');

export const markMarketplacePayouts = (payload: { tenant_id: string; suborder_ids?: number[] }) =>
  apiRequest<{ tenant_id: string; marked: number; total: string }>('/marketplace/admin/payouts/mark', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

// ---------------------------------------------------------------------------
// Marketplace global · Marca y banners (v0.10.0)
// ---------------------------------------------------------------------------

export interface MarketplaceAdminBranding {
  id: number;
  logo_url: string | null;
  favicon_url: string | null;
  footer_description: string | null;
  footer_email: string | null;
  footer_phone: string | null;
  footer_whatsapp: string | null;
  footer_address: string | null;
  footer_instagram: string | null;
  footer_facebook: string | null;
  updated_at: string | null;
}

export interface MarketplaceBannerAdminRow {
  id: number;
  slot: string;
  title: string | null;
  image_url: string;
  target_url: string | null;
  sort_order: number;
  active: boolean;
  created_at: string | null;
}

export interface MarketplaceBrandingPayload {
  footer_description?: string;
  footer_email?: string;
  footer_phone?: string;
  footer_whatsapp?: string;
  footer_address?: string;
  footer_instagram?: string;
  footer_facebook?: string;
  logo?: File | null;
  favicon?: File | null;
}

export const fetchMarketplaceBranding = () =>
  apiRequest<MarketplaceAdminBranding>('/marketplace/admin/branding');

export const updateMarketplaceBranding = (payload: MarketplaceBrandingPayload) => {
  const form = new FormData();
  if (payload.logo) form.append('logo', payload.logo);
  if (payload.favicon) form.append('favicon', payload.favicon);
  const textFields = [
    'footer_description',
    'footer_email',
    'footer_phone',
    'footer_whatsapp',
    'footer_address',
    'footer_instagram',
    'footer_facebook'
  ] as const;
  for (const field of textFields) {
    const value = payload[field];
    if (value !== undefined) form.append(field, value);
  }
  return apiRequest<MarketplaceAdminBranding>('/marketplace/admin/branding', {
    method: 'PUT',
    body: form
  });
};

export const fetchMarketplaceBanners = () =>
  apiRequest<MarketplaceBannerAdminRow[]>('/marketplace/admin/banners');

export interface MarketplaceBannerPayload {
  file?: File | null;
  image_url?: string;
  title?: string;
  target_url?: string;
  sort_order?: number;
  active?: boolean;
}

function buildBannerForm(payload: MarketplaceBannerPayload): FormData {
  const form = new FormData();
  if (payload.file) form.append('file', payload.file);
  if (payload.image_url !== undefined) form.append('image_url', payload.image_url);
  if (payload.title !== undefined) form.append('title', payload.title);
  if (payload.target_url !== undefined) form.append('target_url', payload.target_url);
  if (payload.sort_order !== undefined) form.append('sort_order', String(payload.sort_order));
  if (payload.active !== undefined) form.append('active', String(payload.active));
  return form;
}

export const createMarketplaceBanner = (payload: MarketplaceBannerPayload) =>
  apiRequest<MarketplaceBannerAdminRow>('/marketplace/admin/banners', {
    method: 'POST',
    body: buildBannerForm(payload)
  });

export const updateMarketplaceBanner = (id: number, payload: MarketplaceBannerPayload) =>
  apiRequest<MarketplaceBannerAdminRow>(`/marketplace/admin/banners/${id}`, {
    method: 'PUT',
    body: buildBannerForm(payload)
  });

export const deleteMarketplaceBanner = (id: number) =>
  apiRequest<{ id: number; deleted: boolean }>(`/marketplace/admin/banners/${id}`, { method: 'DELETE' });
