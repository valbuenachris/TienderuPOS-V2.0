import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { CustomerContextGuard } from '../auth/customer-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { PaymentsService } from './payments.service';

@Controller('customer/payment-methods')
@UseGuards(JwtAuthGuard, CustomerContextGuard)
export class PaymentMethodsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@Req() request: PosRequest) {
    return this.payments.listCustomerPaymentMethods(request.tenantId!, request.posCustomer!.id);
  }
}
