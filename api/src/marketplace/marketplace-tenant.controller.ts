import { Body, Controller, Get, Param, ParseIntPipe, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { MarketplaceOrderStatusDto, MarketplaceSettingsDto } from './marketplace.dto';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { MarketplaceSettingsService } from './marketplace-settings.service';

/**
 * Panel del vendedor (admin del tenant): opt-in, pedidos por despachar y resumen.
 */
@Controller('marketplace')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class MarketplaceTenantController {
  constructor(
    private readonly settings: MarketplaceSettingsService,
    private readonly orders: MarketplaceOrdersService
  ) {}

  @Get('settings')
  getSettings(@Req() request: PosRequest) {
    return this.settings.get(request.tenantId!);
  }

  @Put('settings')
  updateSettings(@Req() request: PosRequest, @Body() body: MarketplaceSettingsDto) {
    return this.settings.upsert(request.tenantId!, body);
  }

  @Get('orders')
  listOrders(
    @Req() request: PosRequest,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.orders.listTenantOrders(
      request.tenantId!,
      status,
      parsePagination(page, limit, 20, 100)
    );
  }

  @Get('orders/:id')
  orderDetail(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.orders.tenantOrderDetail(request.tenantId!, id);
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MarketplaceOrderStatusDto
  ) {
    return this.orders.updateTenantOrderStatus(request.tenantId!, id, body);
  }

  @Get('summary')
  summary(@Req() request: PosRequest) {
    return this.orders.tenantSummary(request.tenantId!);
  }
}
