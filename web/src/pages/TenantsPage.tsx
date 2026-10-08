import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useTenantsQuery } from '../pos-queries';
import { createTenant, deleteTenant, updateTenant } from '../api';
import type { CreateTenantPayload, TenantRecord, UpdateTenantPayload } from '../api';

export default function TenantsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token, tenantId, isSuperAdmin, switchTenant } = useSession();
  const tenantsQuery = useTenantsQuery(token, tenantId, isSuperAdmin);

  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ tenantName: string; username: string; password: string } | null>(null);
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editHost, setEditHost] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [deletingTenant, setDeletingTenant] = useState<TenantRecord | null>(null);

  const saveMutation = useApiMutation((payload: CreateTenantPayload) => createTenant(payload));
  const editMutation = useApiMutation((input: { id: string; payload: UpdateTenantPayload }) =>
    updateTenant(input.id, input.payload)
  );
  const deleteMutation = useApiMutation((id: string) => deleteTenant(id));

  function resetForm() {
    setModalOpen(false);
    setName('');
    setHost('');
    setStatus('active');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setNotice('El nombre del tenant es obligatorio.');
      return;
    }
    const payload: CreateTenantPayload = { name: name.trim(), status };
    if (host.trim()) payload.host = host.trim().toLowerCase();
    saveMutation.mutate(payload, {
      onSuccess: async (tenant) => {
        setNotice(`Tenant “${tenant.name}” creado.`);
        setCredentials({
          tenantName: tenant.name,
          username: tenant.admin_username,
          password: tenant.admin_password
        });
        resetForm();
        await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copiado al portapapeles.`);
    } catch (_error: unknown) {
      setNotice('No se pudo copiar automáticamente; copia el valor manualmente.');
    }
  }

  async function enterTenant(id: string) {
    if (enteringId !== null) return;
    setNotice('');
    setEnteringId(id);
    try {
      await switchTenant(id);
      navigate('/pos');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No fue posible cambiar de tenant');
    } finally {
      setEnteringId(null);
    }
  }

  function openEdit(tenant: TenantRecord) {
    setNotice('');
    setEditingTenant(tenant);
    setEditName(tenant.name);
    setEditHost(tenant.host ?? '');
    setEditStatus(tenant.status === 'active' ? 'active' : 'inactive');
  }

  function closeEdit() {
    setEditingTenant(null);
    setEditName('');
    setEditHost('');
    setEditStatus('active');
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTenant) return;
    if (!editName.trim()) {
      setNotice('El nombre del tenant es obligatorio.');
      return;
    }
    const payload: UpdateTenantPayload = {
      name: editName.trim(),
      host: editHost.trim() ? editHost.trim().toLowerCase() : null,
      status: editStatus
    };
    editMutation.mutate({ id: editingTenant.id, payload }, {
      onSuccess: async (tenant) => {
        setNotice(`Tenant “${tenant.name}” actualizado.`);
        closeEdit();
        await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function toggleStatus(tenant: TenantRecord) {
    const next = tenant.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive' && !window.confirm(`¿Desactivar el tenant “${tenant.name}”? Sus usuarios no podrán operar.`)) {
      return;
    }
    editMutation.mutate({ id: tenant.id, payload: { status: next } }, {
      onSuccess: async (updated) => {
        setNotice(`Tenant “${updated.name}” ${next === 'active' ? 'activado' : 'desactivado'}.`);
        await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function canDelete(tenant: TenantRecord): boolean {
    return tenant.sales_count === 0 && tenant.users_count <= 1;
  }

  function confirmDelete() {
    if (!deletingTenant) return;
    deleteMutation.mutate(deletingTenant.id, {
      onSuccess: async () => {
        setNotice('Tenant eliminado exitosamente.');
        setDeletingTenant(null);
        await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      },
      onError: (error: Error) => {
        setNotice(error.message);
        setDeletingTenant(null);
      }
    });
  }

  const tenants = tenantsQuery.data ?? [];
  const hostChanged = editingTenant !== null && editHost.trim().toLowerCase() !== (editingTenant.host ?? '');

  return (
    <>
      <PageHeader eyebrow="GLOBAL" title="Tenants" />
      {notice ? <Notice tone={/error|inválid|invalid|obligatorio|ya está|not active/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      <Panel className="stack full-width">
        <div className="toolbar">
          <button className="primary" type="button" onClick={() => { setModalOpen(true); setNotice(''); }}>+ Crear tenant</button>
        </div>
        {tenantsQuery.isError ? <Notice tone="error">No fue posible cargar los tenants.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th><th>Host</th><th>Estado</th><th>Usuarios</th><th>Tiendas</th><th>Ventas</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className={tenant.status === 'active' ? '' : 'row-inactive'}>
                  <td>{tenant.name}</td>
                  <td>{tenant.host || '—'}</td>
                  <td>
                    <span className={`badge ${tenant.status === 'active' ? 'paid' : 'due'}`}>
                      {tenant.status === 'active' ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>{tenant.users_count}</td>
                  <td>{tenant.stores_count}</td>
                  <td>{tenant.sales_count}</td>
                  <td className="row-actions">
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => openEdit(tenant)}
                      title="Editar tenant"
                      aria-label="Editar tenant"
                    >
                      ✏️
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => toggleStatus(tenant)}
                      disabled={editMutation.isPending}
                      title={tenant.status === 'active' ? 'Desactivar tenant' : 'Activar tenant'}
                      aria-label={tenant.status === 'active' ? 'Desactivar tenant' : 'Activar tenant'}
                    >
                      {tenant.status === 'active' ? '🔴' : '🟢'}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => { void enterTenant(tenant.id); }}
                      disabled={tenant.status !== 'active' || enteringId !== null}
                      title={tenant.status === 'active' ? 'Entrar a este tenant' : 'Tenant inactivo'}
                      aria-label="Entrar a este tenant"
                    >
                      ➡️
                    </button>
                    {canDelete(tenant) ? (
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => { setNotice(''); setDeletingTenant(tenant); }}
                        disabled={deleteMutation.isPending}
                        title="Eliminar tenant"
                        aria-label="Eliminar tenant"
                      >
                        🗑️
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && !tenantsQuery.isPending ? (
                <tr><td colSpan={7} className="empty">No hay tenants registrados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal
        open={modalOpen}
        eyebrow="NUEVO"
        title="Crear tenant"
        onClose={resetForm}
      >
        <form className="form-grid" onSubmit={submit}>
          <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
          <label>Host<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="pos.ejemplo.com" maxLength={255} /></label>
          <label>Estado
            <select value={status} onChange={(event) => setStatus(event.target.value === 'inactive' ? 'inactive' : 'active')}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          <button className="primary" type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Creando…' : 'Crear tenant'}
          </button>
        </form>
      </Modal>

      <Modal
        open={editingTenant !== null}
        eyebrow="EDITANDO"
        title={editingTenant ? `Editar · ${editingTenant.name}` : 'Editar tenant'}
        onClose={closeEdit}
      >
        <form className="form-grid" onSubmit={submitEdit}>
          <label>Nombre<input value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={100} /></label>
          <label>Host<input value={editHost} onChange={(event) => setEditHost(event.target.value)} placeholder="pos.ejemplo.com" maxLength={255} /></label>
          {hostChanged ? (
            <Notice>
              Cambiar el host puede afectar el acceso si el DNS no está configurado. Deja el campo vacío para quitarlo.
            </Notice>
          ) : null}
          <label>Estado
            <select value={editStatus} onChange={(event) => setEditStatus(event.target.value === 'inactive' ? 'inactive' : 'active')}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={closeEdit} disabled={editMutation.isPending}>Cancelar</button>
            <button className="primary" type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deletingTenant !== null}
        eyebrow="ELIMINAR"
        title={deletingTenant ? `Eliminar · ${deletingTenant.name}` : 'Eliminar tenant'}
        onClose={() => setDeletingTenant(null)}
      >
        {deletingTenant ? (
          <div className="stack">
            <Notice tone="error">
              ⚠️ ¿Estás seguro de eliminar el tenant “{deletingTenant.name}”? Esta acción no se puede deshacer.
            </Notice>
            {deletingTenant.sales_count > 0 || deletingTenant.users_count > 0 ? (
              <p className="muted">
                Este tenant tiene {deletingTenant.sales_count} ventas y {deletingTenant.users_count} usuarios registrados;
                si tiene dependencias activas, el servidor rechazará la eliminación.
              </p>
            ) : null}
            <div className="modal-actions">
              <button className="quiet" type="button" onClick={() => setDeletingTenant(null)} disabled={deleteMutation.isPending}>
                Cancelar
              </button>
              <button className="danger" type="button" onClick={confirmDelete} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={credentials !== null}
        eyebrow="TENANT CREADO"
        title={credentials ? `Credenciales · ${credentials.tenantName}` : 'Credenciales'}
        onClose={() => setCredentials(null)}
      >
        {credentials ? (
          <div className="stack">
            <Notice tone="success">
              Tenant creado exitosamente. ⚠️ Copia estas credenciales y compártelas con el cliente; no se volverán a mostrar.
            </Notice>
            <label>Usuario administrador
              <div className="credential-row">
                <input value={credentials.username} readOnly />
                <button className="quiet" type="button" onClick={() => { void copyText(credentials.username, 'Usuario'); }}>Copiar</button>
              </div>
            </label>
            <label>Contraseña
              <div className="credential-row">
                <input value={credentials.password} readOnly />
                <button className="quiet" type="button" onClick={() => { void copyText(credentials.password, 'Contraseña'); }}>Copiar</button>
              </div>
            </label>
            <div className="modal-actions">
              <button
                className="quiet"
                type="button"
                onClick={() => { void copyText(`Usuario: ${credentials.username}\nContraseña: ${credentials.password}`, 'Credenciales'); }}
              >
                Copiar ambos
              </button>
              <button className="primary" type="button" onClick={() => setCredentials(null)}>Cerrar</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
