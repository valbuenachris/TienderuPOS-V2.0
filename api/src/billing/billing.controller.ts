import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RequestPaymentDto } from './billing.dto';
import { BillingService } from './billing.service';

@Controller('billing')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  listInvoices(@Req() request: PosRequest) {
    return this.billing.listInvoices(request.tenantId!);
  }

  @Get('current-invoice')
  currentInvoice(@Req() request: PosRequest) {
    return this.billing.currentInvoice(request.tenantId!);
  }

  @Post('pay')
  pay(@Req() request: PosRequest, @Body() body: RequestPaymentDto) {
    return this.billing.requestPayment(request.tenantId!, body, request.posUser?.id ?? null);
  }
}
