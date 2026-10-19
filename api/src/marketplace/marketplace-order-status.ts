/**
 * Estado del pedido padre calculado a partir de sus sub-órdenes.
 * `cancelled` es terminal y se excluye del total activo; si TODAS las
 * sub-órdenes están canceladas, el pedido queda `cancelled`.
 * Función pura para poder probarla con el runner existente.
 */
export function computeParentOrderStatus(rows: Array<{ status: string; count: number }>): string {
  const counts = new Map(rows.map((row) => [row.status, row.count]));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return 'pending_payment';

  const cancelled = counts.get('cancelled') ?? 0;
  const active = total - cancelled;
  if (active === 0) return 'cancelled';

  const delivered = counts.get('delivered') ?? 0;
  const shipped = (counts.get('shipped') ?? 0) + delivered;
  const preparing = (counts.get('preparing') ?? 0) + shipped;
  const paid = (counts.get('paid') ?? 0) + preparing;

  if (delivered === active) return 'delivered';
  if (shipped === active) return 'shipped';
  if (preparing === active) return 'preparing';
  if (paid === active) return 'paid';
  return 'pending_payment';
}
