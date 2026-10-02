import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { CreateExpenseDto, UpdateExpenseDto } from './expense.dto';
import { ExpensesService } from './expenses.service';

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

@Controller('expenses')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(
    @Req() request: PosRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.expenses.list(
      request.tenantId!,
      parseDate(from),
      parseDate(to),
      parsePagination(page, limit)
    );
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateExpenseDto) {
    return this.expenses.create(request.tenantId!, request.posUser!.id, body);
  }

  @Put(':id')
  update(@Req() request: PosRequest, @Param('id') id: string, @Body() body: UpdateExpenseDto) {
    return this.expenses.update(request.tenantId!, parseInteger(id, 'id'), body);
  }
}
