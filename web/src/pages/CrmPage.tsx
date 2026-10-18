import { useMemo, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import {
  useApiMutation,
  useCrmAutomationsQuery,
  useCrmLeadQuery,
  useCrmLeadsQuery,
  useCrmSummaryQuery,
  useCrmTemplatesQuery
} from '../pos-queries';
import {
  addCrmActivity,
  completeCrmActivity,
  createCrmAutomation,
  createCrmLead,
  createCrmTemplate,
  deleteCrmAutomation,
  deleteCrmTemplate,
  sendCrmMessage,
  updateCrmAutomation,
  updateCrmLead,
  updateCrmTemplate
} from '../api';
import type { CrmActivity, CrmAutomation, CrmLead, CrmTemplate } from '../api';
import { saleStatusLabel } from '../payments';
import { formatDate, formatMoney } from '../format';

const STAGES: Array<{ value: string; label: string; badge: string }> = [
  { value: 'new', label: 'Nuevo', badge: 'badge none' },
  { value: 'contacted', label: 'Contactado', badge: 'badge staff' },
  { value: 'qualified', label: 'Cualificado', badge: 'badge partial' },
  { value: 'proposal', label: 'Propuesta', badge: 'badge partial' },
  { value: 'won', label: 'Ganado', badge: 'badge paid' },
  { value: 'lost', label: 'Perdido', badge: 'badge due' }
];

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  manual: 'Manual',
  pos: 'POS'
};

const TRIGGERS: Array<{ value: string; label: string }> = [
  { value: 'new_lead', label: 'Bienvenida (lead nuevo)' },
  { value: 'inactive_customer', label: 'Reactivación (cliente sin compra)' },
  { value: 'due_order', label: 'Recordatorio de pago (pedido Debida)' },
  { value: 'post_sale', label: 'Post-venta (gracias tras 1ª compra)' }
];

const ACTIVITY_META: Record<string, string> = {
  note: '📝',
  call: '📞',
  task: '✅',
  whatsapp_out: '💬',
  stage_change: '🔀',
  automation: '🤖'
};

const stageMeta = (stage: string) => STAGES.find((item) => item.value === stage) ?? STAGES[0];

