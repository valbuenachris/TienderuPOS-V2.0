import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useCart } from '../cart';

export function Header() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { customer, logout } = useAuth();
  const cart = useCart();

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = query.trim();
    navigate(clean === '' ? '/buscar' : `/buscar?q=${encodeURIComponent(clean)}`);
  }

  return (
    <header className="site-header">
      <div className="site-header-main">
        <Link to="/" className="brand" aria-label="Tienderu.com inicio">
          <span className="brand-mark">t</span>
          <span className="brand-name">
            tienderu<span className="brand-dot">.com</span>
          </span>
        </Link>

        <form className="search-form" role="search" onSubmit={submit}>
          <input
            type="search"
            placeholder="Busca productos, marcas y tiendas…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar en Tienderu"
          />
          <button type="submit" aria-label="Buscar">
            🔍
          </button>
        </form>

        <nav className="header-links">
          {customer ? (
            <div className="header-account">
              <Link to="/cuenta" className="header-link">
                <span className="header-link-small">Hola, {customer.name?.split(' ')[0] ?? 'cliente'}</span>
                <span className="header-link-strong">Mi cuenta</span>
              </Link>
              <Link to="/pedidos" className="header-link">
                <span className="header-link-small">Devoluciones</span>
                <span className="header-link-strong">y Pedidos</span>
              </Link>
              <button type="button" className="header-link header-link-button" onClick={logout}>
                <span className="header-link-small">Cerrar</span>
                <span className="header-link-strong">sesión</span>
              </button>
            </div>
          ) : (
            <Link to="/ingresar" className="header-link">
              <span className="header-link-small">Hola, identifícate</span>
              <span className="header-link-strong">Ingresar</span>
            </Link>
          )}
          <Link to="/carrito" className="header-cart" aria-label={`Carrito con ${cart.count} productos`}>
            <span className="header-cart-count">{cart.count}</span>
            <span className="header-cart-icon">🛒</span>
            <span className="header-cart-label">Carrito</span>
          </Link>
        </nav>
      </div>
      <div className="site-header-strip">
        <Link to="/buscar">Todo</Link>
        <Link to="/buscar?sort=newest">Novedades</Link>
        <Link to="/buscar?sort=rating">Mejor calificados</Link>
        <Link to="/buscar?sort=price_asc">Menor precio</Link>
        <span className="header-strip-note">Compra local, recibe en casa</span>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <button
        type="button"
        className="back-to-top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        Volver arriba
      </button>
      <div className="footer-grid">
        <div>
          <h4>Conócenos</h4>
          <p>Tienderu.com conecta las tiendas de tu ciudad contigo.</p>
        </div>
        <div>
          <h4>Compra</h4>
          <p>Pago seguro con tarjetas y PSE a través de Bold.</p>
          <p>Envío a domicilio coordinado con cada tienda.</p>
        </div>
        <div>
          <h4>Ayuda</h4>
          <p>¿Dudas con tu pedido? Escríbenos y te ayudamos.</p>
          <p>info@tienderu.com · 310 403 9092</p>
        </div>
      </div>
      <div className="footer-copy">© {new Date().getFullYear()} Tienderu.com — Todos los derechos reservados.</div>
    </footer>
  );
}
