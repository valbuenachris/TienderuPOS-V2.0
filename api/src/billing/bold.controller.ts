import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException
} from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { BoldService, BoldWebhookEvent } from './bold.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

@Controller('webhooks')
export class BoldWebhookController {
  constructor(
    private readonly bold: BoldService,
    private readonly billing: BillingService
  ) {}

  @Post('bold')
  @HttpCode(200)
  async handleBoldWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-bold-signature') signature?: string
  ) {
    if (!this.bold.isEnabled()) throw new ServiceUnavailableException('Bold no está configurado');
    const raw = request.rawBody ?? Buffer.from('');
    if (!this.bold.verifySignature(raw, signature)) {
      throw new BadRequestException('Invalid Bold signature');
    }
    let parsed: unknown = null;
    try {
      parsed = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : null;
    } catch (_error: unknown) {
      parsed = null;
    }
    if (!isRecord(parsed)) throw new BadRequestException('Invalid Bold payload');
    const event: BoldWebhookEvent = {
      id: readString(parsed.id) ?? undefined,
      type: readString(parsed.type) ?? undefined,
      subject: readString(parsed.subject) ?? undefined,
      data: isRecord(parsed.data) ? parsed.data : undefined
    };
    const result = await this.billing.handleBoldWebhook(event);
    return { received: true, handled: result.handled };
  }
}
