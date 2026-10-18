import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest, formatMoney, type StoreConfig } from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';

export function CartPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const { customer } = useAuth();

  const config = useQuery({
    queryKey: ['store-config'],
    queryFn: () => apiRequest<StoreConfig>('/marketplace/config'),
    staleTime: 10 * 60 * 1000
  });

  const shipping = Number(config.data?.shipping_flat ?? 0);
  const total = cart.total + (cart.items.length > 0 ? shipping : 0);

  const bySeller = new Map<string, typeof cart.items>();
  for (const item of cart.items) {
    const group = bySeller.get(item.seller_id);
    if (group) group.push(item);
    else bySeller.set(item.seller_id, [item]);
  }

  if (cart.items.length === 0) {
    return (
      <div className="page empty-state">
        <h2>Tu carrito está vacío</h2>
        <p>Explora el catálogo y agrega productos de tus tiendas favoritas.</p>
        <Link className="btn-primary" to="/buscar">
          Ir a comprar
        </Link>
      </div>
    );
  }

  return (
    <div className="page cart-layout">
      <section className="cart-main">
        <h1>Carrito de compras</h1>
        {[...bySeller.entries()].map(([sellerId, items]) => (
          <div key={sellerId} className="cart-seller-group">
            <div className="cart-seller-header">
              Vendido por <Link to={`/vendedor/${sellerId}`}>{items[0]?.seller_name}</Link>
            </div>
            {items.map((item) => (
              <div key={item.product_id} className="cart-line">
                <Link to={`/producto/${item.product_id}`} className="cart-line-image">
                  {item.image_url ? <img src={item.image_url} alt={item.name} /> : <div className="product-card-placeholder">🛍️</div>}
                </Link>
                <div className="cart-line-body">
                  <Link to={`/producto/${item.product_id}`} className="cart-line-title">
                    {item.name}
                  </Link>
                  <div className="cart-line-price">{formatMoney(item.price)} c/u</div>
                  <div className="cart-line-actions">
                    <label>
                      Cantidad:{' '}
                      <select
                        value={item.quantity}
                        onChange={(event) => cart.setQuantity(item.product_id, Number(event.target.value))}
                      >
                        {Array.from({ length: Math.min(10, item.available_quantity) }).map((_, index) => (
                          <option key={index + 1} value={index + 1}>
                            {index + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="link-button" onClick={() => cart.removeItem(item.product_id)}>
                      Eliminar
                    </button>
                  </div>
                </div>
                <div className="cart-line-total">{formatMoney(Number(item.price) * item.quantity)}</div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <aside className="cart-summary">
        <h2>Resumen del pedido</h2>
        <div className="summary-row">
          <span>Productos</span>
          <span>{formatMoney(cart.total)}</span>
        </div>
        <div className="summary-row">
          <span>Envío</span>
          <span>{shipping === 0 ? 'Gratis' : formatMoney(shipping)}</span>
        </div>
        <div className="summary-row total">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>
        <button
          type="button"
          className="btn-buy full"
          onClick={() => navigate(customer ? '/checkout' : '/ingresar?next=/checkout')}
        >
          Finalizar compra
        </button>
        {!customer && <p className="muted small">Inicia sesión para completar tu compra.</p>}
        <p className="muted small">Pago seguro con tarjetas y PSE a través de Bold.</p>
      </aside>
    </div>
  );
}
