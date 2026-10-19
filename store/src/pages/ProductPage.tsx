import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  apiRequest,
  fetchMyReviewContext,
  formatMoney,
  submitMarketplaceReview,
  type ProductDetail,
  type ReviewsPayload
} from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import { ProductCard } from '../components/ProductCard';
import { Button, buttonStyles } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Rating } from '../components/ui/Rating';
import { Select, Textarea } from '../components/ui/Input';
import { ProductGridSkeleton, Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { pushRecent, snapshotProduct, toggleFavorite, useFavorites } from '../local-lists';
import { useDocumentMeta } from '../use-document-meta';

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const navigate = useNavigate();
  const cart = useCart();
  const toast = useToast();
  const { customer } = useAuth();
  const queryClient = useQueryClient();

  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);

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

  const myReview = useQuery({
    queryKey: ['store-my-review', productId],
    queryFn: () => fetchMyReviewContext(productId),
    enabled: Boolean(customer) && Number.isSafeInteger(productId) && productId > 0
  });

  const submitReview = useMutation({
    mutationFn: () => submitMarketplaceReview(productId, reviewRating, reviewComment),
    onSuccess: () => {
      toast.push('¡Gracias por tu calificación!');
      setReviewRating(0);
      setReviewComment('');
      setReviewError(null);
      void queryClient.invalidateQueries({ queryKey: ['store-product-reviews', productId] });
      void queryClient.invalidateQueries({ queryKey: ['store-my-review', productId] });
      void queryClient.invalidateQueries({ queryKey: ['store-product', productId] });
    },
    onError: (caught) => {
      setReviewError(
        caught instanceof ApiError ? caught.message : 'No pudimos guardar tu calificación.'
      );
    }
  });

  const images = useMemo(() => {
    if (!product.data) return [];
    return [product.data.image_url, product.data.image_2_url, product.data.image_3_url].filter(
      (value): value is string => typeof value === 'string'
    );
  }, [product.data]);

  const favorites = useFavorites();
  const favorite = product.data ? favorites.includes(product.data.id) : false;
  useEffect(() => {
    if (product.data) pushRecent(snapshotProduct(product.data));
  }, [product.data]);
  useDocumentMeta({
    title: product.data ? `${product.data.name} — Tienderu.com` : 'Tienderu.com',
    description: product.data?.details ? product.data.details.slice(0, 160) : null,
    image: product.data?.image_url ?? product.data?.image_2_url ?? null
  });

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

  function shareWhatsApp() {
    if (!data) return;
    const text = `${data.name} — ${formatMoney(data.price)}\n${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: data.name,
            description: data.details ?? undefined,
            image: images.length > 0 ? images : undefined,
            sku: data.code ?? undefined,
            offers: {
              '@type': 'Offer',
              url: window.location.href,
              priceCurrency: 'COP',
              price: data.price,
              availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
            },
            ...(data.average_rating !== null
              ? {
                  aggregateRating: {
                    '@type': 'AggregateRating',
                    ratingValue: data.average_rating,
                    reviewCount: data.reviews_count
                  }
                }
              : {})
          }).replace(/</g, '\\u003c')
        }}
      />
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
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
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
          <div className="flex min-h-[280px] flex-1 overflow-hidden rounded-card">
            {currentImage ? (
              <img
                src={currentImage}
                alt={data.name ?? 'Producto'}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-7xl text-line" aria-hidden="true">
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

          <div className="mt-2 flex flex-col gap-3 rounded-card border border-line bg-line-soft/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-12"
                  aria-label={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  onClick={() => {
                    const added = toggleFavorite(snapshotProduct(data));
                    toast.push(added ? 'Agregado a favoritos' : 'Quitado de favoritos');
                  }}
                >
                  <Icon name="heart" className={favorite ? 'h-4 w-4 fill-current text-deal-600' : 'h-4 w-4'} />
                </Button>
                <Button variant="outline" className="h-12 whitespace-nowrap" onClick={shareWhatsApp}>
                  <Icon name="phone" className="h-4 w-4" /> Compartir
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                disabled={!inStock}
                onClick={() => addToCart(false)}
                className="h-12 whitespace-nowrap sm:flex-1"
              >
                <Icon name="cart" className="h-4 w-4" /> Agregar al carrito
              </Button>
              <Button
                size="lg"
                variant="dark"
                disabled={!inStock}
                onClick={() => addToCart(true)}
                className="h-12 whitespace-nowrap sm:flex-1"
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

        {!customer ? (
          <p className="mb-4 text-sm text-ink-soft">
            <Link
              to={`/ingresar?next=/producto/${productId}`}
              className="font-semibold text-link-600 hover:underline"
            >
              Inicia sesión
            </Link>{' '}
            para calificar este producto si lo compraste.
          </p>
        ) : myReview.data?.review ? (
          <div className="mb-5 rounded-card border border-line bg-line-soft/40 p-4">
            <p className="text-sm font-semibold text-ink">Tu calificación</p>
            <div className="mt-1 flex items-center gap-3">
              <Rating rating={myReview.data.review.rating} showEmpty={false} />
              <span className="text-xs text-ink-soft">Gracias por calificar este producto.</span>
            </div>
            {myReview.data.review.comment ? (
              <p className="mt-1 text-sm text-ink/90">{myReview.data.review.comment}</p>
            ) : null}
          </div>
        ) : myReview.data?.can_review ? (
          <form
            className="mb-5 rounded-card border border-line bg-line-soft/40 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reviewRating < 1) {
                setReviewError('Elige de 1 a 5 estrellas.');
                return;
              }
              setReviewError(null);
              submitReview.mutate();
            }}
          >
            <p className="text-sm font-semibold text-ink">Califica este producto</p>
            <div className="mt-2 flex items-center gap-0.5" role="radiogroup" aria-label="Calificación">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={reviewRating === value}
                  aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`}
                  onClick={() => setReviewRating(value)}
                  className="rounded p-0.5 transition-transform hover:scale-110"
                >
                  <Icon
                    name="star"
                    className={`h-6 w-6 ${value <= reviewRating ? 'text-star' : 'text-star-empty'}`}
                  />
                </button>
              ))}
            </div>
            <Textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="¿Qué te pareció el producto? (opcional)"
              aria-label="Comentario de la opinión"
              className="mt-3"
            />
            {reviewError ? <p className="mt-2 text-sm font-semibold text-price">{reviewError}</p> : null}
            <Button type="submit" size="sm" className="mt-3" disabled={submitReview.isPending}>
              {submitReview.isPending ? 'Enviando…' : 'Publicar opinión'}
            </Button>
          </form>
        ) : null}

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
                <li key={`${review.source}-${review.id}`} className="py-4 first:pt-0">
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
