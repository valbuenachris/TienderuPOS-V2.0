import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseEvolutionWebhook, tokenMatches } from '../whatsapp/evolution-webhook.util';
import { MarketplaceWhatsappAgentService } from './marketplace-whatsapp-agent.service';
import { MarketplaceWhatsappSettingsService } from './marketplace-whatsapp-settings.service';

/**
 * Webhook público de la instancia de WhatsApp de la PLATAFORMA (v0.12.0).
 * Evolution lo registra al activar el chatbot; procesa en segundo plano.
 */
@Controller('webhooks')
export class MarketplaceWhatsappWebhookController {
  private readonly logger = new Logger(MarketplaceWhatsappWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: MarketplaceWhatsappSettingsService,
    private readonly agent: MarketplaceWhatsappAgentService
  ) {}

  @Post('evolution-marketplace')
  @HttpCode(200)
  async handle(@Query('token') token: string | undefined, @Body() body: unknown) {
    const expected = this.config.get<string>('EVOLUTION_WEBHOOK_TOKEN')?.trim() ?? '';
    if (expected === '') {
      throw new ServiceUnavailableException('Webhook de WhatsApp no configurado (EVOLUTION_WEBHOOK_TOKEN).');
    }
    if (token === undefined || token === '' || !tokenMatches(token, expected)) {
      throw new UnauthorizedException('Token del webhook inválido');
    }

    if (!(await this.settings.tableExists())) return { received: true, ignored: true };
    const row = await this.settings.get();
    if (!row) return { received: true, ignored: true };

    const parsed = parseEvolutionWebhook(body);

    // Actualización de conexión: refresca el estado persistido.
    if (parsed.kind === 'connection') {
      await this.settings.updateStatus(
        parsed.state,
        parsed.state === 'open' ? new Date().toISOString() : null
      );
      return { received: true };
    }
    if (parsed.kind === 'ignored') return { received: true, ignored: true };

    // Mensajes enviados por el PERSONAL desde el teléfono (fromMe): pausan al bot.
    if (parsed.fromMe) {
      void this.agent
        .recordStaffMessage({
          phone: parsed.phone,
          messageId: parsed.messageId,
          text: parsed.text
        })
        .catch((error: unknown) => {
          this.logger.error(
            `No se pudo registrar el mensaje del personal de la plataforma (phone ${parsed.phone}): ${error instanceof Error ? error.message : 'unknown'}`
          );
        });
      return { received: true, ignored: true };
    }

    if (!row.agent_enabled) return { received: true, ignored: true };

    // Responder 200 ya y procesar en segundo plano (Evolution reintenta si tardamos).
    void this.agent
      .handleIncoming({
        instanceName: row.instance_name,
        agentName: row.agent_name ?? 'Asesor',
        agentTone: row.agent_tone ?? 'amable',
        phone: parsed.phone,
        pushName: parsed.pushName,
        text: parsed.text,
        messageId: parsed.messageId
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Bot del marketplace falló (phone ${parsed.phone}): ${error instanceof Error ? error.message : 'unknown'}`
        );
      });

    return { received: true };
  }
}
