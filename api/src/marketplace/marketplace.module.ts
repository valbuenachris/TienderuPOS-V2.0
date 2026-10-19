import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentsModule } from '../payments/payments.module';
import { SalesModule } from '../sales/sales.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MarketplaceAdminController } from './marketplace-admin.controller';
import { MarketplaceAuthController } from './marketplace-auth.controller';
import { MarketplaceBrandingService } from './marketplace-branding.service';
import { MarketplaceCatalogService } from './marketplace-catalog.service';
import { MarketplaceCouponsService } from './marketplace-coupons.service';
import { MarketplaceCustomerGuard } from './marketplace-customer.guard';
import { MarketplaceCustomerController } from './marketplace-customer.controller';
import { MarketplaceCustomersService } from './marketplace-customers.service';
import { MarketplaceMaintenanceService } from './marketplace-maintenance.service';
import { MarketplaceNotificationsService } from './marketplace-notifications.service';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { MarketplacePaymentsService } from './marketplace-payments.service';
import { MarketplacePublicController } from './marketplace-public.controller';
import { MarketplaceRateLimitService } from './marketplace-rate-limit.service';
import { MarketplaceReviewsService } from './marketplace-reviews.service';
import { MarketplaceSettingsService } from './marketplace-settings.service';
import { MarketplaceTenantController } from './marketplace-tenant.controller';
import { MarketplaceWhatsappAgentService } from './marketplace-whatsapp-agent.service';
import { MarketplaceWhatsappService } from './marketplace-whatsapp.service';
import { MarketplaceWhatsappSettingsService } from './marketplace-whatsapp-settings.service';
import { MarketplaceWhatsappWebhookController } from './marketplace-whatsapp-webhook.controller';

@Module({
  imports: [AiModule, AuthModule, CatalogModule, PaymentsModule, SalesModule, WhatsappModule],
  controllers: [
    MarketplacePublicController,
    MarketplaceAuthController,
    MarketplaceCustomerController,
    MarketplaceTenantController,
    MarketplaceAdminController,
    MarketplaceWhatsappWebhookController
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
    MarketplaceReviewsService,
    MarketplaceCouponsService,
    MarketplaceRateLimitService,
    MarketplaceWhatsappSettingsService,
    MarketplaceWhatsappService,
    MarketplaceWhatsappAgentService,
    MarketplaceCustomerGuard
  ],
  exports: [MarketplacePaymentsService, MarketplaceSettingsService]
})
export class MarketplaceModule {}
