import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { CreateSaleDto } from './sale.dto';
import { SalesService } from './sales.service';

function parsePage(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BadRequestException('Pagination values must be integers');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new BadRequestException('Pagination value is outside the allowed range');
  }
  return parsed;
}

function parseDate(value?: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Date must use YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Date is invalid');
  }
  return value;
}

@Controller('sales')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(
    @Req() request: PosRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.sales.list(
      request.tenantId!,
      request.posUser!,
      parseDate(from),
      parseDate(to),
      parsePage(limit, 50, 100),
      parsePage(offset, 0, 1000000)
    );
  }

  @Get('daily')
  daily(@Req() request: PosRequest, @Query('date') date?: string) {
    return this.sales.dailyReport(
      request.tenantId!,
      parseDate(date) ?? new Date().toISOString().slice(0, 10),
      request.posUser!
    );
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateSaleDto) {
    return this.sales.create(request.tenantId!, request.posUser!, body);
  }
}
