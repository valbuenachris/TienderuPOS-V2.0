import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonStyles } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ProductCard } from '../components/ProductCard';
import { readFavorites, savedToProduct, useFavorites } from '../local-lists';
import { useDocumentMeta } from '../use-document-meta';

export function FavoritesPage() {
  useDocumentMeta({ title: 'Favoritos — Tienderu.com' });
  useFavorites(); // reactividad: re-render al quitar favoritos
  const [items] = useState(() => readFavorites());

  if (items.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="heart"
          title="Aún no tienes favoritos"
          description="Toca el corazón en los productos que te gusten para guardarlos aquí."
          action={
            <Link to="/buscar" className={buttonStyles({ variant: 'primary' })}>
              Explorar la tienda
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-page py-6">
      <h1 className="mb-4 text-xl font-bold text-ink sm:text-2xl">Favoritos</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {readFavorites().map((saved) => (
          <ProductCard key={saved.id} product={savedToProduct(saved)} />
        ))}
      </div>
    </div>
  );
}
