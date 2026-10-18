import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantTimezoneService } from '../common/tenant-timezone.service';
import { DatabaseService } from '../database/database.service';
import { EvolutionClient } from '../whatsapp/evolution.client';
import { TenantWhatsappSettingsService } from '../whatsapp/tenant-whatsapp-settings.service';

const RUN_INTERVAL_MS = 15 * 60 * 1000;
const MIGRATION_HINT = 'Ejecuta docs/migrations/v0.7.0-crm.sql';

type AutomationRow = {
  id: number;
  tenant_id: string;
  name: string;
  trigger: string;
  delay_hours: number;
  template_id: number | null;
  template_body: string | null;
};

type Candidate = {
  lead_id: number;
  phone: string;
  name: string | null;
  sale_id?: number;
  total?: string;
  pending?: string;
};

/** Motor de automatizaciones del CRM: bienvenida, reactivación, cobro y post-venta. */
@Injectable()
export class CrmAutomationService implements OnModuleInit {
  private readonly logger = new Logger(CrmAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ready = false;
  private lastReadyCheck = 0;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly client: EvolutionClient,
    private readonly whatsappSettings: TenantWhatsappSettingsService,
    private readonly timezone: TenantTimezoneService
  ) {}

  async onModuleInit(): Promise<void> {
    const ready = await this.ensureReady(true);
    if (!ready) {
      this.logger.warn(`tec_crm_automations no existe; automatizaciones del CRM deshabilitadas. ${MIGRATION_HINT}.`);
      return;
    }
    void this.runAll();
    this.timer = setInterval(() => {
      void this.runAll();
    }, RUN_INTERVAL_MS);
    this.timer.unref();
  }

  private async ensureReady(force = false): Promise<boolean> {
    if (this.ready) return true;
    const now = Date.now();
    if (!force && now - this.lastReadyCheck < 30000) return false;
    this.lastReadyCheck = now;
    try {
      const result = await this.database.query<{ exists: boolean }>(
        "SELECT to_regclass('public.tec_crm_automations') IS NOT NULL AS exists"
      );
      this.ready = result.rows[0]?.exists === true;
    } catch (_error: unknown) {
      this.ready = false;
    }
    if (this.ready) this.logger.log('CRM detectado; motor de automatizaciones activo (cada 15 min)');
    return this.ready;
  }

