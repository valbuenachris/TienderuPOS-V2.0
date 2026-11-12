import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [AuthModule, TenantManagementModule],
  controllers: [ProductsController],
  providers: [ProductsService]
})
export class ProductsModule {}
