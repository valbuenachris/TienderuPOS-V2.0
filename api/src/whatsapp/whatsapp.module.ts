import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SalesModule } from '../sales/sales.module';
import { SettingsModule } from '../settings/settings.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { EvolutionClient } from './evolution.client';
import { TenantWhatsappSettingsService } from './tenant-whatsapp-settings.service';
import { WhatsappAgentService } from './whatsapp-agent.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [AiModule, AuthModule, TenantManagementModule, SalesModule, SettingsModule],
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [WhatsappService, WhatsappAgentService, EvolutionClient, TenantWhatsappSettingsService],
  exports: [EvolutionClient, TenantWhatsappSettingsService]
})
export class WhatsappModule {}
