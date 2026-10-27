import { Body, Controller, Get, Headers, HttpCode, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
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

  /**
   * Webhook de Sistecrédito (v0.12.6): confirmación server-to-server con JWT.
   * Responde SIEMPRE 200 con el acuse JSON que espera la pasarela
   * (`{function,errorCode,message,country,data{...}}`); solo `Terminado` liquida.
   */
  @Post('sistecredito')
  @HttpCode(200)
  handleSistecredito(@Body() payload: unknown) {
    return this.payments.handleSistecreditoWebhook(payload);
  }

  /**
   * Retorno del usuario desde el checkout de Sistecrédito (misma URL, GET con
   * `?transactionId=&orderId=`): verifica con `getInfoCredit` (liquida si está
   * aprobada, idempotente) y redirige al `return_url` del tenant (o al global).
   */
  @Get('sistecredito')
  async verifySistecreditoReturn(
    @Res() response: Response,
    @Query('transactionId') transactionId?: string,
    @Query('orderId') orderId?: string
  ): Promise<void> {
    const redirectUrl = await this.payments.verifySistecreditoReturn(orderId, transactionId);
    response.redirect(302, redirectUrl);
  }
}
