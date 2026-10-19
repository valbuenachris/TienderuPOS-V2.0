import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import {
  useApiMutation,
  useMarketplaceWhatsappConnectQuery,
  useMarketplaceWhatsappQuery
} from '../../pos-queries';
import {
  createMarketplaceWhatsappInstance,
  disconnectMarketplaceWhatsapp,
  updateMarketplaceWhatsapp
} from '../../api';
import { formatDate } from '../../format';

const STATUS_META: Record<string, { label: string; badge: string }> = {
  open: { label: 'Conectado', badge: 'badge paid' },
  connecting: { label: 'Conectando…', badge: 'badge partial' },
  close: { label: 'Desconectado', badge: 'badge due' },
  none: { label: 'Sin instancia', badge: 'badge none' }
};

export function WhatsappTab() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draft, setDraft] = useState<{
    enabled: boolean;
    name: string;
    tone: string;
    notifyCustomers: boolean;
    notifyTenants: boolean;
  } | null>(null);

  // Mientras el modal del QR está abierto, refresca el estado cada 5 s.
  const settingsQuery = useMarketplaceWhatsappQuery(token, tenantId, qrOpen ? 5000 : false);
  const settings = settingsQuery.data ?? null;
  const connectQuery = useMarketplaceWhatsappConnectQuery(token, tenantId, qrOpen);

  const createMutation = useApiMutation(createMarketplaceWhatsappInstance);
  const disconnectMutation = useApiMutation(disconnectMarketplaceWhatsapp);
  const saveMutation = useApiMutation(updateMarketplaceWhatsapp);

  const values = draft ?? {
    enabled: settings?.agent_enabled ?? false,
    name: settings?.agent_name ?? '',
    tone: settings?.agent_tone ?? 'amable',
    notifyCustomers: settings?.notify_customers ?? true,
    notifyTenants: settings?.notify_tenants ?? true
  };

  const configured = settings?.configured !== false;
  const tableReady = settings?.table_ready !== false;
  const status = settings?.status ?? 'none';
  const meta = STATUS_META[status] ?? STATUS_META.none;
  const connected = status === 'open';
  const qr = connectQuery.data?.qr ?? null;

  useEffect(() => {
    if (qrOpen && connected) {
      setQrOpen(false);
      setNotice('¡WhatsApp de tienderu.com conectado!');
      void queryClient.invalidateQueries({ queryKey: ['marketplace-whatsapp'] });
    }
  }, [qrOpen, connected, queryClient]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['marketplace-whatsapp'] });
  }

  function createInstance() {
    setError('');
    createMutation.mutate(undefined, {
      onSuccess: async (result) => {
        setNotice(`Instancia creada: ${result.instance_name ?? ''}`);
        await invalidate();
        setQrOpen(true);
      },
      onError: (mutationError: Error) => setError(mutationError.message)
    });
  }

  function disconnect() {
    setError('');
    disconnectMutation.mutate(undefined, {
      onSuccess: async () => {
        setConfirmOpen(false);
        setNotice('WhatsApp desconectado. La instancia se conserva; puedes reconectar con un QR nuevo.');
        await invalidate();
      },
      onError: (mutationError: Error) => {
        setConfirmOpen(false);
        setError(mutationError.message);
      }
    });
  }

  function saveSettings() {
    setError('');
    saveMutation.mutate(
      {
        agent_enabled: values.enabled,
        agent_name: values.name.trim(),
        agent_tone: values.tone,
        notify_customers: values.notifyCustomers,
        notify_tenants: values.notifyTenants
      },
      {
        onSuccess: async (result) => {
          setNotice(
            result.agent_enabled
              ? `Chatbot activado: responderá como ${result.agent_name || 'Asesor'}.`
              : 'Configuración guardada.'
          );
          setDraft(null);
          await invalidate();
        },
        onError: (mutationError: Error) => setError(mutationError.message)
      }
    );
  }

  return (
    <>
      <Panel className="stack full-width">
        <p className="muted">
          Instancia única de WhatsApp de <strong>tienderu.com</strong> (no es la de un tenant): se usa para
          notificar a los compradores y a los vendedores de los pedidos del marketplace, y para el chatbot de
          ventas que atiende con <strong>todo el catálogo</strong> de todas las tiendas.
        </p>
        {!configured && !settingsQuery.isPending ? (
          <Notice tone="error">
            El servidor de WhatsApp no está configurado: define EVOLUTION_API_URL y EVOLUTION_API_KEY en el .env.
          </Notice>
        ) : null}
        {!tableReady && !settingsQuery.isPending ? (
          <Notice tone="error">
            Falta la migración: ejecuta docs/migrations/v0.12.0-marketplace-whatsapp.sql y recarga.
          </Notice>
        ) : null}
        {settingsQuery.isError ? <Notice tone="error">No fue posible cargar el estado de WhatsApp.</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="whatsapp-status-row">
          <span className={meta.badge}>{meta.label}</span>
          {settings?.instance_name ? <strong>{settings.instance_name}</strong> : null}
          {connected && settings?.connected_at ? (
            <span className="muted">Conectado desde {formatDate(settings.connected_at)}</span>
          ) : null}
        </div>

        <p className="muted">
          Vincula el número de tienderu.com escaneando el QR con la app de WhatsApp (Dispositivos vinculados →
          Vincular un dispositivo). El chatbot responde desde este mismo número.
        </p>

        <div className="action-grid">
          {status === 'none' ? (
            <button
              className="primary"
              type="button"
              onClick={createInstance}
              disabled={!configured || !tableReady || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creando…' : 'Crear instancia'}
            </button>
          ) : (
            <>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  setError('');
                  setQrOpen(true);
                }}
                disabled={!configured}
              >
                {connected ? 'Ver QR / Reconectar' : 'Conectar'}
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!connected || disconnectMutation.isPending}
              >
                Desconectar
              </button>
            </>
          )}
        </div>
      </Panel>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CHATBOT · NOTIFICACIONES</p>
            <h2>Agente del marketplace</h2>
          </div>
        </div>
        <p className="muted">
          El chatbot busca en todo el marketplace (todos los vendedores), arma el pedido, pide la dirección y lo
          crea con el <strong>checkout real</strong> (stock, sub-órdenes y envío); envía el link de pago Bold o
          confirma contraentrega. Los compradores de WhatsApp se registran solos por teléfono.
        </p>
        {!tableReady && !settingsQuery.isPending ? (
          <Notice tone="error">Falta la migración v0.12.0-marketplace-whatsapp.sql.</Notice>
        ) : null}
        {values.enabled && !settings?.webhook_token_ready ? (
          <Notice tone="error">Define EVOLUTION_WEBHOOK_TOKEN en el .env para activar el chatbot.</Notice>
        ) : null}
        {values.enabled && !connected ? (
          <Notice>El WhatsApp de tienderu.com debe estar conectado para que el chatbot responda.</Notice>
        ) : null}

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(event) => setDraft({ ...values, enabled: event.target.checked })}
            disabled={status === 'none' || !tableReady}
          />
          Chatbot activo (responde automáticamente y vende)
        </label>
        <div className="field-row">
          <label>
            Nombre del agente
            <input
              value={values.name}
              onChange={(event) => setDraft({ ...values, name: event.target.value })}
              placeholder="Ej: Sara"
              maxLength={60}
              disabled={status === 'none' || !tableReady}
            />
          </label>
          <label>
            Tono
            <select
              value={values.tone}
              onChange={(event) => setDraft({ ...values, tone: event.target.value })}
              disabled={status === 'none' || !tableReady}
            >
              <option value="amable">Amable y cercano</option>
              <option value="profesional">Profesional (usted)</option>
              <option value="vendedor">Vendedor (persuasivo)</option>
              <option value="cercano">Muy coloquial y breve</option>
            </select>
          </label>
        </div>

        <div className="section-heading">
          <div>
            <p className="eyebrow">NOTIFICACIONES</p>
            <h3>¿Quién recibe avisos por este número?</h3>
          </div>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={values.notifyCustomers}
            onChange={(event) => setDraft({ ...values, notifyCustomers: event.target.checked })}
            disabled={status === 'none' || !tableReady}
          />
          Compradores: confirmación del pedido, enviado y entregado
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={values.notifyTenants}
            onChange={(event) => setDraft({ ...values, notifyTenants: event.target.checked })}
            disabled={status === 'none' || !tableReady}
          />
          Vendedores: pedido pagado / contraentrega pendiente de despacho
        </label>
        <p className="muted">
          Si la instancia de la plataforma no está conectada, las notificaciones vuelven a usar la instancia de
          WhatsApp de cada tienda (como antes).
        </p>

        <div className="action-grid">
          <button
            className="primary"
            type="button"
            onClick={saveSettings}
            disabled={saveMutation.isPending || status === 'none' || !tableReady}
          >
            {saveMutation.isPending ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </Panel>

      <Modal open={qrOpen} eyebrow="WHATSAPP PLATAFORMA" title="Conectar WhatsApp de tienderu.com" onClose={() => setQrOpen(false)}>
        <div className="stack">
          <p className="muted">
            Abre WhatsApp en el teléfono de tienderu.com → <strong>Dispositivos vinculados</strong> →{' '}
            <strong>Vincular un dispositivo</strong> y escanea este código. El QR se actualiza automáticamente.
          </p>
          {connectQuery.isError ? (
            <Notice tone="error">
              {connectQuery.error instanceof Error
                ? connectQuery.error.message
                : 'No fue posible obtener el QR.'}
            </Notice>
          ) : null}
          {qr ? (
            <img className="whatsapp-qr" src={qr} alt="Código QR para vincular WhatsApp" />
          ) : (
            <div className="chart-empty">
              {connectQuery.isPending ? 'Generando código QR…' : 'QR no disponible por ahora; reintentando…'}
            </div>
          )}
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={() => setQrOpen(false)}>
              Cerrar
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmOpen} eyebrow="WHATSAPP PLATAFORMA" title="Desconectar WhatsApp" onClose={() => setConfirmOpen(false)}>
        <div className="stack">
          <p className="muted">
            Se cerrará la sesión de WhatsApp de tienderu.com. La instancia se conserva y puedes reconectarla con
            un QR nuevo. Mientras esté desconectada, las notificaciones usan la instancia de cada tienda.
          </p>
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </button>
            <button className="danger" type="button" onClick={disconnect} disabled={disconnectMutation.isPending}>
              {disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
