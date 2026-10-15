import { Request } from 'express';

export interface PosClaims {
  sub: string;
  tenant_id: string;
  sid?: string;
  /** Tenant the user belongs to. Equals tenant_id on login; differs after switch-tenant. */
  home_tenant_id?: string;
  /** True only for super administrators (group_name = 'super_admin'). */
  super?: boolean;
  /** Token audience: absent or 'pos_user' for POS staff, 'customer' for the B2C app. */
  type?: 'pos_user' | 'customer';
  role?: string;
  iat?: number;
  exp?: number;
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

export interface PosCustomer {
  id: number;
  tenant_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  store_id: number | null;
  points_balance: number;
}

export interface PosRequest extends Request {
  posClaims?: PosClaims;
  tenantId?: string;
  posUser?: PosUser;
  posCustomer?: PosCustomer;
}