  /** Ejecuta todas las automatizaciones habilitadas + sincroniza ventas pagadas hacia leads. */
  async runAll(): Promise<void> {
    if (this.running) return;
    if (!(await this.ensureReady())) return;
    this.running = true;
    try {
      await this.syncPaidSales();
      const automations = await this.database.query<AutomationRow>(
        `SELECT a.id, a.tenant_id::text AS tenant_id, a.name, a.trigger, a.delay_hours, a.template_id,
                t.body AS template_body
         FROM public.tec_crm_automations a
         JOIN public.tec_crm_templates t ON t.id = a.template_id AND t.tenant_id = a.tenant_id
         WHERE a.enabled = true
         ORDER BY a.id ASC`
      );
      for (const automation of automations.rows) {
        try {
          await this.runAutomation(automation);
        } catch (error: unknown) {
          this.logger.warn(
            `CRM automatización #${automation.id} falló: ${error instanceof Error ? error.message : 'unknown'}`
          );
        }
      }
    } catch (error: unknown) {
      this.logger.error(`CRM runAll falló: ${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      this.running = false;
    }
  }

  private async runAutomation(automation: AutomationRow): Promise<void> {
    // Guardrail 1: ventana horaria en la zona del tenant.
    const timezone = await this.timezone.forTenant(automation.tenant_id);
    const hour = this.hourInTimeZone(timezone);
    const startHour = this.configInt('CRM_AUTOMATION_START_HOUR', 8);
    const endHour = this.configInt('CRM_AUTOMATION_END_HOUR', 19);
    if (hour < startHour || hour >= endHour) return;

    // Guardrail 2: cupo diario por tienda.
    const dailyLimit = this.configInt('CRM_AUTOMATION_DAILY_LIMIT', 50);
    const sentLast24h = await this.countAutomationSends(automation.tenant_id);
    if (sentLast24h >= dailyLimit) return;

    // Guardrail 3: WhatsApp conectado.
    if (!this.client.isConfigured()) return;
    const settings = await this.whatsappSettings.getForTenant(automation.tenant_id);
    if (!settings) return;
    const state = await this.client.connectionState(settings.instanceName);
    if (state !== 'open') return;

    const tenant = await this.database.query<{ name: string }>(
      'SELECT name FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [automation.tenant_id]
    );
    const storeName = tenant.rows[0]?.name ?? 'la tienda';

    const candidates = await this.findCandidates(automation);
    let sent = 0;
    const remaining = dailyLimit - sentLast24h;
    for (const candidate of candidates) {
      if (sent >= remaining) break;
      const message = this.renderTemplate(automation.template_body ?? '', {
        nombre: candidate.name?.trim() || 'cliente',
        tienda: storeName,
        total_pedido: candidate.total ?? '',
        pendiente: candidate.pending ?? '',
        pedido: candidate.sale_id === undefined ? '' : `#${candidate.sale_id}`
      });
      if (message.trim() === '') continue;
      try {
        await this.client.sendText(settings.instanceName, candidate.phone, message);
      } catch (error: unknown) {
        this.logger.warn(
          `CRM automatización ${automation.trigger}: no se pudo enviar a ${candidate.phone}: ${error instanceof Error ? error.message : 'unknown'}`
        );
        continue;
      }
      await this.database.query(
        `INSERT INTO public.tec_whatsapp_messages (tenant_id, phone, direction, message_id, body)
         VALUES ($1, $2, 'out', NULL, $3)`,
        [automation.tenant_id, candidate.phone, message]
      );
      await this.database.query(
        `UPDATE public.tec_whatsapp_conversations SET last_message_at = now() WHERE tenant_id = $1 AND phone = $2`,
        [automation.tenant_id, candidate.phone]
      );
      await this.database.query(
        `INSERT INTO public.tec_crm_activities (tenant_id, lead_id, type, content, created_by)
         VALUES ($1, $2, 'automation', $3, NULL)`,
        [automation.tenant_id, candidate.lead_id, `[auto:${automation.trigger}] ${message}`]
      );
      await this.database.query(
        `UPDATE public.tec_crm_leads SET last_activity_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [automation.tenant_id, candidate.lead_id]
      );
      if (automation.trigger === 'new_lead') {
        await this.database.query(
          `UPDATE public.tec_crm_leads SET stage = 'contacted'
           WHERE tenant_id = $1 AND id = $2 AND stage = 'new'`,
          [automation.tenant_id, candidate.lead_id]
        );
      }
      sent += 1;
      this.logger.log(
        `CRM automatización ${automation.trigger} → lead #${candidate.lead_id} (tenant ${automation.tenant_id})`
      );
    }
    if (sent > 0) {
      await this.database.query('UPDATE public.tec_crm_automations SET last_run_at = now() WHERE id = $1', [automation.id]);
    }
  }

  private async findCandidates(automation: AutomationRow): Promise<Candidate[]> {
    // Guardrail 4: máximo 1 automatizado por cliente cada 24 h.
    const notRecentlyAutomated = `AND NOT EXISTS (
      SELECT 1 FROM public.tec_crm_activities x
      WHERE x.lead_id = l.id AND x.type = 'automation' AND x.created_at > now() - INTERVAL '24 hours')`;

    switch (automation.trigger) {
      case 'new_lead': {
        const result = await this.database.query<Candidate>(
          `SELECT l.id AS lead_id, l.phone, l.name
           FROM public.tec_crm_leads l
           WHERE l.tenant_id = $1 AND l.stage = 'new' AND l.opt_out = false
             AND COALESCE(l.last_activity_at, l.created_at) < now() - make_interval(hours => $2::int)
             ${notRecentlyAutomated}
           ORDER BY l.id ASC
           LIMIT 20`,
          [automation.tenant_id, automation.delay_hours]
        );
        return result.rows;
      }
      case 'inactive_customer': {
        const result = await this.database.query<Candidate>(
          `SELECT l.id AS lead_id, l.phone, l.name, MAX(s.created_at)::text AS last_sale
           FROM public.tec_crm_leads l
           JOIN public.tec_sales s
             ON s.customer_id = l.customer_id AND s.tenant_id = l.tenant_id AND s.status IN ('paid', 'partial')
           WHERE l.tenant_id = $1 AND l.customer_id IS NOT NULL AND l.opt_out = false
             ${notRecentlyAutomated}
           GROUP BY l.id
           HAVING MAX(s.created_at) < now() - make_interval(hours => $2::int)
           ORDER BY MAX(s.created_at) ASC
           LIMIT 20`,
          [automation.tenant_id, automation.delay_hours]
        );
        return result.rows;
      }
      case 'due_order': {
        const result = await this.database.query<Candidate>(
          `SELECT l.id AS lead_id, l.phone, l.name, s.id AS sale_id,
                  s.grand_total::text AS total, (s.grand_total - COALESCE(s.paid, 0))::text AS pending
           FROM public.tec_crm_leads l
           JOIN public.tec_sales s
             ON s.customer_id = l.customer_id AND s.tenant_id = l.tenant_id AND s.status IN ('due', 'partial')
           WHERE l.tenant_id = $1 AND l.customer_id IS NOT NULL AND l.opt_out = false
             AND s.created_at < now() - make_interval(hours => $2::int)
             ${notRecentlyAutomated}
           ORDER BY s.created_at ASC
           LIMIT 20`,
          [automation.tenant_id, automation.delay_hours]
        );
        return result.rows;
      }
      case 'post_sale': {
        const result = await this.database.query<Candidate>(
          `SELECT l.id AS lead_id, l.phone, l.name, first.sale_id, first.total
           FROM public.tec_crm_leads l
           JOIN LATERAL (
             SELECT s.id AS sale_id, s.grand_total::text AS total, s.created_at
             FROM public.tec_sales s
             WHERE s.customer_id = l.customer_id AND s.tenant_id = l.tenant_id AND s.status IN ('paid', 'partial')
             ORDER BY s.created_at ASC
             LIMIT 1
           ) first ON true
           WHERE l.tenant_id = $1 AND l.customer_id IS NOT NULL AND l.opt_out = false
             AND first.created_at < now() - make_interval(hours => $2::int)
             AND first.created_at > now() - make_interval(hours => $2::int + 48)
             AND NOT EXISTS (
               SELECT 1 FROM public.tec_crm_activities x
               WHERE x.lead_id = l.id AND x.type = 'automation' AND x.content LIKE '[auto:post_sale]%')
           ORDER BY first.created_at ASC
           LIMIT 20`,
          [automation.tenant_id, automation.delay_hours]
        );
        return result.rows;
      }
      default:
        return [];
    }
  }

  /** Ventas pagadas nuevas → actividad `[venta]`, etapa `won` y +20 de score (best-effort). */
  private async syncPaidSales(): Promise<void> {
    const result = await this.database.query<{
      lead_id: number;
      tenant_id: string;
      sales_count: number;
      total: string;
    }>(
      `SELECT l.id AS lead_id, l.tenant_id::text AS tenant_id,
              COUNT(s.id)::integer AS sales_count, COALESCE(SUM(s.grand_total), 0)::text AS total
       FROM public.tec_crm_leads l
       JOIN public.tec_sales s
         ON s.customer_id = l.customer_id AND s.tenant_id = l.tenant_id AND s.status IN ('paid', 'partial')
        AND s.created_at > GREATEST(COALESCE(l.last_activity_at, l.created_at), l.created_at)
       WHERE l.customer_id IS NOT NULL
       GROUP BY l.id, l.tenant_id
       LIMIT 200`
    );
    for (const row of result.rows) {
      await this.database.query(
        `INSERT INTO public.tec_crm_activities (tenant_id, lead_id, type, content, created_by)
         VALUES ($1, $2, 'note', $3, NULL)`,
        [row.tenant_id, row.lead_id, `[venta] ${row.sales_count} compra(s) por $${Number(row.total).toLocaleString('es-CO')}`]
      );
      await this.database.query(
        `UPDATE public.tec_crm_leads
         SET stage = CASE WHEN stage IN ('won', 'lost') THEN stage ELSE 'won' END,
             score = LEAST(score + 20, 10000),
             last_activity_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [row.tenant_id, row.lead_id]
      );
    }
    if (result.rows.length > 0) {
      this.logger.log(`CRM: ${result.rows.length} lead(s) actualizados por ventas pagadas`);
    }
  }

  private async countAutomationSends(tenantId: string): Promise<number> {
    const result = await this.database.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM public.tec_crm_activities
       WHERE tenant_id = $1 AND type = 'automation' AND created_at > now() - INTERVAL '24 hours'`,
      [tenantId]
    );
    return result.rows[0]?.count ?? 0;
  }

  private renderTemplate(body: string, vars: Record<string, string>): string {
    return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? '');
  }

  private hourInTimeZone(timeZone: string): number {
    try {
      const formatted = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(new Date());
      return Number(formatted) % 24;
    } catch (_error: unknown) {
      return new Date().getHours();
    }
  }

  private configInt(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key) ?? '');
    return Number.isSafeInteger(raw) && raw > 0 ? raw : fallback;
  }
}
