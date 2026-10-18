import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiRequest, type SellerPage as SellerPagePayload } from '../api';
import { ProductCard } from '../components/ProductCard';
import { Pagination } from './SearchPage';

export function SellerPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['store-seller', tenantId, page],
    queryFn: () => apiRequest<SellerPagePayload>(`/marketplace/sellers/${tenantId}?page=${page}&limit=24`),
    enabled: Boolean(tenantId)
  });

  if (isLoading) {
    return (
      <div className="page">
        <div className="skeleton-line skeleton" />
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
        <h2>Tienda no disponible</h2>
        <p>Esta tienda no está publicada en tienderu.com.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="seller-header">
        {data.seller.logo_url ? (
          <img src={data.seller.logo_url} alt={data.seller.name} className="seller-logo" />
        ) : (
          <div className="seller-logo placeholder">{data.seller.name.charAt(0)}</div>
        )}
        <div>
          <h1>{data.seller.name}</h1>
          <p className="muted">
            {data.products.meta.total} {data.products.meta.total === 1 ? 'producto publicado' : 'productos publicados'}
          </p>
        </div>
      </div>
      <div className="product-grid">
        {data.products.data.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      <Pagination
        page={page}
        totalPages={data.products.meta.totalPages}
        onPage={(nextPage) => {
          const next = new URLSearchParams(params);
          next.set('page', String(nextPage));
          setParams(next);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
