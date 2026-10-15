import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useAppCustomersQuery } from '../../pos-queries';
import { adjustAppCustomerPoints, resetAppCustomerPassword } from '../../api';
import type { AppCustomerRow } from '../../api';
import AdjustPointsModal from './AdjustPointsModal';

export default function AppCustomersTab() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [pointsTarget, setPointsTarget] = useState<AppCustomerRow | null>(null);
  const [resetTarget, setResetTarget] = useState<AppCustomerRow | null>(null);
  const query = useAppCustomersQuery(token, tenantId, search, page, 20);

  const pointsMutation = useApiMutation((input: { id: number; amount: number; reason: string }) =>
    adjustAppCustomerPoints(input.id, { amount: input.amount, reason: input.reason })
  );
  const resetMutation = useApiMutation((id: number) => resetAppCustomerPassword(id));

  const rows = query.data?.data ?? [];
  const customerName = (customer: AppCustomerRow) => customer.name || customer.phone || `Cliente #${customer.id}`;

  return (
    <>
      <Panel className="stack full-width">
        <div className="toolbar">
          <label className="search-label">Buscar
            <div className="search-row">
              <input
                className="search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="Nombre, correo o teléfono"
              />
            </div>
          </label>
        </div>
        {notice ? <Notice tone={/error|no fue|inválid|invalid|no se|saldo/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
        {query.isError ? <Notice tone="error">No fue posible cargar los clientes de la app.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Puntos</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr key={customer.id}>
                  <td><strong>{customerName(customer)}</strong></td>
                  <td>{customer.phone || '—'}</td>
                  <td>{customer.email || '—'}</td>
                  <td><span className={`badge ${customer.points_balance > 0 ? 'paid' : 'none'}`}>{customer.points_balance} pts</span></td>
                  <td className="row-actions">
                    <button
                      className="icon-button"
                      type="button"
                      title="Ajustar puntos"
                      aria-label="Ajustar puntos"
                      onClick={() => { setNotice(''); setPointsTarget(customer); }}
                    >
                      ✏️
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      title="Restablecer contraseña"
                      aria-label="Restablecer contraseña"
                      onClick={() => { setNotice(''); setResetTarget(customer); }}
                    >
                      🔑
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !query.isPending ? (
                <tr><td colSpan={5} className="empty">No hay clientes registrados en la app.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {query.data ? (
          <Pagination
            page={query.data.meta.page}
            totalPages={query.data.meta.totalPages}
            total={query.data.meta.total}
            onChange={setPage}
          />
        ) : null}
      </Panel>

      <AdjustPointsModal
        open={pointsTarget !== null}
        customerName={pointsTarget ? customerName(pointsTarget) : ''}
        currentBalance={pointsTarget?.points_balance ?? 0}
        pending={pointsMutation.isPending}
        onClose={() => setPointsTarget(null)}
        onSubmit={(amount, reason) => {
          if (!pointsTarget) return;
          pointsMutation.mutate({ id: pointsTarget.id, amount, reason }, {
            onSuccess: async (customer) => {
              setNotice(`Puntos de ${customerName(customer)} actualizados a ${customer.points_balance}.`);
              setPointsTarget(null);
              await queryClient.invalidateQueries({ queryKey: ['admin-app-customers'] });
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />

      <Modal
        open={resetTarget !== null}
        eyebrow="CONTRASEÑA"
        title={resetTarget ? `Restablecer · ${customerName(resetTarget)}` : 'Restablecer contraseña'}
        onClose={() => setResetTarget(null)}
      >
        <div className="stack">
          <Notice tone="error">
            ⚠️ ¿Está seguro? El cliente deberá volver a configurar su contraseña desde la app ("¿Primera vez?").
          </Notice>
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={() => setResetTarget(null)} disabled={resetMutation.isPending}>
              Cancelar
            </button>
            <button
              className="danger"
              type="button"
              disabled={resetMutation.isPending}
              onClick={() => {
                if (!resetTarget) return;
                resetMutation.mutate(resetTarget.id, {
                  onSuccess: async () => {
                    setNotice(`Contraseña de ${customerName(resetTarget)} restablecida.`);
                    setResetTarget(null);
                    await queryClient.invalidateQueries({ queryKey: ['admin-app-customers'] });
                  },
                  onError: (error: Error) => {
                    setNotice(error.message);
                    setResetTarget(null);
                  }
                });
              }}
            >
              {resetMutation.isPending ? 'Restableciendo…' : 'Restablecer contraseña'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
