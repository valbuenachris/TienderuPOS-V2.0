import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BoldWebhookController } from './bold.controller';
import { BoldService } from './bold.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [BillingController, BoldWebhookController],
  providers: [BillingService, BoldService]
})
export class BillingModule {}
