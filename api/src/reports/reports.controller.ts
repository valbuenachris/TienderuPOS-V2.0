import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { ReportsService } from './reports.service';

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD`);
  }
  return value;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BadRequestException('limit must be an integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException('limit is outside the allowed range');
  }
  return parsed;
}

function defaultDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

@Controller('reports')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@Req() request: PosRequest, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.summary(
      request.tenantId!,
      from === undefined ? defaultDate(-29) : parseDate(from, 'from'),
      to === undefined ? defaultDate(0) : parseDate(to, 'to')
    );
  }

  @Get('top-products')
  topProducts(
    @Req() request: PosRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string
  ) {
    return this.reports.topProducts(
      request.tenantId!,
      from === undefined ? defaultDate(-29) : parseDate(from, 'from'),
      to === undefined ? defaultDate(0) : parseDate(to, 'to'),
      parseLimit(limit, 10, 50)
    );
  }
}
