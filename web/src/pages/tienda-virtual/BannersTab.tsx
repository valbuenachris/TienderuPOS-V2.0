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
  const [title, setTitle] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [notice, setNotice] = useState('');
  const query = useAdminBannersQuery(token, tenantId);

  const createMutation = useApiMutation((params: { image_url: string; title?: string; target_url?: string }) =>
    createAdminBanner(params)
  );
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
    createMutation.mutate(
      {
        image_url: url,
        title: title.trim() || undefined,
        target_url: targetUrl.trim() || undefined
      },
      {
        onSuccess: async () => {
          setNotice('Banner agregado.');
          setImageUrl('');
          setTitle('');
          setTargetUrl('');
          await queryClient.invalidateQueries({ queryKey: ['admin-banners'] });
        },
        onError: (error: Error) => setNotice(error.message)
      }
    );
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
        Banners del carrusel de la app móvil. Cada tenant administra sus propios banners.
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
          </div>
        </label>
        <label className="search-label">Título (opcional)
          <div className="search-row">
            <input
              className="search"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ej: Promoción de noviembre"
              maxLength={120}
            />
          </div>
        </label>
        <label className="search-label">URL de destino (opcional)
          <div className="search-row">
            <input
              className="search"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://…"
              maxLength={500}
            />
          </div>
        </label>
        <button className="primary" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Agregando…' : 'Agregar banner'}
        </button>
      </form>
      {notice ? <Notice tone={/error|inválid|invalid|no fue|no se|obligator/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {query.isError ? <Notice tone="error">No fue posible cargar los banners.</Notice> : null}
      <div className="banner-grid">
        {banners.map((banner) => (
          <article className="banner-card" key={banner.id}>
            <img src={banner.image_url} alt={banner.title ?? 'Banner'} loading="lazy" />
            {banner.title ? <strong className="block">{banner.title}</strong> : null}
            {banner.target_url ? <small className="block muted" title={banner.target_url}>🔗 {banner.target_url}</small> : null}
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
