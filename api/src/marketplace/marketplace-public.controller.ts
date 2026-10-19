import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parsePagination } from '../common/pagination';
import { MarketplaceBrandingService } from './marketplace-branding.service';
import { MarketplaceCatalogService } from './marketplace-catalog.service';
import { BANNER_CLICK_RATE_RULE, MarketplaceRateLimitService } from './marketplace-rate-limit.service';
import { MarketplaceSettingsService } from './marketplace-settings.service';

function readQueryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Catálogo público de tienderu.com (sin autenticación). Solo expone productos
 * publicables: tenants con opt-in activo, con stock y precio.
 */
@Controller('marketplace')
export class MarketplacePublicController {
  constructor(
    private readonly catalog: MarketplaceCatalogService,
    private readonly settings: MarketplaceSettingsService,
    private readonly branding: MarketplaceBrandingService,
    private readonly rateLimit: MarketplaceRateLimitService,
    private readonly configService: ConfigService
  ) {}

  @Get('config')
  async config() {
    return {
      currency: 'COP',
      shipping_flat: this.settings.shippingFlatValue(),
      payment_enabled: this.settings.paymentEnabled(),
      payment_ttl_minutes: this.settings.paymentTtlMinutes(),
      branding: await this.branding.getPublicBranding()
    };
  }

  @Get('home')
  async home() {
    const [home, promos] = await Promise.all([
      this.catalog.getHome(),
      this.branding.getActiveBanners()
    ]);
    return { ...home, promos };
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  sitemap() {
    const base = (
      this.configService.get<string>('MARKETPLACE_BASE_URL') ?? 'https://tienderu.com'
    ).replace(/\/+$/, '');
    return this.catalog.buildSitemap(base);
  }

  /** Métrica de clics de banners (v0.11.2); best-effort, sin datos del cliente. */
  @Post('banners/:id/click')
  @HttpCode(204)
  async bannerClick(@Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    this.rateLimit.assertWithin(`mp-banner:${ip || 'unknown'}`, BANNER_CLICK_RATE_RULE);
    await this.branding.recordBannerClick(id);
  }

  @Get('categories')
  categories() {
    return this.catalog.listCategories();
  }

  @Get('sellers/:tenantId')
  seller(
    @Param('tenantId') tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.catalog.getSeller(tenantId, parsePagination(page, limit, 24, 48));
  }

  @Get('products')
  products(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('tenant') tenant?: string,
    @Query('min_price') minPrice?: string,
    @Query('max_price') maxPrice?: string,
    @Query('min_rating') minRating?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const pagination = parsePagination(page, limit, 24, 48);
    return this.catalog.listProducts(
      {
        q: readQueryString(q),
        category: readQueryString(category),
        tenant: readQueryString(tenant),
        minPrice: readQueryString(minPrice),
        maxPrice: readQueryString(maxPrice),
        minRating: readQueryString(minRating),
        sort: readQueryString(sort)
      },
      pagination
    );
  }

  @Get('products/:id')
  product(@Param('id', ParseIntPipe) id: number) {
    if (id < 1) throw new BadRequestException('Invalid product id');
    return this.catalog.getProduct(id);
  }

  @Get('products/:id/reviews')
  reviews(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    if (id < 1) throw new BadRequestException('Invalid product id');
    return this.catalog.listReviews(id, parsePagination(page, limit, 10, 50));
  }
}
