import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Pagination, Panel } from '../components/ui';
import ProductImagesEditor from '../components/ProductImagesEditor';
import ProductScanner from '../components/ProductScanner';
import type { ScannerResult } from '../components/ProductScanner';
import { useSession } from '../app/session';
import { useApiMutation, useManagedProductsQuery } from '../pos-queries';
import { createManagedProduct, fetchManagedProducts, setManagedProductStock, updateManagedProduct } from '../api';
import type { ManagedProduct, ManagedProductPayload } from '../api';
import { parseScanValue } from '../scan';
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
  const [scannerMode, setScannerMode] = useState<'barcode' | 'qr' | null>(null);
  const [scannedCode, setScannedCode] = useState<string | null>(null);

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
    if (scannedCode) {
      setCode(scannedCode);
      setScannedCode(null);
    }
    setModalOpen(true);
  }

  async function handleScannedCode(raw: string): Promise<ScannerResult> {
    const value = parseScanValue(raw);
    if (modalOpen) {
      setCode(value);
      setScannedCode(null);
      window.setTimeout(() => document.getElementById('product-name')?.focus(), 80);
      return { ok: true, message: `Código capturado: ${value}` };
    }
    if (!effectiveStoreId) return { ok: false, message: 'Selecciona una tienda antes de escanear.' };
    try {
      const result = await fetchManagedProducts(effectiveStoreId, value, 1, 20);
      const normalized = value.trim().toLowerCase();
      const product = result.data.find((item) => (item.code ?? '').trim().toLowerCase() === normalized) ?? null;
      setSearch(value);
      setPage(1);
      if (!product) {
        setScannedCode(value);
        setNotice(`Producto no encontrado. Puede crearlo con el código: ${value}`);
        return { ok: false, message: `Producto no encontrado. Código listo para crear: ${value}` };
      }
      setScannedCode(null);
      setNotice(`Producto encontrado: ${product.name ?? product.code ?? `#${product.id}`}`);
      return { ok: true, message: `Producto encontrado: ${product.name ?? product.code ?? `#${product.id}`}` };
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : 'No fue posible buscar el producto.' };
    }
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
      <PageHeader eyebrow="CATÁLOGO" title="Productos" />
      {notice ? <Notice tone={/no fue|no encontrado|error|inválid|invalid|required/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {stores.length === 0 ? (
        <Notice tone="error">No hay tiendas configuradas en este tenant. Verifica el tenant activo o crea una tienda primero.</Notice>
      ) : null}
      <Panel className="stack full-width">
        <div className="toolbar">
          <label>Tienda
            <select value={effectiveStoreId ?? ''} onChange={(event) => { setStoreId(Number(event.target.value) || null); setPage(1); }}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label className="search-label">Buscar
            <div className="search-row">
              <input
                className="search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="Nombre o código"
              />
              <button
                className="icon-button"
                type="button"
                title="Escanear código de barras"
                aria-label="Escanear código de barras"
                onClick={() => setScannerMode('barcode')}
              >
                📷
              </button>
              <button
                className="icon-button"
                type="button"
                title="Escanear código QR"
                aria-label="Escanear código QR"
                onClick={() => setScannerMode('qr')}
              >
                🔳
              </button>
            </div>
          </label>
          <button className="primary" type="button" onClick={openCreate}>+ Crear producto</button>
        </div>
        {productsQuery.isError ? <Notice tone="error">No fue posible cargar los productos.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table products-table">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
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

      <Modal
        open={modalOpen}
        eyebrow={editingId === null ? 'NUEVO' : 'EDITANDO'}
        title={editingId === null ? 'Crear producto' : `Producto #${editingId}`}
        onClose={resetForm}
      >
        <form className="form-grid" onSubmit={submitProduct}>
          <label>Código
            <div className="input-with-scanner">
              <input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={50} />
              <button
                className="icon-button"
                type="button"
                title="Escanear código de barras"
                aria-label="Escanear código de barras"
                onClick={() => setScannerMode('barcode')}
              >
                📷
              </button>
              <button
                className="icon-button"
                type="button"
                title="Escanear código QR"
                aria-label="Escanear código QR"
                onClick={() => setScannerMode('qr')}
              >
                🔳
              </button>
            </div>
          </label>
          <label>Nombre<input id="product-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={55} /></label>
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
      </Modal>

      <Modal
        open={stockProduct !== null}
        eyebrow="AJUSTE"
        title={stockProduct ? `Stock · ${stockProduct.name ?? stockProduct.code ?? `#${stockProduct.id}`}` : 'Stock'}
        onClose={() => setStockProduct(null)}
      >
        <form className="form-grid" onSubmit={submitStock}>
          <label>Cantidad<input value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} inputMode="numeric" /></label>
          <div className="form-actions">
            <button className="primary" type="submit" disabled={stockMutation.isPending}>Guardar stock</button>
            <button className="quiet" type="button" onClick={() => setStockProduct(null)}>Cancelar</button>
          </div>
        </form>
      </Modal>
      <ProductScanner
        open={scannerMode !== null}
        mode={scannerMode ?? 'barcode'}
        onClose={() => setScannerMode(null)}
        onScan={handleScannedCode}
      />
    </>
  );
}
