import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CrmAutomationService } from './crm-automation.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  imports: [AuthModule, TenantManagementModule, WhatsappModule],
  controllers: [CrmController],
  providers: [CrmService, CrmAutomationService]
})
export class CrmModule {}
