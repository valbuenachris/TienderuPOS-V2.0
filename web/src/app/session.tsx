import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken, loginPos, logoutPos, setToken } from '../api';
import type { PosSettings, PosUser, Store } from '../api';
import { usePosUserQuery, useSettingsQuery, useStoresQuery } from '../pos-queries';

interface SessionValue {
  token: string | null;
  user: PosUser | null;
  tenantId: string | null;
  isAdmin: boolean;
  stores: Store[];
  settings: PosSettings | null;
  settingsLoading: boolean;
  loading: boolean;
  loggingIn: boolean;
  sessionError: boolean;
  login(identity: string, password: string): Promise<void>;
  logout(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setAuthToken] = useState<string | null>(() => getToken());
  const [loggingIn, setLoggingIn] = useState(false);

  const meQuery = usePosUserQuery(token);
  const user = meQuery.data?.user ?? null;
  const tenantId = meQuery.data?.tenant_id ?? null;
  const storesQuery = useStoresQuery(token, tenantId, user?.id ?? null);
  const settingsQuery = useSettingsQuery(token, tenantId);

  const value = useMemo<SessionValue>(() => ({
    token,
    user,
    tenantId,
    isAdmin: user?.group_name?.toLowerCase() === 'admin',
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
      } finally {
        setLoggingIn(false);
      }
    },
    logout() {
      void logoutPos()
        .catch(() => undefined)
        .then(() => {
          setToken(null);
          setAuthToken(null);
          queryClient.clear();
        });
    }
  }), [token, user, tenantId, storesQuery.data, settingsQuery.data, settingsQuery.isLoading, meQuery.isLoading, meQuery.isError, loggingIn, queryClient]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
