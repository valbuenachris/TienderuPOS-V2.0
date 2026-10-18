import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type SellerPage as SellerPagePayload } from '../api';
import { ProductCard } from '../components/ProductCard';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { ProductGridSkeleton, Skeleton } from '../components/ui/Skeleton';

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
      <div className="container-page py-6">
        <Skeleton className="mb-5 h-24 w-full rounded-card" />
        <ProductGridSkeleton count={8} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="store"
          title="Tienda no disponible"
          description="Esta tienda no está publicada en tienderu.com."
        />
      </div>
    );
  }

  return (
    <div className="container-page py-6">
      <header className="mb-6 flex items-center gap-4 rounded-card bg-white p-5 shadow-card">
        {data.seller.logo_url ? (
          <img
            src={data.seller.logo_url}
            alt={data.seller.name}
            className="h-16 w-16 rounded-xl border border-line bg-white object-contain p-1"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-navy-800 text-2xl font-extrabold text-accent-400">
            {data.seller.name.charAt(0)}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-ink sm:text-2xl">{data.seller.name}</h1>
          <p className="text-sm text-ink-soft">
            {data.products.meta.total}{' '}
            {data.products.meta.total === 1 ? 'producto publicado' : 'productos publicados'}
          </p>
        </div>
      </header>

      {data.products.data.length === 0 ? (
        <EmptyState
          icon="store"
          title="Esta tienda no tiene productos disponibles"
          description="Vuelve pronto: el vendedor está actualizando su catálogo."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.products.data.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <Pagination
        className="mt-8"
        page={page}
        totalPages={data.products.meta.totalPages}
        onChange={(nextPage) => {
          const next = new URLSearchParams(params);
          next.set('page', String(nextPage));
          setParams(next);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
