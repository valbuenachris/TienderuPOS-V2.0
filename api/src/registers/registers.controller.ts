import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { CloseRegisterDto, OpenRegisterDto } from './register.dto';
import { RegistersService } from './registers.service';

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

function parseDate(value?: unknown): string {
  if (value === undefined || value === '') return new Date().toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Date must use YYYY-MM-DD');
  }
  return value;
}

@Controller('registers')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get()
  list(@Req() request: PosRequest, @Query('limit') limit?: string) {
    const parsed = limit === undefined ? 20 : parseInteger(limit, 'limit');
    return this.registers.list(request.tenantId!, request.posUser!, Math.min(parsed, 100));
  }

  @Get('current')
  current(@Req() request: PosRequest, @Query('store_id') storeId?: string) {
    return this.registers.current(request.tenantId!, request.posUser!, optionalInteger(storeId, 'store_id'));
  }

  @Get('summary')
  summary(@Req() request: PosRequest, @Query('date') date?: string, @Query('store_id') storeId?: string) {
    return this.registers.summary(
      request.tenantId!,
      request.posUser!,
      parseDate(date),
      optionalInteger(storeId, 'store_id')
    );
  }

  @Post('open')
  open(@Req() request: PosRequest, @Body() body: OpenRegisterDto) {
    return this.registers.open(request.tenantId!, request.posUser!, body);
  }

  @Post(':id/close')
  close(@Req() request: PosRequest, @Param('id') id: string, @Body() body: CloseRegisterDto) {
    return this.registers.close(request.tenantId!, request.posUser!, parseInteger(id, 'id'), body);
  }
}
