import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [ExpensesController],
  providers: [ExpensesService]
})
export class ExpensesModule {}
