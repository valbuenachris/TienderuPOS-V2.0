import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { AppManagementService } from './app-management.service';
import { AdjustPointsDto, CreateBannerDto, UpdateDeliveryStatusDto } from './app-management.dto';

function parseInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new BadRequestException(`${field} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return parsed;
}

// Los banners usan bigint: se valida numérico y se pasa como string a PostgreSQL.
function parseBannerId(value: string): string {
  const id = value.trim();
  if (!/^\d{1,19}$/.test(id)) throw new BadRequestException('id must be a numeric id');
  return id;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class AppManagementController {
  constructor(private readonly appManagement: AppManagementService) {}

  @Get('app-orders')
  listAppOrders(@Req() request: PosRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.appManagement.listAppOrders(request.tenantId!, parsePagination(page, limit));
  }

  @Patch('app-orders/:id/delivery')
  updateDelivery(
    @Req() request: PosRequest,
    @Param('id') id: string,
    @Body() body: UpdateDeliveryStatusDto
  ) {
    return this.appManagement.updateOrderDelivery(request.tenantId!, parseInteger(id, 'id'), body);
  }

  @Get('app-customers')
  listAppCustomers(
    @Req() request: PosRequest,
    @Query('q') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.appManagement.listAppCustomers(
      request.tenantId!,
      (search ?? '').trim().slice(0, 100),
      parsePagination(page, limit)
    );
  }

  @Patch('customers/:id/points')
  adjustPoints(@Req() request: PosRequest, @Param('id') id: string, @Body() body: AdjustPointsDto) {
    return this.appManagement.adjustCustomerPoints(request.tenantId!, parseInteger(id, 'id'), body);
  }

  @Post('customers/:id/reset-password')
  resetPassword(@Req() request: PosRequest, @Param('id') id: string) {
    return this.appManagement.resetCustomerPassword(request.tenantId!, parseInteger(id, 'id'));
  }

  @Get('reviews')
  listReviews(@Req() request: PosRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.appManagement.listReviews(request.tenantId!, parsePagination(page, limit));
  }

  @Delete('reviews/:id')
  deleteReview(@Req() request: PosRequest, @Param('id') id: string) {
    return this.appManagement.deleteReview(request.tenantId!, parseInteger(id, 'id'));
  }

  @Get('banners')
  listBanners() {
    return this.appManagement.listBanners();
  }

  @Post('banners')
  createBanner(@Body() body: CreateBannerDto) {
    return this.appManagement.createBanner(body);
  }

  @Delete('banners/:id')
  deleteBanner(@Param('id') id: string) {
    return this.appManagement.deleteBanner(parseBannerId(id));
  }
}
