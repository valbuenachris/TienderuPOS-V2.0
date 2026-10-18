import { Link } from 'react-router-dom';
import { Icon } from '../ui/Icon';

export function Footer() {
  return (
    <footer className="mt-12 bg-navy-800 text-white/80">
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="block w-full bg-navy-700 py-3.5 text-center text-sm font-medium text-white transition-colors hover:bg-navy-600"
      >
        <span className="inline-flex items-center gap-2">
          <Icon name="arrow-up" className="h-4 w-4" /> Volver arriba
        </span>
      </button>

      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Tienderu.com</h4>
          <p className="text-sm leading-relaxed">
            Las tiendas de tu ciudad, en línea. Compra local con pago seguro y envío a domicilio.
          </p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Compra</h4>
          <ul className="space-y-2 text-sm">
            <li>
              <Link to="/buscar" className="transition-colors hover:text-accent-400">
                Todo el catálogo
              </Link>
            </li>
            <li>
              <Link to="/buscar?sort=newest" className="transition-colors hover:text-accent-400">
                Novedades
              </Link>
            </li>
            <li>
              <Link to="/pedidos" className="transition-colors hover:text-accent-400">
                Mis pedidos
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Pagos y envíos</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Icon name="credit-card" className="h-4 w-4 shrink-0" /> Tarjetas y PSE con Bold
            </li>
            <li className="flex items-center gap-2">
              <Icon name="truck" className="h-4 w-4 shrink-0" /> Envío coordinado con cada tienda
            </li>
            <li className="flex items-center gap-2">
              <Icon name="shield" className="h-4 w-4 shrink-0" /> Pago 100% seguro
            </li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Ayuda</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Icon name="mail" className="h-4 w-4 shrink-0" /> info@tienderu.com
            </li>
            <li className="flex items-center gap-2">
              <Icon name="phone" className="h-4 w-4 shrink-0" /> 310 403 9092
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-4 text-center text-xs text-white/60">
        © {new Date().getFullYear()} Tienderu.com — Todos los derechos reservados.
      </div>
    </footer>
  );
}
