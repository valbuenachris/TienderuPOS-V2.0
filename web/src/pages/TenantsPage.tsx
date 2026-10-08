import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useTenantsQuery } from '../pos-queries';
import { createTenant } from '../api';
import type { CreateTenantPayload } from '../api';

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

  const saveMutation = useApiMutation((payload: CreateTenantPayload) => createTenant(payload));

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
        resetForm();
        await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
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

  const tenants = tenantsQuery.data ?? [];

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
                <tr key={tenant.id}>
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
                      className="quiet"
                      type="button"
                      onClick={() => { void enterTenant(tenant.id); }}
                      disabled={tenant.status !== 'active' || enteringId !== null}
                      title={tenant.status === 'active' ? 'Entrar a este tenant' : 'Tenant inactivo'}
                    >
                      {enteringId === tenant.id ? 'Entrando…' : 'Entrar'}
                    </button>
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
    </>
  );
}
