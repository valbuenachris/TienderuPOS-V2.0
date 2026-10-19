import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentsModule } from '../payments/payments.module';
import { SalesModule } from '../sales/sales.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MarketplaceAdminController } from './marketplace-admin.controller';
import { MarketplaceAuthController } from './marketplace-auth.controller';
import { MarketplaceBrandingService } from './marketplace-branding.service';
import { MarketplaceCatalogService } from './marketplace-catalog.service';
import { MarketplaceCustomerGuard } from './marketplace-customer.guard';
import { MarketplaceCustomerController } from './marketplace-customer.controller';
import { MarketplaceCustomersService } from './marketplace-customers.service';
import { MarketplaceMaintenanceService } from './marketplace-maintenance.service';
import { MarketplaceNotificationsService } from './marketplace-notifications.service';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { MarketplacePaymentsService } from './marketplace-payments.service';
import { MarketplacePublicController } from './marketplace-public.controller';
import { MarketplaceSettingsService } from './marketplace-settings.service';
import { MarketplaceTenantController } from './marketplace-tenant.controller';

@Module({
  imports: [AuthModule, CatalogModule, PaymentsModule, SalesModule, WhatsappModule],
  controllers: [
    MarketplacePublicController,
    MarketplaceAuthController,
    MarketplaceCustomerController,
    MarketplaceTenantController,
    MarketplaceAdminController
  ],
  providers: [
    MarketplaceSettingsService,
    MarketplaceCustomersService,
    MarketplaceCatalogService,
    MarketplaceOrdersService,
    MarketplacePaymentsService,
    MarketplaceBrandingService,
    MarketplaceMaintenanceService,
    MarketplaceNotificationsService,
    MarketplaceCustomerGuard
  ],
  exports: [MarketplacePaymentsService, MarketplaceSettingsService]
})
export class MarketplaceModule {}
