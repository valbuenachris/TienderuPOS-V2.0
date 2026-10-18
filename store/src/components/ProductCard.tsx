import { Link } from 'react-router-dom';
import { formatMoney, type Product } from '../api';

export function RatingStars({ rating, count }: { rating: number | null; count?: number }) {
  if (rating === null || rating === undefined) {
    return <span className="rating-empty">Sin calificaciones</span>;
  }
  const rounded = Math.round(rating * 2) / 2;
  return (
    <span className="rating" aria-label={`${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= rounded ? 'star filled' : star - 0.5 === rounded ? 'star half' : 'star'}>
          ★
        </span>
      ))}
      {count !== undefined && <span className="rating-count">({count})</span>}
    </span>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const image = product.image_url ?? product.image_2_url ?? product.image_3_url;
  return (
    <Link to={`/producto/${product.id}`} className="product-card">
      <div className="product-card-image">
        {image ? (
          <img src={image} alt={product.name ?? 'Producto'} loading="lazy" />
        ) : (
          <div className="product-card-placeholder">🛍️</div>
        )}
      </div>
      <div className="product-card-body">
        <h3 className="product-card-title">{product.name ?? `Producto ${product.id}`}</h3>
        <RatingStars rating={product.average_rating} count={product.reviews_count} />
        <div className="product-card-price">{formatMoney(product.price)}</div>
        <div className="product-card-seller">Vendido por {product.seller.name}</div>
        {product.available_quantity <= 5 && (
          <div className="product-card-low-stock">Solo quedan {product.available_quantity}</div>
        )}
      </div>
    </Link>
  );
}
