import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, type Product } from '../api';
import { useCart } from '../cart';
import { snapshotProduct, toggleFavorite, useFavorites } from '../local-lists';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { Rating } from './ui/Rating';
import { useToast } from './ui/Toast';

export function ProductCard({ product }: { product: Product }) {
  const image = product.image_url ?? product.image_2_url ?? product.image_3_url;
  const lowStock = product.available_quantity > 0 && product.available_quantity <= 5;
  const favorites = useFavorites();
  const favorite = favorites.includes(product.id);
  const cart = useCart();
  const toast = useToast();
  const [added, setAdded] = useState(false);
  const resetTimer = useRef<number | null>(null);
  const outOfStock = product.available_quantity <= 0;

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    []
  );

  function addToCart(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (outOfStock || added) return;
    cart.addItem(
      {
        product_id: product.id,
        name: product.name ?? `Producto ${product.id}`,
        price: product.price,
        image_url: image,
        seller_id: product.seller.id,
        seller_name: product.seller.name,
        available_quantity: product.available_quantity
      },
      1
    );
    toast.push('Producto agregado al carrito');
    setAdded(true);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <Link
      to={`/producto/${product.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-card border border-transparent bg-white shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-line hover:shadow-card-hover"
    >
      <button
        type="button"
        aria-label={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        title={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleFavorite(snapshotProduct(product));
        }}
        className={`absolute right-2 top-2 z-10 rounded-full bg-white/90 p-1.5 shadow-card transition-colors hover:bg-white ${
          favorite ? 'text-deal-600' : 'text-ink-soft'
        }`}
      >
        <Icon name="heart" className={favorite ? 'h-4 w-4 fill-current' : 'h-4 w-4'} />
      </button>
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
        <Button
          size="sm"
          full
          disabled={outOfStock}
          onClick={addToCart}
          aria-label={outOfStock ? 'Producto agotado' : added ? 'Agregado al carrito' : 'Agregar al carrito'}
          className="mt-1 hover:shadow-md"
        >
          <Icon name={added ? 'check' : 'cart'} className="h-4 w-4 shrink-0" />
          <span className={added ? 'inline' : 'hidden sm:inline'}>
            {added ? 'Agregado' : 'Agregar al carrito'}
          </span>
        </Button>
      </div>
    </Link>
  );
}
