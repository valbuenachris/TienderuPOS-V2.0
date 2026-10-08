import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken, loginPos, logoutPos, setToken, switchTenant as requestTenantSwitch } from '../api';
import type { PosSettings, PosUser, Store } from '../api';
import { setBusinessTimeZone } from '../format';
import { usePosUserQuery, useSettingsQuery, useStoresQuery } from '../pos-queries';

interface SessionValue {
  token: string | null;
  user: PosUser | null;
  tenantId: string | null;
  selectedTenantId: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  stores: Store[];
  settings: PosSettings | null;
  settingsLoading: boolean;
  loading: boolean;
  loggingIn: boolean;
  sessionError: boolean;
  login(identity: string, password: string): Promise<void>;
  switchTenant(tenantId: string): Promise<void>;
  clearTenantSelection(): void;
  logout(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setAuthToken] = useState<string | null>(() => getToken());
  const [loggingIn, setLoggingIn] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const meQuery = usePosUserQuery(token);
  const user = meQuery.data?.user ?? null;
  const tenantId = meQuery.data?.tenant_id ?? null;
  const storesQuery = useStoresQuery(token, tenantId, user?.id ?? null);
  const settingsQuery = useSettingsQuery(token, tenantId);

  useEffect(() => {
    setBusinessTimeZone(settingsQuery.data?.timezone);
  }, [settingsQuery.data?.timezone]);

  const value = useMemo<SessionValue>(() => ({
    token,
    user,
    tenantId,
    selectedTenantId,
    isAdmin: ['admin', 'super_admin'].includes(user?.group_name?.toLowerCase() ?? ''),
    isSuperAdmin: meQuery.data?.super === true || user?.group_name?.toLowerCase() === 'super_admin',
    stores: storesQuery.data ?? [],
    settings: settingsQuery.data ?? null,
    settingsLoading: Boolean(token && tenantId) && settingsQuery.isLoading,
    loading: Boolean(token) && meQuery.isLoading,
    loggingIn,
    sessionError: Boolean(token) && meQuery.isError,
    async login(identity: string, password: string) {
      setLoggingIn(true);
      try {
        const result = await loginPos(identity, password);
        queryClient.clear();
        setToken(result.access_token);
        setAuthToken(result.access_token);
        setSelectedTenantId(null);
      } finally {
        setLoggingIn(false);
      }
    },
    async switchTenant(targetTenantId: string) {
      const result = await requestTenantSwitch(targetTenantId);
      queryClient.clear();
      setToken(result.access_token);
      setAuthToken(result.access_token);
      setSelectedTenantId(targetTenantId);
    },
    clearTenantSelection() {
      setSelectedTenantId(null);
    },
    logout() {
      void logoutPos()
        .catch(() => undefined)
        .then(() => {
          setToken(null);
          setAuthToken(null);
          setSelectedTenantId(null);
          queryClient.clear();
        });
    }
  }), [token, user, tenantId, selectedTenantId, meQuery.data?.super, storesQuery.data, settingsQuery.data, settingsQuery.isLoading, meQuery.isLoading, meQuery.isError, loggingIn, queryClient]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
