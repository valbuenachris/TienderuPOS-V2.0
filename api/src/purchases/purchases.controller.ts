import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { CreatePurchaseDto } from './purchase.dto';
import { PurchasesService } from './purchases.service';

function parseInteger(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return parsed;
}

function parseDate(value?: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Date must use YYYY-MM-DD');
  }
  return value;
}

@Controller('purchases')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list(
    @Req() request: PosRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.purchases.list(
      request.tenantId!,
      parseDate(from),
      parseDate(to),
      parsePagination(page, limit)
    );
  }

  @Get(':id')
  detail(@Req() request: PosRequest, @Param('id') id: string) {
    return this.purchases.detail(request.tenantId!, parseInteger(id, 'id'));
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreatePurchaseDto) {
    return this.purchases.create(request.tenantId!, request.posUser!, body);
  }
}
