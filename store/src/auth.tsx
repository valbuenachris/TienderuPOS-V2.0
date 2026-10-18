import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest, getToken, setToken, type AuthPayload, type MarketplaceCustomer } from './api';

interface AuthContextValue {
  customer: MarketplaceCustomer | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; phone?: string; password: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<MarketplaceCustomer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    apiRequest<{ customer: MarketplaceCustomer }>('/auth/marketplace-me')
      .then((payload) => {
        if (!cancelled) setCustomer(payload.customer);
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null);
          setCustomer(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const payload = await apiRequest<AuthPayload>('/auth/marketplace-login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setToken(payload.access_token);
    setCustomer(payload.customer);
  }, []);

  const register = useCallback(async (input: { name: string; email: string; phone?: string; password: string }) => {
    const payload = await apiRequest<AuthPayload>('/auth/marketplace-register', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    setToken(payload.access_token);
    setCustomer(payload.customer);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setCustomer(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ customer, ready, login, register, logout }),
    [customer, ready, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
