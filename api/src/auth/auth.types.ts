import { Request } from 'express';

export interface PosClaims {
  sub: string;
  tenant_id: string;
  sid: string;
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

export interface PosRequest extends Request {
  posClaims?: PosClaims;
  tenantId?: string;
  posUser?: PosUser;
}
