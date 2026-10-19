import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createExpense,
  createManagedCustomer,
  createManagedProduct,
  createSale,
  fetchCurrentRegister,
  fetchCustomers,
  fetchAppCustomers,
  fetchAppOrders,
  fetchAdminBanners,
  fetchAdminReviews,
  fetchDailyReport,
  fetchBillingInvoices,
  fetchCategories,
  fetchCurrentInvoice,
  fetchExpenses,
  fetchGlobalDashboard,
  fetchManagedCustomers,
  fetchManagedProducts,
  fetchPosUser,
  appendSaleItems,
  connectWhatsapp,
  fetchAiModels,
  fetchAiSettings,
  fetchCrmAutomations,
  fetchCrmLead,
  fetchCrmLeads,
  fetchCrmSummary,
  fetchCrmTemplates,
  fetchWhatsappSettings,
  fetchProducts,
  fetchPurchaseDetail,
  fetchPurchases,
  fetchMarketplaceAdminOrders,
  fetchMarketplaceAdminSummary,
  fetchMarketplaceBanners,
  fetchMarketplaceBranding,
  fetchMarketplaceCoupons,
  fetchMarketplaceCustomers,
  fetchMarketplaceOrders,
  fetchMarketplaceSettings,
  fetchMarketplaceSummary,
  fetchMarketplaceWhatsapp,
  connectMarketplaceWhatsapp,
  fetchRegisterSummary,
  fetchRegisters,
  fetchReportSummary,
  fetchReportCalendar,
  fetchPosSettings,
  fetchSales,
  fetchSaleDetail,
  fetchSettings,
  fetchStores,
  fetchSuppliers,
  fetchSubscriptionPlans,
  fetchTenantActivity,
  fetchTenantManagement,
  fetchTenantPaymentSummary,
  fetchTenantPayments,
  fetchTenantPaymentsByTenant,
  fetchTenantSubscription,
  fetchTenants,
  fetchTopProducts,
  fetchUsers,
  loginPos,
  logoutPos,
  setManagedProductStock,
  updateExpense,
  updateManagedCustomer,
  updateManagedProduct
} from './api';
import type { ReportCalendarGroup, TenantPaymentFilters } from './api';

export function useApiMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  return useMutation<TResult, Error, TInput>({ mutationFn });
}

export function useLoginMutation() {
  return useMutation({
    mutationFn: (credentials: { identity: string; password: string }) =>
      loginPos(credentials.identity, credentials.password)
  });
}

export function useLogoutMutation() {
  return useMutation({ mutationFn: logoutPos });
}

export function useCreateSaleMutation() {
  return useMutation({ mutationFn: (payload: Parameters<typeof createSale>[0]) => createSale(payload) });
}

export function usePosUserQuery(token: string | null) {
  return useQuery({
    queryKey: ['pos-user'],
    queryFn: fetchPosUser,
    enabled: Boolean(token),
    retry: false
  });
}

export function useStoresQuery(token: string | null, tenantId: string | null, userId: number | null) {
  return useQuery({
    queryKey: ['stores', tenantId, userId],
    queryFn: fetchStores,
    enabled: Boolean(token && tenantId && userId),
    retry: false
  });
}

export function useCustomersQuery(token: string | null, tenantId: string | null, storeId: number | null) {
  return useQuery({
    queryKey: ['customers', tenantId, storeId],
    queryFn: () => {
      if (storeId === null) throw new Error('A store is required to load customers');
      return fetchCustomers(storeId);
    },
    enabled: Boolean(token && tenantId && storeId),
    retry: false
  });
}

export function useCustomerSearchQuery(
  token: string | null,
  tenantId: string | null,
  storeId: number | null,
  search: string
) {
  return useQuery({
    queryKey: ['customer-search', tenantId, storeId, search],
    queryFn: () => {
      if (storeId === null) throw new Error('A store is required to search customers');
      return fetchCustomers(storeId, search);
    },
    enabled: Boolean(token && tenantId && storeId && search.trim().length > 0),
    retry: false
  });
}

