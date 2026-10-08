import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementController } from './tenant-management.controller';
import { TenantManagementService } from './tenant-management.service';

@Module({
  imports: [AuthModule],
  controllers: [TenantManagementController],
  providers: [TenantManagementService],
  exports: [TenantManagementService]
})
export class TenantManagementModule {}
