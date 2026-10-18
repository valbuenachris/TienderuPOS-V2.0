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
import { createHash, timingSafeEqual } from 'node:crypto';
import { TenantWhatsappSettingsService } from './tenant-whatsapp-settings.service';
import { WhatsappAgentService } from './whatsapp-agent.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Comparación timing-safe del token del webhook. */
function tokenMatches(received: string, expected: string): boolean {
  const a = createHash('sha256').update(received, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function extractText(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const message = isRecord(data.message) ? data.message : null;
  if (!message) return null;
  const candidates: unknown[] = [
    message.conversation,
    isRecord(message.extendedTextMessage) ? message.extendedTextMessage.text : null,
    isRecord(message.imageMessage) ? message.imageMessage.caption : null,
    isRecord(message.videoMessage) ? message.videoMessage.caption : null,
    isRecord(message.buttonsResponseMessage) ? message.buttonsResponseMessage.selectedDisplayText : null,
    isRecord(message.listResponseMessage) ? message.listResponseMessage.title : null
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim().slice(0, 2000);
  }
  return null;
}

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
    if (!isRecord(body)) return { received: true, ignored: true };

    const event = String(body.event ?? '').toLowerCase();

    // Actualización de conexión: refresca el estado persistido.
    if (event === 'connection.update') {
      const data = isRecord(body.data) ? body.data : null;
      const state = data && typeof data.state === 'string' ? data.state.trim().toLowerCase() : null;
      if (state !== null && state !== '') {
        await this.settings.updateStatus(settings.tenantId, state, state === 'open' ? new Date().toISOString() : null);
      }
      return { received: true };
    }

    if (event !== 'messages.upsert') return { received: true, ignored: true };

    const data = isRecord(body.data) ? body.data : null;
    const key = data && isRecord(data.key) ? data.key : null;
    const remoteJid = key && typeof key.remoteJid === 'string' ? key.remoteJid : null;
    const fromMe = key?.fromMe === true;
    if (
      remoteJid === null ||
      remoteJid.includes('@g.us') ||
      remoteJid.includes('@broadcast') ||
      remoteJid.includes('status@')
    ) {
      return { received: true, ignored: true };
    }

    const phone = remoteJid.split('@')[0].replace(/\D/g, '');
    if (phone === '') return { received: true, ignored: true };

    const messageId = key && typeof key.id === 'string' ? key.id : null;
    const pushName = data && typeof data.pushName === 'string' ? data.pushName : null;

    // Mensajes enviados por el PERSONAL desde el teléfono (fromMe): se registran para
    // pausar al bot mientras un humano atiende (y habilitar el auto-retorno después).
    if (fromMe) {
      void this.agent
        .recordStaffMessage({ tenantId: settings.tenantId, phone, messageId, text: extractText(data) })
        .catch((error: unknown) => {
          this.logger.error(
            `No se pudo registrar el mensaje del personal (tenant ${settings.tenantId}, phone ${phone}): ${error instanceof Error ? error.message : 'unknown'}`
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
        phone,
        pushName,
        text: extractText(data),
        messageId
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Bot WhatsApp falló (tenant ${settings.tenantId}, phone ${phone}): ${error instanceof Error ? error.message : 'unknown'}`
        );
      });

    return { received: true };
  }
}
