import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [PurchasesController],
  providers: [PurchasesService]
})
export class PurchasesModule {}
