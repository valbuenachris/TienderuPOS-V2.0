import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useSubscriptionPlansQuery } from '../../pos-queries';
import { createSubscriptionPlan, updateSubscriptionPlan } from '../../api';
import type { SubscriptionPlan, SubscriptionPlanPayload } from '../../api';
import { formatMoney } from '../../format';
import { planLimitLabel } from './utils';

const FEATURES_CONFIG: { key: string; label: string; description: string }[] = [
  { key: 'advanced_reports', label: 'Reportes avanzados', description: 'Gráficos, top productos, calendario' },
  { key: 'crm', label: 'CRM', description: 'Gestión de leads y automatizaciones' },
  { key: 'whatsapp_bot', label: 'Bot de WhatsApp', description: 'Agente de ventas automatizado' },
  { key: 'app_management', label: 'Tienda Virtual', description: 'App móvil, pedidos, reseñas, banners' },
  { key: 'ai_assistant', label: 'Asistente IA', description: 'Chat con IA sobre datos del negocio' },
  { key: 'marketplace', label: 'Marketplace', description: 'Vender en tienderu.com' },
  { key: 'api_access', label: 'Acceso API', description: 'Integraciones externas' }
];

interface PlanFormState {
  name: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  maxUsers: string;
  maxStores: string;
  featureFlags: Record<string, boolean>;
  isActive: boolean;
}

function emptyFeatureFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const { key } of FEATURES_CONFIG) flags[key] = false;
  return flags;
}

const EMPTY_FORM: PlanFormState = {
  name: '',
  description: '',
  priceMonthly: '',
  priceYearly: '',
  maxUsers: '-1',
  maxStores: '-1',
  featureFlags: emptyFeatureFlags(),
  isActive: true
};

function formFromPlan(plan: SubscriptionPlan): PlanFormState {
  const flags = emptyFeatureFlags();
  if (plan.features && typeof plan.features === 'object') {
    for (const { key } of FEATURES_CONFIG) {
      if (plan.features[key] === true) flags[key] = true;
    }
  }
  return {
    name: plan.name,
    description: plan.description ?? '',
    priceMonthly: plan.price_monthly ?? '',
    priceYearly: plan.price_yearly ?? '',
    maxUsers: String(plan.max_users ?? -1),
    maxStores: String(plan.max_stores ?? -1),
    featureFlags: flags,
    isActive: plan.is_active
  };
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -1 ? parsed : -1;
}

