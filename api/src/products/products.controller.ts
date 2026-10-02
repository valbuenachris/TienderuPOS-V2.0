import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { CreateProductDto, SetStockDto, UpdateProductDto } from './product.dto';
import { ProductsService, ProductImageSlot } from './products.service';

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

function parseSlot(value: unknown): ProductImageSlot {
  if (value !== '1' && value !== '2' && value !== '3') {
    throw new BadRequestException('slot must be 1, 2 or 3');
  }
  return Number(value) as ProductImageSlot;
}

@Controller('products')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Req() request: PosRequest,
    @Query('store_id') storeId?: string,
    @Query('q') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.products.list(
      request.tenantId!,
      parseInteger(storeId, 'store_id'),
      parseSearch(search),
      parsePagination(page, limit)
    );
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

  @Post(':id/images/:slot')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }))
  uploadImage(
    @Req() request: PosRequest,
    @Param('id') id: string,
    @Param('slot') slot: string,
    @UploadedFile() file?: Express.Multer.File
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.products.uploadImage(request.tenantId!, parseInteger(id, 'id'), parseSlot(slot), file);
  }

  @Delete(':id/images/:slot')
  deleteImage(@Req() request: PosRequest, @Param('id') id: string, @Param('slot') slot: string) {
    return this.products.deleteImage(request.tenantId!, parseInteger(id, 'id'), parseSlot(slot));
  }
}
