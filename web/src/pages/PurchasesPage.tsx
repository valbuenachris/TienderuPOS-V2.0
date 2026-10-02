import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useManagedProductsQuery, usePurchasesQuery, useSuppliersQuery } from '../pos-queries';
import { createPurchase } from '../api';
import type { PurchasePayload } from '../api';
import { formatDate, formatMoney } from '../format';

interface PurchaseRow {
  key: number;
  productId: string;
  quantity: string;
  cost: string;
  salePrice: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PurchasesPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, stores, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [storeId, setStoreId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<PurchaseRow[]>([{ key: Date.now(), productId: '', quantity: '1', cost: '', salePrice: '' }]);
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);

  const effectiveStoreId = storeId ?? stores[0]?.id ?? null;
  const productsQuery = useManagedProductsQuery(token, tenantId, effectiveStoreId, '', 1, 100);
  const suppliersQuery = useSuppliersQuery(token, tenantId, '', 1, 100);
  const purchasesQuery = usePurchasesQuery(token, tenantId, undefined, undefined, page, 20);
  const products = productsQuery.data?.data ?? [];
  const suppliers = suppliersQuery.data?.data ?? [];

  const saveMutation = useApiMutation((payload: PurchasePayload) => createPurchase(payload));

  const total = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.cost) || 0), 0);

  function updateRow(key: number, patch: Partial<PurchaseRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function selectProduct(key: number, value: string) {
    const product = products.find((item) => String(item.id) === value);
    updateRow(key, {
      productId: value,
      cost: product?.cost ?? '',
      salePrice: product?.price ?? ''
    });
  }

  function addRow() {
    setRows((current) => [...current, { key: Date.now(), productId: '', quantity: '1', cost: '', salePrice: '' }]);
  }

  function removeRow(key: number) {
    setRows((current) => current.length === 1 ? current : current.filter((row) => row.key !== key));
  }

  function resetForm() {
    setSupplierId('');
    setReference('');
    setDate(today());
    setNote('');
    setRows([{ key: Date.now(), productId: '', quantity: '1', cost: '', salePrice: '' }]);
  }

  function submitPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = rows
      .filter((row) => row.productId !== '' && row.quantity.trim() !== '' && row.cost.trim() !== '')
      .map((row) => ({
        product_id: Number(row.productId),
        quantity: row.quantity.trim(),
        cost: row.cost.trim(),
        ...(row.salePrice.trim() ? { sale_price: row.salePrice.trim() } : {})
      }));
    if (items.length === 0) {
      setNotice('Agrega al menos un producto con cantidad y costo.');
      return;
    }
    if (!effectiveStoreId) {
      setNotice('Selecciona una tienda.');
      return;
    }

    const payload: PurchasePayload = { items, date, store_id: effectiveStoreId };
    if (supplierId) payload.supplier_id = Number(supplierId);
    if (reference.trim()) payload.reference = reference.trim();
    if (note.trim()) payload.note = note.trim();

    saveMutation.mutate(payload, {
      onSuccess: async (purchase) => {
        setNotice(`Compra #${purchase.id} registrada (${purchase.reference}).`);
        resetForm();
        await queryClient.invalidateQueries({ queryKey: ['purchases'] });
        await queryClient.invalidateQueries({ queryKey: ['managed-products'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const purchases = purchasesQuery.data?.data ?? [];
  const meta = purchasesQuery.data?.meta;

  return (
    <>
      <PageHeader eyebrow="ABASTECIMIENTO" title="Compras" />
      {notice ? <Notice tone={/error|inválid|invalid|required|insuficiente/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      <div className="split-layout">
        <Panel className="stack">
          <div className="section-heading">
            <div><p className="eyebrow">RECEPCIÓN</p><h2>Nueva compra</h2></div>
          </div>
          <form className="form-grid" onSubmit={submitPurchase}>
            <div className="toolbar">
              <label>Tienda
                <select value={effectiveStoreId ?? ''} onChange={(event) => setStoreId(Number(event.target.value) || null)}>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </label>
              <label>Proveedor
                <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label>Referencia<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Automática" maxLength={55} /></label>
              <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
            </div>

            <div className="purchase-rows">
              {rows.map((row) => (
                <div className="purchase-row" key={row.key}>
                  <label>Producto
                    <select value={row.productId} onChange={(event) => selectProduct(row.key, event.target.value)}>
                      <option value="">Selecciona…</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{product.code || `#${product.id}`} · {product.name || 'Producto'}</option>
                      ))}
                    </select>
                  </label>
                  <label>Cantidad<input value={row.quantity} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} inputMode="numeric" /></label>
                  <label>Costo<input value={row.cost} onChange={(event) => updateRow(row.key, { cost: event.target.value })} inputMode="decimal" placeholder="0.00" /></label>
                  <label>Precio venta<input value={row.salePrice} onChange={(event) => updateRow(row.key, { salePrice: event.target.value })} inputMode="decimal" placeholder="0.00" /></label>
                  <button className="quiet" type="button" onClick={() => removeRow(row.key)} aria-label="Quitar">✕</button>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="quiet" type="button" onClick={addRow}>+ Agregar producto</button>
            </div>

            <label>Nota<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} /></label>
            <div className="purchase-total"><span>Total de la compra</span><strong>{formatMoney(total, currency)}</strong></div>
            <button className="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Registrando…' : 'Registrar compra'}
            </button>
          </form>
        </Panel>

        <Panel className="stack">
          <div className="section-heading"><div><p className="eyebrow">HISTORIAL</p><h2>Últimas compras</h2></div></div>
          {purchasesQuery.isError ? <Notice tone="error">No fue posible cargar las compras.</Notice> : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>Fecha</th><th>Referencia</th><th>Proveedor</th><th>Total</th></tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>{purchase.id}</td>
                    <td>{formatDate(purchase.date)}</td>
                    <td>{purchase.reference || '—'}</td>
                    <td>{purchase.supplier_name || '—'}</td>
                    <td>{formatMoney(purchase.total, currency)}</td>
                  </tr>
                ))}
                {purchases.length === 0 && !purchasesQuery.isPending ? (
                  <tr><td colSpan={5} className="empty">No hay compras registradas.</td></tr>
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
      </div>
    </>
  );
}
