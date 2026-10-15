import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { CustomerContextGuard } from '../auth/customer-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { parsePagination } from '../common/pagination';
import { PaymentsService } from '../payments/payments.service';
import { SalesService } from '../sales/sales.service';
import { BannersService } from './banners.service';
import { CustomerCheckoutDto, CustomerCheckoutWithPaymentDto, RedeemProductDto, UpdateCustomerProfileDto } from './customer.dto';
import { CustomerService } from './customer.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^\d{1,10}$/;

// Acepta UUID (esquema de la migración v0.3.52) o id numérico (serial).
function parseOptionalCategoryId(value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  const id = value.trim();
  if (UUID_RE.test(id)) return id.toLowerCase();
  if (NUMERIC_ID_RE.test(id)) return id;
  throw new BadRequestException('category_id must be a UUID or a numeric id');
}

@Controller('customer')
@UseGuards(JwtAuthGuard, CustomerContextGuard)
export class CustomerController {
  constructor(
    private readonly customer: CustomerService,
    private readonly sales: SalesService,
    private readonly payments: PaymentsService,
    private readonly banners: BannersService
  ) {}

  @Get('banners')
  listBanners() {
    return this.banners.list();
  }

  @Get('profile')
  profile(@Req() request: PosRequest) {
    return this.customer.profile(request.tenantId!, request.posCustomer!);
  }

  @Put('profile')
  updateProfile(@Req() request: PosRequest, @Body() body: UpdateCustomerProfileDto) {
    return this.customer.updateProfile(request.tenantId!, request.posCustomer!.id, body);
  }

  @Get('stores')
  stores(@Req() request: PosRequest) {
    return this.customer.stores(request.tenantId!);
  }

  @Get('products')
  products(
    @Req() request: PosRequest,
    @Query('store_id', ParseIntPipe) storeId: number,
    @Query('q') search = '',
    @Query('category_id') categoryId?: string
  ) {
    return this.customer.products(
      request.tenantId!,
      storeId,
      (search || '').trim().slice(0, 100),
      parseOptionalCategoryId(categoryId)
    );
  }

  @Get('categories')
  categories(@Req() request: PosRequest) {
    return this.customer.categories(request.tenantId!);
  }

  @Get('rewards')
  rewards(@Req() request: PosRequest) {
    return this.customer.rewards(request.tenantId!);
  }

  @Get('orders')
  orders(@Req() request: PosRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.customer.orders(
      request.tenantId!,
      request.posCustomer!.id,
      parsePagination(page, limit, 20, 50)
    );
  }

  @Get('orders/:id')
  orderDetail(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.customer.orderDetail(request.tenantId!, request.posCustomer!.id, id);
  }

  @Post('checkout')
  checkout(@Req() request: PosRequest, @Body() body: CustomerCheckoutDto) {
    return this.sales.createForCustomer(request.tenantId!, request.posCustomer!, body);
  }

  @Post('checkout-with-payment')
  checkoutWithPayment(
    @Req() request: PosRequest,
    @Body() body: CustomerCheckoutWithPaymentDto
  ) {
    return this.payments.checkoutWithPayment(request.tenantId!, request.posCustomer!, body);
  }

  @Post('redeem')
  redeem(@Req() request: PosRequest, @Body() body: RedeemProductDto) {
    return this.customer.redeem(request.tenantId!, request.posCustomer!, body);
  }
}
