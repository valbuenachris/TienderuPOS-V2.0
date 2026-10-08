import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AuthModule, TenantManagementModule, SettingsModule],
  controllers: [TenantsController],
  providers: [TenantsService]
})
export class TenantsModule {}