function isOverdue(lead: Pick<CrmLead, 'next_followup_at'>): boolean {
  return lead.next_followup_at !== null && new Date(lead.next_followup_at).getTime() < Date.now();
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function delayLabel(hours: number): string {
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 día' : `${days} días`;
}

export default function CrmPage() {
  const { token, tenantId } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pipeline' | 'list' | 'templates' | 'automations'>('pipeline');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);

  const summaryQuery = useCrmSummaryQuery(token, tenantId);
  const pipelineQuery = useCrmLeadsQuery(token, tenantId, { limit: 100 }, tab === 'pipeline');
  const summary = summaryQuery.data;

  const moveMutation = useApiMutation((input: { id: number; stage: string }) =>
    updateCrmLead(input.id, { stage: input.stage })
  );

  const pipelineLeads = pipelineQuery.data?.data ?? [];
  const byStage = useMemo(() => {
    const map = new Map<string, CrmLead[]>();
    for (const stage of STAGES) map.set(stage.value, []);
    for (const lead of pipelineLeads) {
      const list = map.get(lead.stage) ?? map.get('new')!;
      list.push(lead);
    }
    return map;
  }, [pipelineLeads]);

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['crm-leads'] }),
      queryClient.invalidateQueries({ queryKey: ['crm-summary'] })
    ]);
  }

  function moveLead(id: number, stage: string) {
    setError('');
    moveMutation.mutate({ id, stage }, {
      onSuccess: async () => {
        setNotice('Etapa actualizada.');
        await invalidateAll();
      },
      onError: (mutationError: Error) => setError(mutationError.message)
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="VENTAS"
        title="CRM"
        actions={<button className="primary" type="button" onClick={() => setNewLeadOpen(true)}>+ Nuevo lead</button>}
      />
      <Panel className="stack full-width">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        <div className="stat-grid">
          <article className="stat-card"><span>Leads totales</span><strong>{summary?.total ?? '—'}</strong><small>En el pipeline</small></article>
          <article className="stat-card"><span>Nuevos este mes</span><strong>{summary?.new_this_month ?? '—'}</strong><small>Seguimientos frescos</small></article>
          <article className="stat-card"><span>Ganados este mes</span><strong>{summary?.won_this_month ?? '—'}</strong><small>Conversión {summary?.conversion ?? 0}%</small></article>
          <article className={`stat-card ${summary && summary.overdue_tasks > 0 ? 'money' : ''}`}><span>Tareas vencidas</span><strong className={summary && summary.overdue_tasks > 0 ? 'text-danger' : ''}>{summary?.overdue_tasks ?? '—'}</strong><small>Seguimientos atrasados</small></article>
          <article className="stat-card"><span>Enviados por automatización</span><strong>{summary?.automation_sends_7d ?? '—'}</strong><small>Últimos 7 días</small></article>
        </div>

        <div className="tabs">
          <button type="button" className={`tab ${tab === 'pipeline' ? 'active' : ''}`} onClick={() => setTab('pipeline')}>Pipeline</button>
          <button type="button" className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>Lista</button>
          <button type="button" className={`tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>Plantillas</button>
          <button type="button" className={`tab ${tab === 'automations' ? 'active' : ''}`} onClick={() => setTab('automations')}>Automatizaciones</button>
        </div>

        {tab === 'pipeline' ? (
          pipelineQuery.isPending ? <div className="empty">Cargando pipeline…</div> : (
            <div className="crm-kanban">
              {STAGES.map((stage) => {
                const leads = byStage.get(stage.value) ?? [];
                return (
                  <div
                    key={stage.value}
                    className="crm-column"
                    onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
                    onDrop={(event: DragEvent<HTMLDivElement>) => {
                      event.preventDefault();
                      const id = Number(event.dataTransfer.getData('text/plain'));
                      if (Number.isSafeInteger(id) && id > 0) moveLead(id, stage.value);
                    }}
                  >
                    <div className="crm-column-head">
                      <span>{stage.label}</span>
                      <span>{leads.length}</span>
                    </div>
                    {leads.map((lead) => (
                      <div
                        key={lead.id}
                        className="crm-card"
                        draggable
                        onDragStart={(event: DragEvent<HTMLDivElement>) => event.dataTransfer.setData('text/plain', String(lead.id))}
                        onClick={() => setDetailId(lead.id)}
                      >
                        <strong>{lead.name || lead.phone}</strong>
                        <small>{lead.phone} · {SOURCE_LABELS[lead.source] ?? lead.source}</small>
                        <div className="crm-card-meta">
                          <span className="crm-score">{lead.score} pts</span>
                          {isOverdue(lead) ? <small className="crm-due">⏰ Seguimiento vencido</small> : null}
                        </div>
                      </div>
                    ))}
                    {leads.length === 0 ? <div className="empty" style={{ padding: '10px 6px' }}>Sin leads</div> : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}

        {tab === 'list' ? <LeadsList onOpen={setDetailId} /> : null}
        {tab === 'templates' ? <TemplatesTab /> : null}
        {tab === 'automations' ? <AutomationsTab /> : null}
      </Panel>

      {newLeadOpen ? (
        <NewLeadModal
          onClose={() => setNewLeadOpen(false)}
          onCreated={async () => {
            setNewLeadOpen(false);
            setNotice('Lead creado.');
            await invalidateAll();
          }}
        />
      ) : null}

      {detailId !== null ? (
        <LeadDetailModal
          leadId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={async () => {
            await invalidateAll();
          }}
        />
      ) : null}
    </>
  );
}

// ===== Lista =====

function LeadsList({ onOpen }: { onOpen: (id: number) => void }) {
  const { token, tenantId } = useSession();
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);

  const leadsQuery = useCrmLeadsQuery(token, tenantId, {
    stage: stage === '' ? undefined : stage,
    q: appliedQ === '' ? undefined : appliedQ,
    overdue: overdue ? 'true' : undefined,
    page,
    limit: 30
  });

  const rows = leadsQuery.data?.data ?? [];
  const meta = leadsQuery.data?.meta;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedQ(q.trim());
  }

  return (
    <div className="stack">
      <form className="toolbar" onSubmit={submit}>
        <label>Etapa
          <select value={stage} onChange={(event) => { setStage(event.target.value); setPage(1); }}>
            <option value="">Todas</option>
            {STAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>Buscar
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Nombre, teléfono o correo…" maxLength={100} />
        </label>
        <label className="checkbox-label" style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={overdue} onChange={(event) => { setOverdue(event.target.checked); setPage(1); }} />
          Solo seguimientos vencidos
        </label>
        <button className="primary" type="submit" disabled={leadsQuery.isFetching}>Buscar</button>
      </form>
      {leadsQuery.isError ? <Notice tone="error">No fue posible cargar los leads.</Notice> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>#</th><th>Lead</th><th>Teléfono</th><th>Etapa</th><th>Score</th><th>Próximo seguimiento</th><th>Fuente</th></tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <tr key={lead.id} onClick={() => onOpen(lead.id)} style={{ cursor: 'pointer' }}>
                <td>{lead.id}</td>
                <td><strong>{lead.name || 'Sin nombre'}</strong></td>
                <td>{lead.phone}</td>
                <td><span className={stageMeta(lead.stage).badge}>{stageMeta(lead.stage).label}</span></td>
                <td>{lead.score}</td>
                <td className={isOverdue(lead) ? 'text-danger' : ''}>
                  {lead.next_followup_at ? formatDate(lead.next_followup_at) : '—'}
                </td>
                <td>{SOURCE_LABELS[lead.source] ?? lead.source}</td>
              </tr>
            ))}
            {rows.length === 0 && !leadsQuery.isPending ? (
              <tr><td colSpan={7} className="empty">No hay leads{appliedQ ? ` para “${appliedQ}”` : ''}.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={meta?.totalPages ?? 0} total={meta?.total ?? 0} onChange={setPage} />
    </div>
  );
}

// ===== Detalle =====

function LeadDetailModal({
  leadId,
  onClose,
  onChanged
}: {
  leadId: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { token, tenantId, settings } = useSession();
  const queryClient = useQueryClient();
  const currency = settings?.currency_prefix || 'COP';
  const detailQuery = useCrmLeadQuery(token, tenantId, leadId);
  const detail = detailQuery.data;

  const [infoDraft, setInfoDraft] = useState<Record<string, string | number | boolean> | null>(null);
  const [reply, setReply] = useState('');
  const [activityType, setActivityType] = useState('note');
  const [activityContent, setActivityContent] = useState('');
  const [activityDue, setActivityDue] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const lead = detail?.lead ?? null;
  const info = infoDraft ?? {
    name: lead?.name ?? '',
    email: lead?.email ?? '',
    score: String(lead?.score ?? 0),
    stage: lead?.stage ?? 'new',
    optOut: lead?.opt_out ?? false,
    followup: toLocalInput(lead?.next_followup_at ?? null)
  };

  const saveMutation = useApiMutation((input: { id: number; payload: Parameters<typeof updateCrmLead>[1] }) =>
    updateCrmLead(input.id, input.payload)
  );
  const sendMutation = useApiMutation((input: { id: number; content: string }) => sendCrmMessage(input.id, input.content));
  const activityMutation = useApiMutation((input: { id: number; type: string; content: string; due_at?: string }) =>
    addCrmActivity(input.id, { type: input.type, content: input.content, ...(input.due_at ? { due_at: input.due_at } : {}) })
  );
  const completeMutation = useApiMutation((input: { leadId: number; activityId: number }) =>
    completeCrmActivity(input.leadId, input.activityId)
  );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['crm-lead', tenantId, leadId] });
    await onChanged();
  }

  function saveInfo() {
    if (lead === null) return;
    setError('');
    const scoreValue = Number(info.score as string);
    saveMutation.mutate(
      {
        id: leadId,
        payload: {
          name: String(info.name),
          email: String(info.email),
          stage: String(info.stage),
          score: Number.isSafeInteger(scoreValue) ? scoreValue : lead.score,
          opt_out: Boolean(info.optOut),
          next_followup_at: fromLocalInput(String(info.followup))
        }
      },
      {
        onSuccess: async () => {
          setNotice('Lead actualizado.');
          setInfoDraft(null);
          await refresh();
        },
        onError: (mutationError: Error) => setError(mutationError.message)
      }
    );
  }

  function sendMessage() {
    const content = reply.trim();
    if (content === '') return;
    setError('');
    sendMutation.mutate({ id: leadId, content }, {
      onSuccess: async () => {
        setReply('');
        setNotice('Mensaje enviado por WhatsApp (el bot queda pausado 15 min en este chat).');
        await refresh();
      },
      onError: (mutationError: Error) => setError(mutationError.message)
    });
  }

  function addActivity() {
    const content = activityContent.trim();
    if (content === '') return;
    if (activityType === 'task' && activityDue.trim() === '') {
      setError('La tarea necesita fecha');
      return;
    }
    setError('');
    activityMutation.mutate(
      {
        id: leadId,
        type: activityType,
        content,
        ...(activityType === 'task' ? { due_at: fromLocalInput(activityDue) ?? undefined } : {})
      },
      {
        onSuccess: async () => {
          setActivityContent('');
          setActivityDue('');
          setNotice('Actividad registrada.');
          await refresh();
        },
        onError: (mutationError: Error) => setError(mutationError.message)
      }
    );
  }

  return (
    <Modal
      open
      eyebrow="CRM"
      title={lead ? `${lead.name || 'Lead'} · ${lead.phone}` : `Lead #${leadId}`}
      className="crm-detail-card"
      onClose={onClose}
    >
      <div className="stack">
        {detailQuery.isPending ? <Notice>Cargando lead…</Notice> : null}
        {detailQuery.isError ? <Notice tone="error">No fue posible cargar el lead.</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}

        {detail ? (
          <div className="crm-detail-grid">
            <div className="stack">
              <div className="sale-detail-grid">
                <div><span>Fuente</span><strong>{SOURCE_LABELS[detail.lead.source] ?? detail.lead.source}</strong></div>
                <div><span>Creado</span><strong>{formatDate(detail.lead.created_at)}</strong></div>
                <div><span>Última actividad</span><strong>{formatDate(detail.lead.last_activity_at)}</strong></div>
                <div><span>Puntos cliente</span><strong>{detail.customer ? detail.customer.points_balance : '—'}</strong></div>
              </div>

              <div className="field-row">
                <label>Nombre
                  <input value={String(info.name)} onChange={(event) => setInfoDraft({ ...info, name: event.target.value })} maxLength={120} />
                </label>
                <label>Correo
                  <input value={String(info.email)} onChange={(event) => setInfoDraft({ ...info, email: event.target.value })} maxLength={150} />
                </label>
              </div>
              <div className="field-row">
                <label>Etapa
                  <select value={String(info.stage)} onChange={(event) => setInfoDraft({ ...info, stage: event.target.value })}>
                    {STAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label>Score
                  <input value={String(info.score)} onChange={(event) => setInfoDraft({ ...info, score: event.target.value })} inputMode="numeric" />
                </label>
              </div>
              <div className="field-row">
                <label>Próximo seguimiento
                  <input type="datetime-local" value={String(info.followup)} onChange={(event) => setInfoDraft({ ...info, followup: event.target.value })} />
                </label>
                <label className="checkbox-label" style={{ alignSelf: 'end', paddingBottom: '12px' }}>
                  <input type="checkbox" checked={Boolean(info.optOut)} onChange={(event) => setInfoDraft({ ...info, optOut: event.target.checked })} />
                  No enviar automáticos (opt-out)
                </label>
              </div>
              <div className="action-grid">
                <button className="primary" type="button" onClick={saveInfo} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>

              <div>
                <p className="eyebrow">COMPRAS RECIENTES</p>
                {detail.recent_sales.length === 0 ? <p className="muted">Sin compras registradas.</p> : (
                  <div className="table-wrap confirm-products">
                    <table className="data-table">
                      <thead><tr><th>#</th><th>Fecha</th><th>Total</th><th>Pagado</th><th>Estado</th></tr></thead>
                      <tbody>
                        {detail.recent_sales.map((sale) => (
                          <tr key={sale.id}>
                            <td>{sale.id}</td>
                            <td>{formatDate(sale.created_at)}</td>
                            <td className="money-cell">{formatMoney(sale.grand_total, currency)}</td>
                            <td className="money-cell">{formatMoney(sale.paid, currency)}</td>
                            <td><span className={`badge ${sale.status ?? ''}`}>{saleStatusLabel(sale.status)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="stack">
              <div>
                <p className="eyebrow">WHATSAPP</p>
                <div className="crm-thread">
                  {detail.conversation.length === 0 ? <p className="muted">Sin conversación de WhatsApp.</p> : (
                    detail.conversation.map((message) => (
                      <div key={message.id} className={`chat-bubble ${message.direction === 'out' ? 'user' : 'assistant'}`}>
                        <span className="chat-role">{message.direction === 'out' ? 'Tú' : (detail.lead.name || 'Cliente')}</span>
                        <p>{message.body ?? ''}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="chat-input" style={{ marginTop: '8px' }}>
                  <input
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Escribe un mensaje de WhatsApp…"
                    maxLength={2000}
                    aria-label="Mensaje de WhatsApp"
                  />
                  <button className="primary" type="button" onClick={sendMessage} disabled={sendMutation.isPending || reply.trim() === ''}>
                    {sendMutation.isPending ? 'Enviando…' : 'Enviar'}
                  </button>
                </div>
              </div>

              <div>
                <p className="eyebrow">NUEVA ACTIVIDAD</p>
                <div className="toolbar">
                  <label>Tipo
                    <select value={activityType} onChange={(event) => setActivityType(event.target.value)}>
                      <option value="note">Nota</option>
                      <option value="call">Llamada</option>
                      <option value="task">Tarea (seguimiento)</option>
                    </select>
                  </label>
                  {activityType === 'task' ? (
                    <label>Vence
                      <input type="datetime-local" value={activityDue} onChange={(event) => setActivityDue(event.target.value)} />
                    </label>
                  ) : null}
                </div>
                <div className="chat-input">
                  <input
                    value={activityContent}
                    onChange={(event) => setActivityContent(event.target.value)}
                    placeholder={activityType === 'task' ? '¿Qué debes hacer?' : 'Detalle…'}
                    maxLength={2000}
                    aria-label="Contenido de la actividad"
                  />
                  <button className="quiet" type="button" onClick={addActivity} disabled={activityMutation.isPending}>
                    Agregar
                  </button>
                </div>
              </div>

              <div>
                <p className="eyebrow">TIMELINE</p>
                <div className="crm-timeline">
                  {detail.activities.length === 0 ? <p className="muted">Sin actividades.</p> : (
                    detail.activities.map((activity: CrmActivity) => (
                      <div key={activity.id} className="crm-timeline-item">
                        <strong>{ACTIVITY_META[activity.type] ?? '•'} {activity.type === 'task' ? 'Tarea' : activity.type}</strong>
                        <span>{activity.content}</span>
                        <small>
                          {formatDate(activity.created_at)}
                          {activity.type === 'task' && activity.due_at ? ` · vence ${formatDate(activity.due_at)}` : ''}
                          {activity.completed_at ? ' · ✅ completada' : ''}
                        </small>
                        {activity.type === 'task' && activity.completed_at === null ? (
                          <button
                            className="quiet"
                            type="button"
                            onClick={() => {
                              completeMutation.mutate({ leadId, activityId: activity.id }, {
                                onSuccess: async () => { await refresh(); }
                              });
                            }}
                            disabled={completeMutation.isPending}
                          >
                            Marcar completada
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

// ===== Plantillas =====

function TemplatesTab() {
  const { token, tenantId } = useSession();
  const queryClient = useQueryClient();
  const templatesQuery = useCrmTemplatesQuery(token, tenantId);
  const [editor, setEditor] = useState<{ id: number | null; name: string; body: string } | null>(null);
  const [error, setError] = useState('');

  const saveMutation = useApiMutation((input: { id: number | null; name: string; body: string }) =>
    input.id === null ? createCrmTemplate({ name: input.name, body: input.body }) : updateCrmTemplate(input.id, { name: input.name, body: input.body })
  );
  const deleteMutation = useApiMutation((id: number) => deleteCrmTemplate(id));

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['crm-templates'] });
  }

  return (
    <div className="stack">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="muted">
        Variables disponibles: <code>{'{{nombre}}'}</code>, <code>{'{{tienda}}'}</code>, <code>{'{{pedido}}'}</code>,{' '}
        <code>{'{{total_pedido}}'}</code>, <code>{'{{pendiente}}'}</code>.
      </p>
      <div className="action-grid">
        <button className="primary" type="button" onClick={() => setEditor({ id: null, name: '', body: '' })}>+ Nueva plantilla</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Nombre</th><th>Mensaje</th><th className="actions-col">Acciones</th></tr></thead>
          <tbody>
            {(templatesQuery.data ?? []).map((template: CrmTemplate) => (
              <tr key={template.id}>
                <td><strong>{template.name}</strong></td>
                <td className="muted">{template.body.slice(0, 120)}{template.body.length > 120 ? '…' : ''}</td>
                <td>
                  <div className="row-actions sale-actions">
                    <button className="sale-action-btn sale-action-btn--edit" type="button" title="Editar" aria-label="Editar" onClick={() => setEditor({ id: template.id, name: template.name, body: template.body })}>✏️</button>
                    <button
                      className="sale-action-btn sale-action-btn--delete"
                      type="button"
                      title="Eliminar"
                      aria-label="Eliminar"
                      onClick={() => {
                        if (!window.confirm(`¿Eliminar la plantilla "${template.name}"?`)) return;
                        deleteMutation.mutate(template.id, {
                          onSuccess: async () => { await invalidate(); },
                          onError: (mutationError: Error) => setError(mutationError.message)
                        });
                      }}
                    >🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
            {(templatesQuery.data ?? []).length === 0 && !templatesQuery.isPending ? (
              <tr><td colSpan={3} className="empty">No hay plantillas.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editor ? (
        <Modal open eyebrow="CRM" title={editor.id === null ? 'Nueva plantilla' : 'Editar plantilla'} onClose={() => setEditor(null)}>
          <div className="stack">
            <label>Nombre
              <input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={120} />
            </label>
            <label>Mensaje
              <textarea value={editor.body} onChange={(event) => setEditor({ ...editor, body: event.target.value })} maxLength={1000} rows={5} />
            </label>
            <div className="modal-actions">
              <button className="quiet" type="button" onClick={() => setEditor(null)}>Cancelar</button>
              <button
                className="primary"
                type="button"
                disabled={saveMutation.isPending || editor.name.trim() === '' || editor.body.trim() === ''}
                onClick={() => saveMutation.mutate(editor, {
                  onSuccess: async () => {
                    setEditor(null);
                    await invalidate();
                  },
                  onError: (mutationError: Error) => setError(mutationError.message)
                })}
              >
                {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ===== Automatizaciones =====

function AutomationsTab() {
  const { token, tenantId } = useSession();
  const queryClient = useQueryClient();
  const automationsQuery = useCrmAutomationsQuery(token, tenantId);
  const templatesQuery = useCrmTemplatesQuery(token, tenantId);
  const [editor, setEditor] = useState<{
    id: number | null;
    name: string;
    trigger: string;
    delay_hours: string;
    template_id: string;
    enabled: boolean;
  } | null>(null);
  const [error, setError] = useState('');

  const saveMutation = useApiMutation((input: { id: number | null; name: string; trigger: string; delay_hours: number; template_id?: number; enabled: boolean }) =>
    input.id === null
      ? createCrmAutomation({ name: input.name, trigger: input.trigger, delay_hours: input.delay_hours, template_id: input.template_id, enabled: input.enabled })
      : updateCrmAutomation(input.id, { name: input.name, trigger: input.trigger, delay_hours: input.delay_hours, template_id: input.template_id, enabled: input.enabled })
  );
  const deleteMutation = useApiMutation((id: number) => deleteCrmAutomation(id));

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['crm-automations'] });
  }

  function toggleAutomation(automation: CrmAutomation) {
    saveMutation.mutate(
      {
        id: automation.id,
        name: automation.name,
        trigger: automation.trigger,
        delay_hours: automation.delay_hours,
        template_id: automation.template_id ?? undefined,
        enabled: !automation.enabled
      },
      {
        onSuccess: async () => { await invalidate(); },
        onError: (mutationError: Error) => setError(mutationError.message)
      }
    );
  }

  return (
    <div className="stack">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Notice>
        Envíos solo entre 8:00 y 19:00 (hora de la tienda), máximo 50 al día por tienda y 1 por cliente cada 24 h.
        Requiere el WhatsApp conectado; si no, quedan pendientes.
      </Notice>
      <div className="action-grid">
        <button
          className="primary"
          type="button"
          onClick={() => setEditor({ id: null, name: '', trigger: 'new_lead', delay_hours: '24', template_id: '', enabled: false })}
        >
          + Nueva automatización
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Nombre</th><th>Disparador</th><th>Espera</th><th>Plantilla</th><th>Estado</th><th>Última ejecución</th><th className="actions-col">Acciones</th></tr></thead>
          <tbody>
            {(automationsQuery.data ?? []).map((automation: CrmAutomation) => (
              <tr key={automation.id}>
                <td><strong>{automation.name}</strong></td>
                <td>{TRIGGERS.find((item) => item.value === automation.trigger)?.label ?? automation.trigger}</td>
                <td>{delayLabel(automation.delay_hours)}</td>
                <td>{automation.template_name ?? '—'}</td>
                <td>
                  <span className={`badge ${automation.enabled ? 'paid' : 'none'}`}>
                    {automation.enabled ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
                <td className="muted">{automation.last_run_at ? formatDate(automation.last_run_at) : '—'}</td>
                <td>
                  <div className="row-actions sale-actions">
                    <button className="sale-action-btn sale-action-btn--edit" type="button" title={automation.enabled ? 'Desactivar' : 'Activar'} aria-label="Alternar" onClick={() => toggleAutomation(automation)}>
                      {automation.enabled ? '⏸️' : '▶️'}
                    </button>
                    <button
                      className="sale-action-btn sale-action-btn--edit"
                      type="button"
                      title="Editar"
                      aria-label="Editar"
                      onClick={() => setEditor({
                        id: automation.id,
                        name: automation.name,
                        trigger: automation.trigger,
                        delay_hours: String(automation.delay_hours),
                        template_id: automation.template_id === null ? '' : String(automation.template_id),
                        enabled: automation.enabled
                      })}
                    >✏️</button>
                    <button
                      className="sale-action-btn sale-action-btn--delete"
                      type="button"
                      title="Eliminar"
                      aria-label="Eliminar"
                      onClick={() => {
                        if (!window.confirm(`¿Eliminar la automatización "${automation.name}"?`)) return;
                        deleteMutation.mutate(automation.id, {
                          onSuccess: async () => { await invalidate(); },
                          onError: (mutationError: Error) => setError(mutationError.message)
                        });
                      }}
                    >🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
            {(automationsQuery.data ?? []).length === 0 && !automationsQuery.isPending ? (
              <tr><td colSpan={7} className="empty">No hay automatizaciones.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editor ? (
        <Modal open eyebrow="CRM" title={editor.id === null ? 'Nueva automatización' : 'Editar automatización'} onClose={() => setEditor(null)}>
          <div className="stack">
            <label>Nombre
              <input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={120} />
            </label>
            <label>Disparador
              <select value={editor.trigger} onChange={(event) => setEditor({ ...editor, trigger: event.target.value })}>
                {TRIGGERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="field-row">
              <label>Esperar (horas)
                <input value={editor.delay_hours} onChange={(event) => setEditor({ ...editor, delay_hours: event.target.value })} inputMode="numeric" />
              </label>
              <label>Plantilla
                <select value={editor.template_id} onChange={(event) => setEditor({ ...editor, template_id: event.target.value })}>
                  <option value="">Sin plantilla</option>
                  {(templatesQuery.data ?? []).map((template: CrmTemplate) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={editor.enabled} onChange={(event) => setEditor({ ...editor, enabled: event.target.checked })} />
              Automatización activa
            </label>
            <div className="modal-actions">
              <button className="quiet" type="button" onClick={() => setEditor(null)}>Cancelar</button>
              <button
                className="primary"
                type="button"
                disabled={saveMutation.isPending || editor.name.trim() === '' || editor.template_id === ''}
                onClick={() => {
                  const delay = Number(editor.delay_hours);
                  if (!Number.isSafeInteger(delay) || delay < 1) {
                    setError('La espera debe ser un número de horas (mínimo 1)');
                    return;
                  }
                  saveMutation.mutate(
                    {
                      id: editor.id,
                      name: editor.name,
                      trigger: editor.trigger,
                      delay_hours: delay,
                      template_id: Number(editor.template_id),
                      enabled: editor.enabled
                    },
                    {
                      onSuccess: async () => {
                        setEditor(null);
                        await invalidate();
                      },
                      onError: (mutationError: Error) => setError(mutationError.message)
                    }
                  );
                }}
              >
                {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            <p className="muted">La automatización exige una plantilla (elige o crea una en la pestaña Plantillas).</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ===== Nuevo lead =====

function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [followup, setFollowup] = useState('');
  const [error, setError] = useState('');

  const createMutation = useApiMutation((input: { name?: string; phone: string; email?: string; next_followup_at?: string }) =>
    createCrmLead(input)
  );

  return (
    <Modal open eyebrow="CRM" title="Nuevo lead" onClose={onClose}>
      <div className="stack">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <label>Nombre
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej: María Pérez" maxLength={120} />
        </label>
        <label>Teléfono (WhatsApp)
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ej: 3001234567" maxLength={20} />
        </label>
        <div className="field-row">
          <label>Correo
            <input value={email} onChange={(event) => setEmail(event.target.value)} maxLength={150} />
          </label>
          <label>Próximo seguimiento
            <input type="datetime-local" value={followup} onChange={(event) => setFollowup(event.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            type="button"
            disabled={createMutation.isPending || phone.trim() === ''}
            onClick={() =>
              createMutation.mutate(
                {
                  ...(name.trim() !== '' ? { name: name.trim() } : {}),
                  phone: phone.trim(),
                  ...(email.trim() !== '' ? { email: email.trim() } : {}),
                  ...(followup.trim() !== '' ? { next_followup_at: fromLocalInput(followup) ?? undefined } : {})
                },
                {
                  onSuccess: async () => { await onCreated(); },
                  onError: (mutationError: Error) => setError(mutationError.message)
                }
              )
            }
          >
            {createMutation.isPending ? 'Creando…' : 'Crear lead'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
