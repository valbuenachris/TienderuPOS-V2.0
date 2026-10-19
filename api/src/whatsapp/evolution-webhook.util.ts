import { createHash, timingSafeEqual } from 'node:crypto';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Comparación timing-safe del token del webhook de Evolution. */
export function tokenMatches(received: string, expected: string): boolean {
  const a = createHash('sha256').update(received, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Texto útil del mensaje de Evolution (texto plano, caption, botones o listas). */
export function extractEvolutionText(data: Record<string, unknown> | null): string | null {
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

export type EvolutionWebhookEvent =
  | { kind: 'connection'; state: string }
  | {
      kind: 'message';
      phone: string;
      fromMe: boolean;
      messageId: string | null;
      pushName: string | null;
      text: string | null;
    }
  | { kind: 'ignored' };

/**
 * Normaliza el payload del webhook de Evolution compartido por el bot de tenants
 * y el bot de la plataforma (v0.12.0): eventos de conexión, mensajes 1:1 y el
 * resto se ignora (grupos, difusión, status).
 */
export function parseEvolutionWebhook(body: unknown): EvolutionWebhookEvent {
  if (!isRecord(body)) return { kind: 'ignored' };
  const event = String(body.event ?? '').toLowerCase();

  if (event === 'connection.update') {
    const data = isRecord(body.data) ? body.data : null;
    const state = data && typeof data.state === 'string' ? data.state.trim().toLowerCase() : null;
    if (state === null || state === '') return { kind: 'ignored' };
    return { kind: 'connection', state };
  }

  if (event !== 'messages.upsert') return { kind: 'ignored' };

  const data = isRecord(body.data) ? body.data : null;
  const key = data && isRecord(data.key) ? data.key : null;
  const remoteJid = key && typeof key.remoteJid === 'string' ? key.remoteJid : null;
  if (
    remoteJid === null ||
    remoteJid.includes('@g.us') ||
    remoteJid.includes('@broadcast') ||
    remoteJid.includes('status@')
  ) {
    return { kind: 'ignored' };
  }

  const phone = remoteJid.split('@')[0].replace(/\D/g, '');
  if (phone === '') return { kind: 'ignored' };

  return {
    kind: 'message',
    phone,
    fromMe: key?.fromMe === true,
    messageId: key && typeof key.id === 'string' ? key.id : null,
    pushName: data && typeof data.pushName === 'string' ? data.pushName : null,
    text: extractEvolutionText(data)
  };
}
