import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { DatabaseService } from '../database/database.service';
import { EvolutionClient } from '../whatsapp/evolution.client';
import { TenantWhatsappSettingsService } from '../whatsapp/tenant-whatsapp-settings.service';
import {
  AutomationDto,
  CreateActivityDto,
  CreateLeadDto,
  LEAD_SOURCES,
  LEAD_STAGES,
  SendLeadMessageDto,
  TemplateDto,
  UpdateLeadDto
} from './crm.dto';

type LeadRow = {
  id: number;
  tenant_id: string;
  customer_id: number | null;
  name: string | null;
  phone: string;
  email: string | null;
  source: string;
  stage: string;
  score: number;
  owner_id: number | null;
  opt_out: boolean;
  last_activity_at: string | null;
  next_followup_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const LEAD_COLUMNS = `id, tenant_id::text AS tenant_id, customer_id, name, phone, email, source, stage, score,
                      owner_id, opt_out, last_activity_at::text AS last_activity_at,
                      next_followup_at::text AS next_followup_at, created_at::text AS created_at,
                      updated_at::text AS updated_at`;

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw new BadRequestException('phone debe ser un teléfono válido (7 a 15 dígitos)');
  }
  return digits;
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly client: EvolutionClient,
    private readonly whatsappSettings: TenantWhatsappSettingsService
  ) {}

  // ===== Leads =====

  async listLeads(
    tenantId: string,
    query: { stage?: string; source?: string; q?: string; overdue?: boolean; pagination: PaginationQuery }
  ): Promise<Paginated<LeadRow>> {
    const values: unknown[] = [tenantId];
    let filters = '';
    if (query.stage !== undefined && query.stage !== '') {
      if (!LEAD_STAGES.includes(query.stage)) throw new BadRequestException('stage inválido');
      values.push(query.stage);
      filters += ` AND stage = $${values.length}`;
    }
    if (query.source !== undefined && query.source !== '') {
      if (!LEAD_SOURCES.includes(query.source)) throw new BadRequestException('source inválido');
      values.push(query.source);
      filters += ` AND source = $${values.length}`;
    }
    if (query.q !== undefined && query.q !== '') {
      values.push(`%${escapeLike(query.q)}%`);
      const index = values.length;
      filters += ` AND (name ILIKE $${index} OR phone ILIKE $${index} OR email ILIKE $${index})`;
    }
    if (query.overdue === true) {
      filters += ' AND next_followup_at IS NOT NULL AND next_followup_at < now()';
    }
    values.push(query.pagination.limit, query.pagination.offset);
    const result = await this.database.query<LeadRow & { total_count: number }>(
      `SELECT ${LEAD_COLUMNS}, COUNT(*) OVER() AS total_count
       FROM public.tec_crm_leads
       WHERE tenant_id = $1${filters}
       ORDER BY
         CASE WHEN next_followup_at IS NOT NULL AND next_followup_at < now() THEN 0 ELSE 1 END,
         next_followup_at ASC NULLS LAST,
         COALESCE(last_activity_at, created_at) DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, query.pagination);
  }

  async createLead(tenantId: string, input: CreateLeadDto): Promise<LeadRow> {
    const phone = normalizePhone(input.phone);
    const existing = await this.database.query<{ id: number }>(
      'SELECT id FROM public.tec_crm_leads WHERE tenant_id = $1 AND phone = $2 LIMIT 1',
      [tenantId, phone]
    );
    if (existing.rows[0]) {
      throw new BadRequestException(`Ya existe un lead con ese teléfono (#${existing.rows[0].id})`);
    }
    const result = await this.database.query<LeadRow>(
      `INSERT INTO public.tec_crm_leads
         (tenant_id, name, phone, email, source, stage, owner_id, next_followup_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING ${LEAD_COLUMNS}`,
      [
        tenantId,
        input.name?.trim() || null,
        phone,
        input.email?.trim().toLowerCase() || null,
        input.source ?? 'manual',
        input.stage ?? 'new',
        input.owner_id ?? null,
        input.next_followup_at ?? null
      ]
    );
    this.logger.log(`CRM lead creado: #${result.rows[0].id} (tenant ${tenantId})`);
    return result.rows[0];
  }

  async getLead(tenantId: string, leadId: number) {
    const lead = await this.requireLead(tenantId, leadId);

    const [customer, activities, conversation, sales] = await Promise.all([
      lead.customer_id === null
        ? Promise.resolve(null)
        : this.database.query<{
            id: number;
            name: string | null;
            email: string | null;
            phone: string | null;
            points_balance: number;
          }>(
            `SELECT id, name, email, phone, COALESCE(points_balance, 0) AS points_balance
             FROM public.tec_customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
            [tenantId, lead.customer_id]
          ),
      this.database.query<{
        id: number;
        type: string;
        content: string | null;
        due_at: string | null;
        completed_at: string | null;
        created_by: number | null;
        created_at: string | null;
      }>(
        `SELECT id, type, content, due_at::text AS due_at, completed_at::text AS completed_at,
                created_by, created_at::text AS created_at
         FROM public.tec_crm_activities
         WHERE tenant_id = $1 AND lead_id = $2
         ORDER BY id DESC
         LIMIT 100`,
        [tenantId, leadId]
      ),
      this.database.query<{ id: number; direction: string; body: string | null; created_at: string | null }>(
        `SELECT id, direction, body, created_at::text AS created_at
         FROM public.tec_whatsapp_messages
         WHERE tenant_id = $1 AND phone = $2
         ORDER BY id DESC
         LIMIT 60`,
        [tenantId, lead.phone]
      ),
      lead.customer_id === null
        ? Promise.resolve(null)
        : this.database.query<{
            id: number;
            grand_total: string | null;
            paid: string | null;
            status: string | null;
            created_at: string | null;
          }>(
            `SELECT id, grand_total::text AS grand_total, paid::text AS paid, status, created_at::text AS created_at
             FROM public.tec_sales
             WHERE tenant_id = $1 AND customer_id = $2
             ORDER BY created_at DESC, id DESC
             LIMIT 10`,
            [tenantId, lead.customer_id]
          )
    ]);

    return {
      lead,
      customer: customer?.rows[0] ?? null,
      activities: activities.rows,
      conversation: conversation.rows.reverse(),
      recent_sales: sales?.rows ?? []
    };
  }

  async updateLead(
    tenantId: string,
    userId: number | null,
    leadId: number,
    input: UpdateLeadDto
  ): Promise<LeadRow> {
    const lead = await this.requireLead(tenantId, leadId);

    const sets: string[] = [];
    const values: unknown[] = [tenantId, leadId];
    const push = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (input.name !== undefined) push('name', input.name.trim() || null);
    if (input.email !== undefined) push('email', input.email.trim().toLowerCase() || null);
    if (input.score !== undefined) push('score', input.score);
    if (input.owner_id !== undefined) push('owner_id', input.owner_id);
    if (input.opt_out !== undefined) push('opt_out', input.opt_out);
    if (input.next_followup_at !== undefined) push('next_followup_at', input.next_followup_at);
    if (input.stage !== undefined && input.stage !== lead.stage) {
      push('stage', input.stage);
    }
    sets.push('updated_at = now()', 'last_activity_at = now()');
    const result = await this.database.query<LeadRow>(
      `UPDATE public.tec_crm_leads
       SET ${sets.join(', ')}
       WHERE tenant_id = $1 AND id = $2
       RETURNING ${LEAD_COLUMNS}`,
      values
    );

    if (input.stage !== undefined && input.stage !== lead.stage) {
      await this.database.query(
        `INSERT INTO public.tec_crm_activities (tenant_id, lead_id, type, content, created_by)
         VALUES ($1, $2, 'stage_change', $3, $4)`,
        [tenantId, leadId, `Etapa: ${lead.stage} → ${input.stage}`, userId]
      );
    }
    return result.rows[0];
  }

  // ===== Actividades / tareas =====

  async addActivity(tenantId: string, userId: number | null, leadId: number, input: CreateActivityDto) {
    await this.requireLead(tenantId, leadId);
    if (input.type === 'task' && (input.due_at === undefined || input.due_at === null)) {
      throw new BadRequestException('Las tareas requieren due_at');
    }
    const result = await this.database.query<{ id: number }>(
      `INSERT INTO public.tec_crm_activities (tenant_id, lead_id, type, content, due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tenantId, leadId, input.type, input.content.trim(), input.due_at ?? null, userId]
    );
    await this.database.query(
      `UPDATE public.tec_crm_leads
       SET last_activity_at = now(), updated_at = now(),
           next_followup_at = CASE WHEN $3::timestamptz IS NOT NULL THEN $3::timestamptz ELSE next_followup_at END
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, leadId, input.type === 'task' ? input.due_at ?? null : null]
    );
    return { id: result.rows[0].id };
  }

  async completeActivity(tenantId: string, leadId: number, activityId: number) {
    const result = await this.database.query<{ id: number }>(
      `UPDATE public.tec_crm_activities
       SET completed_at = now()
       WHERE tenant_id = $1 AND lead_id = $2 AND id = $3
       RETURNING id`,
      [tenantId, leadId, activityId]
    );
    if (!result.rows[0]) throw new NotFoundException('Actividad no encontrada');
    return { id: result.rows[0].id, completed: true };
  }

  // ===== Mensaje manual por WhatsApp (pausa el bot en ese chat) =====

  async sendMessage(tenantId: string, userId: number | null, leadId: number, input: SendLeadMessageDto) {
    const lead = await this.requireLead(tenantId, leadId);
    if (!this.client.isConfigured()) {
      throw new BadRequestException('El servidor de WhatsApp (Evolution) no está configurado.');
    }
    const settings = await this.whatsappSettings.getForTenant(tenantId);
    if (!settings) {
      throw new BadRequestException('Esta tienda no tiene una instancia de WhatsApp; créala en la sección WhatsApp.');
    }
    const state = await this.client.connectionState(settings.instanceName);
    if (state !== 'open') {
      throw new BadRequestException('El WhatsApp de la tienda no está conectado; conéctalo para enviar mensajes.');
    }

    const text = input.content.trim().slice(0, 2000);
    // message_id sintético: cuenta como actividad del personal (pausa el bot y alimenta el auto-retorno).
    const staffMessageId = `crm-${leadId}-${Date.now().toString(36)}`;
    await this.client.sendText(settings.instanceName, lead.phone, text);

    await this.database.query(
      `INSERT INTO public.tec_whatsapp_messages (tenant_id, phone, direction, message_id, body)
       VALUES ($1, $2, 'out', $3, $4)`,
      [tenantId, lead.phone, staffMessageId, text]
    );
    await this.database.query(
      `INSERT INTO public.tec_whatsapp_conversations (tenant_id, phone, status, last_message_at)
       VALUES ($1, $2, 'human', now())
       ON CONFLICT (tenant_id, phone) DO UPDATE SET status = 'human', last_message_at = now()`,
      [tenantId, lead.phone]
    );
    await this.database.query(
      `INSERT INTO public.tec_crm_activities (tenant_id, lead_id, type, content, created_by)
       VALUES ($1, $2, 'whatsapp_out', $3, $4)`,
      [tenantId, leadId, text, userId]
    );
    await this.database.query(
      `UPDATE public.tec_crm_leads SET last_activity_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, leadId]
    );
    return { sent: true, paused_bot: true };
  }

  // ===== Plantillas =====

  async listTemplates(tenantId: string) {
    const result = await this.database.query(
      `SELECT id, name, body, created_at::text AS created_at, updated_at::text AS updated_at
       FROM public.tec_crm_templates WHERE tenant_id = $1 ORDER BY name ASC LIMIT 200`,
      [tenantId]
    );
    return result.rows;
  }

  async createTemplate(tenantId: string, input: TemplateDto) {
    const result = await this.database.query<{ id: number }>(
      `INSERT INTO public.tec_crm_templates (tenant_id, name, body)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, input.name.trim(), input.body.trim()]
    );
    return { id: result.rows[0].id };
  }

  async updateTemplate(tenantId: string, templateId: number, input: TemplateDto) {
    const result = await this.database.query<{ id: number }>(
      `UPDATE public.tec_crm_templates SET name = $3, body = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, templateId, input.name.trim(), input.body.trim()]
    );
    if (!result.rows[0]) throw new NotFoundException('Plantilla no encontrada');
    return { id: templateId, updated: true };
  }

  async deleteTemplate(tenantId: string, templateId: number) {
    const used = await this.database.query<{ id: number }>(
      `SELECT id FROM public.tec_crm_automations WHERE tenant_id = $1 AND template_id = $2 LIMIT 1`,
      [tenantId, templateId]
    );
    if (used.rows[0]) throw new BadRequestException('La plantilla está en uso por una automatización');
    const result = await this.database.query(
      'DELETE FROM public.tec_crm_templates WHERE tenant_id = $1 AND id = $2',
      [tenantId, templateId]
    );
    if (result.rowCount === 0) throw new NotFoundException('Plantilla no encontrada');
    return { deleted: true };
  }

  // ===== Automatizaciones =====

  async listAutomations(tenantId: string) {
    const result = await this.database.query(
      `SELECT a.id, a.name, a.trigger, a.delay_hours, a.template_id, a.enabled,
              a.last_run_at::text AS last_run_at, t.name AS template_name
       FROM public.tec_crm_automations a
       LEFT JOIN public.tec_crm_templates t ON t.id = a.template_id AND t.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1
       ORDER BY a.id DESC LIMIT 100`,
      [tenantId]
    );
    return result.rows;
  }

  async createAutomation(tenantId: string, input: AutomationDto) {
    if (input.template_id !== undefined) await this.assertTemplate(tenantId, input.template_id);
    const result = await this.database.query<{ id: number }>(
      `INSERT INTO public.tec_crm_automations (tenant_id, name, trigger, delay_hours, template_id, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, input.name.trim(), input.trigger, input.delay_hours, input.template_id ?? null, input.enabled ?? false]
    );
    return { id: result.rows[0].id };
  }

  async updateAutomation(tenantId: string, automationId: number, input: AutomationDto) {
    if (input.template_id !== undefined) await this.assertTemplate(tenantId, input.template_id);
    const result = await this.database.query<{ id: number }>(
      `UPDATE public.tec_crm_automations
       SET name = $3, trigger = $4, delay_hours = $5, template_id = $6, enabled = $7
       WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [
        tenantId,
        automationId,
        input.name.trim(),
        input.trigger,
        input.delay_hours,
        input.template_id ?? null,
        input.enabled ?? false
      ]
    );
    if (!result.rows[0]) throw new NotFoundException('Automatización no encontrada');
    return { id: automationId, updated: true };
  }

  async deleteAutomation(tenantId: string, automationId: number) {
    const result = await this.database.query(
      'DELETE FROM public.tec_crm_automations WHERE tenant_id = $1 AND id = $2',
      [tenantId, automationId]
    );
    if (result.rowCount === 0) throw new NotFoundException('Automatización no encontrada');
    return { deleted: true };
  }

  // ===== KPIs =====

  async summary(tenantId: string) {
    const [byStage, month, overdue, sends] = await Promise.all([
      this.database.query<{ stage: string; count: number }>(
        `SELECT stage, COUNT(*)::integer AS count FROM public.tec_crm_leads
         WHERE tenant_id = $1 GROUP BY stage`,
        [tenantId]
      ),
      this.database.query<{ created: number; won: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::integer AS created,
           COUNT(*) FILTER (WHERE stage = 'won' AND updated_at >= date_trunc('month', now()))::integer AS won
         FROM public.tec_crm_leads WHERE tenant_id = $1`,
        [tenantId]
      ),
      this.database.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM public.tec_crm_activities
         WHERE tenant_id = $1 AND type = 'task' AND completed_at IS NULL AND due_at IS NOT NULL AND due_at < now()`,
        [tenantId]
      ),
      this.database.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM public.tec_crm_activities
         WHERE tenant_id = $1 AND type = 'automation' AND created_at > now() - INTERVAL '7 days'`,
        [tenantId]
      )
    ]);
    const stages: Record<string, number> = {};
    for (const stage of LEAD_STAGES) stages[stage] = 0;
    for (const row of byStage.rows) stages[row.stage] = row.count;
    const total = Object.values(stages).reduce((sum, value) => sum + value, 0);
    const won = stages.won ?? 0;
    return {
      by_stage: stages,
      total,
      new_this_month: month.rows[0]?.created ?? 0,
      won_this_month: month.rows[0]?.won ?? 0,
      conversion: total > 0 ? Number(((won / total) * 100).toFixed(1)) : 0,
      overdue_tasks: overdue.rows[0]?.count ?? 0,
      automation_sends_7d: sends.rows[0]?.count ?? 0
    };
  }

  // ===== Helpers =====

  async requireLead(tenantId: string, leadId: number): Promise<LeadRow> {
    const result = await this.database.query<LeadRow>(
      `SELECT ${LEAD_COLUMNS} FROM public.tec_crm_leads WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, leadId]
    );
    const lead = result.rows[0];
    if (!lead) throw new NotFoundException('Lead no encontrado');
    return lead;
  }

  private async assertTemplate(tenantId: string, templateId: number): Promise<void> {
    const result = await this.database.query<{ id: number }>(
      'SELECT id FROM public.tec_crm_templates WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, templateId]
    );
    if (!result.rows[0]) throw new NotFoundException('Plantilla no encontrada');
  }
}
