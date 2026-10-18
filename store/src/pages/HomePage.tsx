import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type Product, type StoreHome } from '../api';
import { ProductCard } from '../components/ProductCard';

export function HomePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['store-home'],
    queryFn: () => apiRequest<StoreHome>('/marketplace/home')
  });

  if (isLoading) {
    return (
      <div className="page">
        <div className="hero-skeleton skeleton" />
        <div className="product-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="product-card skeleton-card" />
          ))}
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="page empty-state">
        <h2>La tienda está tomando un descanso</h2>
        <p>No pudimos cargar los productos. Intenta de nuevo en unos minutos.</p>
      </div>
    );
  }

  const hasProducts = data.newest.length > 0 || data.top_rated.length > 0;

  return (
    <div className="page">
      {data.banners.length > 0 && <BannerCarousel banners={data.banners} />}

      {data.categories.length > 0 && (
        <section className="category-tiles">
          {data.categories.slice(0, 8).map((category) => (
            <Link
              key={category.name}
              to={`/buscar?category=${encodeURIComponent(category.name)}`}
              className="category-tile"
            >
              <span className="category-tile-name">{category.name}</span>
              <span className="category-tile-count">{category.products_count} productos</span>
            </Link>
          ))}
        </section>
      )}

      {!hasProducts && (
        <div className="empty-state">
          <h2>Muy pronto verás aquí los productos</h2>
          <p>Las tiendas están preparando su catálogo para tienderu.com.</p>
        </div>
      )}

      {data.top_rated.length > 0 && (
        <ProductRail title="Mejor calificados" products={data.top_rated} moreHref="/buscar?sort=rating" />
      )}
      {data.newest.length > 0 && (
        <ProductRail title="Recién llegados a la tienda" products={data.newest} moreHref="/buscar?sort=newest" />
      )}
    </div>
  );
}

function ProductRail({ title, products, moreHref }: { title: string; products: Product[]; moreHref: string }) {
  return (
    <section className="product-rail">
      <div className="rail-header">
        <h2>{title}</h2>
        <Link to={moreHref} className="rail-more">
          Ver más
        </Link>
      </div>
      <div className="rail-scroll">
        {products.map((product) => (
          <div key={product.id} className="rail-item">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}

function BannerCarousel({ banners }: { banners: StoreHome['banners'] }) {
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
    <section className="hero" aria-label="Promociones">
      <img src={banner.image_url} alt="Promoción" />
      {banners.length > 1 && (
        <div className="hero-dots">
          {banners.map((item, dotIndex) => (
            <button
              key={item.id}
              type="button"
              className={dotIndex === index ? 'hero-dot active' : 'hero-dot'}
              aria-label={`Ir a la promoción ${dotIndex + 1}`}
              onClick={() => setIndex(dotIndex)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
