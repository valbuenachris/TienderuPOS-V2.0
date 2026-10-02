import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { CreateUserDto, SetUserActiveDto, UpdateUserDto } from './user.dto';
import { UsersService } from './users.service';

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

@Controller('users')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @Req() request: PosRequest,
    @Query('q') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const cleanSearch = search === undefined ? '' : search.trim().slice(0, 100);
    return this.users.list(request.tenantId!, cleanSearch, parsePagination(page, limit));
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateUserDto) {
    return this.users.create(request.tenantId!, body);
  }

  @Put(':id')
  update(@Req() request: PosRequest, @Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.users.update(request.tenantId!, parseInteger(id, 'id'), body, request.posUser!);
  }

  @Patch(':id/active')
  setActive(@Req() request: PosRequest, @Param('id') id: string, @Body() body: SetUserActiveDto) {
    return this.users.setActive(request.tenantId!, parseInteger(id, 'id'), body.active, request.posUser!);
  }

  @Delete(':id')
  softDelete(@Req() request: PosRequest, @Param('id') id: string) {
    return this.users.setActive(request.tenantId!, parseInteger(id, 'id'), false, request.posUser!);
  }
}
