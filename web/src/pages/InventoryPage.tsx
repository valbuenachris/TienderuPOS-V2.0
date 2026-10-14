import { useState } from 'react';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useManagedProductsQuery } from '../pos-queries';
import { formatMoney } from '../format';

export default function InventoryPage() {
  const { token, tenantId, stores, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [storeId, setStoreId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const effectiveStoreId = storeId ?? stores[0]?.id ?? null;
  const productsQuery = useManagedProductsQuery(token, tenantId, effectiveStoreId, '', page, 20);
  const products = [...(productsQuery.data?.data ?? [])].sort((a, b) => (a.store_quantity ?? 0) - (b.store_quantity ?? 0));
  const meta = productsQuery.data?.meta;

  return (
    <>
      <PageHeader
        eyebrow="EXISTENCIAS"
        title="Inventario"
        actions={stores.length > 1 ? (
          <select value={effectiveStoreId ?? ''} onChange={(event) => { setStoreId(Number(event.target.value) || null); setPage(1); }} aria-label="Tienda">
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        ) : (
          <div className="store-pill">{stores[0]?.name || 'Tienda'}</div>
        )}
      />
      <Panel className="stack">
        <p className="muted">Productos ordenados de menor a mayor existencia. Las filas en rojo tienen 5 unidades o menos.</p>
        {stores.length === 0 ? (
          <Notice tone="error">No hay tiendas configuradas en este tenant. Verifica el tenant activo o crea una tienda primero.</Notice>
        ) : null}
        {productsQuery.isError ? <Notice tone="error">No fue posible cargar el inventario.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Código</th><th>Nombre</th><th>Existencia</th><th>Precio base</th><th>Precio tienda</th><th>Valor total</th></tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const low = (product.store_quantity ?? 0) <= 5;
                return (
                  <tr key={product.id} className={low ? 'low-stock' : ''}>
                    <td>{product.code || `#${product.id}`}</td>
                    <td>{product.name || '—'}</td>
                    <td><strong>{product.store_quantity ?? 0}</strong></td>
                    <td>{product.cost === null || product.cost === undefined ? '—' : formatMoney(product.cost, currency)}</td>
                    <td>{product.store_price === null || product.store_price === undefined ? '—' : formatMoney(product.store_price, currency)}</td>
                    <td className="money-cell">{product.line_total_value === null || product.line_total_value === undefined ? '—' : formatMoney(product.line_total_value, currency)}</td>
                  </tr>
                );
              })}
              {products.length === 0 && !productsQuery.isPending ? (
                <tr><td colSpan={6} className="empty">No hay inventario para esta tienda.</td></tr>
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
        <div className="inventory-total">
          <span>Valor total del inventario</span>
          <strong>{formatMoney(meta?.grand_total, currency)}</strong>
        </div>
      </Panel>
    </>
  );
}
