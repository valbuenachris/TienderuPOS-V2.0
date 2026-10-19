import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, trackBannerClick, type Banner, type Product, type PromoBanner, type StoreHome } from '../api';
import { readRecent, savedToProduct } from '../local-lists';
import { useDocumentMeta } from '../use-document-meta';
import { ProductCard } from '../components/ProductCard';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';

export function HomePage() {
  const [recent] = useState(() => readRecent());
  useDocumentMeta({
    title: 'Tienderu.com — Todo lo que buscas de las tiendas de tu ciudad',
    description:
      'Compra en línea a las tiendas de tu ciudad: tecnología, hogar, mercado y más. Pago seguro y envío a domicilio.'
  });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['store-home'],
    queryFn: () => apiRequest<StoreHome>('/marketplace/home')
  });

  if (isLoading) {
    return (
      <div className="container-page py-6">
        <Skeleton className="mb-5 h-64 w-full rounded-card sm:h-80" />
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-card" />
          ))}
        </div>
        <ProductRailSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="alert"
          title="La tienda está tomando un descanso"
          description="No pudimos cargar los productos. Intenta de nuevo en unos minutos."
          action={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-accent-400 px-5 py-2 text-sm font-semibold text-navy-900 hover:bg-accent-500"
              onClick={() => window.location.reload()}
            >
              <Icon name="refresh" className="h-4 w-4" /> Reintentar
            </button>
          }
        />
      </div>
    );
  }

  const hasProducts = data.newest.length > 0 || data.top_rated.length > 0;

  return (
    <div className="container-page py-6">
      <TrustRow />

      {data.banners.length > 0 ? <BannerCarousel banners={data.banners} /> : null}

      {data.categories.length > 0 ? (
        <section aria-label="Categorías" className="mb-8">
          <h2 className="mb-3 text-lg font-bold text-ink sm:text-xl">Compra por categoría</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {data.categories.slice(0, 10).map((category) => (
              <Link
                key={category.name}
                to={`/buscar?category=${encodeURIComponent(category.name)}`}
                className="group flex flex-col gap-1 rounded-card bg-white p-4 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-line-soft text-link-600 transition-colors group-hover:bg-accent-300">
                  <Icon name="store" className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-ink">{category.name}</span>
                <span className="text-xs text-ink-soft">
                  {category.products_count} {category.products_count === 1 ? 'producto' : 'productos'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {!hasProducts ? (
        <EmptyState
          title="Muy pronto verás aquí los productos"
          description="Las tiendas están preparando su catálogo para tienderu.com."
        />
      ) : null}

      {data.top_rated.length > 0 ? (
        <ProductRail title="Mejor calificados" products={data.top_rated} moreHref="/buscar?sort=rating" />
      ) : null}
      {data.promos && data.promos.length > 0 ? <PromoStrip promos={data.promos} /> : null}
      {data.newest.length > 0 ? (
        <ProductRail title="Recién llegados a la tienda" products={data.newest} moreHref="/buscar?sort=newest" />
      ) : null}
      {recent.length >= 2 ? (
        <ProductRail title="Vistos recientemente" products={recent.map(savedToProduct)} />
      ) : null}
    </div>
  );
}

/** Banners pequeños: en móvil 1 visible con slider (swipe + puntos); en desktop 3 columnas en una línea. */
function PromoStrip({ promos }: { promos: PromoBanner[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [mobileIndex, setMobileIndex] = useState(0);

  function handleScroll() {
    const track = trackRef.current;
    if (!track) return;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    [...track.children].forEach((child, index) => {
      const distance = Math.abs((child as HTMLElement).offsetLeft - track.scrollLeft);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    setMobileIndex(nearest);
  }

  function goTo(index: number) {
    const track = trackRef.current;
    const child = track?.children[index] as HTMLElement | undefined;
    if (track && child) track.scrollTo({ left: child.offsetLeft, behavior: 'smooth' });
  }

  function card(promo: PromoBanner, imageClass: string) {
    const image = (
      <img
        src={promo.image_url}
        alt={promo.title ?? 'Promoción'}
        loading="lazy"
        className={`${imageClass} w-full rounded-card object-cover shadow-card transition-transform duration-200 group-hover:scale-[1.02]`}
      />
    );
    const target = promo.target_url;
    if (!target) {
      return <div className="group overflow-hidden rounded-card">{image}</div>;
    }
    if (target.startsWith('/')) {
      return (
        <Link
          to={target}
          onClick={() => trackBannerClick(promo.id)}
          className="group block overflow-hidden rounded-card"
        >
          {image}
        </Link>
      );
    }
    return (
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackBannerClick(promo.id)}
        className="group block overflow-hidden rounded-card"
      >
        {image}
      </a>
    );
  }

  return (
    <section aria-label="Promociones destacadas" className="mb-8">
      {/* Móvil: 1 banner visible con slider (swipe) y puntos */}
      <div className="sm:hidden">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {promos.map((promo) => (
            <div key={promo.id} className="w-full shrink-0 snap-center">
              {card(promo, 'h-[8.19rem]')}
            </div>
          ))}
        </div>
        {promos.length > 1 ? (
          <div className="mt-2 flex justify-center gap-1.5">
            {promos.map((promo, index) => (
              <button
                key={promo.id}
                type="button"
                aria-label={`Ir al banner ${index + 1}`}
                onClick={() => goTo(index)}
                className={
                  index === mobileIndex
                    ? 'h-2 w-2 rounded-full bg-navy-800'
                    : 'h-2 w-2 rounded-full bg-ink-soft/40'
                }
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Desktop: 3 columnas en una sola línea */}
      <div className="hidden gap-4 sm:grid sm:grid-cols-3">
        {promos.map((promo) => (
          <div key={promo.id}>{card(promo, 'h-[10.01rem]')}</div>
        ))}
      </div>
    </section>
  );
}

function TrustRow() {
  const items = [
    { icon: 'credit-card' as const, title: 'Pago seguro', text: 'Tarjetas y PSE con Bold' },
    { icon: 'truck' as const, title: 'Envío a domicilio', text: 'Coordinado con cada tienda' },
    { icon: 'store' as const, title: 'Vendedores locales', text: 'Tiendas de tu ciudad' },
    { icon: 'shield' as const, title: 'Compra protegida', text: 'Seguimiento de cada pedido' }
  ];
  return (
    <section
      aria-label="Ventajas de comprar en tienderu.com"
      className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {items.map((item) => (
        <div key={item.title} className="flex items-center gap-3 rounded-card bg-white px-4 py-3 shadow-card">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-600">
            <Icon name={item.icon} className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="line-clamp-1 text-sm font-bold text-ink">{item.title}</span>
            <span className="line-clamp-1 text-xs text-ink-soft">{item.text}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

function ProductRail({ title, products, moreHref }: { title: string; products: Product[]; moreHref?: string }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold text-ink sm:text-xl">{title}</h2>
        {moreHref ? (
          <Link
            to={moreHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-link-600 hover:text-link-700 hover:underline"
          >
            Ver más <Icon name="chevron-right" className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-4">
        {products.map((product) => (
          <div key={product.id} className="w-44 shrink-0 snap-start sm:w-auto">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductRailSkeleton() {
  return (
    <div className="mb-8">
      <Skeleton className="mb-3 h-6 w-48" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-72 rounded-card" />
        ))}
      </div>
    </div>
  );
}

function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % banners.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [banners.length]);

  const banner = banners[index];
  if (!banner) return null;

  return (
    <section aria-label="Promociones" className="relative mb-6 overflow-hidden rounded-card bg-white shadow-card">
      <img src={banner.image_url} alt="Promoción" className="h-56 w-full object-cover sm:h-80" />
      {banners.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Promoción anterior"
            onClick={() => setIndex((current) => (current - 1 + banners.length) % banners.length)}
            className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow-card transition-colors hover:bg-white sm:flex"
          >
            <Icon name="chevron-left" className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Promoción siguiente"
            onClick={() => setIndex((current) => (current + 1) % banners.length)}
            className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow-card transition-colors hover:bg-white sm:flex"
          >
            <Icon name="chevron-right" className="h-5 w-5" />
          </button>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {banners.map((item, dotIndex) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Ir a la promoción ${dotIndex + 1}`}
                onClick={() => setIndex(dotIndex)}
                className={
                  dotIndex === index
                    ? 'h-2.5 w-2.5 rounded-full bg-white shadow'
                    : 'h-2.5 w-2.5 rounded-full bg-white/50 shadow'
                }
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
