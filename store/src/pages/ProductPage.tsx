import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatMoney, type ProductDetail, type ReviewsPayload } from '../api';
import { useCart } from '../cart';
import { ProductCard, RatingStars } from '../components/ProductCard';

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const navigate = useNavigate();
  const cart = useCart();
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [added, setAdded] = useState(false);

  const product = useQuery({
    queryKey: ['store-product', productId],
    queryFn: () => apiRequest<ProductDetail>(`/marketplace/products/${productId}`),
    enabled: Number.isSafeInteger(productId) && productId > 0
  });

  const reviews = useQuery({
    queryKey: ['store-product-reviews', productId, reviewsPage],
    queryFn: () => apiRequest<ReviewsPayload>(`/marketplace/products/${productId}/reviews?page=${reviewsPage}&limit=10`),
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
      <div className="page product-detail">
        <div className="product-detail-media skeleton" />
        <div className="product-detail-info">
          <div className="skeleton-line skeleton" />
          <div className="skeleton-line skeleton" />
          <div className="skeleton-line short skeleton" />
        </div>
      </div>
    );
  }
  if (product.isError || !product.data) {
    return (
      <div className="page empty-state">
        <h2>Producto no disponible</h2>
        <p>El producto que buscas ya no está publicado en la tienda.</p>
        <Link to="/buscar">Volver al catálogo</Link>
      </div>
    );
  }

  const data = product.data;
  const currentImage = images[imageIndex] ?? null;

  function addToCart(goCheckout = false) {
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
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2500);
    if (goCheckout) navigate('/carrito');
  }

  return (
    <div className="page product-detail">
      <nav className="breadcrumb">
        <Link to="/">Inicio</Link>
        {data.category_name && (
          <>
            {' › '}
            <Link to={`/buscar?category=${encodeURIComponent(data.category_name)}`}>{data.category_name}</Link>
          </>
        )}
        {' › '}
        <span>{data.name}</span>
      </nav>

      <div className="product-detail-main">
        <div className="product-detail-media">
          <div className="thumbnails">
            {images.map((image, index) => (
              <button
                key={image}
                type="button"
                className={index === imageIndex ? 'thumbnail active' : 'thumbnail'}
                onClick={() => setImageIndex(index)}
              >
                <img src={image} alt={`Vista ${index + 1}`} />
              </button>
            ))}
          </div>
          <div className="main-image">
            {currentImage ? (
              <img src={currentImage} alt={data.name ?? 'Producto'} />
            ) : (
              <div className="product-card-placeholder large">🛍️</div>
            )}
          </div>
        </div>

        <div className="product-detail-info">
          <h1>{data.name}</h1>
          <div className="product-detail-rating">
            <RatingStars rating={data.average_rating} count={data.reviews_count} />
            {data.code && <span className="product-code">Código: {data.code}</span>}
          </div>
          <div className="product-detail-price">{formatMoney(data.price)}</div>
          <p className="product-detail-tax-note">Precio final con impuestos incluidos.</p>

          <Link to={`/vendedor/${data.seller.id}`} className="seller-chip">
            Vendido por <strong>{data.seller.name}</strong>
          </Link>

          <div className="product-detail-stock">
            {data.available_quantity > 0 ? (
              <span className="in-stock">Disponible ({data.available_quantity} unidades)</span>
            ) : (
              <span className="out-stock">Agotado</span>
            )}
          </div>

          {data.details && <p className="product-detail-description">{data.details}</p>}

          <div className="buy-box">
            <label>
              Cantidad:{' '}
              <select
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                disabled={data.available_quantity === 0}
              >
                {Array.from({ length: Math.min(10, data.available_quantity) }).map((_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={data.available_quantity === 0}
              onClick={() => addToCart(false)}
            >
              Agregar al carrito
            </button>
            <button
              type="button"
              className="btn-buy"
              disabled={data.available_quantity === 0}
              onClick={() => addToCart(true)}
            >
              Comprar ahora
            </button>
            {added && <div className="added-note">✔ Agregado al carrito</div>}
          </div>
        </div>
      </div>

      <section className="reviews-section">
        <h2>Opiniones de clientes</h2>
        {reviews.data && reviews.data.reviews_count === 0 && (
          <p className="muted">Este producto aún no tiene opiniones.</p>
        )}
        {reviews.data && reviews.data.reviews_count > 0 && (
          <>
            <div className="reviews-summary">
              <RatingStars rating={reviews.data.average_rating ? Number(reviews.data.average_rating) : null} />
              <span>
                {reviews.data.reviews_count} {reviews.data.reviews_count === 1 ? 'opinión' : 'opiniones'}
              </span>
            </div>
            <ul className="reviews-list">
              {reviews.data.reviews.data.map((review) => (
                <li key={review.id}>
                  <div className="review-head">
                    <strong>{review.customer_name ?? 'Cliente'}</strong>
                    <RatingStars rating={review.rating} />
                  </div>
                  {review.comment && <p>{review.comment}</p>}
                </li>
              ))}
            </ul>
            {reviews.data.reviews.meta.totalPages > 1 && (
              <div className="reviews-pagination">
                <button
                  type="button"
                  disabled={reviewsPage <= 1}
                  onClick={() => setReviewsPage((current) => current - 1)}
                >
                  Anterior
                </button>
                <span>
                  Página {reviewsPage} de {reviews.data.reviews.meta.totalPages}
                </span>
                <button
                  type="button"
                  disabled={reviewsPage >= reviews.data.reviews.meta.totalPages}
                  onClick={() => setReviewsPage((current) => current + 1)}
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {data.related.length > 0 && (
        <section className="product-rail">
          <div className="rail-header">
            <h2>Productos relacionados</h2>
          </div>
          <div className="rail-scroll">
            {data.related.map((related) => (
              <div key={related.id} className="rail-item">
                <ProductCard product={related} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
