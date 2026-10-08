import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import {
  CreatePlanDto,
  ExtendTrialDto,
  RecordPaymentDto,
  SuspendTenantDto,
  UpdatePlanDto,
  UpdateSubscriptionDto
} from './tenant-management.dto';
import { PaymentFilters, TenantManagementService } from './tenant-management.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const PAYMENT_STATUSES = ['completed', 'pending', 'failed', 'refunded'];

function parseUuid(value: string, field: string): string {
  if (!UUID_RE.test(value)) throw new BadRequestException(`${field} must be a UUID`);
  return value.toLowerCase();
}

function parseDate(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!DATE_RE.test(value)) throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  return value;
}

function parseAmount(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!AMOUNT_RE.test(value)) throw new BadRequestException(`${field} must be a non-negative amount`);
  return value;
}

@Controller('tenant-management')
@UseGuards(JwtAuthGuard, TenantContextGuard, SuperAdminGuard)
export class TenantManagementController {
  constructor(private readonly tenantManagement: TenantManagementService) {}

  @Get('plans')
  listPlans() {
    return this.tenantManagement.listPlans();
  }

  @Post('plans')
  createPlan(@Body() body: CreatePlanDto) {
    return this.tenantManagement.createPlan(body);
  }

  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() body: UpdatePlanDto) {
    return this.tenantManagement.updatePlan(parseUuid(id, 'id'), body);
  }

  @Get('tenants')
  listTenants() {
    return this.tenantManagement.listTenants();
  }

  @Get('tenants/:id/subscription')
  getSubscription(@Param('id') id: string) {
    return this.tenantManagement.getTenantSubscription(parseUuid(id, 'id'));
  }

  @Patch('tenants/:id/subscription')
  updateSubscription(
    @Req() request: PosRequest,
    @Param('id') id: string,
    @Body() body: UpdateSubscriptionDto
  ) {
    return this.tenantManagement.updateSubscription(parseUuid(id, 'id'), body, request.posUser?.id ?? null);
  }

  @Post('tenants/:id/trial/extend')
  extendTrial(@Req() request: PosRequest, @Param('id') id: string, @Body() body: ExtendTrialDto) {
    return this.tenantManagement.extendTrial(parseUuid(id, 'id'), body, request.posUser?.id ?? null);
  }

  @Post('tenants/:id/suspend')
  suspend(@Req() request: PosRequest, @Param('id') id: string, @Body() body: SuspendTenantDto) {
    return this.tenantManagement.suspendTenant(parseUuid(id, 'id'), body, request.posUser?.id ?? null);
  }

  @Post('tenants/:id/reactivate')
  reactivate(@Req() request: PosRequest, @Param('id') id: string) {
    return this.tenantManagement.reactivateTenant(parseUuid(id, 'id'), request.posUser?.id ?? null);
  }

  @Get('payments/summary')
  paymentSummary() {
    return this.tenantManagement.paymentSummary();
  }

  @Get('payments')
  listPayments(
    @Query('tenant_id') tenantId?: string,
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('min_amount') minAmount?: string,
    @Query('max_amount') maxAmount?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    if (status !== undefined && !PAYMENT_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of ${PAYMENT_STATUSES.join(', ')}`);
    }
    const filters: PaymentFilters = {
      tenantId: tenantId ? parseUuid(tenantId, 'tenant_id') : undefined,
      status,
      method: method?.trim().slice(0, 50) || undefined,
      from: parseDate(from, 'from'),
      to: parseDate(to, 'to'),
      minAmount: parseAmount(minAmount, 'min_amount'),
      maxAmount: parseAmount(maxAmount, 'max_amount')
    };
    return this.tenantManagement.listPayments(filters, parsePagination(page, limit));
  }

  @Get('tenants/:id/payments')
  tenantPayments(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.tenantManagement.listTenantPayments(parseUuid(id, 'id'), parsePagination(page, limit));
  }

  @Patch('payments/:id/confirm')
  confirmPayment(@Req() request: PosRequest, @Param('id') id: string) {
    return this.tenantManagement.confirmPayment(parseUuid(id, 'id'), request.posUser?.id ?? null);
  }

  @Post('tenants/:id/payments/record')
  recordPayment(@Req() request: PosRequest, @Param('id') id: string, @Body() body: RecordPaymentDto) {
    return this.tenantManagement.recordPayment(parseUuid(id, 'id'), body, request.posUser?.id ?? null);
  }

  @Get('tenants/:id/activity')
  tenantActivity(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.tenantManagement.listTenantActivity(parseUuid(id, 'id'), parsePagination(page, limit));
  }
}
