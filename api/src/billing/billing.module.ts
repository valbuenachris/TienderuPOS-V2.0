import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { PaymentsModule } from '../payments/payments.module';
import { SalesModule } from '../sales/sales.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BoldWebhookController } from './bold.controller';
import { BoldService } from './bold.service';

@Module({
  imports: [AuthModule, TenantManagementModule, SalesModule, PaymentsModule, MarketplaceModule],
  controllers: [BillingController, BoldWebhookController],
  providers: [BillingService, BoldService],
  exports: [BoldService]
})
export class BillingModule {}
