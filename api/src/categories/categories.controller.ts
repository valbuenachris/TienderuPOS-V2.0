import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^\d{1,10}$/;

// Acepta UUID (esquema de la migración) o id numérico (tablas creadas con serial).
function parseCategoryId(value: string): string {
  const id = value.trim();
  if (UUID_RE.test(id)) return id.toLowerCase();
  if (NUMERIC_ID_RE.test(id)) return id;
  throw new BadRequestException(`id must be a UUID (received: "${id.slice(0, 60)}")`);
}

@Controller('categories')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@Req() request: PosRequest) {
    return this.categories.list(request.tenantId!);
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateCategoryDto) {
    return this.categories.create(request.tenantId!, body);
  }

  @Put(':id')
  update(@Req() request: PosRequest, @Param('id') id: string, @Body() body: UpdateCategoryDto) {
    return this.categories.update(request.tenantId!, parseCategoryId(id), body);
  }

  @Delete(':id')
  remove(@Req() request: PosRequest, @Param('id') id: string) {
    return this.categories.remove(request.tenantId!, parseCategoryId(id));
  }
}
