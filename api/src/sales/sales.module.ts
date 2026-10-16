import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CombosModule } from '../combos/combos.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [AuthModule, CombosModule, TenantManagementModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService]
})
export class SalesModule {}
