import { useState } from 'react';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useManagedProductsQuery } from '../pos-queries';

export default function InventoryPage() {
  const { token, tenantId, stores } = useSession();
  const [storeId, setStoreId] = useState<number | null>(null);
  const effectiveStoreId = storeId ?? stores[0]?.id ?? null;
  const productsQuery = useManagedProductsQuery(token, tenantId, effectiveStoreId, '');
  const products = [...(productsQuery.data ?? [])].sort((a, b) => (a.store_quantity ?? 0) - (b.store_quantity ?? 0));

  return (
    <>
      <PageHeader
        eyebrow="EXISTENCIAS"
        title="Inventario"
        actions={(
          <select value={effectiveStoreId ?? ''} onChange={(event) => setStoreId(Number(event.target.value) || null)} aria-label="Tienda">
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        )}
      />
      <Panel className="stack">
        <p className="muted">Productos ordenados de menor a mayor existencia. Las filas en rojo tienen 5 unidades o menos.</p>
        {productsQuery.isError ? <Notice tone="error">No fue posible cargar el inventario.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Código</th><th>Nombre</th><th>Existencia</th><th>Precio tienda</th><th>Precio base</th></tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const low = (product.store_quantity ?? 0) <= 5;
                return (
                  <tr key={product.id} className={low ? 'low-stock' : ''}>
                    <td>{product.code || `#${product.id}`}</td>
                    <td>{product.name || '—'}</td>
                    <td><strong>{product.store_quantity ?? 0}</strong></td>
                    <td>{product.store_price ?? '—'}</td>
                    <td>{product.price ?? '—'}</td>
                  </tr>
                );
              })}
              {products.length === 0 && !productsQuery.isPending ? (
                <tr><td colSpan={5} className="empty">No hay inventario para esta tienda.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
