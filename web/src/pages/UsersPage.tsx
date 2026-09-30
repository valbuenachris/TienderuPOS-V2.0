import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useUsersQuery } from '../pos-queries';

export default function UsersPage() {
  const { token, tenantId, stores } = useSession();
  const usersQuery = useUsersQuery(token, tenantId);
  const users = usersQuery.data ?? [];

  return (
    <>
      <PageHeader eyebrow="EQUIPO" title="Usuarios" />
      <Panel className="stack">
        <p className="muted">Listado de solo lectura. La creación y edición de usuarios se habilitará tras definir el manejo de contraseñas compatible con el POS anterior.</p>
        {usersQuery.isError ? <Notice tone="error">No fue posible cargar los usuarios.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Grupo</th><th>Tienda</th><th>Activo</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username || '—'}</td>
                  <td>{[user.first_name, user.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td>{user.email || '—'}</td>
                  <td><span className={`badge ${user.group_name?.toLowerCase() === 'admin' ? 'paid' : ''}`}>{user.group_name || '—'}</span></td>
                  <td>{stores.find((store) => store.id === user.store_id)?.name ?? 'Todas'}</td>
                  <td>{user.active === 1 ? 'Sí' : 'No'}</td>
                </tr>
              ))}
              {users.length === 0 && !usersQuery.isPending ? (
                <tr><td colSpan={6} className="empty">No hay usuarios en el tenant.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
