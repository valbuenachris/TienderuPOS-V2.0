import { Body, Controller, Headers, HttpCode, Post, RawBodyRequest, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service';

@Controller('webhooks')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('addi')
  @HttpCode(200)
  async handleAddi(
    @Req() request: RawBodyRequest<Request>,
    @Body() payload: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    await this.payments.handleAddiWebhook(payload, authorization);
    // Regla de Oro de Addi: responder 200 con EXACTAMENTE el mismo JSON recibido.
    const raw = request.rawBody;
    if (raw && raw.length > 0) {
      response.status(200).type('application/json').send(raw);
    } else {
      response.status(200).json(payload);
    }
  }

  @Post('sistecredito')
  @HttpCode(200)
  handleSistecredito(@Body() payload: unknown, @Headers('x-webhook-secret') secret?: string) {
    return this.payments.handleSistecreditoWebhook(payload, secret);
  }
}
