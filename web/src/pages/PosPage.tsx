import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice } from '../components/ui';
import { useSession } from '../app/session';
import { useCreateSaleMutation, useCustomersQuery, useProductsQuery } from '../pos-queries';
import type { Product, SaleResult } from '../api';
import { formatMoney } from '../format';

type CartLine = { product: Product; quantity: number };
type PaymentMode = 'cash' | 'CC' | 'Transferencia' | 'due';

export default function PosPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, user, isAdmin, stores, settings } = useSession();
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [notice, setNotice] = useState('');
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);

  const storeId = selectedStoreId ?? user?.store_id ?? (isAdmin ? stores[0]?.id ?? null : null);
  const productsQuery = useProductsQuery(token, tenantId, storeId, search);
  const customersQuery = useCustomersQuery(token, tenantId, storeId);
  const saleMutation = useCreateSaleMutation();

  const customers = customersQuery.data ?? [];
  const configuredCustomerId = settings?.default_customer ?? null;
  const defaultCustomerId = configuredCustomerId !== null
    && customers.some((customer) => customer.id === configuredCustomerId)
    ? configuredCustomerId
    : null;
  const effectiveCustomerId = customerId === 0 ? null : customerId ?? defaultCustomerId;
  const currency = settings?.currency_prefix || 'COP';

  const estimatedTotal = useMemo(() => cart.reduce((sum, line) => {
    const unitPrice = Number(line.product.price || 0);
    const taxPercent = Number(line.product.tax || 0);
    return sum + (unitPrice + unitPrice * taxPercent / 100) * line.quantity;
  }, 0), [cart]);

  function submitSale() {
    if (!storeId || cart.length === 0) {
      setNotice('Selecciona una tienda y agrega productos.');
      return;
    }
    saleMutation.mutate({
      store_id: storeId,
      ...(effectiveCustomerId ? { customer_id: effectiveCustomerId } : {}),
      items: cart.map((line) => ({ product_id: line.product.id, quantity: String(line.quantity) })),
      ...(paymentMode === 'due' ? {} : { paid_by: paymentMode })
    }, {
      onSuccess: async (sale) => {
        setLastSale(sale);
        setCart([]);
        setCustomerId(null);
        setNotice(`Venta #${sale.id} registrada.`);
        await queryClient.invalidateQueries({ queryKey: ['products', tenantId, storeId] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function addToCart(product: Product) {
    if (product.type === 'combo') {
      setNotice('Los combos se habilitarán después de validar sus componentes e inventario.');
      return;
    }
    if (product.price === null) {
      setNotice('El producto no tiene un precio definido.');
      return;
    }
    const available = Number(product.available_quantity || 0);
    const currentQuantity = cart.find((line) => line.product.id === product.id)?.quantity ?? 0;
    if (currentQuantity + 1 > available) {
      setNotice('No hay existencias suficientes en esta tienda.');
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { product, quantity: 1 }];
    });
    setNotice('');
  }

  function setQuantity(productId: number, quantity: number) {
    const line = cart.find((item) => item.product.id === productId);
    const available = Number(line?.product.available_quantity || 0);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setCart((current) => current.filter((item) => item.product.id !== productId));
      return;
    }
    if (quantity > available) {
      setNotice('No hay existencias suficientes en esta tienda.');
      return;
    }
    setCart((current) => current.map((item) => item.product.id === productId ? { ...item, quantity } : item));
  }

  if (!storeId) {
    return (
      <div className="login-shell inline">
        <section className="login-card">
          <div className="brand-mark">P</div>
          <p className="eyebrow">POS · CONFIGURACIÓN</p>
          <h1>Falta asignar tienda</h1>
          <p className="muted">Asigna una tienda al usuario POS, o inicia con un grupo administrador y una tienda disponible para el tenant.</p>
        </section>
      </div>
    );
  }

  const products = productsQuery.data ?? [];

  return (
    <div className="workspace">
      <section className="catalog-panel">
        <div className="section-heading">
          <div><p className="eyebrow">PUNTO DE VENTA</p><h1>Nueva venta</h1></div>
          {isAdmin ? (
            <select value={storeId} disabled={saleMutation.isPending} onChange={(event) => {
              setSelectedStoreId(Number(event.target.value));
              setCart([]);
              setCustomerId(null);
              setNotice('');
            }} aria-label="Tienda">
              {stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
            </select>
          ) : <div className="store-pill">{stores[0]?.name || 'Tienda asignada'}</div>}
        </div>
        {notice ? <Notice>{notice}</Notice> : null}
        {customersQuery.isError ? <Notice tone="error">No fue posible cargar los clientes de esta tienda.</Notice> : null}
        <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto por nombre o código…" />
        {productsQuery.isError ? <Notice tone="error">No fue posible cargar el catálogo.</Notice> : null}
        <div className="product-grid">
          {productsQuery.isPending ? <div className="empty">Cargando productos…</div> : null}
          {products.map((product) => (
            <button
              className="product-card"
              key={product.id}
              disabled={saleMutation.isPending || product.price === null || Number(product.available_quantity) <= 0}
              onClick={() => addToCart(product)}
            >
              <span className="product-code">{product.code || `#${product.id}`}</span>
              <strong>{product.name || 'Producto'}</strong>
              <span>{formatMoney(product.price, currency)}</span>
              <small>Disponible: {product.available_quantity ?? '0'}</small>
            </button>
          ))}
          {products.length === 0 && !productsQuery.isPending ? <div className="empty">No hay productos para mostrar en esta tienda.</div> : null}
        </div>
      </section>

      <aside className="ticket-panel">
        <div className="ticket-heading"><div><p className="eyebrow">TICKET</p><h2>Venta actual</h2></div><span>{cart.length} líneas</span></div>
        <label>Cliente
          <select
            value={customerId === null ? defaultCustomerId ?? '' : customerId || ''}
            disabled={saleMutation.isPending}
            onChange={(event) => setCustomerId(Number(event.target.value) || 0)}
          >
            <option value="">Cliente ocasional</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone || customer.email || ''}</option>)}
          </select>
        </label>
        <div className="cart-lines">
          {cart.map((line) => (
            <div className="cart-line" key={line.product.id}>
              <div><strong>{line.product.name}</strong><small>{formatMoney(line.product.price, currency)} c/u</small></div>
              <div className="quantity-control">
                <button disabled={saleMutation.isPending} onClick={() => setQuantity(line.product.id, line.quantity - 1)} aria-label="Restar">−</button>
                <span>{line.quantity}</span>
                <button disabled={saleMutation.isPending} onClick={() => setQuantity(line.product.id, line.quantity + 1)} aria-label="Sumar">+</button>
              </div>
            </div>
          ))}
          {cart.length === 0 ? <div className="empty">Agrega productos para comenzar.</div> : null}
        </div>
        <div className="ticket-footer">
          <label>Forma de pago
            <select value={paymentMode} disabled={saleMutation.isPending} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}>
              <option value="cash">Efectivo</option><option value="CC">Tarjeta</option>
              <option value="Transferencia">Transferencia</option><option value="due">Cuenta pendiente</option>
            </select>
          </label>
          <div className="total-row"><span>Total aproximado</span><strong>{formatMoney(estimatedTotal, currency)}</strong></div>
          <small className="muted">El servidor recalcula impuestos y existencias antes de confirmar.</small>
          <button className="primary full checkout" onClick={submitSale} disabled={saleMutation.isPending || cart.length === 0}>
            {saleMutation.isPending ? 'Procesando…' : 'Registrar venta'}
          </button>
          {lastSale ? <div className="receipt">Última venta: <strong>#{lastSale.id}</strong> · {formatMoney(lastSale.grand_total, currency)}</div> : null}
        </div>
      </aside>
    </div>
  );
}