export default function SubscriptionPlansPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, isSuperAdmin, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const plansQuery = useSubscriptionPlansQuery(token, tenantId, isSuperAdmin);

  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState<PlanFormState>(EMPTY_FORM);

  const saveMutation = useApiMutation((input: { id: string | null; payload: SubscriptionPlanPayload }) =>
    input.id ? updateSubscriptionPlan(input.id, input.payload) : createSubscriptionPlan(input.payload)
  );
  const toggleMutation = useApiMutation((plan: SubscriptionPlan) =>
    updateSubscriptionPlan(plan.id, { is_active: !plan.is_active })
  );

  const plans = plansQuery.data ?? [];

  function openCreate() {
    setNotice('');
    setEditingPlan(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(plan: SubscriptionPlan) {
    setNotice('');
    setEditingPlan(plan);
    setForm(formFromPlan(plan));
    setModalOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setNotice('El nombre del plan es obligatorio.');
      return;
    }
    const payload: SubscriptionPlanPayload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      price_monthly: form.priceMonthly.trim() || undefined,
      price_yearly: form.priceYearly.trim() || undefined,
      max_users: parseLimit(form.maxUsers),
      max_stores: parseLimit(form.maxStores),
      features: form.featureFlags,
      is_active: form.isActive
    };
    saveMutation.mutate({ id: editingPlan?.id ?? null, payload }, {
      onSuccess: async (plan) => {
        setNotice(`Plan "${plan.name}" ${editingPlan ? 'actualizado' : 'creado'}.`);
        setModalOpen(false);
        await queryClient.invalidateQueries({ queryKey: ['subscription-plans'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function toggleActive(plan: SubscriptionPlan) {
    toggleMutation.mutate(plan, {
      onSuccess: async (updated) => {
        setNotice(`Plan "${updated.name}" ${updated.is_active ? 'activado' : 'desactivado'}.`);
        await queryClient.invalidateQueries({ queryKey: ['subscription-plans'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function toggleFeature(key: string) {
    setForm({ ...form, featureFlags: { ...form.featureFlags, [key]: !form.featureFlags[key] } });
  }

  return (
    <>
      <PageHeader
        eyebrow="GESTIÓN"
        title="Planes de suscripción"
        actions={<button className="primary" type="button" onClick={openCreate}>+ Nuevo plan</button>}
      />
      {notice ? <Notice tone={/error|obligatorio|inválid|invalid/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {plansQuery.isError ? <Notice tone="error">No fue posible cargar los planes. ¿Ejecutaste la migración v0.3.11?</Notice> : null}

      <div className="plan-grid">
        {plans.map((plan) => (
          <article key={plan.id} className={`plan-card ${plan.is_active ? '' : 'row-inactive'}`}>
            <header>
              <div>
                <p className="eyebrow">{plan.is_active ? 'ACTIVO' : 'INACTIVO'}</p>
                <h2>{plan.name}</h2>
              </div>
              <span className="badge">{plan.tenants_count} tenant(s)</span>
            </header>
            {plan.description ? <p className="muted">{plan.description}</p> : null}
            <div className="plan-price">
              <strong>{formatMoney(plan.price_monthly, currency)}</strong><small>/mes</small>
              <span>{formatMoney(plan.price_yearly, currency)}/año</span>
            </div>
            <ul className="plan-features">
              <li>{planLimitLabel(plan.max_users)} usuario(s)</li>
              <li>{planLimitLabel(plan.max_stores)} tienda(s)</li>
              {FEATURES_CONFIG
                .filter(({ key }) => plan.features?.[key])
                .map(({ key, label }) => (
                  <li key={key} className="feature-active">{label}</li>
                ))}
            </ul>
            <div className="row-actions">
              <button
                className="icon-button"
                type="button"
                onClick={() => openEdit(plan)}
                title="Editar plan"
                aria-label="Editar plan"
              >
                ✏️
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => toggleActive(plan)}
                disabled={toggleMutation.isPending}
                title={plan.is_active ? 'Desactivar plan' : 'Activar plan'}
                aria-label={plan.is_active ? 'Desactivar plan' : 'Activar plan'}
              >
                {plan.is_active ? '🔴' : '🟢'}
              </button>
              <Link
                className="icon-button"
                to={`/tenant-management/tenants?plan=${plan.id}`}
                title="Ver tenants en este plan"
                aria-label="Ver tenants en este plan"
              >
                👥
              </Link>
            </div>
          </article>
        ))}
        {plans.length === 0 && !plansQuery.isPending ? (
          <p className="empty">No hay planes registrados. Crea el primero para asignarlo a los tenants.</p>
        ) : null}
      </div>

      <Modal
        open={modalOpen}
        eyebrow={editingPlan ? 'EDITANDO' : 'NUEVO'}
        title={editingPlan ? `Editar · ${editingPlan.name}` : 'Crear plan'}
        onClose={() => setModalOpen(false)}
      >
        <form className="form-grid" onSubmit={submit}>
          <label>Nombre<input value={form.name} maxLength={100} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label>Descripción<input value={form.description} maxLength={1000} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>Precio mensual<input value={form.priceMonthly} inputMode="decimal" placeholder="29.00" onChange={(event) => setForm({ ...form, priceMonthly: event.target.value })} /></label>
          <label>Precio anual<input value={form.priceYearly} inputMode="decimal" placeholder="290.00" onChange={(event) => setForm({ ...form, priceYearly: event.target.value })} /></label>
          <label>Máx. usuarios (-1 = ilimitado)<input value={form.maxUsers} inputMode="numeric" onChange={(event) => setForm({ ...form, maxUsers: event.target.value })} /></label>
          <label>Máx. tiendas (-1 = ilimitado)<input value={form.maxStores} inputMode="numeric" onChange={(event) => setForm({ ...form, maxStores: event.target.value })} /></label>
          <fieldset className="feature-checkboxes">
            <legend>Tools del plan</legend>
            {FEATURES_CONFIG.map(({ key, label, description }) => (
              <label key={key} className="checkbox-label feature-checkbox" onClick={() => toggleFeature(key)}>
                <input
                  type="checkbox"
                  checked={form.featureFlags[key] ?? false}
                  readOnly
                />
                <span>
                  <strong>{label}</strong>
                  <small className="muted"> — {description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            Plan activo
          </label>
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={() => setModalOpen(false)} disabled={saveMutation.isPending}>Cancelar</button>
            <button className="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : editingPlan ? 'Guardar cambios' : 'Crear plan'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
