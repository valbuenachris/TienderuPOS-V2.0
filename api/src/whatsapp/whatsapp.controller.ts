import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantOperationalGuard } from '../auth/tenant-operational.guard';
import { WhatsappService } from './whatsapp.service';

/** WhatsApp por tenant (Evolution API): solo el admin de la tienda. */
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard, TenantOperationalGuard)
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Get('settings')
  settings(@Req() request: PosRequest) {
    return this.whatsapp.settingsView(request.tenantId!);
  }

  @Post('instance')
  createInstance(@Req() request: PosRequest) {
    return this.whatsapp.createInstance(request.tenantId!);
  }

  @Post('connect')
  connect(@Req() request: PosRequest) {
    return this.whatsapp.connect(request.tenantId!);
  }

  @Get('status')
  status(@Req() request: PosRequest) {
    return this.whatsapp.status(request.tenantId!);
  }

  @Post('disconnect')
  disconnect(@Req() request: PosRequest) {
    return this.whatsapp.disconnect(request.tenantId!);
  }
}
