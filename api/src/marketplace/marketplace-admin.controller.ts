import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { parsePagination } from '../common/pagination';
import { AdminBannerDto, AdminBrandingDto, MarketplacePayoutMarkDto } from './marketplace.dto';
import { MarketplaceBrandingService, UploadedBrandFiles } from './marketplace-branding.service';
import { MarketplaceOrdersService } from './marketplace-orders.service';

const FILE_LIMITS = { limits: { fileSize: 3 * 1024 * 1024 } };

/**
 * Panel global de la plataforma (super admin): pedidos de tienderu.com,
 * GMV/comisiones, liquidación manual a los tenants y marca/banners de la tienda.
 */
@Controller('marketplace/admin')
@UseGuards(JwtAuthGuard, TenantContextGuard, SuperAdminGuard)
export class MarketplaceAdminController {
  constructor(
    private readonly orders: MarketplaceOrdersService,
    private readonly branding: MarketplaceBrandingService
  ) {}

  @Get('orders')
  listOrders(
    @Query('status') status?: string,
    @Query('tenant_id') tenantId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.orders.adminOrders(status, tenantId, parsePagination(page, limit, 20, 100));
  }

  @Get('summary')
  summary() {
    return this.orders.adminSummary();
  }

  @Get('payouts')
  async payouts() {
    const summary = await this.orders.adminSummary();
    return { tenants: summary.tenants };
  }

  @Patch('payouts/mark')
  markPayouts(@Body() body: MarketplacePayoutMarkDto) {
    return this.orders.adminMarkPayouts(body);
  }

  // ---------------------------------------------------------------------------
  // Marca (logo, favicon y footer de tienderu.com)
  // ---------------------------------------------------------------------------

  @Get('branding')
  getBranding() {
    return this.branding.adminGetBranding();
  }

  @Put('branding')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'logo', maxCount: 1 },
        { name: 'favicon', maxCount: 1 }
      ],
      FILE_LIMITS
    )
  )
  updateBranding(@Body() body: AdminBrandingDto, @UploadedFiles() files: UploadedBrandFiles) {
    return this.branding.adminUpdateBranding(body, files ?? {});
  }

  // ---------------------------------------------------------------------------
  // Banners pequeños del home (fila de promos)
  // ---------------------------------------------------------------------------

  @Get('banners')
  listBanners() {
    return this.branding.adminListBanners();
  }

  @Post('banners')
  @UseInterceptors(FileInterceptor('file', FILE_LIMITS))
  createBanner(@Body() body: AdminBannerDto, @UploadedFile() file?: Express.Multer.File) {
    return this.branding.adminCreateBanner(body, file);
  }

  @Put('banners/:id')
  @UseInterceptors(FileInterceptor('file', FILE_LIMITS))
  updateBanner(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdminBannerDto,
    @UploadedFile() file?: Express.Multer.File
  ) {
    return this.branding.adminUpdateBanner(id, body, file);
  }

  @Delete('banners/:id')
  deleteBanner(@Param('id', ParseIntPipe) id: number) {
    return this.branding.adminDeleteBanner(id);
  }
}
