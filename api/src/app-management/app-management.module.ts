import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { AppManagementController } from './app-management.controller';
import { AppManagementService } from './app-management.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [AppManagementController],
  providers: [AppManagementService]
})
export class AppManagementModule {}
