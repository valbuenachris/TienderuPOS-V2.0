import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useSuppliersQuery } from '../pos-queries';
import { createSupplier, updateSupplier } from '../api';
import type { SupplierPayload, SupplierRecord } from '../api';

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [cf1, setCf1] = useState('');
  const [cf2, setCf2] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const suppliersQuery = useSuppliersQuery(token, tenantId, search, page, 20);

  const saveMutation = useApiMutation((input: { id: number | null; payload: SupplierPayload }) =>
    input.id === null ? createSupplier(input.payload) : updateSupplier(input.id, input.payload)
  );

  function resetForm() {
    setEditingId(null);
    setName('');
    setCf1('');
    setCf2('');
    setPhone('');
    setEmail('');
  }

  function startEdit(supplier: SupplierRecord) {
    setEditingId(supplier.id);
    setName(supplier.name ?? '');
    setCf1(supplier.cf1 ?? '');
    setCf2(supplier.cf2 ?? '');
    setPhone(supplier.phone ?? '');
    setEmail(supplier.email ?? '');
    setNotice('');
  }

  function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: SupplierPayload = {
      name: name.trim(),
      cf1: cf1.trim() || undefined,
      cf2: cf2.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined
    };
    saveMutation.mutate({ id: editingId, payload }, {
      onSuccess: async () => {
        setNotice(editingId === null ? 'Proveedor creado.' : 'Proveedor actualizado.');
        resetForm();
        await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const suppliers = suppliersQuery.data?.data ?? [];
  const meta = suppliersQuery.data?.meta;

  return (
    <>
      <PageHeader eyebrow="ABASTECIMIENTO" title="Proveedores" />
      {notice ? <Notice tone={/error|inválid|invalid|required/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      <div className="split-layout">
        <Panel className="stack">
          <label>Buscar
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Nombre del proveedor" />
          </label>
          {suppliersQuery.isError ? <Notice tone="error">No fue posible cargar los proveedores.</Notice> : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Nombre</th><th>Contacto</th><th>Teléfono</th><th>Correo</th><th /></tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>{supplier.name || '—'}</td>
                    <td>{[supplier.cf1, supplier.cf2].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{supplier.phone || '—'}</td>
                    <td>{supplier.email || '—'}</td>
                    <td className="row-actions"><button className="quiet" onClick={() => startEdit(supplier)}>Editar</button></td>
                  </tr>
                ))}
                {suppliers.length === 0 && !suppliersQuery.isPending ? (
                  <tr><td colSpan={5} className="empty">No hay proveedores registrados.</td></tr>
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
            <div><p className="eyebrow">{editingId === null ? 'NUEVO' : 'EDITANDO'}</p><h2>{editingId === null ? 'Crear proveedor' : `Proveedor #${editingId}`}</h2></div>
            {editingId !== null ? <button className="quiet" onClick={resetForm}>Cancelar</button> : null}
          </div>
          <form className="form-grid" onSubmit={submitSupplier}>
            <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={55} /></label>
            <label>Contacto 1<input value={cf1} onChange={(event) => setCf1(event.target.value)} maxLength={255} /></label>
            <label>Contacto 2<input value={cf2} onChange={(event) => setCf2(event.target.value)} maxLength={255} /></label>
            <label>Teléfono<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={20} /></label>
            <label>Correo<input value={email} onChange={(event) => setEmail(event.target.value)} maxLength={100} /></label>
            <button className="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : editingId === null ? 'Crear proveedor' : 'Guardar cambios'}
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
