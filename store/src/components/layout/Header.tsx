import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatMoney, type Paginated, type Product, type StoreConfig } from '../../api';
import { useAuth } from '../../auth';
import { useCart } from '../../cart';
import { Icon } from '../ui/Icon';

function BrandLogo() {
  const config = useQuery({
    queryKey: ['store-config'],
    queryFn: () => apiRequest<StoreConfig>('/marketplace/config'),
    staleTime: 10 * 60 * 1000
  });
  const [broken, setBroken] = useState(false);
  const logoUrl = config.data?.branding?.logo_url ?? null;

  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt="Tienderu.com"
        className="h-17 w-auto max-w-[281px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <>
      <span className="flex h-17 w-17 items-center justify-center rounded-md bg-accent-400 text-[2.34rem] font-extrabold lowercase text-navy-900">
        t
      </span>
      <span className="hidden text-[2.34rem] font-bold sm:block">
        tienderu<span className="text-[1.56rem] font-semibold text-accent-400">.com</span>
      </span>
    </>
  );
}

const QUICK_LINKS = [
  { to: '/buscar', label: 'Todo' },
  { to: '/buscar?sort=newest', label: 'Novedades' },
  { to: '/buscar?sort=rating', label: 'Mejor calificados' },
  { to: '/buscar?sort=price_asc', label: 'Menor precio' }
];