export function useSettingsQuery(token: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['global-pos-settings'],
    queryFn: fetchPosSettings,
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useManagedSettingsQuery(token: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['global-pos-settings-manage'],
    queryFn: fetchSettings,
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useTenantsQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: fetchTenants,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useGlobalDashboardQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['global-dashboard'],
    queryFn: fetchGlobalDashboard,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useProductsQuery(
  token: string | null,
  tenantId: string | null,
  storeId: number | null,
  search: string
) {
  return useQuery({
    queryKey: ['products', tenantId, storeId, search],
    queryFn: () => {
      if (storeId === null) throw new Error('A store is required to load products');
      return fetchProducts(storeId, search);
    },
    enabled: Boolean(token && tenantId && storeId),
    retry: false
  });
}

export function useSalesQuery(
  token: string | null,
  tenantId: string | null,
  from: string | undefined,
  to: string | undefined,
  page = 1,
  limit = 20,
  enabled = true,
  customer = ''
) {
  return useQuery({
    queryKey: ['sales', tenantId, from ?? '', to ?? '', page, limit, customer],
    queryFn: () => fetchSales(from, to, page, limit, customer),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

/** Cuentas abiertas: ventas due/partial del tenant (staff: solo su tienda). */
export function useOpenAccountsQuery(
  token: string | null,
  tenantId: string | null,
  page = 1,
  limit = 20,
  customer = '',
  enabled = true
) {
  return useQuery({
    queryKey: ['open-accounts', tenantId, page, limit, customer],
    queryFn: () => fetchSales(undefined, undefined, page, limit, customer, 'due,partial'),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useAppendSaleItemsMutation() {
  return useApiMutation((input: { id: number; items: Array<{ product_id: number; quantity: string }> }) =>
    appendSaleItems(input.id, { items: input.items })
  );
}

export function useAiSettingsQuery(token: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['ai-settings', tenantId],
    queryFn: fetchAiSettings,
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useAiModelsQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['ai-models', tenantId],
    queryFn: fetchAiModels,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useWhatsappSettingsQuery(
  token: string | null,
  tenantId: string | null,
  refetchInterval: number | false = false
) {
  return useQuery({
    queryKey: ['whatsapp-settings', tenantId],
    queryFn: fetchWhatsappSettings,
    enabled: Boolean(token && tenantId),
    refetchInterval,
    retry: false
  });
}

export function useWhatsappConnectQuery(token: string | null, tenantId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['whatsapp-connect', tenantId],
    queryFn: connectWhatsapp,
    enabled: Boolean(token && tenantId && enabled),
    refetchInterval: enabled ? 20000 : false,
    retry: false
  });
}

export function useCrmLeadsQuery(
  token: string | null,
  tenantId: string | null,
  filters: { stage?: string; source?: string; q?: string; overdue?: string; page?: number; limit?: number },
  enabled = true
) {
  return useQuery({
    queryKey: ['crm-leads', tenantId, filters.stage ?? '', filters.source ?? '', filters.q ?? '', filters.overdue ?? '', filters.page ?? 1, filters.limit ?? 30],
    queryFn: () => fetchCrmLeads(filters),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useCrmLeadQuery(token: string | null, tenantId: string | null, leadId: number | null) {
  return useQuery({
    queryKey: ['crm-lead', tenantId, leadId],
    queryFn: () => {
      if (leadId === null) throw new Error('A lead id is required');
      return fetchCrmLead(leadId);
    },
    enabled: Boolean(token && tenantId && leadId !== null),
    retry: false
  });
}

export function useCrmSummaryQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['crm-summary', tenantId],
    queryFn: fetchCrmSummary,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useCrmTemplatesQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['crm-templates', tenantId],
    queryFn: fetchCrmTemplates,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useCrmAutomationsQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['crm-automations', tenantId],
    queryFn: fetchCrmAutomations,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useSaleDetailQuery(token: string | null, tenantId: string | null, saleId: number | null) {
  return useQuery({
    queryKey: ['sale-detail', tenantId, saleId],
    queryFn: () => {
      if (saleId === null) throw new Error('A sale id is required to load the detail');
      return fetchSaleDetail(saleId);
    },
    enabled: Boolean(token && tenantId && saleId !== null),
    retry: false
  });
}

export function useDailyReportQuery(token: string | null, tenantId: string | null, date: string) {
  return useQuery({
    queryKey: ['sales-daily', tenantId, date],
    queryFn: () => fetchDailyReport(date),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useManagedProductsQuery(
  token: string | null,
  tenantId: string | null,
  storeId: number | null,
  search: string,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: ['managed-products', tenantId, storeId, search, page, limit],
    queryFn: () => {
      if (storeId === null) throw new Error('A store is required to load products');
      return fetchManagedProducts(storeId, search, page, limit);
    },
    enabled: Boolean(token && tenantId && storeId),
    retry: false
  });
}

export function useManagedCustomersQuery(
  token: string | null,
  tenantId: string | null,
  search: string,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: ['managed-customers', tenantId, search, page, limit],
    queryFn: () => fetchManagedCustomers(search, page, limit),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useExpensesQuery(
  token: string | null,
  tenantId: string | null,
  from: string | undefined,
  to: string | undefined,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: ['expenses', tenantId, from ?? '', to ?? '', page, limit],
    queryFn: () => fetchExpenses(from, to, page, limit),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useReportSummaryQuery(token: string | null, tenantId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['report-summary', tenantId, from, to],
    queryFn: () => fetchReportSummary(from, to),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useReportCalendarQuery(
  token: string | null,
  tenantId: string | null,
  from: string,
  to: string,
  group: ReportCalendarGroup,
  enabled = true
) {
  return useQuery({
    queryKey: ['report-calendar', tenantId, from, to, group],
    queryFn: () => fetchReportCalendar(from, to, group),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useTopProductsQuery(token: string | null, tenantId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['report-top-products', tenantId, from, to],
    queryFn: () => fetchTopProducts(from, to),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useUsersQuery(token: string | null, tenantId: string | null, search = '', page = 1, limit = 20) {
  return useQuery({
    queryKey: ['users', tenantId, search, page, limit],
    queryFn: () => fetchUsers(search, page, limit),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export const productMutations = {
  create: createManagedProduct,
  update: updateManagedProduct,
  setStock: setManagedProductStock
};

export const customerMutations = {
  create: createManagedCustomer,
  update: updateManagedCustomer
};

export const expenseMutations = {
  create: createExpense,
  update: updateExpense
};

export function useSuppliersQuery(
  token: string | null,
  tenantId: string | null,
  search: string,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: ['suppliers', tenantId, search, page, limit],
    queryFn: () => fetchSuppliers(search, page, limit),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function usePurchasesQuery(
  token: string | null,
  tenantId: string | null,
  from: string | undefined,
  to: string | undefined,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: ['purchases', tenantId, from ?? '', to ?? '', page, limit],
    queryFn: () => fetchPurchases(from, to, page, limit),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function usePurchaseDetailQuery(token: string | null, tenantId: string | null, purchaseId: number | null) {
  return useQuery({
    queryKey: ['purchase-detail', tenantId, purchaseId],
    queryFn: () => {
      if (purchaseId === null) throw new Error('A purchase id is required to load the detail');
      return fetchPurchaseDetail(purchaseId);
    },
    enabled: Boolean(token && tenantId && purchaseId !== null),
    retry: false
  });
}

export function useRegistersQuery(token: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['registers', tenantId],
    queryFn: fetchRegisters,
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useCurrentRegisterQuery(token: string | null, tenantId: string | null, storeId: number | null) {
  return useQuery({
    queryKey: ['register-current', tenantId, storeId],
    queryFn: () => fetchCurrentRegister(storeId ?? undefined),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useRegisterSummaryQuery(
  token: string | null,
  tenantId: string | null,
  date: string,
  storeId: number | null
) {
  return useQuery({
    queryKey: ['register-summary', tenantId, storeId, date],
    queryFn: () => fetchRegisterSummary(date, storeId ?? undefined),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useSubscriptionPlansQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['subscription-plans', tenantId],
    queryFn: fetchSubscriptionPlans,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useTenantManagementQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['tenant-management', tenantId],
    queryFn: fetchTenantManagement,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useTenantSubscriptionQuery(token: string | null, tenantId: string | null, tenantUuid: string | null) {
  return useQuery({
    queryKey: ['tenant-subscription', tenantId, tenantUuid],
    queryFn: () => {
      if (tenantUuid === null) throw new Error('A tenant id is required to load the subscription');
      return fetchTenantSubscription(tenantUuid);
    },
    enabled: Boolean(token && tenantId && tenantUuid),
    retry: false
  });
}

export function useTenantPaymentsQuery(
  token: string | null,
  tenantId: string | null,
  tenantUuid: string | null,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: ['tenant-payments', tenantId, tenantUuid, page, limit],
    queryFn: () => {
      if (tenantUuid === null) throw new Error('A tenant id is required to load payments');
      return fetchTenantPaymentsByTenant(tenantUuid, page, limit);
    },
    enabled: Boolean(token && tenantId && tenantUuid),
    retry: false
  });
}

export function useGlobalTenantPaymentsQuery(
  token: string | null,
  tenantId: string | null,
  filters: TenantPaymentFilters,
  page = 1,
  limit = 20,
  enabled = false
) {
  return useQuery({
    queryKey: ['tenant-payments-global', tenantId, filters, page, limit],
    queryFn: () => fetchTenantPayments(filters, page, limit),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useTenantPaymentSummaryQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['tenant-payments-summary', tenantId],
    queryFn: fetchTenantPaymentSummary,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useTenantActivityQuery(
  token: string | null,
  tenantId: string | null,
  tenantUuid: string | null,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: ['tenant-activity', tenantId, tenantUuid, page, limit],
    queryFn: () => {
      if (tenantUuid === null) throw new Error('A tenant id is required to load the activity log');
      return fetchTenantActivity(tenantUuid, page, limit);
    },
    enabled: Boolean(token && tenantId && tenantUuid),
    retry: false
  });
}

export function useBillingInvoicesQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['billing-invoices', tenantId],
    queryFn: fetchBillingInvoices,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useCurrentInvoiceQuery(token: string | null, tenantId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['billing-current', tenantId],
    queryFn: fetchCurrentInvoice,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useCategoriesQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['categories', tenantId],
    queryFn: fetchCategories,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useAppOrdersQuery(
  token: string | null,
  tenantId: string | null,
  page = 1,
  limit = 20,
  enabled = true
) {
  return useQuery({
    queryKey: ['admin-app-orders', tenantId, page, limit],
    queryFn: () => fetchAppOrders(page, limit),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useAppCustomersQuery(
  token: string | null,
  tenantId: string | null,
  search = '',
  page = 1,
  limit = 20,
  enabled = true
) {
  return useQuery({
    queryKey: ['admin-app-customers', tenantId, search, page, limit],
    queryFn: () => fetchAppCustomers(search, page, limit),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useAdminReviewsQuery(
  token: string | null,
  tenantId: string | null,
  page = 1,
  limit = 20,
  enabled = true
) {
  return useQuery({
    queryKey: ['admin-reviews', tenantId, page, limit],
    queryFn: () => fetchAdminReviews(page, limit),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useAdminBannersQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['admin-banners', tenantId],
    queryFn: fetchAdminBanners,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

// ---------------------------------------------------------------------------
// Marketplace Tienderu.com (v0.8.0)
// ---------------------------------------------------------------------------

export function useMarketplaceSettingsQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['marketplace-settings', tenantId],
    queryFn: fetchMarketplaceSettings,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceOrdersQuery(
  token: string | null,
  tenantId: string | null,
  status?: string,
  page = 1,
  enabled = true
) {
  return useQuery({
    queryKey: ['marketplace-orders', tenantId, status ?? '', page],
    queryFn: () => fetchMarketplaceOrders(status, page),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceSummaryQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['marketplace-summary', tenantId],
    queryFn: fetchMarketplaceSummary,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceAdminOrdersQuery(
  token: string | null,
  tenantId: string | null,
  status?: string,
  sellerId?: string,
  page = 1,
  enabled = true
) {
  return useQuery({
    queryKey: ['marketplace-admin-orders', tenantId, status ?? '', sellerId ?? '', page],
    queryFn: () => fetchMarketplaceAdminOrders(status, sellerId, page),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceAdminSummaryQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['marketplace-admin-summary', tenantId],
    queryFn: fetchMarketplaceAdminSummary,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

// ---------------------------------------------------------------------------
// Marketplace global · Marca y banners (v0.10.0)
// ---------------------------------------------------------------------------

export function useMarketplaceBrandingQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['marketplace-branding', tenantId],
    queryFn: fetchMarketplaceBranding,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceBannersQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['marketplace-banners', tenantId],
    queryFn: fetchMarketplaceBanners,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceCustomersQuery(
  token: string | null,
  tenantId: string | null,
  q: string | undefined,
  page = 1,
  enabled = true
) {
  return useQuery({
    queryKey: ['marketplace-customers', tenantId, q ?? '', page],
    queryFn: () => fetchMarketplaceCustomers(q, page),
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceCouponsQuery(token: string | null, tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['marketplace-coupons', tenantId],
    queryFn: fetchMarketplaceCoupons,
    enabled: Boolean(token && tenantId && enabled),
    retry: false
  });
}

export function useMarketplaceWhatsappQuery(
  token: string | null,
  tenantId: string | null,
  refetchInterval: number | false = false
) {
  return useQuery({
    queryKey: ['marketplace-whatsapp', tenantId],
    queryFn: fetchMarketplaceWhatsapp,
    enabled: Boolean(token && tenantId),
    refetchInterval,
    retry: false
  });
}

export function useMarketplaceWhatsappConnectQuery(
  token: string | null,
  tenantId: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['marketplace-whatsapp-connect', tenantId],
    queryFn: connectMarketplaceWhatsapp,
    enabled: Boolean(token && tenantId && enabled),
    refetchInterval: enabled ? 20000 : false,
    retry: false
  });
}
