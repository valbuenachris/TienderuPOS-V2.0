import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useManagedCustomersQuery } from '../pos-queries';
import { createManagedCustomer, updateManagedCustomer } from '../api';
import type { ManagedCustomer, ManagedCustomerPayload } from '../api';

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, stores } = useSession();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [storeId, setStoreId] = useState<string>('');
  const customersQuery = useManagedCustomersQuery(token, tenantId, search, page, 20);

  const saveMutation = useApiMutation((input: { id: number | null; payload: ManagedCustomerPayload }) =>
    input.id === null ? createManagedCustomer(input.payload) : updateManagedCustomer(input.id, input.payload)
  );

  function resetForm() {
    setEditingId(null);
    setName('');
    setEmail('');
    setPhone('');
    setStoreId('');
  }

  function startEdit(customer: ManagedCustomer) {
    setEditingId(customer.id);
    setName(customer.name ?? '');
    setEmail(customer.email ?? '');
    setPhone(customer.phone ?? '');
    setStoreId(customer.store_id === null ? '' : String(customer.store_id));
    setNotice('');
  }

  function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: ManagedCustomerPayload = {
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      ...(storeId === '' ? {} : { store_id: Number(storeId) })
    };
    saveMutation.mutate({ id: editingId, payload }, {
      onSuccess: async () => {
        setNotice(editingId === null ? 'Cliente creado.' : 'Cliente actualizado.');
        resetForm();
        await queryClient.invalidateQueries({ queryKey: ['managed-customers'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const customers = customersQuery.data?.data ?? [];
  const meta = customersQuery.data?.meta;

  return (
    <>
      <PageHeader eyebrow="DIRECTORIO" title="Clientes" />
      {notice ? <Notice tone={/error|inválid|invalid|required/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      <div className="split-layout">
        <Panel className="stack">
          <label>Buscar
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Nombre del cliente" />
          </label>
          {customersQuery.isError ? <Notice tone="error">No fue posible cargar los clientes.</Notice> : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Tienda</th><th /></tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.name || '—'}</td>
                    <td>{customer.email || '—'}</td>
                    <td>{customer.phone || '—'}</td>
                    <td>{stores.find((store) => store.id === customer.store_id)?.name ?? 'Todas'}</td>
                    <td className="row-actions"><button className="quiet" onClick={() => startEdit(customer)}>Editar</button></td>
                  </tr>
                ))}
                {customers.length === 0 && !customersQuery.isPending ? (
                  <tr><td colSpan={5} className="empty">No hay clientes registrados.</td></tr>
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

        <Panel className="stack">
          <div className="section-heading">
            <div><p className="eyebrow">{editingId === null ? 'NUEVO' : 'EDITANDO'}</p><h2>{editingId === null ? 'Crear cliente' : `Cliente #${editingId}`}</h2></div>
            {editingId !== null ? <button className="quiet" onClick={resetForm}>Cancelar</button> : null}
          </div>
          <form className="form-grid" onSubmit={submitCustomer}>
            <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={55} /></label>
            <label>Correo<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" maxLength={100} /></label>
            <label>Teléfono<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={20} /></label>
            <label>Tienda
              <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                <option value="">Todas las tiendas</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <button className="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : editingId === null ? 'Crear cliente' : 'Guardar cambios'}
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
