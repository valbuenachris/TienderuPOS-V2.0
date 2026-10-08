import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantContextGuard, SuperAdminGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('global')
  global() {
    return this.dashboard.global();
  }
}
