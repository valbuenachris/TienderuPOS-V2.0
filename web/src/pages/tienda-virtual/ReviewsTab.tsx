import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useAdminReviewsQuery, useApiMutation } from '../../pos-queries';
import { deleteAdminReview } from '../../api';
import { formatDate } from '../../format';

function stars(rating: number): string {
  const filled = Math.max(0, Math.min(5, rating));
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`;
}

export default function ReviewsTab() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const query = useAdminReviewsQuery(token, tenantId, page, 20);
  const deleteMutation = useApiMutation((id: number) => deleteAdminReview(id));

  const rows = query.data?.data ?? [];

  function confirmDelete(id: number, productName: string | null) {
    if (!window.confirm(`¿Eliminar la reseña de “${productName ?? 'producto'}”? Esta acción no se puede deshacer.`)) return;
    setNotice('');
    deleteMutation.mutate(id, {
      onSuccess: async () => {
        setNotice('Reseña eliminada.');
        await queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  return (
    <Panel className="stack full-width">
      <p className="muted">Reseñas de productos escritas por clientes de la app. El borrado es definitivo.</p>
      {notice ? <Notice tone={/error|no fue|inválid|invalid|no se/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {query.isError ? <Notice tone="error">No fue posible cargar las reseñas.</Notice> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Producto</th><th>Cliente</th><th>Calificación</th><th>Comentario</th><th>Fecha</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {rows.map((review) => (
              <tr key={review.id}>
                <td><strong>{review.product_name || `#${review.product_id}`}</strong></td>
                <td>{review.customer_name || 'Cliente verificado'}</td>
                <td><span className="text-warn" title={`${review.rating} de 5`}>{stars(review.rating)}</span></td>
                <td>{review.comment || '—'}</td>
                <td>{formatDate(review.created_at)}</td>
                <td className="row-actions">
                  <button
                    className="icon-button danger"
                    type="button"
                    title="Eliminar reseña"
                    aria-label="Eliminar reseña"
                    disabled={deleteMutation.isPending}
                    onClick={() => confirmDelete(review.id, review.product_name)}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !query.isPending ? (
              <tr><td colSpan={6} className="empty">No hay reseñas registradas todavía.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {query.data ? (
        <Pagination
          page={query.data.meta.page}
          totalPages={query.data.meta.totalPages}
          total={query.data.meta.total}
          onChange={setPage}
        />
      ) : null}
    </Panel>
  );
}
