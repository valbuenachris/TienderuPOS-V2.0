import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { CreateSupplierDto, UpdateSupplierDto } from './supplier.dto';
import { SuppliersService } from './suppliers.service';

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

@Controller('suppliers')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list(
    @Req() request: PosRequest,
    @Query('q') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const cleanSearch = search === undefined ? '' : search.trim().slice(0, 100);
    return this.suppliers.list(request.tenantId!, cleanSearch, parsePagination(page, limit));
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateSupplierDto) {
    return this.suppliers.create(request.tenantId!, body);
  }

  @Put(':id')
  update(@Req() request: PosRequest, @Param('id') id: string, @Body() body: UpdateSupplierDto) {
    return this.suppliers.update(request.tenantId!, parseInteger(id, 'id'), body);
  }
}
