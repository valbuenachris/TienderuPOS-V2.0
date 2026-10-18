import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesModule } from '../sales/sales.module';
import { AddiService } from './addi.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentsWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TenantBoldService } from './tenant-bold.service';
import { TenantPaymentSettingsService } from './tenant-payment-settings.service';

@Module({
  imports: [AuthModule, SalesModule],
  controllers: [PaymentsWebhookController, PaymentMethodsController],
  providers: [PaymentsService, TenantPaymentSettingsService, TenantBoldService, AddiService],
  exports: [PaymentsService]
})
export class PaymentsModule {}
