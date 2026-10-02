import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import ProductImagesEditor from '../components/ProductImagesEditor';
import { useSession } from '../app/session';
import { useApiMutation, useManagedProductsQuery } from '../pos-queries';
import { createManagedProduct, setManagedProductStock, updateManagedProduct } from '../api';
import type { ManagedProduct, ManagedProductPayload } from '../api';
import { formatMoney } from '../format';

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, stores, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [storeId, setStoreId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [tax, setTax] = useState('');
  const [rewardPoints, setRewardPoints] = useState('0');
  const [details, setDetails] = useState('');
  const [initialQuantity, setInitialQuantity] = useState('0');
  const [stockProduct, setStockProduct] = useState<ManagedProduct | null>(null);
  const [stockQuantity, setStockQuantity] = useState('0');
  const [modalOpen, setModalOpen] = useState(false);

  const effectiveStoreId = storeId ?? stores[0]?.id ?? null;
  const productsQuery = useManagedProductsQuery(token, tenantId, effectiveStoreId, search, page, 20);

  const saveMutation = useApiMutation((input: { id: number | null; payload: ManagedProductPayload }) => {
    if (input.id === null) return createManagedProduct(input.payload);
    return updateManagedProduct(input.id, {
      code: input.payload.code,
      name: input.payload.name,
      price: input.payload.price,
      cost: input.payload.cost,
      tax: input.payload.tax,
      reward_points: input.payload.reward_points,
      details: input.payload.details
    });
  });

  const stockMutation = useApiMutation((input: { id: number; store_id: number; quantity: number }) =>
    setManagedProductStock(input.id, { store_id: input.store_id, quantity: input.quantity })
  );

  function resetForm() {
    setModalOpen(false);
    setEditingId(null);
    setCode('');
    setName('');
    setPrice('');
    setCost('');
    setTax('');
    setRewardPoints('0');
    setDetails('');
    setInitialQuantity('0');
  }

  function openCreate() {
    resetForm();
    setModalOpen(true);
  }

  function startEdit(product: ManagedProduct) {
    setEditingId(product.id);
    setCode(product.code ?? '');
    setName(product.name ?? '');
    setPrice(product.price ?? '');
    setCost(product.cost ?? '');
    setTax(product.tax ?? '');
    setRewardPoints(String(product.reward_points ?? 0));
    setDetails(product.details ?? '');
    setNotice('');
    setModalOpen(true);
  }

  function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!effectiveStoreId) {
      setNotice('Selecciona una tienda.');
      return;
    }
    const payload: ManagedProductPayload = {
      code: code.trim(),
      name: name.trim(),
      price: price.trim(),
      cost: cost.trim() || undefined,
      tax: tax.trim() || undefined,
      reward_points: Number(rewardPoints) || 0,
      details: details.trim().slice(0, 1000)
    };
    if (editingId === null) {
      payload.store_id = effectiveStoreId;
      payload.quantity = Number(initialQuantity) || 0;
    }
    saveMutation.mutate({ id: editingId, payload }, {
      onSuccess: async () => {
        setNotice(editingId === null ? 'Producto creado.' : 'Producto actualizado.');
        resetForm();
        await queryClient.invalidateQueries({ queryKey: ['managed-products'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function submitStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stockProduct || !effectiveStoreId) {
      setNotice('Selecciona un producto para ajustar el stock.');
      return;
    }
    stockMutation.mutate(
      { id: stockProduct.id, store_id: effectiveStoreId, quantity: Number(stockQuantity) || 0 },
      {
        onSuccess: async () => {
          setNotice(`Stock actualizado para ${stockProduct.name ?? stockProduct.code ?? `#${stockProduct.id}`}.`);
          setStockProduct(null);
          setStockQuantity('0');
          await queryClient.invalidateQueries({ queryKey: ['managed-products'] });
        },
        onError: (error: Error) => setNotice(error.message)
      }
    );
  }

  const products = productsQuery.data?.data ?? [];
  const meta = productsQuery.data?.meta;
  const editingProduct = editingId === null ? null : products.find((product) => product.id === editingId) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="CATÁLOGO"
        title="Productos"
        actions={<button className="primary" onClick={openCreate}>+ Crear producto</button>}
      />
      {notice ? <Notice tone={/no fue|error|inválid|invalid|required/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      <div className="split-layout">
        <Panel className="stack">
          <div className="toolbar">
            <label>Tienda
              <select value={effectiveStoreId ?? ''} onChange={(event) => { setStoreId(Number(event.target.value) || null); setPage(1); }}>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label>Buscar
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Nombre o código" />
            </label>
          </div>
          {productsQuery.isError ? <Notice tone="error">No fue posible cargar los productos.</Notice> : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Código</th><th>Nombre</th><th>Precio</th><th>Costo</th><th>Imp.</th><th>Stock</th><th /></tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.code || `#${product.id}`}</td>
                    <td>{product.name || '—'}</td>
                    <td>{formatMoney(product.price, currency)}</td>
                    <td>{formatMoney(product.cost, currency)}</td>
                    <td>{product.tax ?? '0'}%</td>
                    <td>{product.store_quantity ?? 0}</td>
                    <td className="row-actions">
                      <button className="quiet" onClick={() => startEdit(product)}>Editar</button>
                      <button className="quiet" onClick={() => { setStockProduct(product); setStockQuantity(String(product.store_quantity ?? 0)); }}>Stock</button>
                    </td>
                  </tr>
                ))}
                {products.length === 0 && !productsQuery.isPending ? (
                  <tr><td colSpan={7} className="empty">No hay productos para esta tienda.</td></tr>
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

        {stockProduct ? (
          <Panel className="stack">
            <form className="form-grid" onSubmit={submitStock}>
              <p className="eyebrow">AJUSTE DE STOCK · {stockProduct.name ?? stockProduct.code ?? `#${stockProduct.id}`}</p>
              <label>Cantidad<input value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} inputMode="numeric" /></label>
              <div className="form-actions">
                <button className="primary" type="submit" disabled={stockMutation.isPending}>Guardar stock</button>
                <button className="quiet" type="button" onClick={() => setStockProduct(null)}>Cancelar</button>
              </div>
            </form>
          </Panel>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) resetForm(); }}>
          <section className="modal-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">{editingId === null ? 'NUEVO' : 'EDITANDO'}</p>
                <h2>{editingId === null ? 'Crear producto' : `Producto #${editingId}`}</h2>
              </div>
              <button className="quiet" type="button" onClick={resetForm} aria-label="Cerrar">✕</button>
            </div>
            <form className="form-grid" onSubmit={submitProduct}>
              <label>Código<input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={50} /></label>
              <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={55} /></label>
              <label>Precio<input value={price} onChange={(event) => setPrice(event.target.value)} required inputMode="decimal" placeholder="0.00" /></label>
              <label>Costo<input value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" placeholder="0.00" /></label>
              <label>Impuesto %<input value={tax} onChange={(event) => setTax(event.target.value)} inputMode="decimal" placeholder="0" /></label>
              <label>Puntos<input value={rewardPoints} onChange={(event) => setRewardPoints(event.target.value)} inputMode="numeric" /></label>
              <label>Descripción
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value.slice(0, 1000))}
                  rows={4}
                  maxLength={1000}
                  placeholder="Describe el producto, sus características, beneficios, uso…"
                />
                <small className="muted">{details.length}/1000 caracteres · se muestra en el catálogo de productos.</small>
              </label>
              {editingId === null ? (
                <label>Stock inicial<input value={initialQuantity} onChange={(event) => setInitialQuantity(event.target.value)} inputMode="numeric" /></label>
              ) : null}
              <button className="primary" type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Guardando…' : editingId === null ? 'Crear producto' : 'Guardar cambios'}
              </button>
            </form>

            {editingProduct ? <ProductImagesEditor product={editingProduct} /> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
