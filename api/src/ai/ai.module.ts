import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai.tools';
import { OpenRouterClient } from './openrouter.client';
import { TenantAiSettingsService } from './tenant-ai-settings.service';

@Module({
  imports: [AuthModule, ReportsModule, TenantManagementModule],
  controllers: [AiController],
  providers: [AiService, AiToolsService, OpenRouterClient, TenantAiSettingsService]
})
export class AiModule {}
