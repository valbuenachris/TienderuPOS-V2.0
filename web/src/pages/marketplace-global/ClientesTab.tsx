import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Notice, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useMarketplaceCustomersQuery } from '../../pos-queries';
import { resetMarketplaceCustomerPassword } from '../../api';

function noticeTone(message: string): 'error' | 'success' {
  return /no |error|inválid|invalid|no se/i.test(message) ? 'error' : 'success';
}

export function ClientesTab() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');

  const customers = useMarketplaceCustomersQuery(token, tenantId, query === '' ? undefined : query, page);
  const resetPassword = useApiMutation((id: number) => resetMarketplaceCustomerPassword(id));

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
  }

  function reset(row: { id: number; name: string | null; email: string | null }) {
    if (!window.confirm(`¿Generar una nueva contraseña temporal para ${row.email ?? row.name ?? 'este cliente'}?`)) {
      return;
    }
    setNotice('');
    resetPassword.mutate(row.id, {
      onSuccess: async (result) => {
        setNotice(
          `Contraseña temporal de ${result.email ?? 'la cuenta'}: ${result.temporary_password} — cópiala y compártela con el cliente; no se volverá a mostrar.`
        );
        await queryClient.invalidateQueries({ queryKey: ['marketplace-customers'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const rows = customers.data?.data ?? [];

  return (
    <Panel className="stack full-width">
      <p className="muted">
        Cuentas globales de tienderu.com. Si un cliente perdió su contraseña, genera una temporal aquí
        (se muestra una sola vez) y pídele cambiarla en «Mi cuenta → Cambiar contraseña».
      </p>
      {notice ? <Notice tone={noticeTone(notice)}>{notice}</Notice> : null}
      {customers.isError ? <Notice tone="error">No fue posible cargar los clientes.</Notice> : null}

      <form className="stack" onSubmit={submitSearch}>
        <Field label="Buscar por nombre, email o teléfono">
          <input
            value={search}
            maxLength={100}
            placeholder="ana@… / 3001234567 / Ana"
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <div>
          <button type="submit" className="primary">Buscar</button>
        </div>
      </form>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Pedidos pagados</th><th>Contraseña</th><th>Registro</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>#{row.id}</td>
                <td>{row.name || '—'}</td>
                <td>{row.email || '—'}</td>
                <td>{row.phone || '—'}</td>
                <td>{row.orders_count}</td>
                <td>
                  <span className={`badge ${row.has_password ? 'paid' : 'none'}`}>
                    {row.has_password ? 'Activa' : 'Sin contraseña'}
                  </span>
                </td>
                <td>{row.created_at ? new Date(row.created_at).toLocaleDateString('es-CO') : '—'}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="quiet"
                    disabled={resetPassword.isPending}
                    onClick={() => reset(row)}
                  >
                    Restablecer contraseña
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !customers.isPending ? (
              <tr><td colSpan={8} className="empty">No hay clientes {query ? 'con esa búsqueda' : 'todavía'}.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {customers.data ? (
        <Pagination
          page={customers.data.meta.page}
          totalPages={customers.data.meta.totalPages}
          total={customers.data.meta.total}
          onChange={setPage}
        />
      ) : null}
    </Panel>
  );
}
