import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createExpense,
  createManagedCustomer,
  createManagedProduct,
  createSale,
  fetchCurrentRegister,
  fetchCustomers,
  fetchDailyReport,
  fetchExpenses,
  fetchManagedCustomers,
  fetchManagedProducts,
  fetchPosUser,
  fetchProducts,
  fetchPurchases,
  fetchRegisterSummary,
  fetchRegisters,
  fetchReportSummary,
  fetchSales,
  fetchSettings,
  fetchStores,
  fetchSuppliers,
  fetchTopProducts,
  fetchUsers,
  loginPos,
  logoutPos,
  setManagedProductStock,
  updateExpense,
  updateManagedCustomer,
  updateManagedProduct
} from './api';

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

export function useSettingsQuery(token: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['global-pos-settings'],
    queryFn: fetchSettings,
    enabled: Boolean(token && tenantId),
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
  from?: string,
  to?: string,
  limit = 50,
  offset = 0
) {
  return useQuery({
    queryKey: ['sales', tenantId, from ?? '', to ?? '', limit, offset],
    queryFn: () => fetchSales(from, to, limit, offset),
    enabled: Boolean(token && tenantId),
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
  search: string
) {
  return useQuery({
    queryKey: ['managed-products', tenantId, storeId, search],
    queryFn: () => {
      if (storeId === null) throw new Error('A store is required to load products');
      return fetchManagedProducts(storeId, search);
    },
    enabled: Boolean(token && tenantId && storeId),
    retry: false
  });
}

export function useManagedCustomersQuery(token: string | null, tenantId: string | null, search: string) {
  return useQuery({
    queryKey: ['managed-customers', tenantId, search],
    queryFn: () => fetchManagedCustomers(search),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useExpensesQuery(token: string | null, tenantId: string | null, from?: string, to?: string) {
  return useQuery({
    queryKey: ['expenses', tenantId, from ?? '', to ?? ''],
    queryFn: () => fetchExpenses(from, to),
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

export function useTopProductsQuery(token: string | null, tenantId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['report-top-products', tenantId, from, to],
    queryFn: () => fetchTopProducts(from, to),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function useUsersQuery(token: string | null, tenantId: string | null) {
  return useQuery({
    queryKey: ['users', tenantId],
    queryFn: fetchUsers,
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

export function useSuppliersQuery(token: string | null, tenantId: string | null, search: string) {
  return useQuery({
    queryKey: ['suppliers', tenantId, search],
    queryFn: () => fetchSuppliers(search),
    enabled: Boolean(token && tenantId),
    retry: false
  });
}

export function usePurchasesQuery(token: string | null, tenantId: string | null, from?: string, to?: string) {
  return useQuery({
    queryKey: ['purchases', tenantId, from ?? '', to ?? ''],
    queryFn: () => fetchPurchases(from, to),
    enabled: Boolean(token && tenantId),
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
    enabled: Boolean(token && tenantId && storeId),
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
    enabled: Boolean(token && tenantId && storeId),
    retry: false
  });
}
