import { Link } from 'react-router-dom';
import { formatMoney, type Product } from '../api';
import { Rating } from './ui/Rating';

export function ProductCard({ product }: { product: Product }) {
  const image = product.image_url ?? product.image_2_url ?? product.image_3_url;
  const lowStock = product.available_quantity > 0 && product.available_quantity <= 5;

  return (
    <Link
      to={`/producto/${product.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-transparent bg-white shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-line hover:shadow-card-hover"
    >
      <div className="flex h-44 items-center justify-center bg-white p-3 sm:h-48">
        {image ? (
          <img
            src={image}
            alt={product.name ?? 'Producto'}
            loading="lazy"
            className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="text-4xl text-line" aria-hidden="true">
            🛍️
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-4">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink">
          {product.name ?? `Producto ${product.id}`}
        </h3>
        <Rating rating={product.average_rating} count={product.reviews_count} />
        <div className="mt-auto">
          <p className="text-lg font-semibold text-price">{formatMoney(product.price)}</p>
          <p className="truncate text-xs text-ink-soft">Vendido por {product.seller.name}</p>
          {lowStock ? (
            <p className="text-xs font-semibold text-deal-600">
              Solo quedan {product.available_quantity}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
