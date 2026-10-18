import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { parsePagination } from '../common/pagination';
import { MarketplaceCatalogService } from './marketplace-catalog.service';
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
    private readonly settings: MarketplaceSettingsService
  ) {}

  @Get('config')
  config() {
    return {
      currency: 'COP',
      shipping_flat: this.settings.shippingFlatValue(),
      payment_enabled: this.settings.paymentEnabled()
    };
  }

  @Get('home')
  home() {
    return this.catalog.getHome();
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
