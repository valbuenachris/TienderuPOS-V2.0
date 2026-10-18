import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { EvolutionClient } from './evolution.client';
import { TenantWhatsappSettingsService } from './tenant-whatsapp-settings.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, EvolutionClient, TenantWhatsappSettingsService]
})
export class WhatsappModule {}
