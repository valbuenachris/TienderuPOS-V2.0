import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { SalesModule } from '../sales/sales.module';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentsWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, BillingModule, SalesModule],
  controllers: [PaymentsWebhookController, PaymentMethodsController],
  providers: [PaymentsService],
  exports: [PaymentsService]
})
export class PaymentsModule {}
