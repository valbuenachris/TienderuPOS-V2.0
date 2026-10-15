import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CategoriesModule } from '../categories/categories.module';
import { PaymentsModule } from '../payments/payments.module';
import { SalesModule } from '../sales/sales.module';
import { SettingsModule } from '../settings/settings.module';
import { TenantManagementModule } from '../tenant-management/tenant-management.module';
import { BannersService } from './banners.service';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  imports: [AuthModule, CatalogModule, CategoriesModule, SalesModule, PaymentsModule, SettingsModule, TenantManagementModule],
  controllers: [CustomerController],
  providers: [CustomerService, BannersService]
})
export class CustomerModule {}
