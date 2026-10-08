import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [BillingController],
  providers: [BillingService]
})
export class BillingModule {}
