import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { CreateSaleDto, AddSalePaymentDto, UpdateSaleDto } from './sale.dto';
import { SalesService } from './sales.service';

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
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.sales.list(
      request.tenantId!,
      request.posUser!,
      parseDate(from),
      parseDate(to),
      parsePagination(page, limit, 20, 100)
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

  @Post(':id/payments')
  addPayment(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AddSalePaymentDto
  ) {
    return this.sales.addPayment(request.tenantId!, request.posUser!, id, body);
  }

  @Get(':id')
  detail(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.sales.detail(request.tenantId!, request.posUser!, id);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  update(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSaleDto
  ) {
    return this.sales.update(request.tenantId!, request.posUser!, id, body);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.sales.remove(request.tenantId!, request.posUser!, id);
  }
}
