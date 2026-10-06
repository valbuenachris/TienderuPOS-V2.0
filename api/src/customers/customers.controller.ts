import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto';
import { CustomersService } from './customers.service';

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

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  return parseInteger(value, field);
}

@Controller('customers')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(
    @Req() request: PosRequest,
    @Query('q') search?: string,
    @Query('store_id') storeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const cleanSearch = search === undefined ? '' : search.trim().slice(0, 100);
    return this.customers.list(
      request.tenantId!,
      request.posUser!,
      cleanSearch,
      optionalInteger(storeId, 'store_id'),
      parsePagination(page, limit)
    );
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateCustomerDto) {
    return this.customers.create(request.tenantId!, request.posUser!, body);
  }

  @Put(':id')
  update(@Req() request: PosRequest, @Param('id') id: string, @Body() body: UpdateCustomerDto) {
    return this.customers.update(request.tenantId!, request.posUser!, parseInteger(id, 'id'), body);
  }
}
