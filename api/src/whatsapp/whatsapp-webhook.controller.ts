import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseEvolutionWebhook, tokenMatches } from './evolution-webhook.util';
import { TenantWhatsappSettingsService } from './tenant-whatsapp-settings.service';
import { WhatsappAgentService } from './whatsapp-agent.service';

/** Webhook público de Evolution: valida token y dispara el bot en segundo plano. */
@Controller('webhooks')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: TenantWhatsappSettingsService,
    private readonly agent: WhatsappAgentService
  ) {}

  @Post('evolution/:instance')
  @HttpCode(200)
  async handle(
    @Param('instance') instance: string,
    @Query('token') token: string | undefined,
    @Body() body: unknown
  ) {
    const expected = this.config.get<string>('EVOLUTION_WEBHOOK_TOKEN')?.trim() ?? '';
    if (expected === '') {
      throw new ServiceUnavailableException('Webhook de WhatsApp no configurado (EVOLUTION_WEBHOOK_TOKEN).');
    }
    if (token === undefined || token === '' || !tokenMatches(token, expected)) {
      throw new UnauthorizedException('Token del webhook inválido');
    }

    const settings = await this.settings.getByInstanceName(instance);
    if (!settings) return { received: true, ignored: true };

    const parsed = parseEvolutionWebhook(body);

    // Actualización de conexión: refresca el estado persistido.
    if (parsed.kind === 'connection') {
      await this.settings.updateStatus(
        settings.tenantId,
        parsed.state,
        parsed.state === 'open' ? new Date().toISOString() : null
      );
      return { received: true };
    }
    if (parsed.kind === 'ignored') return { received: true, ignored: true };

    // Mensajes enviados por el PERSONAL desde el teléfono (fromMe): se registran para
    // pausar al bot mientras un humano atiende (y habilitar el auto-retorno después).
    if (parsed.fromMe) {
      void this.agent
        .recordStaffMessage({
          tenantId: settings.tenantId,
          phone: parsed.phone,
          messageId: parsed.messageId,
          text: parsed.text
        })
        .catch((error: unknown) => {
          this.logger.error(
            `No se pudo registrar el mensaje del personal (tenant ${settings.tenantId}, phone ${parsed.phone}): ${error instanceof Error ? error.message : 'unknown'}`
          );
        });
      return { received: true, ignored: true };
    }

    if (!settings.agentEnabled) return { received: true, ignored: true };

    // Responder 200 ya y procesar en segundo plano (Evolution reintenta si tardamos).
    void this.agent
      .handleIncoming({
        tenantId: settings.tenantId,
        instanceName: instance,
        agentName: settings.agentName ?? 'Asesor',
        agentTone: settings.agentTone,
        phone: parsed.phone,
        pushName: parsed.pushName,
        text: parsed.text,
        messageId: parsed.messageId
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Bot WhatsApp falló (tenant ${settings.tenantId}, phone ${parsed.phone}): ${error instanceof Error ? error.message : 'unknown'}`
        );
      });

    return { received: true };
  }
}
