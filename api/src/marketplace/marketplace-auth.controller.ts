import { Body, Controller, Get, Ip, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { MarketplaceCustomerGuard } from './marketplace-customer.guard';
import { MarketplaceCustomersService } from './marketplace-customers.service';
import { MarketplaceLoginDto, MarketplaceRegisterDto } from './marketplace.dto';

@Controller('auth')
export class MarketplaceAuthController {
  constructor(private readonly customers: MarketplaceCustomersService) {}

  @Post('marketplace-register')
  register(@Body() body: MarketplaceRegisterDto, @Ip() ip: string) {
    return this.customers.register(body, ip || '');
  }

  @Post('marketplace-login')
  login(@Body() body: MarketplaceLoginDto, @Ip() ip: string) {
    return this.customers.login(body, ip || '');
  }

  @Get('marketplace-me')
  @UseGuards(JwtAuthGuard, MarketplaceCustomerGuard)
  me(@Req() request: PosRequest) {
    return {
      customer: request.posMarketplaceCustomer,
      role: 'marketplace_customer'
    };
  }
}
