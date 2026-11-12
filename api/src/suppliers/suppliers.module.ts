import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [SuppliersController],
  providers: [SuppliersService]
})
export class SuppliersModule {}
