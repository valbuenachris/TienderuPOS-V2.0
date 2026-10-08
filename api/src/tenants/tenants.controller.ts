import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { CreateTenantDto, UpdateTenantDto } from './tenant.dto';
import { TenantsService } from './tenants.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTenantId(value: string): string {
  if (!UUID_RE.test(value)) throw new BadRequestException('id must be a UUID');
  return value.toLowerCase();
}

@Controller('tenants')
@UseGuards(JwtAuthGuard, TenantContextGuard, SuperAdminGuard)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateTenantDto) {
    return this.tenants.create(body, request.posUser?.id ?? null);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTenantDto) {
    return this.tenants.update(parseTenantId(id), body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() request: PosRequest, @Param('id') id: string): Promise<void> {
    await this.tenants.remove(request.tenantId!, parseTenantId(id), request.posUser?.id ?? null);
  }
}
