import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { RegistersController } from './registers.controller';
import { RegistersService } from './registers.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [RegistersController],
  providers: [RegistersService]
})
export class RegistersModule {}
