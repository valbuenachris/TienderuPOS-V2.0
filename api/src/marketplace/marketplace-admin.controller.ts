import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { MarketplacePayoutMarkDto } from './marketplace.dto';
import { MarketplaceOrdersService } from './marketplace-orders.service';

/**
 * Panel global de la plataforma (super admin): pedidos de tienderu.com,
 * GMV/comisiones y liquidación manual a los tenants.
 */
@Controller('marketplace/admin')
@UseGuards(JwtAuthGuard, TenantContextGuard, SuperAdminGuard)
export class MarketplaceAdminController {
  constructor(private readonly orders: MarketplaceOrdersService) {}

  @Get('orders')
  listOrders(
    @Query('status') status?: string,
    @Query('tenant_id') tenantId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.orders.adminOrders(status, tenantId, parsePagination(page, limit, 20, 100));
  }

  @Get('summary')
  summary() {
    return this.orders.adminSummary();
  }

  @Get('payouts')
  async payouts() {
    const summary = await this.orders.adminSummary();
    return { tenants: summary.tenants };
  }

  @Patch('payouts/mark')
  markPayouts(@Body() body: MarketplacePayoutMarkDto) {
    return this.orders.adminMarkPayouts(body);
  }
}
