import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatMoney, type ProductDetail, type ReviewsPayload } from '../api';
import { useCart } from '../cart';
import { ProductCard } from '../components/ProductCard';
import { Button, buttonStyles } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Rating } from '../components/ui/Rating';
import { Select } from '../components/ui/Input';
import { ProductGridSkeleton, Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const navigate = useNavigate();
  const cart = useCart();
  const toast = useToast();

  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);

  const product = useQuery({
    queryKey: ['store-product', productId],
    queryFn: () => apiRequest<ProductDetail>(`/marketplace/products/${productId}`),
    enabled: Number.isSafeInteger(productId) && productId > 0
  });

  const reviews = useQuery({
    queryKey: ['store-product-reviews', productId, reviewsPage],
    queryFn: () =>
      apiRequest<ReviewsPayload>(`/marketplace/products/${productId}/reviews?page=${reviewsPage}&limit=10`),
    enabled: Number.isSafeInteger(productId) && productId > 0
  });

  const images = useMemo(() => {
    if (!product.data) return [];
    return [product.data.image_url, product.data.image_2_url, product.data.image_3_url].filter(
      (value): value is string => typeof value === 'string'
    );
  }, [product.data]);

  if (product.isLoading) {
    return (
      <div className="container-page py-6">
        <div className="grid gap-8 rounded-card bg-white p-6 shadow-card lg:grid-cols-2">
          <Skeleton className="aspect-square w-full" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-9 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (product.isError || !product.data) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="package"
          title="Producto no disponible"
          description="El producto que buscas ya no está publicado en la tienda."
          action={
            <Link to="/buscar" className={buttonStyles({ variant: 'primary' })}>
              Volver al catálogo
            </Link>
          }
        />
      </div>
    );
  }

  const data = product.data;
  const currentImage = images[imageIndex] ?? null;
  const inStock = data.available_quantity > 0;

  function addToCart(goCheckout: boolean) {
    if (!data) return;
    cart.addItem(
      {
        product_id: data.id,
        name: data.name ?? `Producto ${data.id}`,
        price: data.price,
        image_url: currentImage,
        seller_id: data.seller.id,
        seller_name: data.seller.name,
        available_quantity: data.available_quantity
      },
      quantity
    );
    toast.push(goCheckout ? 'Producto agregado. Redirigiendo al carrito…' : 'Producto agregado al carrito');
    if (goCheckout) navigate('/carrito');
  }

  return (
    <div className="container-page py-6">
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-xs text-ink-soft" aria-label="Ruta de navegación">
        <Link to="/" className="hover:text-link-600 hover:underline">
          Inicio
        </Link>
        {data.category_name ? (
          <>
            <Icon name="chevron-right" className="h-3 w-3" />
            <Link
              to={`/buscar?category=${encodeURIComponent(data.category_name)}`}
              className="hover:text-link-600 hover:underline"
            >
              {data.category_name}
            </Link>
          </>
        ) : null}
        <Icon name="chevron-right" className="h-3 w-3" />
        <span className="text-ink">{data.name}</span>
      </nav>

      <div className="grid gap-8 rounded-card bg-white p-5 shadow-card sm:p-6 lg:grid-cols-[minmax(0,44%)_1fr]">
        <div className="flex flex-col-reverse gap-3 sm:flex-row lg:sticky lg:top-32 lg:self-start">
          {images.length > 1 ? (
            <div className="flex gap-2 sm:flex-col" role="list" aria-label="Miniaturas del producto">
              {images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  role="listitem"
                  onClick={() => setImageIndex(index)}
                  aria-label={`Ver imagen ${index + 1}`}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 bg-white p-1 transition-colors ${
                    index === imageIndex ? 'border-link-600' : 'border-line hover:border-link-600'
                  }`}
                >
                  <img src={image} alt="" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-1 items-center justify-center rounded-card">
            {currentImage ? (
              <img
                src={currentImage}
                alt={data.name ?? 'Producto'}
                className="max-h-[440px] w-full object-contain"
              />
            ) : (
              <span className="flex aspect-square w-full items-center justify-center text-7xl text-line" aria-hidden="true">
                🛍️
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-xl font-bold leading-snug text-ink sm:text-2xl">{data.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Rating rating={data.average_rating} count={data.reviews_count} size="md" />
            {data.code ? <span className="text-xs text-ink-soft">Código: {data.code}</span> : null}
          </div>

          <div className="border-y border-line-soft py-3">
            <p className="text-3xl font-semibold text-price">{formatMoney(data.price)}</p>
            <p className="text-xs text-ink-soft">Precio final con impuestos incluidos</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/vendedor/${data.seller.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-line-soft px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-line"
            >
              <Icon name="store" className="h-4 w-4" /> Vendido por {data.seller.name}
            </Link>
            <span
              className={
                inStock
                  ? 'inline-flex items-center gap-1 text-sm font-semibold text-success-600'
                  : 'inline-flex items-center gap-1 text-sm font-semibold text-price'
              }
            >
              <Icon name={inStock ? 'check' : 'alert'} className="h-4 w-4" />
              {inStock ? `Disponible (${data.available_quantity} unidades)` : 'Agotado'}
            </span>
          </div>

          {data.details ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink/90">{data.details}</p> : null}

          <div className="mt-2 flex flex-col gap-3 rounded-card border border-line bg-line-soft/50 p-4 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              Cantidad
              <span className="w-20">
                <Select
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  disabled={!inStock}
                  aria-label="Cantidad"
                >
                  {Array.from({ length: Math.min(10, Math.max(1, data.available_quantity)) }).map((_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </Select>
              </span>
            </label>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <Button size="lg" disabled={!inStock} onClick={() => addToCart(false)} className="flex-1">
                <Icon name="cart" className="h-4 w-4" /> Agregar al carrito
              </Button>
              <Button
                size="lg"
                variant="dark"
                disabled={!inStock}
                onClick={() => addToCart(true)}
                className="flex-1"
              >
                Comprar ahora
              </Button>
            </div>
          </div>

          <ul className="mt-1 grid gap-2 text-xs text-ink-soft sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <Icon name="credit-card" className="h-4 w-4" /> Pago seguro con tarjetas y PSE (Bold)
            </li>
            <li className="flex items-center gap-2">
              <Icon name="truck" className="h-4 w-4" /> Envío coordinado con el vendedor
            </li>
          </ul>
        </div>
      </div>

      <section className="mt-8 rounded-card bg-white p-5 shadow-card sm:p-6" aria-label="Opiniones de clientes">
        <h2 className="mb-4 text-lg font-bold text-ink">Opiniones de clientes</h2>
        {reviews.data && reviews.data.reviews_count === 0 ? (
          <p className="text-sm text-ink-soft">Este producto aún no tiene opiniones.</p>
        ) : null}
        {reviews.data && reviews.data.reviews_count > 0 ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Rating
                rating={reviews.data.average_rating ? Number(reviews.data.average_rating) : null}
                size="md"
              />
              <span className="text-sm text-ink-soft">
                {reviews.data.reviews_count} {reviews.data.reviews_count === 1 ? 'opinión' : 'opiniones'}
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-line-soft">
              {reviews.data.reviews.data.map((review) => (
                <li key={review.id} className="py-4 first:pt-0">
                  <div className="mb-1 flex flex-wrap items-center gap-3">
                    <strong className="text-sm text-ink">{review.customer_name ?? 'Cliente'}</strong>
                    <Rating rating={review.rating} showEmpty={false} />
                  </div>
                  {review.comment ? <p className="text-sm text-ink/90">{review.comment}</p> : null}
                </li>
              ))}
            </ul>
            {reviews.data.reviews.meta.totalPages > 1 ? (
              <div className="mt-4 flex items-center gap-3 text-sm">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reviewsPage <= 1}
                  onClick={() => setReviewsPage((current) => current - 1)}
                >
                  Anterior
                </Button>
                <span className="text-ink-soft">
                  Página {reviewsPage} de {reviews.data.reviews.meta.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reviewsPage >= reviews.data.reviews.meta.totalPages}
                  onClick={() => setReviewsPage((current) => current + 1)}
                >
                  Siguiente
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {reviews.isLoading ? <Skeleton className="h-4 w-56" /> : null}
      </section>

      {data.related.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold text-ink">Productos relacionados</h2>
          {product.isFetching ? (
            <ProductGridSkeleton count={4} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {data.related.map((related) => (
                <ProductCard key={related.id} product={related} />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
