import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('webhooks')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('addi')
  @HttpCode(200)
  handleAddi(@Body() payload: unknown, @Headers('x-webhook-secret') secret?: string) {
    return this.payments.handleFinancingWebhook('addi', payload, secret);
  }

  @Post('sistecredito')
  @HttpCode(200)
  handleSistecredito(@Body() payload: unknown, @Headers('x-webhook-secret') secret?: string) {
    return this.payments.handleFinancingWebhook('sistecredito', payload, secret);
  }
}
