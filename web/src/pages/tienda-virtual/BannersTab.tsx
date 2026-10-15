import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useAdminBannersQuery, useApiMutation } from '../../pos-queries';
import { createAdminBanner, deleteAdminBanner } from '../../api';
import { formatDate } from '../../format';

export default function BannersTab() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const [imageUrl, setImageUrl] = useState('');
  const [notice, setNotice] = useState('');
  const query = useAdminBannersQuery(token, tenantId);

  const createMutation = useApiMutation((url: string) => createAdminBanner({ image_url: url }));
  const deleteMutation = useApiMutation((id: string) => deleteAdminBanner(id));

  const banners = query.data ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = imageUrl.trim();
    if (url.length < 4) {
      setNotice('Ingresa una URL de imagen válida.');
      return;
    }
    setNotice('');
    createMutation.mutate(url, {
      onSuccess: async () => {
        setNotice('Banner agregado.');
        setImageUrl('');
        await queryClient.invalidateQueries({ queryKey: ['admin-banners'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function confirmDelete(id: string) {
    if (!window.confirm('¿Eliminar este banner de la tienda virtual?')) return;
    setNotice('');
    deleteMutation.mutate(id, {
      onSuccess: async () => {
        setNotice('Banner eliminado.');
        await queryClient.invalidateQueries({ queryKey: ['admin-banners'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  return (
    <Panel className="stack full-width">
      <p className="muted">
        Banners del carrusel de la app móvil. La tabla `banners` es global (no distingue tenant), así que estos
        cambios aplican a toda la tienda virtual.
      </p>
      <form className="toolbar" onSubmit={submit}>
        <label className="search-label">URL de imagen
          <div className="search-row">
            <input
              className="search"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://…/banner.jpg"
              maxLength={1000}
            />
            <button className="primary" type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Agregando…' : 'Agregar banner'}
            </button>
          </div>
        </label>
      </form>
      {notice ? <Notice tone={/error|inválid|invalid|no fue|no se|obligator/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {query.isError ? <Notice tone="error">No fue posible cargar los banners.</Notice> : null}
      <div className="banner-grid">
        {banners.map((banner) => (
          <article className="banner-card" key={banner.id}>
            <img src={banner.image_url} alt="Banner" loading="lazy" />
            <small className="block muted" title={banner.image_url}>{banner.image_url}</small>
            <small className="block muted">{formatDate(banner.created_at)}</small>
            <button
              className="icon-button danger"
              type="button"
              title="Eliminar banner"
              aria-label="Eliminar banner"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete(banner.id)}
            >
              🗑️
            </button>
          </article>
        ))}
        {banners.length === 0 && !query.isPending ? <div className="empty">No hay banners activos.</div> : null}
      </div>
    </Panel>
  );
}
