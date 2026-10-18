import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, type Category, type Paginated, type Product } from '../api';
import { ProductCard } from '../components/ProductCard';

const SORT_LABELS: Array<{ value: string; label: string }> = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'newest', label: 'Más recientes' },
  { value: 'price_asc', label: 'Precio: menor a mayor' },
  { value: 'price_desc', label: 'Precio: mayor a menor' },
  { value: 'rating', label: 'Mejor calificados' }
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'relevance';
  const minPrice = params.get('min_price') ?? '';
  const maxPrice = params.get('max_price') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (category) query.set('category', category);
  if (sort) query.set('sort', sort);
  if (minPrice) query.set('min_price', minPrice);
  if (maxPrice) query.set('max_price', maxPrice);
  query.set('page', String(page));
  query.set('limit', '24');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['store-products', query.toString()],
    queryFn: () => apiRequest<Paginated<Product>>(`/marketplace/products?${query.toString()}`)
  });

  const categories = useQuery({
    queryKey: ['store-categories'],
    queryFn: () => apiRequest<Category[]>('/marketplace/categories'),
    staleTime: 5 * 60 * 1000
  });

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    next.delete('page');
    setParams(next);
  }

  const title = q ? `Resultados para «${q}»` : category ? category : 'Todos los productos';

  return (
    <div className="page search-layout">
      <aside className="filters">
        <h3>Categorías</h3>
        <button
          type="button"
          className={category === '' ? 'filter-item active' : 'filter-item'}
          onClick={() => updateFilter('category', '')}
        >
          Todas
        </button>
        {(categories.data ?? []).map((item) => (
          <button
            key={item.name}
            type="button"
            className={category === item.name ? 'filter-item active' : 'filter-item'}
            onClick={() => updateFilter('category', item.name)}
          >
            {item.name} <span className="filter-count">({item.products_count})</span>
          </button>
        ))}

        <h3>Precio</h3>
        <form
          className="price-filter"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const min = (form.elements.namedItem('min') as HTMLInputElement).value;
            const max = (form.elements.namedItem('max') as HTMLInputElement).value;
            updateFilter('min_price', min);
            updateFilter('max_price', max);
          }}
        >
          <input name="min" type="number" min="0" placeholder="Mínimo" defaultValue={minPrice} />
          <span>—</span>
          <input name="max" type="number" min="0" placeholder="Máximo" defaultValue={maxPrice} />
          <button type="submit">Aplicar</button>
        </form>
      </aside>

      <section className="results">
        <div className="results-header">
          <h1>{title}</h1>
          <label className="sort-select">
            Ordenar por:{' '}
            <select value={sort} onChange={(event) => updateFilter('sort', event.target.value)}>
              {SORT_LABELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading && (
          <div className="product-grid">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="product-card skeleton-card" />
            ))}
          </div>
        )}

        {isError && <p className="empty-state">No pudimos cargar los productos. Intenta de nuevo.</p>}

        {data && data.data.length === 0 && (
          <div className="empty-state">
            <h2>Sin resultados</h2>
            <p>Prueba con otras palabras o quita los filtros.</p>
            <Link to="/buscar">Ver todo el catálogo</Link>
          </div>
        )}

        {data && data.data.length > 0 && (
          <>
            <p className="results-count">{data.meta.total} resultados</p>
            <div className="product-grid">
              {data.data.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={data.meta.totalPages}
              onPage={(nextPage) => {
                const next = new URLSearchParams(params);
                next.set('page', String(nextPage));
                setParams(next);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPage
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let index = start; index <= end; index += 1) pages.push(index);
  return (
    <nav className="pagination" aria-label="Paginación">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      {pages.map((item) => (
        <button
          key={item}
          type="button"
          className={item === page ? 'active' : ''}
          onClick={() => onPage(item)}
        >
          {item}
        </button>
      ))}
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Siguiente
      </button>
    </nav>
  );
}
