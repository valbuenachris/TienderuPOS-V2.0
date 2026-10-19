import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type StoreConfig } from '../../api';
import { Icon } from '../ui/Icon';

function whatsappLink(value: string): string {
  return `https://wa.me/${value.replace(/\D/g, '')}`;
}

function socialLink(value: string, base: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${base}/${value.replace(/^@/, '')}`;
}

function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function Footer() {
  const config = useQuery({
    queryKey: ['store-config'],
    queryFn: () => apiRequest<StoreConfig>('/marketplace/config'),
    staleTime: 10 * 60 * 1000
  });
  const branding = config.data?.branding ?? null;

  const description =
    branding?.footer.description ??
    'Las tiendas de tu ciudad, en línea. Compra local con pago seguro y envío a domicilio.';
  const email = branding?.footer.email ?? 'info@tienderu.com';
  const phone = branding?.footer.phone ?? '310 403 9092';
  const whatsapp = branding?.footer.whatsapp;
  const address = branding?.footer.address;
  const instagram = branding?.footer.instagram;
  const facebook = branding?.footer.facebook;

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
          <p className="text-sm leading-relaxed">{description}</p>
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
            <li>
              <Link to="/favoritos" className="transition-colors hover:text-accent-400">
                Favoritos
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
              <Icon name="mail" className="h-4 w-4 shrink-0" />
              <a href={`mailto:${email}`} className="transition-colors hover:text-accent-400">
                {email}
              </a>
            </li>
            <li className="flex items-center gap-2">
              <Icon name="phone" className="h-4 w-4 shrink-0" />
              <a
                href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                className="transition-colors hover:text-accent-400"
              >
                {phone}
              </a>
            </li>
            {whatsapp ? (
              <li className="flex items-center gap-2">
                <Icon name="phone" className="h-4 w-4 shrink-0" />
                <a
                  href={whatsappLink(whatsapp)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-accent-400"
                >
                  WhatsApp {whatsapp}
                </a>
              </li>
            ) : null}
            {address ? (
              <li className="flex items-start gap-2">
                <Icon name="map-pin" className="mt-0.5 h-4 w-4 shrink-0" />
                <a
                  href={mapsLink(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-accent-400"
                >
                  {address}
                </a>
              </li>
            ) : null}
            {instagram || facebook ? (
              <li className="flex items-center gap-3 pt-1">
                {instagram ? (
                  <a
                    href={socialLink(instagram, 'https://instagram.com')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium transition-colors hover:text-accent-400"
                  >
                    Instagram
                  </a>
                ) : null}
                {facebook ? (
                  <a
                    href={socialLink(facebook, 'https://facebook.com')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium transition-colors hover:text-accent-400"
                  >
                    Facebook
                  </a>
                ) : null}
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-4 text-center text-xs text-white/60">
        © {new Date().getFullYear()} Tienderu.com — Todos los derechos reservados.
      </div>
    </footer>
  );
}
