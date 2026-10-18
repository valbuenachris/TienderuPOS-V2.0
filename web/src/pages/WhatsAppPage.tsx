import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useWhatsappConnectQuery, useWhatsappSettingsQuery } from '../pos-queries';
import { createWhatsappInstance, disconnectWhatsapp, updateWhatsappAgent } from '../api';
import { formatDate } from '../format';

const STATUS_META: Record<string, { label: string; badge: string }> = {
  open: { label: 'Conectado', badge: 'badge paid' },
  connecting: { label: 'Conectando…', badge: 'badge partial' },
  close: { label: 'Desconectado', badge: 'badge due' },
  none: { label: 'Sin instancia', badge: 'badge none' }
};

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentDraft, setAgentDraft] = useState<{ enabled: boolean; name: string; tone: string } | null>(null);

  // Mientras el modal del QR está abierto, refresca el estado cada 5 s.
  const settingsQuery = useWhatsappSettingsQuery(token, tenantId, qrOpen ? 5000 : false);
  const settings = settingsQuery.data ?? null;
  const connectQuery = useWhatsappConnectQuery(token, tenantId, qrOpen);

  const createMutation = useApiMutation(createWhatsappInstance);
  const disconnectMutation = useApiMutation(disconnectWhatsapp);
  const saveMutation = useApiMutation(updateWhatsappAgent);

  const draft = agentDraft ?? {
    enabled: settings?.agent_enabled ?? false,
    name: settings?.agent_name ?? '',
    tone: settings?.agent_tone ?? 'amable'
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
      setNotice('¡WhatsApp conectado! La instancia quedó vinculada a esta tienda.');
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-settings'] });
    }
  }, [qrOpen, connected, queryClient]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['whatsapp-settings'] });
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

  function saveAgent() {
    setError('');
    saveMutation.mutate(
      {
        agent_enabled: draft.enabled,
        agent_name: draft.name.trim(),
        agent_tone: draft.tone
      },
      {
        onSuccess: async (result) => {
          setNotice(
            result.agent_enabled
              ? `Bot activado: responderá como ${result.agent_name || 'Asesor'}.`
              : 'Bot desactivado.'
          );
          setAgentDraft(null);
          await invalidate();
        },
        onError: (mutationError: Error) => setError(mutationError.message)
      }
    );
  }

  return (
    <>
      <PageHeader eyebrow="ADMINISTRACIÓN" title="WhatsApp" />
      <Panel className="stack full-width">
        {!configured && !settingsQuery.isPending ? (
          <Notice tone="error">
            El servidor de WhatsApp no está configurado: define EVOLUTION_API_URL y EVOLUTION_API_KEY en el .env.
          </Notice>
        ) : null}
        {!tableReady && !settingsQuery.isPending ? (
          <Notice tone="error">
            Falta la migración: ejecuta docs/migrations/v0.5.0-tenant-whatsapp.sql y recarga.
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
          Vincula el WhatsApp de tu tienda escaneando el código QR con la app (Dispositivos vinculados). La
          instancia es exclusiva de esta tienda y la administra un usuario con rol de administrador.
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
                onClick={() => { setError(''); setQrOpen(true); }}
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
        <p className="muted">
          "Desconectar" cierra la sesión de WhatsApp pero conserva la instancia, para poder reconectarla con un
          QR nuevo cuando lo necesites.
        </p>
      </Panel>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">BOT DE VENTAS</p><h2>Agente de ventas</h2></div>
        </div>
        <p className="muted">
          El agente atiende el WhatsApp de la tienda: responde precios y disponibilidad con datos reales,
          recomienda productos, toma el pedido y lo deja <strong>pendiente de pago</strong> para que la tienda
          lo verifique. Los datos de la tienda (nombre, dirección, teléfono…) se toman de Configuración.
        </p>
        {!tableReady && !settingsQuery.isPending ? (
          <Notice tone="error">Falta la migración del bot: ejecuta docs/migrations/v0.6.0-whatsapp-bot.sql.</Notice>
        ) : null}
        {draft.enabled && !settings?.webhook_token_ready ? (
          <Notice tone="error">Define EVOLUTION_WEBHOOK_TOKEN en el .env para activar el bot.</Notice>
        ) : null}
        {draft.enabled && status !== 'open' ? (
          <Notice>El WhatsApp debe estar conectado para que el bot pueda responder.</Notice>
        ) : null}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setAgentDraft({ ...draft, enabled: event.target.checked })}
            disabled={status === 'none' || !tableReady}
          />
          Bot activo (responde automáticamente)
        </label>
        <div className="field-row">
          <label>Nombre del agente
            <input
              value={draft.name}
              onChange={(event) => setAgentDraft({ ...draft, name: event.target.value })}
              placeholder="Ej: Sara"
              maxLength={60}
              disabled={status === 'none' || !tableReady}
            />
          </label>
          <label>Tono
            <select
              value={draft.tone}
              onChange={(event) => setAgentDraft({ ...draft, tone: event.target.value })}
              disabled={status === 'none' || !tableReady}
            >
              <option value="amable">Amable y cercano</option>
              <option value="profesional">Profesional (usted)</option>
              <option value="vendedor">Vendedor (persuasivo)</option>
              <option value="cercano">Muy coloquial y breve</option>
            </select>
          </label>
        </div>
        <div className="action-grid">
          <button
            className="primary"
            type="button"
            onClick={saveAgent}
            disabled={saveMutation.isPending || status === 'none' || !tableReady}
          >
            {saveMutation.isPending ? 'Guardando…' : 'Guardar agente'}
          </button>
        </div>
        <p className="muted">
          Los pedidos del bot se crean como ventas en estado <strong>Debida</strong> (visibles en Cuentas
          abiertas y en Tienda Virtual → Pedidos App) y el stock se descuenta al confirmar el pedido.
        </p>
      </Panel>

      <Modal open={qrOpen} eyebrow="WHATSAPP" title="Conectar WhatsApp" onClose={() => setQrOpen(false)}>
        <div className="stack">
          <p className="muted">
            Abre WhatsApp en tu teléfono → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong> y
            escanea este código. El QR se actualiza automáticamente.
          </p>
          {connectQuery.isError ? (
            <Notice tone="error">
              {connectQuery.error instanceof Error ? connectQuery.error.message : 'No fue posible obtener el QR.'}
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
            <button className="quiet" type="button" onClick={() => setQrOpen(false)}>Cerrar</button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmOpen} eyebrow="WHATSAPP" title="Desconectar WhatsApp" onClose={() => setConfirmOpen(false)}>
        <div className="stack">
          <p className="muted">
            Se cerrará la sesión de WhatsApp de esta tienda. La instancia se conserva y puedes reconectarla con un
            QR nuevo.
          </p>
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={() => setConfirmOpen(false)}>Cancelar</button>
            <button className="danger" type="button" onClick={disconnect} disabled={disconnectMutation.isPending}>
              {disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
