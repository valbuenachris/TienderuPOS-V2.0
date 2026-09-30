import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Req() request: PosRequest) {
    return this.users.list(request.tenantId!);
  }
}
