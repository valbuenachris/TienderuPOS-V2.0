import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantOperationalGuard } from '../auth/tenant-operational.guard';
import { AiChatDto, UpdateAiSettingsDto } from './ai.dto';
import { AiService } from './ai.service';

/** Asistente IA por tenant: solo administradores. La key de OpenRouter es global (.env). */
@Controller('ai')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard, TenantOperationalGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  settings(@Req() request: PosRequest) {
    return this.ai.settingsView(request.tenantId!);
  }

  @Put('settings')
  updateSettings(@Req() request: PosRequest, @Body() body: UpdateAiSettingsDto) {
    return this.ai.updateSettings(request.tenantId!, body);
  }

  @Get('models')
  models() {
    return this.ai.models();
  }

  @Post('chat')
  chat(@Req() request: PosRequest, @Body() body: AiChatDto) {
    return this.ai.chat(request.tenantId!, request.posUser!, body);
  }
}
