import { Controller, Get, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get(@Req() request: PosRequest) {
    const settings = await this.settings.getGlobalForTenant(request.tenantId!);
    if (!settings) throw new NotFoundException('Global POS settings are unavailable');
    return settings;
  }
}
