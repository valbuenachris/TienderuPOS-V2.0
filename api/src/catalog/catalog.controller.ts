import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { PosRequest } from '../auth/auth.types';
import { isAdminRole } from '../common/roles';
import { CatalogService } from './catalog.service';

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BadRequestException('store_id must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) {
    throw new BadRequestException('store_id is invalid');
  }
  return parsed;
}

function parseSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new BadRequestException('q must be a string');
  return value.trim().slice(0, 100);
}

@Controller('catalog')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('stores')
  stores(@Req() request: PosRequest) {
    return this.catalog.listStores(request.tenantId!, request.posUser!);
  }

  @Get('products')
  products(@Req() request: PosRequest, @Query('q') search = '', @Query('store_id') storeId?: string) {
    const cleanSearch = parseSearch(search);
    const user = request.posUser!;
    const assignedStoreId = user.store_id;
    const requestedStoreId = optionalInteger(storeId);
    const isAdmin = isAdminRole(user.group_name);
    if (!isAdmin && assignedStoreId && requestedStoreId && requestedStoreId !== assignedStoreId) {
      throw new ForbiddenException('This POS user is not assigned to the selected store');
    }
    const effectiveStoreId = isAdmin ? (requestedStoreId ?? assignedStoreId) : assignedStoreId;
    if (!effectiveStoreId || (!assignedStoreId && !isAdmin)) {
      throw new ForbiddenException('This POS user is not assigned to the selected store');
    }
    return this.catalog.listProducts(request.tenantId!, cleanSearch, effectiveStoreId);
  }

  @Get('customers')
  customers(@Req() request: PosRequest, @Query('q') search = '', @Query('store_id') storeId?: string) {
    const cleanSearch = parseSearch(search);
    const user = request.posUser!;
    const requestedStoreId = optionalInteger(storeId);
    const isAdmin = isAdminRole(user.group_name);
    if (!isAdmin && requestedStoreId && requestedStoreId !== user.store_id) {
      throw new ForbiddenException('This POS user is not assigned to the selected store');
    }
    const effectiveStoreId = isAdmin ? (requestedStoreId ?? user.store_id ?? undefined) : user.store_id ?? undefined;
    if (!isAdmin && !effectiveStoreId) {
      throw new ForbiddenException('Assign this POS user to a store before loading customers');
    }
    return this.catalog.listCustomers(
      request.tenantId!,
      cleanSearch,
      effectiveStoreId
    );
  }
}
