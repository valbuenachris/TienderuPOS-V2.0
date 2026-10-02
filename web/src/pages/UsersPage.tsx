import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useUsersQuery } from '../pos-queries';
import { createUser, deleteUser, setUserActive, updateUser } from '../api';
import type { UserPayload, UserRecord } from '../api';

type Role = 'admin' | 'staff';

interface UserFormState {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  confirm: string;
  role: Role;
  store_id: string;
  active: boolean;
}

const EMPTY_FORM: UserFormState = {
  username: '',
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  confirm: '',
  role: 'staff',
  store_id: '',
  active: true
};

function roleOf(user: UserRecord): Role {
  return user.group_name?.toLowerCase() === 'admin' ? 'admin' : 'staff';
}

function passwordStrength(password: string): 'weak' | 'medium' | 'strong' | '' {
  if (!password) return '';
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 2) return 'weak';
  if (score === 3) return 'medium';
  return 'strong';
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, user: currentUser, stores } = useSession();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const usersQuery = useUsersQuery(token, tenantId, search, page, 10);
  const users = usersQuery.data?.data ?? [];
  const meta = usersQuery.data?.meta;
  const strength = passwordStrength(form.password);

  const saveMutation = useApiMutation((input: { id: number | null; payload: UserPayload | Partial<UserPayload> }) =>
    input.id === null ? createUser(input.payload as UserPayload) : updateUser(input.id, input.payload)
  );
  const activeMutation = useApiMutation((input: { id: number; active: boolean }) =>
    setUserActive(input.id, input.active)
  );
  const deleteMutation = useApiMutation((input: { id: number }) => deleteUser(input.id));

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setError('');
    setModalOpen(true);
  }

  function openEdit(target: UserRecord) {
    setEditing(target);
    setForm({
      username: target.username ?? '',
      first_name: target.first_name ?? '',
      last_name: target.last_name ?? '',
      email: target.email ?? '',
      password: '',
      confirm: '',
      role: roleOf(target),
      store_id: target.store_id === null ? '' : String(target.store_id),
      active: target.active === 1
    });
    setFormErrors({});
    setError('');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setFormErrors({});
  }

  function validate(): UserPayload | null {
    const errors: Record<string, string> = {};
    if (!/^[A-Za-z0-9]{3,20}$/.test(form.username.trim())) errors.username = '3-20 caracteres alfanuméricos.';
    if (form.first_name.trim().length < 2) errors.first_name = 'Mínimo 2 caracteres.';
    if (form.last_name.trim().length < 2) errors.last_name = 'Mínimo 2 caracteres.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Correo inválido.';
    const requiresPassword = editing === null || form.password.length > 0;
    if (requiresPassword) {
      if (!/^(?=.*[A-Z])(?=.*\d).{8,72}$/.test(form.password)) {
        errors.password = 'Mínimo 8 caracteres, una mayúscula y un número.';
      }
      if (form.confirm !== form.password) errors.confirm = 'Las contraseñas no coinciden.';
    }
    if (form.role === 'staff' && !form.store_id) errors.store_id = 'La tienda es obligatoria para cajeros.';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return null;

    return {
      username: form.username.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      role: form.role,
      active: form.active,
      ...(form.store_id ? { store_id: Number(form.store_id) } : {}),
      ...(requiresPassword ? { password: form.password } : {})
    };
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const payload = validate();
    if (!payload) return;
    saveMutation.mutate({ id: editing?.id ?? null, payload }, {
      onSuccess: async () => {
        setNotice(editing === null ? 'Usuario creado.' : 'Usuario actualizado.');
        closeModal();
        await refresh();
      },
      onError: (mutationError: Error) => setError(mutationError.message)
    });
  }

  function toggleActive(target: UserRecord) {
    const nextActive = target.active !== 1;
    activeMutation.mutate({ id: target.id, active: nextActive }, {
      onSuccess: async () => {
        setNotice(nextActive ? 'Usuario activado.' : 'Usuario desactivado.');
        setError('');
        await refresh();
      },
      onError: (mutationError: Error) => setError(mutationError.message)
    });
  }

  function removeUser(target: UserRecord) {
    if (!window.confirm(`¿Eliminar (desactivar) a ${target.username ?? 'este usuario'}? Esta acción se puede revertir.`)) {
      return;
    }
    deleteMutation.mutate({ id: target.id }, {
      onSuccess: async () => {
        setNotice('Usuario eliminado (desactivado).');
        setError('');
        await refresh();
      },
      onError: (mutationError: Error) => setError(mutationError.message)
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="EQUIPO"
        title="Usuarios"
        actions={<button className="primary" onClick={openCreate}>+ Nuevo usuario</button>}
      />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Panel className="stack">
        <div className="toolbar">
          <label>Buscar
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Usuario, nombre o correo"
            />
          </label>
        </div>
        {usersQuery.isError ? <Notice tone="error">No fue posible cargar los usuarios.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Grupo</th><th>Tienda</th><th>Activo</th><th /></tr>
            </thead>
            <tbody>
              {users.map((target) => (
                <tr key={target.id}>
                  <td>{target.username || '—'}</td>
                  <td>{[target.first_name, target.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td>{target.email || '—'}</td>
                  <td>
                    {target.group_name ? (
                      <span className={`badge ${roleOf(target)}`}>
                        {roleOf(target) === 'admin' ? '🛡️' : '👤'} {target.group_name}
                      </span>
                    ) : (
                      <span className="badge none">— Sin asignar</span>
                    )}
                  </td>
                  <td>{stores.find((store) => store.id === target.store_id)?.name ?? 'Todas'}</td>
                  <td>
                    <span className={`status-dot ${target.active === 1 ? 'on' : 'off'}`} />
                    {target.active === 1 ? 'Sí' : 'No'}
                  </td>
                  <td className="row-actions">
                    <button className="quiet" onClick={() => openEdit(target)} title="Editar">✏️</button>
                    {target.active === 1 ? (
                      <button
                        className="quiet"
                        onClick={() => removeUser(target)}
                        disabled={target.id === currentUser?.id || deleteMutation.isPending}
                        title={target.id === currentUser?.id ? 'No puedes desactivar tu propia cuenta' : 'Eliminar (desactivar)'}
                      >
                        🗑️
                      </button>
                    ) : (
                      <button className="quiet" onClick={() => toggleActive(target)} disabled={activeMutation.isPending} title="Activar">✅</button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && !usersQuery.isPending ? (
                <tr><td colSpan={7} className="empty">No hay usuarios que coincidan.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={meta?.totalPages ?? 0}
          total={meta?.total ?? 0}
          onChange={setPage}
        />
      </Panel>

      {modalOpen ? (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <section className="modal-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">{editing === null ? 'NUEVO' : 'EDITANDO'}</p>
                <h2>{editing === null ? 'Crear usuario' : `Usuario ${editing.username ?? `#${editing.id}`}`}</h2>
              </div>
              <button className="quiet" type="button" onClick={closeModal}>✕</button>
            </div>
            <form className="form-grid" onSubmit={submitForm}>
              <label>Usuario
                <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} maxLength={20} required />
                {formErrors.username ? <small className="field-error">{formErrors.username}</small> : null}
              </label>
              <div className="field-row">
                <label>Nombre
                  <input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} maxLength={55} required />
                  {formErrors.first_name ? <small className="field-error">{formErrors.first_name}</small> : null}
                </label>
                <label>Apellido
                  <input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} maxLength={55} required />
                  {formErrors.last_name ? <small className="field-error">{formErrors.last_name}</small> : null}
                </label>
              </div>
              <label>Correo
                <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" maxLength={100} required />
                {formErrors.email ? <small className="field-error">{formErrors.email}</small> : null}
              </label>
              <label>{editing === null ? 'Contraseña' : 'Contraseña (dejar vacío para no cambiar)'}
                <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" autoComplete="new-password" />
                {formErrors.password ? <small className="field-error">{formErrors.password}</small> : null}
              </label>
              {form.password ? (
                <div className="strength">
                  <div className={`strength-bar ${strength}`}><span /></div>
                  <span>{strength === 'weak' ? 'Débil' : strength === 'medium' ? 'Media' : 'Fuerte'}</span>
                </div>
              ) : null}
              <label>Confirmar contraseña
                <input value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} type="password" autoComplete="new-password" />
                {formErrors.confirm ? <small className="field-error">{formErrors.confirm}</small> : null}
              </label>
              <div className="field-row">
                <label>Rol
                  <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
                    <option value="admin">Admin · administrador del tenant</option>
                    <option value="staff">Staff · cajero/empleado</option>
                  </select>
                </label>
                <label>Tienda
                  <select value={form.store_id} onChange={(event) => setForm({ ...form, store_id: event.target.value })}>
                    <option value="">Sin tienda asignada</option>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                  {formErrors.store_id ? <small className="field-error">{formErrors.store_id}</small> : null}
                </label>
              </div>
              <label className="checkbox">
                <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
                Activo
              </label>
              <div className="modal-actions">
                <button className="quiet" type="button" onClick={closeModal}>Cancelar</button>
                <button className="primary" type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Guardando…' : editing === null ? 'Crear usuario' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