function SearchBar({ autoFocus = false, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  const suggestions = useQuery({
    queryKey: ['store-search-suggest', debounced],
    queryFn: () =>
      apiRequest<Paginated<Product>>(`/marketplace/products?q=${encodeURIComponent(debounced)}&limit=6`),
    enabled: debounced.length >= 2 && open
  });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function go(value: string) {
    setOpen(false);
    onNavigate?.();
    navigate(value === '' ? '/buscar' : `/buscar?q=${encodeURIComponent(value)}`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    go(term.trim());
  }

  const showPanel = open && debounced.length >= 2;

  return (
    <div ref={containerRef} className="relative w-full">
      <form
        role="search"
        onSubmit={submit}
        className="flex overflow-hidden rounded-lg bg-white focus-within:ring-2 focus-within:ring-accent-400"
      >
        <input
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder="Busca productos, marcas y tiendas…"
          aria-label="Buscar en Tienderu"
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/70"
        />
        <button
          type="submit"
          aria-label="Buscar"
          title="Buscar"
          className="bg-accent-400 px-4 text-navy-900 transition-colors hover:bg-accent-500"
        >
          <Icon name="search" className="h-5 w-5" />
        </button>
      </form>

      {showPanel ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg bg-white shadow-float">
          {suggestions.isFetching ? (
            <div className="px-4 py-3 text-sm text-ink-soft">Buscando…</div>
          ) : null}
          {!suggestions.isFetching && suggestions.data && suggestions.data.data.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-soft">Sin resultados para «{debounced}»</div>
          ) : null}
          {(suggestions.data?.data ?? []).map((product) => (
            <button
              key={product.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
                navigate(`/producto/${product.id}`);
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-line-soft"
            >
              {product.image_url ? (
                <img src={product.image_url} alt="" className="h-9 w-9 rounded object-contain" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center text-lg" aria-hidden="true">
                  🛍️
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{product.name}</span>
                <span className="block truncate text-xs text-ink-soft">
                  {formatMoney(product.price)} · {product.seller.name}
                </span>
              </span>
            </button>
          ))}
          {suggestions.data && suggestions.data.data.length > 0 ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(term.trim())}
              className="block w-full border-t border-line-soft px-4 py-2.5 text-left text-sm font-semibold text-link-600 transition-colors hover:bg-line-soft"
            >
              Ver todos los resultados
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MobileDrawer({ onClose }: { onClose: () => void }) {
  const { customer, logout } = useAuth();
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const itemClass =
    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10';

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="presentation">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside
        className="animate-fade-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-navy-900 p-4 text-white"
        aria-label="Menú de navegación"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-bold">
            tienderu<span className="text-sm font-semibold text-accent-400">.com</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            title="Cerrar"
            className="rounded-full p-1.5 transition-colors hover:bg-white/10"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5">
          <Link to="/" className={itemClass} onClick={onClose}>
            <Icon name="home" className="h-4 w-4" /> Inicio
          </Link>
          <Link to="/buscar" className={itemClass} onClick={onClose}>
            <Icon name="search" className="h-4 w-4" /> Buscar
          </Link>
          <Link to="/pedidos" className={itemClass} onClick={onClose}>
            <Icon name="package" className="h-4 w-4" /> Mis pedidos
          </Link>
          {customer ? (
            <>
              <Link to="/cuenta" className={itemClass} onClick={onClose}>
                <Icon name="user" className="h-4 w-4" /> Mi cuenta
              </Link>
              <button
                type="button"
                className={`${itemClass} w-full text-left`}
                onClick={() => {
                  logout();
                  onClose();
                }}
              >
                <Icon name="log-out" className="h-4 w-4" /> Cerrar sesión
              </button>
            </>
          ) : (
            <Link to="/ingresar" className={itemClass} onClick={onClose}>
              <Icon name="user" className="h-4 w-4" /> Ingresar
            </Link>
          )}
        </nav>
        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-white/50">
            Descubre
          </p>
          <nav className="flex flex-col gap-0.5">
            {QUICK_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className={itemClass} onClick={onClose}>
                <Icon name="chevron-right" className="h-4 w-4" /> {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>
    </div>
  );
}

export function Header() {
  const { customer, logout } = useAuth();
  const cart = useCart();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40">
      <div className="bg-navy-900 text-white">
        <div className="container-page flex items-center gap-2 py-2.5 sm:gap-4">
          <button
            type="button"
            className="rounded p-1.5 transition-colors hover:bg-white/10 md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
            title="Menú"
          >
            <Icon name="menu" className="h-6 w-6" />
          </button>

          <Link to="/" className="flex shrink-0 items-center gap-2 rounded p-1" aria-label="Tienderu.com — Inicio">
            <BrandLogo />
          </Link>

          <div className="hidden flex-1 justify-center sm:flex">
            <div className="w-full max-w-2xl">
              <SearchBar />
            </div>
          </div>

          <nav className="ml-auto flex items-center gap-1 sm:gap-2" aria-label="Cuenta y carrito">
            {customer ? (
              <div className="hidden items-center sm:flex">
                <Link
                  to="/cuenta"
                  className="flex flex-col rounded px-2 py-1 leading-tight transition-colors hover:bg-white/10"
                >
                  <span className="text-xs text-white/70">
                    Hola, {customer.name?.split(' ')[0] ?? 'cliente'}
                  </span>
                  <span className="text-sm font-bold">Mi cuenta</span>
                </Link>
                <Link
                  to="/pedidos"
                  className="flex flex-col rounded px-2 py-1 leading-tight transition-colors hover:bg-white/10"
                >
                  <span className="text-xs text-white/70">Devoluciones</span>
                  <span className="text-sm font-bold">y Pedidos</span>
                </Link>
                <button
                  type="button"
                  onClick={logout}
                  className="flex flex-col rounded px-2 py-1 text-left leading-tight transition-colors hover:bg-white/10"
                >
                  <span className="text-xs text-white/70">Cerrar</span>
                  <span className="text-sm font-bold">sesión</span>
                </button>
              </div>
            ) : (
              <Link
                to="/ingresar"
                className="hidden flex-col rounded px-2 py-1 leading-tight transition-colors hover:bg-white/10 sm:flex"
              >
                <span className="text-xs text-white/70">Hola, identifícate</span>
                <span className="text-sm font-bold">Ingresar</span>
              </Link>
            )}

            <Link
              to="/carrito"
              className="relative flex items-end gap-1 rounded px-2 py-1 transition-colors hover:bg-white/10"
              aria-label={`Carrito de compras, ${cart.count} productos`}
            >
              {cart.count > 0 ? (
                <span className="absolute -top-1 left-6 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-400 px-1 text-xs font-bold text-navy-900">
                  {cart.count}
                </span>
              ) : null}
              <Icon name="cart" className="h-7 w-7" />
              <span className="hidden pb-0.5 text-sm font-bold sm:block">Carrito</span>
            </Link>
          </nav>
        </div>

        <div className="container-page pb-3 sm:hidden">
          <SearchBar />
        </div>
      </div>

      <div className="bg-navy-800 text-white">
        <div className="container-page flex items-center gap-5 overflow-x-auto py-2 text-sm">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="whitespace-nowrap transition-colors hover:text-accent-400"
            >
              {link.label}
            </Link>
          ))}
          <span className="ml-auto hidden whitespace-nowrap text-xs text-white/60 lg:block">
            Compra local, recibe en casa
          </span>
        </div>
      </div>

      {menuOpen ? <MobileDrawer onClose={() => setMenuOpen(false)} /> : null}
    </header>
  );
}
