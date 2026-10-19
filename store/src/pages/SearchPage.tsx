import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type Category, type Paginated, type Product } from '../api';
import { ProductCard } from '../components/ProductCard';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Input, Select } from '../components/ui/Input';
import { Pagination } from '../components/ui/Pagination';
import { ProductGridSkeleton } from '../components/ui/Skeleton';
import { useDocumentMeta } from '../use-document-meta';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'newest', label: 'Más recientes' },
  { value: 'price_asc', label: 'Precio: menor a mayor' },
  { value: 'price_desc', label: 'Precio: mayor a menor' },
  { value: 'rating', label: 'Mejor calificados' }
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'relevance';
  const minPrice = params.get('min_price') ?? '';
  const maxPrice = params.get('max_price') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (category) query.set('category', category);
  query.set('sort', sort);
  if (minPrice) query.set('min_price', minPrice);
  if (maxPrice) query.set('max_price', maxPrice);
  query.set('page', String(page));
  query.set('limit', '24');

  const products = useQuery({
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

  function applyPrice(min: string, max: string) {
    const next = new URLSearchParams(params);
    if (min.trim() === '') next.delete('min_price');
    else next.set('min_price', min.trim());
    if (max.trim() === '') next.delete('max_price');
    else next.set('max_price', max.trim());
    next.delete('page');
    setParams(next);
  }

  const activeChips: Array<{ label: string; clear: () => void }> = [];
  if (q) activeChips.push({ label: `«${q}»`, clear: () => updateFilter('q', '') });
  if (category)
    activeChips.push({ label: category, clear: () => updateFilter('category', '') });
  if (minPrice || maxPrice) {
    activeChips.push({
      label: `Precio: ${minPrice || '0'} – ${maxPrice || '∞'}`,
      clear: () => applyPrice('', '')
    });
  }
  if (sort !== 'relevance')
    activeChips.push({
      label: SORT_OPTIONS.find((option) => option.value === sort)?.label ?? sort,
      clear: () => updateFilter('sort', 'relevance')
    });

  const title = q ? `Resultados para «${q}»` : category ? category : 'Todo el catálogo';
  useDocumentMeta({
    title: q
      ? `«${q}» — Buscar en Tienderu.com`
      : category
        ? `${category} — Tienderu.com`
        : 'Todo el catálogo — Tienderu.com'
  });

  const filtersPanel = (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">Categorías</h3>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => {
              updateFilter('category', '');
              setFiltersOpen(false);
            }}
            className={`rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
              category === '' ? 'bg-sky-50 font-semibold text-link-600' : 'text-ink hover:bg-line-soft'
            }`}
          >
            Todas
          </button>
          {(categories.data ?? []).map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => {
                updateFilter('category', item.name);
                setFiltersOpen(false);
              }}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                category === item.name
                  ? 'bg-sky-50 font-semibold text-link-600'
                  : 'text-ink hover:bg-line-soft'
              }`}
            >
              <span className="truncate">{item.name}</span>
              <span className="ml-2 text-xs text-ink-soft">{item.products_count}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">Precio</h3>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const min = (form.elements.namedItem('min') as HTMLInputElement).value;
            const max = (form.elements.namedItem('max') as HTMLInputElement).value;
            applyPrice(min, max);
            setFiltersOpen(false);
          }}
        >
          <Input name="min" type="number" min="0" placeholder="Mínimo" defaultValue={minPrice} aria-label="Precio mínimo" />
          <span className="text-ink-soft">—</span>
          <Input name="max" type="number" min="0" placeholder="Máximo" defaultValue={maxPrice} aria-label="Precio máximo" />
          <Button type="submit" variant="outline" size="sm">
            Aplicar
          </Button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="container-page py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink sm:text-2xl">{title}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
            <Icon name="filter" className="h-4 w-4" /> Filtros
          </Button>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <span className="hidden sm:inline">Ordenar por</span>
            <span className="w-44">
              <Select
                value={sort}
                onChange={(event) => updateFilter('sort', event.target.value)}
                aria-label="Ordenar resultados"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </span>
          </label>
        </div>
      </div>

      {activeChips.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.clear}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-line-soft"
              aria-label={`Quitar filtro ${chip.label}`}
            >
              {chip.label}
              <Icon name="close" className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setParams(q ? new URLSearchParams({ q }) : new URLSearchParams())}
            className="text-xs font-semibold text-link-600 hover:underline"
          >
            Limpiar todo
          </button>
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:items-start lg:gap-6">
        <aside className="sticky top-32 hidden rounded-card bg-white p-4 shadow-card lg:block">
          {filtersPanel}
        </aside>

        <section>
          {products.isLoading ? <ProductGridSkeleton count={8} /> : null}

          {products.isError ? (
            <EmptyState
              icon="alert"
              title="No pudimos cargar los productos"
              description="Revisa tu conexión e intenta de nuevo."
            />
          ) : null}

          {products.data && products.data.data.length === 0 ? (
            <EmptyState
              icon="search"
              title="Sin resultados"
              description="Prueba con otras palabras o quita los filtros."
              action={
                <Link
                  to="/buscar"
                  className="inline-flex rounded-full bg-accent-400 px-5 py-2 text-sm font-semibold text-navy-900 hover:bg-accent-500"
                >
                  Ver todo el catálogo
                </Link>
              }
            />
          ) : null}

          {products.data && products.data.data.length > 0 ? (
            <>
              <p className="mb-3 text-sm text-ink-soft">
                {products.data.meta.total}{' '}
                {products.data.meta.total === 1 ? 'resultado' : 'resultados'}
              </p>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {products.data.data.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <Pagination
                className="mt-8"
                page={page}
                totalPages={products.data.meta.totalPages}
                onChange={(nextPage) => {
                  const next = new URLSearchParams(params);
                  next.set('page', String(nextPage));
                  setParams(next);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          ) : null}
        </section>
      </div>

      <Dialog open={filtersOpen} title="Filtros" onClose={() => setFiltersOpen(false)}>
        {filtersPanel}
      </Dialog>
    </div>
  );
}
