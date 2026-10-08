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

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  return parseDate(value, field);
}

function parseGroup(value: unknown): 'day' | 'month' {
  if (value === undefined || value === 'day') return 'day';
  if (value === 'month') return 'month';
  throw new BadRequestException('group must be day or month');
}

@Controller('reports')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@Req() request: PosRequest, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.summary(request.tenantId!, optionalDate(from, 'from'), optionalDate(to, 'to'));
  }

  @Get('calendar')
  calendar(
    @Req() request: PosRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('group') group?: string
  ) {
    return this.reports.calendar(
      request.tenantId!,
      optionalDate(from, 'from'),
      optionalDate(to, 'to'),
      parseGroup(group)
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
      optionalDate(from, 'from'),
      optionalDate(to, 'to'),
      parseLimit(limit, 10, 50)
    );
  }
}
