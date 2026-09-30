import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { CreateProductDto, SetStockDto, UpdateProductDto } from './product.dto';
import { ProductsService } from './products.service';

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

function parseSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new BadRequestException('q must be a string');
  return value.trim().slice(0, 100);
}

@Controller('products')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Req() request: PosRequest, @Query('store_id') storeId?: string, @Query('q') search?: string) {
    return this.products.list(request.tenantId!, parseInteger(storeId, 'store_id'), parseSearch(search));
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateProductDto) {
    return this.products.create(request.tenantId!, body);
  }

  @Put(':id')
  update(@Req() request: PosRequest, @Param('id') id: string, @Body() body: UpdateProductDto) {
    return this.products.update(request.tenantId!, parseInteger(id, 'id'), body);
  }

  @Put(':id/stock')
  setStock(@Req() request: PosRequest, @Param('id') id: string, @Body() body: SetStockDto) {
    return this.products.setStock(request.tenantId!, parseInteger(id, 'id'), body);
  }
}
