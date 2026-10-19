import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { parsePagination } from '../common/pagination';
import { MarketplaceCustomerGuard } from './marketplace-customer.guard';
import { MarketplaceCustomersService } from './marketplace-customers.service';
import {
  MarketplaceAccountUpdateDto,
  MarketplaceAddressDto,
  MarketplaceAddressUpdateDto,
  MarketplaceCheckoutDto,
  MarketplacePasswordChangeDto,
  MarketplaceReviewCreateDto
} from './marketplace.dto';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { MarketplaceReviewsService } from './marketplace-reviews.service';

@Controller('marketplace')
@UseGuards(JwtAuthGuard, MarketplaceCustomerGuard)
export class MarketplaceCustomerController {
  constructor(
    private readonly customers: MarketplaceCustomersService,
    private readonly orders: MarketplaceOrdersService,
    private readonly reviews: MarketplaceReviewsService
  ) {}

  @Get('account')
  account(@Req() request: PosRequest) {
    return this.customers.profile(request.posMarketplaceCustomer!.id);
  }

  @Put('account')
  updateAccount(@Req() request: PosRequest, @Body() body: MarketplaceAccountUpdateDto) {
    return this.customers.updateProfile(request.posMarketplaceCustomer!.id, body);
  }

  @Put('account/password')
  changePassword(@Req() request: PosRequest, @Body() body: MarketplacePasswordChangeDto) {
    return this.customers.changePassword(
      request.posMarketplaceCustomer!.id,
      body.current_password,
      body.new_password
    );
  }

  @Get('addresses')
  listAddresses(@Req() request: PosRequest) {
    return this.customers.listAddresses(request.posMarketplaceCustomer!.id);
  }

  @Post('addresses')
  createAddress(@Req() request: PosRequest, @Body() body: MarketplaceAddressDto) {
    return this.customers.createAddress(request.posMarketplaceCustomer!.id, body);
  }

  @Put('addresses/:id')
  updateAddress(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MarketplaceAddressUpdateDto
  ) {
    return this.customers.updateAddress(request.posMarketplaceCustomer!.id, id, body);
  }

  @Put('addresses/:id/set-default')
  setDefaultAddress(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.customers.setDefaultAddress(request.posMarketplaceCustomer!.id, id);
  }

  @Delete('addresses/:id')
  removeAddress(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.customers.removeAddress(request.posMarketplaceCustomer!.id, id);
  }

  @Post('checkout')
  checkout(@Req() request: PosRequest, @Body() body: MarketplaceCheckoutDto) {
    return this.orders.checkout(request.posMarketplaceCustomer!, body);
  }

  @Get('account/orders')
  listOrders(
    @Req() request: PosRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.orders.listCustomerOrders(
      request.posMarketplaceCustomer!.id,
      parsePagination(page, limit, 10, 50)
    );
  }

  @Get('account/orders/:id')
  orderDetail(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.orders.customerOrderDetail(request.posMarketplaceCustomer!.id, id);
  }

  @Post('orders/:id/pay')
  payOrder(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.orders.payOrder(request.posMarketplaceCustomer!.id, id);
  }

  @Post('orders/:id/cancel')
  cancelOrder(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.orders.cancelCustomerOrder(request.posMarketplaceCustomer!.id, id);
  }

  @Post('products/:id/reviews')
  createReview(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MarketplaceReviewCreateDto
  ) {
    return this.reviews.create(request.posMarketplaceCustomer!.id, id, body.rating, body.comment);
  }

  @Get('products/:id/my-review')
  myReview(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.reviews.getMyReviewContext(request.posMarketplaceCustomer!.id, id);
  }
}
