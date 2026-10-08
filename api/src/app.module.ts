import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CatalogModule } from './catalog/catalog.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HealthController } from './health.controller';
import { ProductsModule } from './products/products.module';
import { PurchasesModule } from './purchases/purchases.module';
import { RegistersModule } from './registers/registers.module';
import { ReportsModule } from './reports/reports.module';
import { SalesModule } from './sales/sales.module';
import { SettingsModule } from './settings/settings.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TenantManagementModule } from './tenant-management/tenant-management.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
      cache: true
    }),
    DatabaseModule,
    AuthModule,
    CatalogModule,
    SalesModule,
    SettingsModule,
    ProductsModule,
    CustomersModule,
    ExpensesModule,
    ReportsModule,
    UsersModule,
    SuppliersModule,
    PurchasesModule,
    RegistersModule,
    TenantsModule,
    TenantManagementModule,
    BillingModule,
    DashboardModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
